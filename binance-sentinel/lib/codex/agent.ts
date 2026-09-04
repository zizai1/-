import { prisma } from "@/lib/memory/database";
import { getProfile } from "@/lib/memory/profile";
import { getPortfolio, type PortfolioSnapshot } from "./balance";
import {
  checkNewOrder,
  checkCancelOrder,
  checkCancelOpenOrders,
  type GuardResult,
} from "./guard";
import { codex } from "./client";

const WS_URL = process.env.CODEX_WS_URL || "ws://127.0.0.1:8787";

const TURN_TIMEOUT_MS = 10 * 60 * 1000;
const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;
const MCP_READY_TIMEOUT_MS = 120 * 1000;

const APPROVAL_POLICY = {
  granular: {
    mcp_elicitations: true,
    rules: false,
    sandbox_approval: false,
    skill_approval: false,
    request_permissions: false,
  },
};

export interface ActivityEntry {
  time: number;
  text: string;
  tone?: "info" | "success" | "warning" | "danger";
  authorizationUrl?: string;
}

export interface ConfirmRequest {
  requestId: number;
  sessionId: string;
  tool: "spot.newOrder" | "spot.cancelOrder" | "spot.deleteOrder" | "spot.deleteOpenOrders";
  kind: "order" | "cancel";
  params: Record<string, unknown>;
  summary: string;
}

export interface TurnHandlers {
  onDelta: (delta: string) => void;
  onActivity: (a: ActivityEntry) => void;
  onBalance: (snapshot: PortfolioSnapshot) => void;
  onConfirm: (req: ConfirmRequest) => void;
  onDone: (text: string) => void;
}

function buildSystemPrompt(profile: {
  riskPreference: string;
  favoriteAssets: string[];
  tradingStyle: string;
}): string {
  return `
你是「币安哨兵」交易助手，用中文与用户自然对话。

硬性规则：
1. 行情、余额、挂单、订单等一切数据必须调用 MCP 工具获取真实数据（如 spot.getAccount、spot.getOpenOrders），严禁编造价格、余额或订单信息。
2. 下单（spot.newOrder）、撤单（spot.deleteOrder、spot.deleteOpenOrders）等资金操作会被系统拦截并交用户人工确认；你可以发起这些工具调用，但只有用户确认后才真正执行。不要声称「已经下单/已经撤单」，要说「已提交确认，请查看确认卡片」。
3. 可以分析、可以建议，但不催促交易、不承诺收益、不制造紧迫感。
4. 用户要求下单/撤单时，直接调用对应工具并给出正确参数，系统会接管审批流程。
5. 下单前必须先核对规则，避免参数被系统拦截：用 spot.exchangeInfo 查该交易对的步长（LOT_SIZE）与最小名义金额（MIN_NOTIONAL），用 spot.getAccount 查现货可用余额；数量向下取整到步长；只能卖「可用余额」，被挂单锁定的数量不能卖。
6. 如果工具调用被系统拒绝并附带原因，按原因修正参数后重试一次，并向用户说明修正了什么。
7. 不要用 tool_search、list_mcp_resources 枚举工具列表；只有当你需要执行某操作（如下单）但不确定工具名时，才用 tool_search 精确查找该工具。
8. 回答简洁，闲聊简短。

用户画像：风险偏好 ${profile.riskPreference}，常关注资产 ${profile.favoriteAssets.join("、")}，交易风格 ${profile.tradingStyle}。
`.trim();
}

// 从审批请求里解析真实工具名与参数（tool_execute 包装时取内层 toolName/arguments）。
// 线上工具名两种形态并存：直接调用为点分（spot.deleteOrder），
// tool_execute 包装的隐藏工具为下划线（spot_newOrder）→ 统一规范成点分。
function resolveTool(params: any): { tool: string; args: Record<string, unknown> } {
  const tp = params?._meta?.tool_params ?? {};
  if (typeof tp.toolName === "string" && tp.toolName) {
    const inner = tp.arguments;
    return {
      tool: tp.toolName.replaceAll("_", "."),
      args: inner && typeof inner === "object" ? (inner as Record<string, unknown>) : {},
    };
  }
  const m = /run tool "([^"]+)"/.exec(params?.message ?? "");
  return {
    tool: m ? m[1].replaceAll("_", ".") : "",
    args: tp && typeof tp === "object" ? tp : {},
  };
}

type ToolClass = "readonly" | "mutating" | "unknown";

// 分类必须偏保守：宁可拒绝，不可把变更类工具误判为只读而自动放行
const MUTATING_RE =
  /(neworder|new_order|cancel|close|delete|remove|withdraw|transfer|redeem|borrow|repay|loan|settle|toggle|update|edit|place|subscribe|create|post|change|modify|adjust|enable|disable)/i;
const READONLY_RE =
  /(get|query|all|account|balance|position|ticker|price|exchangeinfo|servertime|ping|history|status|depth|kline|candle|rate|income|premium|funding|book|leverage)/i;

function classifyTool(tool: string): ToolClass {
  const n = tool.toLowerCase();
  if (
    n === "spot.neworder" ||
    n === "spot.cancelorder" ||
    n === "spot.deleteorder" ||
    n === "spot.deleteopenorders"
  )
    return "mutating";
  if (n === "tool_search") return "readonly";
  if (MUTATING_RE.test(n)) return "mutating";
  if (READONLY_RE.test(n)) return "readonly";
  return "unknown";
}

function summarize(tool: string, args: Record<string, unknown>): string {
  if (tool === "spot.newOrder") {
    const side = String(args.side ?? "").toUpperCase() === "SELL" ? "卖出" : "买入";
    const qty = args.quantity ?? "";
    const symbol = String(args.symbol ?? "").toUpperCase();
    const quote = args.quoteOrderQty;
    if (qty) return `${side} ${qty} ${symbol}（市价）`;
    if (quote != null) return `${side} ≈${quote} USDT 的 ${symbol}（市价）`;
    return `${side} ${symbol}（市价）`;
  }
  if (tool === "spot.cancelOrder" || tool === "spot.deleteOrder") {
    const symbol = String(args.symbol ?? "").toUpperCase();
    return `撤销挂单 ${args.orderId ?? ""}${symbol ? `（${symbol}）` : ""}`;
  }
  if (tool === "spot.deleteOpenOrders") {
    const symbol = String(args.symbol ?? "").toUpperCase();
    return `撤销 ${symbol} 全部挂单`;
  }
  return tool;
}

// 其他审批请求类型（命令执行/文件变更/权限等）的结构化拒绝，同旧 denyByMethod
function denyByMethod(method: string, params: any): unknown {
  const m = method.toLowerCase();
  if (m.includes("elicitation")) return { action: "decline", content: null };
  if (m.includes("commandexecution")) return { action: "deny" };
  if (m.includes("execcommand")) return { action: "deny", host: params?.host ?? "" };
  if (m.includes("applypatch") || m.includes("filechange")) return { action: "deny" };
  if (m.includes("permissionsrequest")) return { entries: [], read: [], write: [] };
  if (m.includes("toolrequestuserinput")) return { answers: [] };
  if (m.includes("fuzzyfilesearch")) return [];
  return { action: "deny" };
}

// ---------- 待确认审批注册表（跨 /api/agent 与 /api/agent/confirm 共享） ----------

type PendingConfirm = {
  requestId: number;
  session: TurnSession;
  req: ConfirmRequest;
  handlers: TurnHandlers;
  timer: NodeJS.Timeout;
};

const pendingConfirms = new Map<number, PendingConfirm>();

function registerPendingConfirm(
  pc: Omit<PendingConfirm, "timer">
): void {
  const timer = setTimeout(() => {
    const cur = pendingConfirms.get(pc.requestId);
    if (!cur) return;
    pendingConfirms.delete(pc.requestId);
    cur.session.respond(pc.requestId, {
      action: "decline",
      content: { message: "确认超时，系统已自动拒绝，未执行" },
    });
    cur.handlers.onActivity({
      time: Date.now(),
      text: `确认超时，已自动拒绝 ${cur.req.summary}`,
      tone: "warning",
    });
  }, CONFIRM_TIMEOUT_MS);
  pendingConfirms.set(pc.requestId, { ...pc, timer });
}

export function respondConfirm(requestId: number, approve: boolean): boolean {
  const pc = pendingConfirms.get(requestId);
  if (!pc) return false;
  clearTimeout(pc.timer);
  pendingConfirms.delete(requestId);
  if (approve) {
    pc.session.respond(requestId, { action: "accept", content: {} });
    pc.handlers.onActivity({
      time: Date.now(),
      text: `已批准：${pc.req.summary}，等待执行结果`,
      tone: "info",
    });
  } else {
    pc.session.respond(requestId, {
      action: "decline",
      content: { message: "用户拒绝了该操作，未执行" },
    });
    pc.handlers.onActivity({
      time: Date.now(),
      text: `已拒绝：${pc.req.summary}`,
      tone: "warning",
    });
  }
  return true;
}

// ---------- 单轮 turn 的 WebSocket 会话 ----------

class TurnSession {
  readonly sessionId: string;
  // 常驻连接跨轮复用，handlers 每轮由 runTurn 更新为当前请求的回调
  handlers: TurnHandlers;
  onConnectionLost: (() => void) | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private threadId: string | null = null;
  private turnId: string | null = null;
  private turnActive = false;
  private agentText = "";
  private doneResolve: (() => void) | null = null;
  private doneReject: ((e: Error) => void) | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private mcpStatus: string | null = null;
  private mcpReadyResolve: ((ready: boolean) => void) | null = null;
  private closed = false;
  // 本轮 guard 拦截原因：轮次结束后自动补一轮系统提示，让 agent 向用户解释并修正重试
  guardNote: string | null = null;
  private turnCompletedOnce = false;

  constructor(sessionId: string, handlers: TurnHandlers) {
    this.sessionId = sessionId;
    this.handlers = handlers;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      ws.onopen = async () => {
        this.ws = ws;
        try {
          await this.send("initialize", {
            clientInfo: { name: "binance-sentinel", version: "1.0.0" },
            capabilities: { experimentalApi: true },
          });
          resolve();
        } catch (e) {
          reject(e as Error);
        }
      };
      ws.onerror = () => reject(new Error(`无法连接 codex app-server（${WS_URL}）`));
      ws.onclose = () => {
        this.teardown();
      };
      ws.onmessage = (ev) => this.handleMessage(ev.data.toString());
    });
  }

  isOpen(): boolean {
    return !this.closed && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  isMcpReady(): boolean {
    return this.mcpStatus === "ready";
  }

  getMcpStatus(): string | null {
    return this.mcpStatus;
  }

  markTurnCompleted(): void {
    this.turnCompletedOnce = true;
  }

  hasCompletedTurn(): boolean {
    return this.turnCompletedOnce;
  }

  // 连接断开/主动关闭的统一清理：拒绝在途请求与当前轮，通知外部移除会话
  private teardown(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    for (const [, entry] of this.pending) {
      entry.reject(new Error("与 codex app-server 的连接已断开"));
    }
    this.pending.clear();
    if (this.doneReject) {
      this.doneReject(new Error("与 codex app-server 的连接已断开"));
      this.doneReject = null;
    }
    this.onConnectionLost?.();
  }

  send(method: string, params: any, timeoutMs = 60000): Promise<any> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new Error("not connected"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`));
      }, timeoutMs);
    });
  }

  respond(id: number, result: unknown): void {
    if (!this.isOpen()) return;
    try {
      this.ws?.send(JSON.stringify({ id, result }));
    } catch {
      // 发送失败（连接已断）由 teardown 兜底
    }
  }

  async startThread(baseInstructions: string): Promise<string> {
    const res = await this.send("thread/start", { baseInstructions });
    const threadId = res?.thread?.id;
    if (!threadId) throw new Error("thread/start 未返回 thread id");
    this.threadId = threadId;
    // 新线程要重新注册 MCP，旧线程的 ready 状态作废，重新等通知
    this.mcpStatus = null;
    return threadId;
  }

  // 复用已有 thread 必须 resume：审批请求只发给 thread 的 listener，
  // 不复用则 turn 会在 waitingOnApproval 上永远挂起（见 Phase 0 教训）
  async resumeThread(threadId: string): Promise<string> {
    const res = await this.send("thread/resume", {
      threadId,
      excludeTurns: true,
    });
    const id = res?.thread?.id ?? threadId;
    this.threadId = id;
    return id;
  }

  setThread(threadId: string): void {
    this.threadId = threadId;
  }

  getThreadId(): string | null {
    return this.threadId;
  }

  // startupStatus/updated 是每 thread 一份的通知，thread 就绪后等待 binance MCP ready
  waitMcpReady(timeoutMs = MCP_READY_TIMEOUT_MS): Promise<boolean> {
    if (this.mcpStatus === "ready") return Promise.resolve(true);
    return new Promise((resolve) => {
      this.mcpReadyResolve = resolve;
      setTimeout(() => {
        if (this.mcpReadyResolve) {
          this.mcpReadyResolve = null;
          console.warn("[agent] binance-mcp-server ready 等待超时，继续执行");
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  async startTurn(message: string): Promise<void> {
    // 常驻连接跨轮复用：清掉上一轮的状态
    this.turnActive = false;
    this.turnId = null;
    this.agentText = "";
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }

    const res = await this.send("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text: message }],
      approvalPolicy: APPROVAL_POLICY,
      approvalsReviewer: "user",
    });
    this.turnId = res?.turn?.id ?? null;
    // daemon 会把线程事件广播给所有 listener，只有自己的 turn 开始后才接受
    this.turnActive = true;
    this.watchdog = setTimeout(() => {
      if (this.doneReject) {
        this.doneReject(new Error("turn 超时未完成"));
        this.doneReject = null;
      }
    }, TURN_TIMEOUT_MS);
  }

  waitDone(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.doneResolve = resolve;
      this.doneReject = reject;
    });
  }

  close(): void {
    this.teardown();
    try {
      this.ws?.close();
    } catch {
      // 已关闭
    }
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (typeof msg.id === "number" || typeof msg.id === "string") {
      const entry = this.pending.get(msg.id as number);
      if (entry) {
        this.pending.delete(msg.id as number);
        if (msg.error) entry.reject(new Error(msg.error.message ?? "codex error"));
        else entry.resolve(msg.result);
        return;
      }
      if (msg.method) {
        this.handleServerRequest(msg.id as number, msg.method, msg.params ?? {});
      }
      return;
    }

    const m: string = msg.method ?? "";
    const p = msg.params ?? {};

    switch (m) {
      case "turn/started": {
        break;
      }
      case "turn/completed": {
        if (!this.turnActive) break;
        if (this.turnId && p.turn?.id !== this.turnId) break;
        this.turnActive = false; // daemon 可能重复投递 turn/completed，只处理一次
        if (p.turn?.error) {
          const err = new Error(
            p.turn.error.message ?? JSON.stringify(p.turn.error)
          );
          if (this.doneReject) {
            this.doneReject(err);
            this.doneReject = null;
          }
        } else {
          this.handlers.onDone(this.agentText);
          if (this.doneResolve) {
            this.doneResolve();
            this.doneResolve = null;
          }
        }
        break;
      }
      case "item/agentMessage/delta": {
        if (!this.turnActive) break;
        if (this.turnId && p.turnId && p.turnId !== this.turnId) break;
        // delta 可能是纯字符串，也可能是 {text} 对象（不同 codex 版本形态不一）
        const text: string =
          typeof p.delta === "string" ? p.delta : (p.delta?.text ?? "");
        if (text) {
          this.agentText += text;
          this.handlers.onDelta(text);
        }
        break;
      }
      case "item/started": {
        if (!this.turnActive) break;
        if (this.turnId && p.turnId && p.turnId !== this.turnId) break;
        if (p.item?.type === "mcpToolCall") this.onToolStarted(p.item);
        break;
      }
      case "item/completed": {
        if (!this.turnActive) break;
        if (this.turnId && p.turnId && p.turnId !== this.turnId) break;
        const item = p.item;
        if (item?.type === "mcpToolCall") {
          void this.onToolCompleted(item);
        } else if (item?.type === "agentMessage" && typeof item.text === "string" && item.text) {
          this.agentText = item.text;
        }
        break;
      }
      case "mcpServer/startupStatus/updated": {
        if (this.threadId && p.threadId !== this.threadId) break;
        if (p.name === "binance-mcp-server") {
          this.mcpStatus = p.status;
          if (p.status === "ready" && this.mcpReadyResolve) {
            this.mcpReadyResolve(true);
            this.mcpReadyResolve = null;
          }
        }
        break;
      }
      case "error": {
        console.error("[agent] codex error:", JSON.stringify(p).slice(0, 500));
        break;
      }
      default:
        break;
    }
  }

  private async handleServerRequest(
    id: number,
    method: string,
    params: any
  ): Promise<void> {
    // 同一 thread 可能被多条连接监听（热重载残留/僵尸连接）：只有当前 turn 的
    // 持有者才能应答，否则旧连接抢答 decline 会把确认流程“拦截”掉
    if (!this.turnActive) return;
    if (this.turnId && params?.turnId && params.turnId !== this.turnId) return;

    if (method === "mcpServer/elicitation/request") {
      if (params?._meta?.codex_approval_kind !== "mcp_tool_call") {
        // OAuth（url 模式）等非工具审批：turn 流程不处理，授权过期走 -2015 → mcpLogin 路径
        this.respond(id, { action: "decline", content: null });
        return;
      }

      const { tool, args } = resolveTool(params);
      const cls = classifyTool(tool);

      if (cls === "readonly") {
        this.respond(id, { action: "accept", content: {} });
        return;
      }

      if (
        cls === "mutating" &&
        (tool === "spot.newOrder" ||
          tool === "spot.cancelOrder" ||
          tool === "spot.deleteOrder" ||
          tool === "spot.deleteOpenOrders")
      ) {
        const guard: GuardResult =
          tool === "spot.newOrder"
            ? await checkNewOrder(args)
            : tool === "spot.deleteOpenOrders"
              ? await checkCancelOpenOrders(args)
              : await checkCancelOrder(args);
        if (!guard.ok) {
          this.handlers.onActivity({
            time: Date.now(),
            text: `已拦截 ${summarize(tool, args)}：${guard.reason}`,
            tone: "warning",
          });
          this.respond(id, { action: "decline", content: null });
          // decline 不带内容（协议限制，模型看不到原因）→ 轮次结束后由系统提示轮转告
          this.guardNote = `你刚才发起的 ${summarize(tool, args)} 被安全拦截，原因：${guard.reason}。请向用户解释原因；修正参数后如可行，直接重新发起工具调用（会再次进入人工确认）。`;
          return;
        }

        // daemon 可能重复投递同一审批请求：已在等待用户确认则不重复注册
        if (pendingConfirms.has(id)) return;

        const req: ConfirmRequest = {
          requestId: id,
          sessionId: this.sessionId,
          tool: tool as ConfirmRequest["tool"],
          kind: tool === "spot.newOrder" ? "order" : "cancel",
          params: args,
          summary: summarize(tool, args),
        };
        registerPendingConfirm({
          requestId: id,
          session: this,
          req,
          handlers: this.handlers,
        });
        this.handlers.onConfirm(req);
        return;
      }

      // 其他变更类/未知工具：保守拒绝
      const reason =
        cls === "mutating"
          ? `该操作（${tool}）未获支持`
          : `未知工具 ${tool}，已拦截`;
      this.handlers.onActivity({
        time: Date.now(),
        text: reason,
        tone: "warning",
      });
      this.respond(id, { action: "decline", content: null });
      this.guardNote = `你刚才发起的工具调用（${tool}）被拦截：${reason}。请向用户解释该操作暂不支持。`;
      return;
    }

    const denial = denyByMethod(method, params);
    console.log("[agent] denied server request:", method);
    this.respond(id, denial);
  }

  private onToolStarted(item: any): void {
    if (item.server !== "binance-mcp-server") return; // 过滤 codex 内置元工具噪音
    // tool_execute 包装（隐藏工具）：展示内层真实工具名与参数
    let tool = item.tool;
    let args = item.arguments ?? {};
    if (tool === "tool_execute" && typeof args.toolName === "string") {
      tool = args.toolName;
      args = args.arguments ?? {};
    }
    const argsBrief = JSON.stringify(args).slice(0, 160);
    this.handlers.onActivity({
      time: Date.now(),
      text: `调用 ${tool}${argsBrief && argsBrief !== "{}" ? ` ${argsBrief}` : ""}`,
      tone: "info",
    });
  }

  private async onToolCompleted(item: any): Promise<void> {
    if (item.server !== "binance-mcp-server") return;

    // tool_execute 包装（隐藏工具）：统一用内层真实工具名展示与分类
    const inner = item.arguments ?? {};
    const toolName =
      item.tool === "tool_execute" && typeof inner.toolName === "string"
        ? inner.toolName
        : item.tool;

    if (item.status === "completed") {
      this.handlers.onActivity({
        time: Date.now(),
        text: `✓ ${toolName} 完成`,
        tone: "success",
      });
      // 变更类工具成功后刷新余额
      if (classifyTool(toolName) === "mutating") {
        try {
          const snapshot = await getPortfolio();
          this.handlers.onBalance(snapshot);
        } catch (e) {
          console.error("[agent] 余额刷新失败:", e);
        }
      }
      return;
    }

    const errText =
      item.error?.message ??
      (item.result?.content ?? [])
        .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
        .join("")
        .slice(0, 300);

    // 授权过期自愈：拿到授权链接交给前端展示
    let authorizationUrl: string | undefined;
    if (/-2015|invalid api-key|not authenticated|unauthorized/i.test(errText)) {
      try {
        authorizationUrl = await codex.mcpLogin("binance-mcp-server");
      } catch {
        // 登录发起失败，仅展示原始错误
      }
    }

    this.handlers.onActivity({
      time: Date.now(),
      text: `✗ ${toolName} 失败：${errText || "未知错误"}`,
      tone: "danger",
      authorizationUrl,
    });
  }
}

// ---------- 会话级 turn 编排 ----------

const activeTurns = new Set<string>();

export function isTurnActive(sessionId: string): boolean {
  return activeTurns.has(sessionId);
}

// MCP 就绪检查：只信线程级 startupStatus/updated 通知。
// daemon 的全局 mcpServerStatus/list 要 ~6s 且 runtimeStatus 恒为 null，不可用。
// 新建线程必注册 → 等 ready（实测 ~5s）；复用线程无通知即已注册 → 不等，
// 除非状态明确是 "starting"（竞态）才等，避免 warm 线程干等 60s。
async function ensureMcpReady(session: TurnSession, freshThread: boolean): Promise<void> {
  if (session.isMcpReady()) return;
  if (!freshThread && session.getMcpStatus() !== "starting") return;
  await session.waitMcpReady(60_000);
}

// 会话级常驻连接：同一 sessionId 复用 WS 与 thread，避免每轮 resume 触发
// MCP 重注册（实测 ~5s）与跨连接事件串扰（每会话仅一条连接）
const sessionStore = new Map<string, TurnSession>();

export async function runTurn(
  sessionId: string,
  message: string,
  handlers: TurnHandlers,
  signal?: AbortSignal
): Promise<void> {
  if (activeTurns.has(sessionId)) {
    throw new Error("上一轮对话仍在进行中，请稍候");
  }
  activeTurns.add(sessionId);

  let session: TurnSession;
  try {
    const existing = sessionStore.get(sessionId);
    let freshThread = false;
    if (existing && existing.isOpen()) {
      session = existing;
      session.handlers = handlers;
    } else {
      sessionStore.delete(sessionId);
      session = new TurnSession(sessionId, handlers);
      session.onConnectionLost = () => {
        if (sessionStore.get(sessionId) === session) {
          sessionStore.delete(sessionId);
        }
      };
      await session.connect();

      // sessionId ↔ threadId 复用（baseInstructions 含用户画像，仅首次创建）
      const row = await prisma.codexThread.findUnique({ where: { sessionId } });
      if (row?.threadId) {
        try {
          await session.resumeThread(row.threadId);
        } catch (e) {
          // daemon 侧 thread 已失效（重启/清理）→ 重建
          if (!/thread not found/i.test(String(e))) throw e;
          console.warn("[agent] thread 失效，重建:", sessionId);
          await prisma.codexThread.delete({ where: { sessionId } }).catch(() => {});
          const profile = await getProfile(sessionId);
          await session.startThread(buildSystemPrompt(profile));
          freshThread = true;
          await prisma.codexThread.upsert({
            where: { sessionId },
            update: { threadId: session.getThreadId() ?? "" },
            create: { sessionId, threadId: session.getThreadId() ?? "" },
          });
        }
      } else {
        const profile = await getProfile(sessionId);
        await session.startThread(buildSystemPrompt(profile));
        freshThread = true;
        await prisma.codexThread.upsert({
          where: { sessionId },
          update: { threadId: session.getThreadId() ?? "" },
          create: { sessionId, threadId: session.getThreadId() ?? "" },
        });
      }
      sessionStore.set(sessionId, session);
    }

    await ensureMcpReady(session, freshThread);

    if (signal?.aborted) throw new Error("客户端已断开");

    try {
      await session.startTurn(message);
    } catch (e) {
      // daemon 侧 thread 已失效（重启/清理）→ 重建 thread 后重试一次
      if (!/thread not found/i.test(String(e))) throw e;
      console.warn("[agent] thread 失效，重建:", sessionId);
      await prisma.codexThread.delete({ where: { sessionId } }).catch(() => {});
      const profile = await getProfile(sessionId);
      await session.startThread(buildSystemPrompt(profile));
      await prisma.codexThread.upsert({
        where: { sessionId },
        update: { threadId: session.getThreadId() ?? "" },
        create: { sessionId, threadId: session.getThreadId() ?? "" },
      });
      await ensureMcpReady(session, true);
      await session.startTurn(message);
    }

    await session.waitDone();
    session.markTurnCompleted();

    // guard 拦截说明轮：decline 无法携带原因（协议限制），模型只看到
    // "user rejected"；补一轮系统提示让 agent 解释原因并修正参数重试。
    // 只补一轮：说明轮内即使再次拦截也不再触发，避免循环。
    const note = session.guardNote;
    session.guardNote = null;
    if (note) {
      try {
        await session.startTurn(`[系统提示] ${note}`);
        await session.waitDone();
      } catch (e) {
        console.error("[agent] 拦截说明轮失败:", e);
      }
    }
  } catch (e) {
    // 失败清理：断开并移除会话，下条消息自动重建（自愈）
    const s = sessionStore.get(sessionId);
    if (s) {
      s.close();
      sessionStore.delete(sessionId);
    }
    throw e;
  } finally {
    activeTurns.delete(sessionId);
    // 连接常驻：下一轮复用同一 thread，免去 resume 与 MCP 重注册
  }
}

export type AgentStatus = {
  connected: boolean;
  mcp: "ready" | "starting" | "offline";
};

// 供 /api/agent/status 轮询（前端 MCP 状态灯）：只读内存状态，不发 WS 请求
export function getAgentStatus(sessionId = "default"): AgentStatus {
  const s = sessionStore.get(sessionId);
  if (!s || !s.isOpen()) return { connected: false, mcp: "offline" };
  // 跑完过一轮 turn 即证明 MCP 已注册（复用线程不重发 startupStatus 通知）
  if (s.isMcpReady() || s.hasCompletedTurn())
    return { connected: true, mcp: "ready" };
  if (s.getMcpStatus() === "starting")
    return { connected: true, mcp: "starting" };
  return { connected: true, mcp: "offline" };
}

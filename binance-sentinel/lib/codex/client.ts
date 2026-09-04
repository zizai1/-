const WS_URL = process.env.CODEX_WS_URL || "ws://127.0.0.1:8787";

const TURN_TIMEOUT_MS = 600_000;

// 安全层：无头模式下拒绝一切需要人工批准的请求。
// 各请求类型有各自的应答结构；elicitation 用 {action, content}，
// 纯字符串 "decline" 会被 daemon 当作无效应答，导致 turn 挂起。
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

class CodexClient {
  private ws: WebSocket | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private sysThreadId: string | null = null;

  connect(): Promise<void> {
    if (this.ready) return this.ready;

    this.ready = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(WS_URL);

      ws.onopen = async () => {
        this.ws = ws;
        try {
          await this.send("initialize", {
            clientInfo: { name: "binance-sentinel", version: "0.9.0" },
          });
          resolve();
        } catch (e) {
          reject(e as Error);
        }
      };

      ws.onerror = () => {
        this.ws = null;
        this.ready = null;
        reject(new Error(`Cannot connect to codex app-server at ${WS_URL}`));
      };

      ws.onclose = () => {
        this.ws = null;
        this.ready = null;
      };

      ws.onmessage = (event) => this.handleMessage(event.data.toString());
    });

    return this.ready;
  }

  private handleMessage(raw: string) {
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

      // 服务器发来的请求（需要人工批准）→ 一律拒绝
      if (msg.method) {
        console.log("[codex] denied server request:", msg.method, JSON.stringify(msg.params ?? {}).slice(0, 300));
        const denial = denyByMethod(msg.method, msg.params);
        this.ws?.send(JSON.stringify({ id: msg.id, result: denial }));
      }
      return;
    }

    const method: string = msg.method ?? "";
    const params = msg.params ?? {};

    switch (method) {
      case "item/started": {
        const type = params.item?.type;
        if (type && !["userMessage", "reasoning", "agentMessage"].includes(type)) {
          console.log("[codex] item started:", type, JSON.stringify(params.item ?? {}).slice(0, 300));
        }
        break;
      }
      case "error": {
        console.error("[codex] server error:", JSON.stringify(params).slice(0, 500));
        break;
      }
      default:
        break;
    }
  }

  private send(method: string, params: any): Promise<any> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new Error("not connected"));

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`));
      }, TURN_TIMEOUT_MS);
    });
  }

  async mcpStatus(): Promise<any[]> {
    await this.connect();
    const res = await this.send("mcpServerStatus/list", {});
    return res?.data ?? [];
  }

  async mcpLogin(name: string): Promise<string> {
    await this.connect();
    const res = await this.send("mcpServer/oauth/login", {
      name,
      timeoutSecs: 300,
    });
    return res?.authorizationUrl ?? "";
  }

  async mcpReload(): Promise<void> {
    await this.connect();
    await this.send("config/mcpServer/reload", {});
  }

  private async sysThread(): Promise<string> {
    if (this.sysThreadId) return this.sysThreadId;
    this.sysThreadId = await this.startThread();
    return this.sysThreadId;
  }

  // 通过 tool_execute 直接调用 Binance MCP 工具（包括 tool_search 才能发现的
  // 隐藏工具，如 spot.newOrder）。不经过 agent turn，所以不会触发审批、不会挂起。
  async mcpToolCall(
    server: string,
    tool: string,
    args: Record<string, unknown> = {}
  ): Promise<any> {
    await this.connect();
    let threadId = await this.sysThread();
    const call = () =>
      this.send("mcpServer/tool/call", {
        server,
        threadId,
        tool: "tool_execute",
        arguments: { toolName: tool, arguments: args },
      });
    try {
      return await call();
    } catch (e) {
      if (/thread not found/i.test(String(e))) {
        this.sysThreadId = null;
        threadId = await this.sysThread();
        return await call();
      }
      throw e;
    }
  }

  async startThread(baseInstructions?: string): Promise<string> {
    await this.connect();
    const res = await this.send("thread/start", {
      ...(baseInstructions ? { baseInstructions } : {}),
    });
    const threadId = res?.thread?.id;
    if (!threadId) throw new Error("no thread id in thread/start response");
    return threadId;
  }
}

export const codex = new CodexClient();

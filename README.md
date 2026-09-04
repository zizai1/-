# -# Binance Sentinel

AI 加密货币交易副驾驶（币安现货）。自然语言对话驱动：查行情、查余额、管挂单、下市价单，全部由 AI 调用币安官方 MCP 工具完成；所有资金操作（下单 / 撤单）必须经过前端人工确认后才真正执行。

三栏界面：左侧钱包总览（圆环图 + 持仓分布），中间对话（内嵌执行确认卡片），右侧 Agent Timeline（工具调用轨迹）。右上角 MCP 状态灯 + 币安账户登录/登出。

> 项目代码位于 `binance-sentinel/` 子目录，本文中所有命令均在该目录内执行。

## 功能特性

- 自然语言对话：DeepSeek 模型经 codex agent turn 驱动，流式输出（SSE）
- 真实数据：行情、余额、挂单、下单、撤单全部走币安官方 MCP（`agent.binance.com/mcp/agentic`），AI 禁止编造
- 执行确认卡片（Trade Proposal）：下单 / 撤单必须人工点击 CONFIRM 才执行，REJECT 或 5 分钟超时自动拒绝
- 安全 guard 校验：交易对步长（LOT_SIZE）、最小名义金额（MIN_NOTIONAL）、单笔上限、现货可用余额预检（含 1% 滑点余量）；校验失败由 AI 用中文解释原因并引导修正
- Agent Timeline：每次工具调用的操作轨迹实时可见
- MCP 登录 / 登出：头部状态灯实时反映币安 OAuth 绑定状态
- 授权过期自愈：工具调用返回 -2015 时自动发起重新授权，链接直达对话

## 安全模型

1. AI 可以分析、可以建议，但不能未经允许执行——变更类工具（`spot.newOrder`、`spot.deleteOrder`、`spot.deleteOpenOrders`）先过 guard 校验，再进确认卡片，人工批准后才放行
2. 单笔订单名义价值上限 `ORDER_MAX_USDT`（默认 1000 USDT，可用环境变量调整）
3. 工具分类偏保守：只读工具自动放行，未知工具一律拒绝
4. 确认请求 5 分钟无人应答自动拒绝，不悬挂
5. 模型不能"声称已下单"——系统提示强制其如实说明审批状态

## 架构

```
浏览器（Next.js 16 前端）
  │  POST /api/agent（SSE 事件流：delta / activity / balance / confirm / done）
  ▼
app/api/agent（SSE 中继，Node runtime）
  │  runTurn()
  ▼
lib/codex/agent.ts（codex agent turn 编排）
  │  WebSocket（常驻连接，session ↔ thread 复用）
  ▼
codex app-server daemon（ws://127.0.0.1:8787）
  │  工具调用 → 审批请求（elicitation）
  ▼
lib/codex/guard.ts（安全拦截层）
  ├─ 只读工具 → 自动批准
  ├─ 变更工具 → guard 校验 → 前端确认卡片（pendingConfirms 注册表）
  └─ 确认应答 ← /api/agent/confirm
  ▼
币安官方 MCP（行情 / 账户 / 挂单 / 交易）
```

前端只做展示与交互；对话、工具调用、审批编排全部在后端；guard 是资金安全最后一道闸。

## 技术栈

- Next.js 16（App Router）+ TypeScript + Tailwind CSS v4
- Prisma 7 + SQLite（会话消息、用户画像、thread 映射）
- codex CLI app-server（WebSocket JSON-RPC，模型经 DeepSeek API）
- 币安官方 MCP（OAuth 绑定）

## 目录结构

```
app/
  page.tsx                 # 首页（状态与 SSE 处理，渲染交给 components/）
  api/
    agent/                 # POST 对话 SSE 流；/confirm 审批应答；/status 状态灯
    balance/               # GET 持仓快照（含授权过期自愈）
    price/                 # GET 现价（确认卡片展示用）
    mcp/                   # login / logout / status（币安 OAuth 管理）
components/                # WalletCard / ChatPanel / AgentTimeline / ExecutionCard / MCPStatus
lib/
  codex/                   # agent.ts 会话编排 · client.ts daemon 客户端 · guard.ts 安全拦截
                           # binance-mcp.ts 直调 · balance.ts · orders.ts
  memory/                  # Prisma 持久化 · 用户画像
  tools/                   # 币安 REST 工具（ticker / 过滤器）
scripts/codex-server.sh    # 启动 codex app-server（读 .env.local 的 LLM_API_KEY）
prisma/schema.prisma       # SQLite 数据模型
```

注：`lib/providers/llm.ts` 与 `lib/indicators/technical.ts` 为早期遗留模块，当前未接入。

## 快速开始

前置要求：Node.js 20+、codex CLI、DeepSeek API Key、币安账户（现货）。

```bash
npm install
npx prisma db push        # 初始化 SQLite
npm run codex-server      # 终端 1：启动 codex app-server（ws://127.0.0.1:8787）
npm run dev               # 终端 2：启动前端 http://localhost:3000
```

打开页面后点右上角「登录」完成币安 OAuth 绑定，发第一条消息，MCP 状态灯变绿即就绪。完整步骤见 `配置说明.txt`。

## API 一览

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/api/agent` | POST | 对话入口，SSE 流：`delta`（文本）/ `activity`（操作流）/ `balance`（余额快照）/ `confirm`（待批准卡片）/ `done` / `error` |
| `/api/agent/confirm` | POST | `{requestId, approve}` 批准 / 拒绝待确认操作 |
| `/api/agent/status` | GET | agent 会话与 MCP 就绪状态（状态灯用，纯内存读取） |
| `/api/balance` | GET | 现货持仓快照（总资产、24h 变化、逐资产） |
| `/api/price` | GET | `?symbol=BTCUSDT` 现价与 24h 涨跌 |
| `/api/mcp/login` | POST | 发起币安 OAuth，返回授权链接 |
| `/api/mcp/logout` | POST | 登出币安 OAuth 并重载 MCP 配置 |
| `/api/mcp/status` | GET | OAuth 绑定状态与工具数 |

## 环境变量

| 变量 | 文件 | 必填 | 说明 |
| --- | --- | --- | --- |
| `LLM_API_KEY` | `.env.local` | 是 | DeepSeek API Key（由 codex-server.sh 转成 `DEEPSEEK_API_KEY` 注入 daemon） |
| `DATABASE_URL` | `.env` | 是 | 默认 `file:./prisma/dev.db` |
| `CODEX_WS_URL` | 可选 | 否 | daemon 地址，默认 `ws://127.0.0.1:8787` |
| `ORDER_MAX_USDT` | 可选 | 否 | 单笔订单名义价值上限，默认 1000 |

`.env*` 已被 .gitignore 排除，切勿提交真实 Key。

## 常见问题

- **MCP 状态灯不亮 / 显示未绑定**：点登录完成币安 OAuth；绑定后发一条消息点亮（复用会话不发启动通知，以跑通对话为准）
- **提示"上一轮对话仍在进行中"**：上一轮 turn 未结束，稍候重试
- **确认卡片被拦截 / 无响应**：重启 dev server 清除热重载残留的僵尸连接（审批请求广播给线程所有 listener，旧连接抢答会拦截流程）
- **工具调用返回 -2015**：授权过期，对话中会自动给出重新授权链接，或点右上角登录
- **提示无法连接 codex app-server**：确认 `npm run codex-server` 在运行、8787 端口可访问

## 免责声明

本项目仅供学习与研究。加密货币交易风险极高，AI 输出不构成投资建议；下单前请自行核对参数，盈亏自负。

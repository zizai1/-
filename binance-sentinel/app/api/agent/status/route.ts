import { getAgentStatus } from "@/lib/codex/agent";

export const runtime = "nodejs";

// GET → { connected, mcp: "ready" | "starting" | "offline" }，前端 MCP 状态灯轮询用
export async function GET() {
  return Response.json(getAgentStatus());
}

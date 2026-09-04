import { codex } from "./client";

export interface McpToolResult {
  structured: any;
  text: string;
  isError: boolean;
}

// 通过 codex daemon 的 mcpServer/tool/call → tool_execute 直接调用 Binance
// MCP 工具（含 tool_search 才能发现的隐藏工具，如 spot.newOrder）。
// 不经过 agent turn，无审批流程，即时返回。
export async function callBinanceTool(
  tool: string,
  args: Record<string, unknown> = {}
): Promise<McpToolResult> {
  const res = await codex.mcpToolCall("binance-mcp-server", tool, args);

  const content = res?.content ?? [];
  const text = content
    .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
    .join("")
    .trim();

  let structured = res?.structuredContent ?? null;
  if (structured == null && text) {
    try {
      structured = JSON.parse(text);
    } catch {
      // 非 JSON 文本（如纯字符串返回值）
    }
  }

  if (res?.isError) {
    throw new Error(`Binance MCP ${tool} failed: ${text.slice(0, 300)}`);
  }

  return { structured, text, isError: !!res?.isError };
}

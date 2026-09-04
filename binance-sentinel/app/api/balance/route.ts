import { NextResponse } from "next/server";
import { getPortfolio } from "@/lib/codex/balance";
import { codex } from "@/lib/codex/client";

export const runtime = "nodejs";

// 币安 MCP 授权过期时（-2015 等），自动发起重新授权并把链接返回给前端
async function authorizationUrlFor(error: string): Promise<string | undefined> {
  if (!/-2015|invalid api-key|not authenticated|unauthorized/i.test(error)) {
    return undefined;
  }
  try {
    return await codex.mcpLogin("binance-mcp-server");
  } catch {
    return undefined;
  }
}

export async function GET() {
  try {
    const portfolio = await getPortfolio();
    return NextResponse.json({ ok: true, ...portfolio });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        error,
        authorizationUrl: await authorizationUrlFor(error),
        totalUsdc: 0,
        change24hUsdc: 0,
        change24hPct: 0,
        balances: [],
        fetchedAt: Date.now(),
      },
      { status: 502 }
    );
  }
}

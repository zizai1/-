import { NextResponse } from "next/server";
import { codex } from "@/lib/codex/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const servers = await codex.mcpStatus();
    const binance = servers.find(
      (s: any) => s.name === "binance-mcp-server"
    );

    return NextResponse.json({
      bound: binance?.authStatus === "oAuth",
      authStatus: binance?.authStatus ?? "unknown",
      serverInfo: binance?.serverInfo ?? null,
      tools: binance ? Object.keys(binance.tools ?? {}).length : 0,
    });
  } catch (e) {
    return NextResponse.json(
      {
        bound: false,
        authStatus: "unknown",
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}

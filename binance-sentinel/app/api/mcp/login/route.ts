import { NextResponse } from "next/server";
import { codex } from "@/lib/codex/client";

export const runtime = "nodejs";

export async function POST() {
  try {
    const authorizationUrl = await codex.mcpLogin("binance-mcp-server");
    return NextResponse.json({ authorizationUrl });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}

import { NextResponse } from "next/server";
import { getTicker } from "@/lib/tools/binance";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!symbol) {
    return NextResponse.json({ error: "symbol 无效" }, { status: 400 });
  }

  try {
    const t = await getTicker(symbol);
    return NextResponse.json({ ok: true, ...t });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}

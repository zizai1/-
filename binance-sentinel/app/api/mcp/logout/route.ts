import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { codex } from "@/lib/codex/client";

export const runtime = "nodejs";

function runLogout(): Promise<void> {
  return new Promise((resolve, reject) => {
    // shell:true 才能解析 Windows 上的 codex.cmd（npm 全局 shim），
    // 参数为固定字符串，无注入风险
    execFile(
      "codex",
      ["mcp", "logout", "binance-mcp-server"],
      { timeout: 120_000, windowsHide: true, shell: true },
      (error) => {
        if (error) reject(error);
        else resolve();
      }
    );
  });
}

export async function POST() {
  try {
    await runLogout();
    await codex.mcpReload();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}

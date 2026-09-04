import { NextResponse } from "next/server";
import { respondConfirm } from "@/lib/codex/agent";

export const runtime = "nodejs";

// POST {requestId, approve} → 向 daemon 发送对应审批请求的批准/拒绝应答
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { requestId, approve } = body ?? {};

  const id = Number(requestId);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "requestId 无效" }, { status: 400 });
  }
  if (typeof approve !== "boolean") {
    return NextResponse.json({ error: "approve 必须是布尔值" }, { status: 400 });
  }

  const ok = respondConfirm(id, approve);
  if (!ok) {
    return NextResponse.json(
      { error: "审批请求不存在或已过期" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}

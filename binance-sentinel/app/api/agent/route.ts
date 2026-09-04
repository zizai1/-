import {
  runTurn,
  isTurnActive,
  type TurnHandlers,
} from "@/lib/codex/agent";
import { appendMessage } from "@/lib/memory/database";

export const runtime = "nodejs";

// POST {sessionId, message} → SSE 事件流：
// delta（对话文本）/ activity（操作流）/ balance（余额快照）/ confirm（待批准操作）/ done / error
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { sessionId = "default", message } = body ?? {};

  if (!message || typeof message !== "string") {
    return new Response(JSON.stringify({ error: "message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (message.length > 4000) {
    return new Response(JSON.stringify({ error: "message 过长" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (isTurnActive(sessionId)) {
    return new Response(
      JSON.stringify({ error: "上一轮对话仍在进行中，请稍候" }),
      { status: 409, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // 客户端已断开
        }
      }, 15000);

      let streamedText = "";

      const handlers: TurnHandlers = {
        onDelta: (delta) => {
          streamedText += delta;
          send({ type: "delta", delta });
        },
        onActivity: (activity) => send({ type: "activity", activity }),
        onBalance: (balance) => send({ type: "balance", balance }),
        onConfirm: (confirm) => send({ type: "confirm", confirm }),
        onDone: (text) => {
          // streamedText 跨轮累计（拦截说明轮追加后仍保持完整）
          send({ type: "done", text: streamedText || text });
        },
      };

      try {
        await runTurn(sessionId, message, handlers, req.signal);
      } catch (e) {
        send({
          type: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        // 所有轮次结束后统一落库一次
        void (async () => {
          try {
            await appendMessage(sessionId, "user", message);
            if (streamedText) {
              await appendMessage(sessionId, "assistant", streamedText);
            }
          } catch (e) {
            console.error("[agent] 消息落库失败:", e);
          }
        })();
        try {
          controller.close();
        } catch {
          // 客户端已断开
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

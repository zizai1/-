"use client";

import { useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import ChatPanel from "@/components/ChatPanel";
import AgentTimeline from "@/components/AgentTimeline";
import MCPStatus from "@/components/MCPStatus";
import type {
  Msg,
  Portfolio,
  Confirm,
  Activity,
  Tone,
} from "@/components/types";
import { now } from "@/components/util";

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);

  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [price, setPrice] = useState<{
    symbol: string;
    price: number;
    change24h: number;
  } | null>(null);
  const [placing, setPlacing] = useState(false);

  const [activity, setActivity] = useState<Activity[]>([]);

  const activityId = useRef(0);

  const addActivity = (text: string, tone: Tone = "info") => {
    setActivity((prev) => [
      ...prev,
      { id: ++activityId.current, time: now(), text, tone },
    ]);
  };

  const addMsg = (m: Omit<Msg, "id">) =>
    setMessages((prev) => [
      ...prev,
      { ...m, id: `${m.role}-${Date.now()}-${Math.random()}` },
    ]);

  useEffect(() => {
    fetch("/api/balance")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok !== false) setPortfolio(d);
      })
      .catch(() => {});
  }, []);

  const refreshPortfolio = async (): Promise<Portfolio | null> => {
    try {
      const d: Portfolio = await fetch("/api/balance").then((r) => r.json());
      if (d.ok !== false) setPortfolio(d);
      if (d.authorizationUrl) {
        addActivity("币安账户授权已过期", "danger");
        addMsg({
          role: "assistant",
          content: `币安账户授权已过期，需要重新授权。\n请点击：${d.authorizationUrl}`,
        });
      }
      return d;
    } catch {
      return null;
    }
  };

  const refreshPrice = async (symbol: string) => {
    try {
      const d = await fetch(`/api/price?symbol=${symbol}`).then((r) =>
        r.json()
      );
      if (d.ok) setPrice(d);
    } catch {
      // 忽略
    }
  };

  const sendConfirm = async (approve: boolean) => {
    if (!confirm || placing) return;
    setPlacing(true);
    try {
      const r = await fetch("/api/agent/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: confirm.requestId, approve }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        addActivity(
          approve ? "已提交批准，等待执行结果" : "已拒绝该操作",
          approve ? "success" : "warning"
        );
        if (approve) refreshPortfolio();
      } else {
        addActivity(
          `审批应答失败：${d.error ?? r.status}（可能已过期）`,
          "danger"
        );
      }
    } catch {
      addActivity("审批请求失败，请重试", "danger");
    } finally {
      setPlacing(false);
      setConfirm(null);
      setPrice(null);
    }
  };

  // 单一入口：后端 codex agent turn → SSE 事件流
  const streamAgent = async (text: string) => {
    const assistantId = `a-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    const patch = (p: Partial<Msg> | ((m: Msg) => Partial<Msg>)) =>
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, ...(typeof p === "function" ? p(m as Msg) : p) }
            : m
        )
      );

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "default", message: text }),
      });

      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;

          const payload = JSON.parse(line.slice(6));

          if (payload.type === "delta") {
            patch((m) => ({ content: m.content + payload.delta }));
          } else if (payload.type === "activity") {
            const a = payload.activity;
            addActivity(a.text, (a.tone as Tone) ?? "info");
          } else if (payload.type === "balance") {
            setPortfolio(payload.balance);
          } else if (payload.type === "confirm") {
            const c: Confirm = payload.confirm;
            // 旧卡片未处理时先自动拒绝，避免悬挂的审批
            if (confirm) {
              fetch("/api/agent/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  requestId: confirm.requestId,
                  approve: false,
                }),
              }).catch(() => {});
            }
            setConfirm(c);
            setPrice(null);
            if (c.kind === "order") {
              const sym = String(c.params?.symbol ?? "").toUpperCase();
              if (sym) refreshPrice(sym);
            }
            addActivity(`等待人工确认：${c.summary}`, "warning");
          } else if (payload.type === "done") {
            patch({ content: payload.text });
            refreshPortfolio();
          } else if (payload.type === "error") {
            patch({
              content: `出错了：${payload.error}。请稍后重试。`,
            });
          }
        }
      }
    } catch (e) {
      patch({
        content: `服务暂时不可用，请稍后重试。${
          e instanceof Error && e.message !== "HTTP 500" ? e.message : ""
        }`,
      });
    }
  };

  const sendMessage = async (text: string) => {
    if (!text || busy) return;

    addMsg({ role: "user", content: text });
    setBusy(true);
    addActivity(`收到请求：${text.slice(0, 40)}`, "info");

    try {
      await streamAgent(text);
    } finally {
      setBusy(false);
    }
  };

  const freeUsdt =
    portfolio?.balances.find((b) => b.asset === "USDT")?.free ?? 0;

  return (
    <main className="h-screen bg-[#050505] text-white flex flex-col">
      <header className="h-12 shrink-0 border-b border-white/[0.08] flex items-center justify-between px-5">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">🛡</span>
          <span className="font-bold text-sm tracking-wide">Sentinel</span>
          <span className="text-[10px] text-zinc-600 tracking-widest mt-px">
            AI TRADING COPILOT
          </span>
        </div>
        <MCPStatus />
      </header>

      <div className="flex-1 flex overflow-hidden">
        <Sidebar portfolio={portfolio} onRefresh={refreshPortfolio} />

        <ChatPanel
          messages={messages}
          busy={busy}
          confirm={confirm}
          price={price}
          placing={placing}
          freeUsdt={freeUsdt}
          onSend={sendMessage}
          onRefreshPrice={refreshPrice}
          onRespond={sendConfirm}
        />

        <AgentTimeline activity={activity} />
      </div>
    </main>
  );
}

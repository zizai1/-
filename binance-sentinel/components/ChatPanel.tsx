"use client";

import { useEffect, useRef, useState } from "react";
import type { Msg, Confirm } from "./types";
import ExecutionCard from "./ExecutionCard";

type Price = { symbol: string; price: number; change24h: number };

const QUICK_ACTIONS = [
  { label: "分析 BTC", prompt: "分析一下 BTC 当前行情" },
  { label: "查看持仓", prompt: "查看我的持仓和余额" },
  { label: "市场概览", prompt: "市场概览：BTC、ETH、SOL 近期表现" },
];

// 聊天气泡正文：把 http(s) 链接渲染为可点击
function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noreferrer"
            className="text-[#00e5ff] underline break-all"
          >
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export default function ChatPanel({
  messages,
  busy,
  confirm,
  price,
  placing,
  freeUsdt,
  onSend,
  onRefreshPrice,
  onRespond,
}: {
  messages: Msg[];
  busy: boolean;
  confirm: Confirm | null;
  price: Price | null;
  placing: boolean;
  freeUsdt: number;
  onSend: (text: string) => void;
  onRefreshPrice: (symbol: string) => void;
  onRespond: (approve: boolean) => void;
}) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, busy, confirm]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    onSend(text);
  };

  return (
    <section className="flex-1 min-w-0 flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
          {/* 欢迎态：品牌 + 副驾驶定位 + 快捷入口 */}
          {messages.length === 0 && !busy && (
            <div className="text-center mt-16">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-[#00e5ff]/10 border border-[#00e5ff]/20 flex items-center justify-center text-3xl mb-4">
                🛡
              </div>
              <p className="text-2xl font-bold tracking-tight">Sentinel</p>
              <p className="text-sm text-[#00e5ff] mt-1.5">
                Your AI Trading Copilot · 你的 AI 交易副驾驶
              </p>
              <p className="text-xs text-zinc-500 mt-4 max-w-md mx-auto leading-relaxed">
                问行情、查余额、管挂单，AI 直接使用真实数据回答；
                下单与撤单会弹出确认卡片，人工确认后才执行。
              </p>
              <div className="flex justify-center gap-2 mt-6">
                {QUICK_ACTIONS.map((q) => (
                  <button
                    key={q.label}
                    onClick={() => onSend(q.prompt)}
                    disabled={busy}
                    className="text-xs bg-[#111111] border border-white/[0.08] text-zinc-300 px-4 py-2 rounded-full hover:border-[#00e5ff]/50 hover:text-[#00e5ff] transition-colors disabled:opacity-40"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] bg-[#00e5ff]/10 border border-[#00e5ff]/15 rounded-xl rounded-br-sm px-4 py-2.5">
                  <div className="text-xs text-zinc-500 mb-0.5">You</div>
                  <div className="whitespace-pre-line text-sm text-zinc-100">
                    {m.content}
                  </div>
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex justify-start">
                <div className="max-w-[90%] bg-[#111111] border border-white/[0.08] rounded-xl rounded-bl-sm px-4 py-2.5">
                  <div className="text-xs text-[#00e5ff] mb-0.5">Sentinel</div>
                  <div className="whitespace-pre-line text-zinc-300 text-sm">
                    <RichText text={m.content} />
                  </div>
                </div>
              </div>
            )
          )}

          {busy && (
            <div className="flex justify-start">
              <div className="bg-[#111111] border border-white/[0.08] rounded-xl rounded-bl-sm px-4 py-2.5">
                <div className="text-[#00e5ff] text-xs mb-1">Sentinel</div>
                <div className="text-sm text-zinc-500 animate-pulse">
                  正在思考…
                </div>
              </div>
            </div>
          )}

          {confirm && (
            <ExecutionCard
              confirm={confirm}
              price={price}
              placing={placing}
              freeUsdt={freeUsdt}
              onRefreshPrice={onRefreshPrice}
              onRespond={onRespond}
            />
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-white/[0.08] p-3">
        <div className="max-w-3xl mx-auto flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="问行情、查持仓、管挂单…（Enter 发送）"
            className="flex-1 bg-[#111111] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#00e5ff]/60 focus:ring-2 focus:ring-[#00e5ff]/15 transition-all placeholder:text-zinc-600"
          />
          <button
            onClick={submit}
            disabled={busy}
            className="bg-[#00e5ff] hover:bg-[#00e5ff]/80 transition-colors text-black px-5 rounded-xl text-sm font-bold disabled:opacity-40"
          >
            {busy ? "…" : "发送"}
          </button>
        </div>
      </div>
    </section>
  );
}

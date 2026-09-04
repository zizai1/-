"use client";

import { useEffect, useRef } from "react";
import type { Activity } from "./types";

const DOT: Record<string, string> = {
  info: "bg-zinc-500",
  success: "bg-green-400",
  warning: "bg-yellow-400",
  danger: "bg-red-400",
};

const TEXT: Record<string, string> = {
  info: "text-zinc-400",
  success: "text-green-400",
  warning: "text-yellow-400",
  danger: "text-red-400",
};

// 右栏 Agent Timeline：时间轴样式展示 agent 的操作轨迹
export default function AgentTimeline({ activity }: { activity: Activity[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [activity]);

  return (
    <section className="w-72 shrink-0 border-l border-white/[0.08] flex flex-col">
      <div className="shrink-0 border-b border-white/[0.08] px-4 py-3 flex items-center gap-2">
        <span className="text-xs font-bold text-zinc-500 tracking-widest">
          AGENT TIMELINE
        </span>
        <span className="text-[10px] text-zinc-700">
          {activity.length} 条记录
        </span>
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto px-4 py-4">
        {activity.length === 0 ? (
          <div className="text-xs text-zinc-600 text-center mt-10 leading-relaxed">
            Agent 的操作轨迹会显示在这里
            <br />
            （查行情 · 查余额 · 挂单操作）
          </div>
        ) : (
          <div className="relative pl-4">
            <div className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-white/[0.08]" />
            <div className="space-y-3">
              {activity.map((a) => (
                <div key={a.id} className="relative text-xs leading-relaxed">
                  <span
                    className={`absolute -left-4 top-[5px] w-[9px] h-[9px] rounded-full ring-2 ring-[#050505] ${
                      DOT[a.tone] ?? DOT.info
                    }`}
                  />
                  <span className="text-zinc-600 font-mono mr-1.5">
                    {a.time}
                  </span>
                  <span className={TEXT[a.tone] ?? TEXT.info}>{a.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

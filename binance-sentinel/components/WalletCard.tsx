"use client";

import type { Portfolio } from "./types";
import { fmt } from "./util";

const PALETTE = [
  "#00e5ff",
  "#a78bfa",
  "#34d399",
  "#f59e0b",
  "#f472b6",
  "#60a5fa",
  "#4ade80",
  "#e879f9",
  "#facc15",
  "#fb923c",
];

// SVG 圆环图：按资产价值占比分段
function Donut({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const total = segments.reduce((s, x) => s + x.value, 0);
  let acc = 0;
  return (
    <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
      <circle
        cx="64"
        cy="64"
        r={R}
        fill="none"
        stroke="#1f1f1f"
        strokeWidth="16"
      />
      {segments.map((s) => {
        const frac = total > 0 ? s.value / total : 0;
        const el = (
          <circle
            key={s.label}
            cx="64"
            cy="64"
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth="16"
            strokeDasharray={`${frac * C} ${C}`}
            strokeDashoffset={-acc * C}
          />
        );
        acc += frac;
        return el;
      })}
    </svg>
  );
}

// 紧凑钱包卡：总资产 + 圆环图 + 24h 变化 + 持仓分布（带占比条）
export default function WalletCard({
  portfolio,
  onRefresh,
}: {
  portfolio: Portfolio | null;
  onRefresh: () => void;
}) {
  const sortedBalances = [...(portfolio?.balances ?? [])].sort(
    (a, b) => b.valueUsd - a.valueUsd
  );
  const topBalances = sortedBalances.slice(0, 5);
  const restValue = sortedBalances
    .slice(5)
    .reduce((s, b) => s + b.valueUsd, 0);
  const total = portfolio?.totalUsdc ?? 0;
  const pctUp = portfolio ? portfolio.change24hPct >= 0 : true;
  const segments = [
    ...topBalances.map((b, i) => ({
      label: b.asset,
      value: b.valueUsd,
      color: PALETTE[i % PALETTE.length],
    })),
    ...(restValue > 0
      ? [{ label: "其他", value: restValue, color: "#3f3f46" }]
      : []),
  ];

  return (
    <div className="bg-[#111111] border border-white/[0.08] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-zinc-500 tracking-widest">
          账户总览
        </span>
        <button
          onClick={onRefresh}
          className="text-xs text-zinc-500 hover:text-[#00e5ff] transition-colors"
        >
          ↻ 刷新
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative w-24 h-24 shrink-0">
          <Donut segments={segments} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] text-zinc-500">总资产</span>
            <span className="text-sm font-bold">${fmt(total)}</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xl font-bold tracking-tight">${fmt(total)}</div>
          <div
            className={`text-xs mt-1 ${
              pctUp ? "text-green-400" : "text-red-400"
            }`}
          >
            {pctUp ? "+" : ""}
            {fmt(portfolio?.change24hUsdc)}
            <span className="ml-1">
              ({pctUp ? "+" : ""}
              {fmt(portfolio?.change24hPct, 2)}% 24h)
            </span>
          </div>
          <div className="text-[10px] text-zinc-600 mt-1">
            币安现货 · {topBalances.length + (restValue > 0 ? 1 : 0)} 项资产
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        {segments.length === 0 && (
          <div className="text-xs text-zinc-600 text-center">没有非零余额</div>
        )}
        {topBalances.map((b, i) => {
          const pct = total > 0 ? (b.valueUsd / total) * 100 : 0;
          const color = PALETTE[i % PALETTE.length];
          return (
            <div key={b.asset}>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-zinc-300">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: color }}
                  />
                  {b.asset}
                  {b.asset !== "USDT" && b.priceUsd ? (
                    <span className="text-zinc-600">
                      @ ${fmt(b.priceUsd, b.priceUsd < 0.01 ? 6 : 4)}
                    </span>
                  ) : null}
                </span>
                <span className="text-zinc-400">
                  {pct.toFixed(1)}%
                  <span className="text-zinc-600 ml-2">${fmt(b.valueUsd)}</span>
                </span>
              </div>
              <div className="text-[10px] mt-1 pl-[16px]">
                <span className="text-zinc-500 font-mono">
                  {fmt(b.total, 8).replace(/\.?0+$/, "")}
                </span>
              </div>
              <div className="h-px bg-white/[0.04] mt-1.5">
                <div
                  className="h-full"
                  style={{ width: `${pct}%`, background: color, opacity: 0.6 }}
                />
              </div>
            </div>
          );
        })}
        {restValue > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-zinc-300">
              <span className="w-2 h-2 rounded-full shrink-0 bg-[#3f3f46]" />
              其他
            </span>
            <span className="text-zinc-400">
              {total > 0 ? `${((restValue / total) * 100).toFixed(1)}%` : "0.0%"}
              <span className="text-zinc-600 ml-2">${fmt(restValue)}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

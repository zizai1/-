"use client";

import type { Portfolio } from "./types";
import WalletCard from "./WalletCard";

export default function Sidebar({
  portfolio,
  onRefresh,
}: {
  portfolio: Portfolio | null;
  onRefresh: () => void;
}) {
  return (
    <section className="w-64 shrink-0 border-r border-white/[0.08] overflow-y-auto p-4 space-y-4">
      <WalletCard portfolio={portfolio} onRefresh={onRefresh} />
      <div className="text-[11px] text-zinc-600 leading-relaxed px-1">
        数据来自币安现货账户
        <br />
        下单与撤单需在对话中人工确认
      </div>
    </section>
  );
}

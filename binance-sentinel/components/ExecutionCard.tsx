"use client";

import type { Confirm } from "./types";
import { fmt } from "./util";

type Price = { symbol: string; price: number; change24h: number };

// 执行确认卡片（Trade Proposal）：由后端 confirm 事件驱动，只读展示 + 人工确认。
// 黄色专属执行类 UI；BUY/确认按钮用黄，SELL 用红，拒绝用红描边。
export default function ExecutionCard({
  confirm,
  price,
  placing,
  freeUsdt,
  onRefreshPrice,
  onRespond,
}: {
  confirm: Confirm;
  price: Price | null;
  placing: boolean;
  freeUsdt: number;
  onRefreshPrice: (symbol: string) => void;
  onRespond: (approve: boolean) => void;
}) {
  const symbol = String(confirm.params?.symbol ?? "").toUpperCase();
  const side =
    String(confirm.params?.side ?? "").toUpperCase() === "SELL" ? "SELL" : "BUY";
  const qtyNum = confirm.kind === "order" ? Number(confirm.params?.quantity) : 0;
  const quoteNum =
    confirm.kind === "order" ? Number(confirm.params?.quoteOrderQty) : 0;
  const isQuoteOrder =
    confirm.kind === "order" &&
    confirm.params?.quantity == null &&
    confirm.params?.quoteOrderQty != null;
  const amountUsdc =
    isQuoteOrder && quoteNum > 0
      ? quoteNum
      : qtyNum > 0 && price
        ? qtyNum * price.price
        : 0;
  const isCancel = confirm.kind === "cancel";
  const baseAsset = symbol.replace(/(USDT|USDC|USD)$/, "");

  const title = isCancel
    ? confirm.params?.orderId != null
      ? `撤销挂单 #${confirm.params.orderId}`
      : `撤销 ${symbol} 全部挂单`
    : `执行确认 · ${symbol}`;

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[90%] bg-[#111111] border border-yellow-500/40 rounded-xl rounded-bl-sm px-4 py-3.5 space-y-3 shadow-[0_0_28px_rgba(234,179,8,0.07)]">
        <div>
          <div className="text-[10px] text-zinc-500 tracking-widest mb-1">
            TRADE PROPOSAL · 待人工确认
          </div>
          <div className="flex items-center justify-between">
            <span className="font-bold text-sm">{title}</span>
            <span
              className={`px-3 py-1 rounded-lg font-bold text-xs ${
                isCancel
                  ? "bg-yellow-400/10 text-yellow-400 border border-yellow-400/30"
                  : side === "BUY"
                    ? "bg-yellow-400/10 text-yellow-400 border border-yellow-400/30"
                    : "bg-red-400/10 text-red-400 border border-red-400/30"
              }`}
            >
              {isCancel
                ? "CANCEL 撤销"
                : side === "BUY"
                  ? "BUY 买入"
                  : "SELL 卖出"}
            </span>
          </div>
        </div>

        {!isCancel ? (
          <>
            <div className="bg-black/40 border border-white/[0.08] rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Current Price 当前价格</span>
                <button
                  onClick={() => onRefreshPrice(symbol)}
                  className="text-xs text-zinc-500 hover:text-[#00e5ff] transition-colors"
                >
                  ↻
                </button>
              </div>
              <div className="text-2xl font-bold mt-1">
                $
                {fmt(price?.price, price && price.price < 1 ? 4 : 2)}
                {price && (
                  <span
                    className={`text-sm ml-2 ${
                      price.change24h >= 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {price.change24h >= 0 ? "+" : ""}
                    {fmt(price.change24h, 2)}%
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-500">Position Size 数量</label>
              <div className="w-full mt-1 bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-mono">
                {isQuoteOrder
                  ? `≈ ${fmt(quoteNum)} USDT`
                  : `${confirm.params?.quantity ?? "—"} `}
                {!isQuoteOrder && (
                  <span className="text-zinc-500">{baseAsset}</span>
                )}
                <span className="text-zinc-600 text-xs ml-2">
                  {String(confirm.params?.type ?? "MARKET").toUpperCase()}
                </span>
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                金额 ≈ ${fmt(amountUsdc)} USDT
                {side === "BUY" && (
                  <span className="ml-2">可用 {fmt(freeUsdt)} USDT</span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="bg-black/40 border border-white/[0.08] rounded-lg p-3 text-sm">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">交易对</span>
              <span className="font-mono">{symbol}</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-1.5">
              <span className="text-zinc-500">订单号</span>
              <span className="font-mono">{confirm.params?.orderId ?? "—"}</span>
            </div>
          </div>
        )}

        <div className="bg-black/40 border border-white/[0.08] rounded-lg p-3 text-xs text-zinc-400">
          <span className="text-green-400">✓</span> 风控校验通过
          {isCancel ? "（挂单存在）" : "（步长 / 最小金额 / 单笔上限 / 可用余额）"}
          <span className="text-zinc-500"> — 等待你手动确认</span>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => onRespond(false)}
            disabled={placing}
            className="flex-1 border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors py-2.5 rounded-lg font-bold text-sm disabled:opacity-40"
          >
            ✕ REJECT 拒绝
          </button>
          <button
            onClick={() => onRespond(true)}
            disabled={placing}
            className="flex-1 bg-yellow-400 hover:bg-yellow-300 transition-colors text-black py-2.5 rounded-lg font-bold text-sm disabled:opacity-40"
          >
            {placing ? "提交中…" : "✓ CONFIRM 确认"}
          </button>
        </div>
      </div>
    </div>
  );
}

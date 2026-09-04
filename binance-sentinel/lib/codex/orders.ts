import { callBinanceTool } from "./binance-mcp";

export interface OpenOrder {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  type: string;
  side: "BUY" | "SELL";
  price: number;
  stopPrice: number;
  origQty: number;
  executedQty: number;
  status: string;
  time: number;
}

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeOrder(o: any): OpenOrder {
  return {
    symbol: String(o.symbol ?? "").toUpperCase(),
    orderId: toNum(o.orderId),
    clientOrderId: String(o.clientOrderId ?? ""),
    type: String(o.type ?? "MARKET").toUpperCase(),
    side: o.side === "SELL" ? "SELL" : "BUY",
    price: toNum(o.price),
    stopPrice: toNum(o.stopPrice),
    origQty: toNum(o.origQty),
    executedQty: toNum(o.executedQty),
    status: String(o.status ?? ""),
    time: toNum(o.time),
  };
}

// 当前所有未成交挂单（可选按 symbol 过滤）
export async function getOpenOrders(symbol?: string): Promise<OpenOrder[]> {
  const res = await callBinanceTool(
    "spot.getOpenOrders",
    symbol ? { symbol } : {}
  );
  let arr = res.structured;
  if (!Array.isArray(arr)) {
    try {
      const parsed = JSON.parse(res.text);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      // 非数组响应视为无挂单
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeOrder);
}

// 撤销单笔挂单（仅由用户确认后调用）
export async function cancelOrder(
  symbol: string,
  orderId: number
): Promise<{ structured: any; text: string }> {
  const res = await callBinanceTool("spot.cancelOrder", {
    symbol,
    orderId,
  });
  return { structured: res.structured, text: res.text };
}

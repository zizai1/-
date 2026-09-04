// data-api.binance.vision 是 Binance 官方公开行情端点（无需 key），
// 与 api.binance.com 提供相同的 /api/v3 接口
const BINANCE_API = "https://data-api.binance.vision";

export async function getTicker(symbol: string = "BTCUSDT") {
  const response = await fetch(
    `${BINANCE_API}/api/v3/ticker/24hr?symbol=${symbol}`
  );

  const data = await response.json();

  return {
    symbol: data.symbol,

    price: Number(data.lastPrice),

    change24h: Number(data.priceChangePercent),

    volume: Number(data.volume),
  };
}

export async function getCandles(
  symbol: string = "BTCUSDT",
  interval: string = "1h",
  limit: number = 100
) {
  const response = await fetch(
    `${BINANCE_API}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );

  const data = await response.json();

  return {
    symbol,

    interval,

    candles: data.map((c: any) => ({
      time: c[0],

      open: Number(c[1]),

      high: Number(c[2]),

      low: Number(c[3]),

      close: Number(c[4]),

      volume: Number(c[5]),
    })),
  };
}

export interface SymbolFilters {
  minQty: number;
  stepSize: number;
  minNotional: number;
  baseAsset: string;
  quoteAsset: string;
}

// 交易对的下单过滤器（LOT_SIZE / MIN_NOTIONAL），来自公开 exchangeInfo。
// 失败返回 null，由币安侧最终校验兜底。
export async function getSymbolFilters(
  symbol: string
): Promise<SymbolFilters | null> {
  try {
    const response = await fetch(
      `${BINANCE_API}/api/v3/exchangeInfo?symbol=${symbol}`
    );
    const data = await response.json();
    const s = data.symbols?.[0];
    if (!s) return null;

    const lot = s.filters.find((f: any) => f.filterType === "LOT_SIZE");
    const notional = s.filters.find(
      (f: any) => f.filterType === "MIN_NOTIONAL"
    );
    if (!lot) return null;

    return {
      minQty: Number(lot.minQty),
      stepSize: Number(lot.stepSize),
      minNotional: notional ? Number(notional.minNotional) : 0,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
    };
  } catch {
    return null;
  }
}

// 按步长向下取整，消除浮点误差（如 0.04000000000000001）
export function roundToStep(value: number, step: number): number {
  const decimals = (String(step).split(".")[1] ?? "").length;
  const rounded = Math.floor(value / step + 1e-9) * step;
  return Number(rounded.toFixed(decimals));
}

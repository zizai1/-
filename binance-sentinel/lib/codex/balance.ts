import { callBinanceTool } from "./binance-mcp";
import { getTicker } from "../tools/binance";

const STABLE_USD = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "BUSD",
  "DAI",
  "USDP",
]);

export interface AssetBalance {
  asset: string;
  free: number;
  locked: number;
  total: number;
  priceUsd: number;
  valueUsd: number;
}

export interface PortfolioSnapshot {
  totalUsdc: number;
  change24hUsdc: number;
  change24hPct: number;
  balances: AssetBalance[];
  fetchedAt: number;
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getPortfolio(): Promise<PortfolioSnapshot> {
  // 现货 + U本位合约 + 币本位合约，三处都查
  const [spotRes, usdsRes, coinRes] = await Promise.allSettled([
    callBinanceTool("spot.getAccount", {}),
    callBinanceTool("futures_usds.futuresAccountBalanceV3", {}),
    callBinanceTool("futures_coin.futuresAccountBalance", {}),
  ]);

  const totals = new Map<string, { free: number; locked: number }>();

  if (spotRes.status === "fulfilled") {
    for (const b of spotRes.value.structured?.balances ?? []) {
      const asset = String(b.asset ?? "").toUpperCase();
      if (!asset) continue;
      const cur = totals.get(asset) ?? { free: 0, locked: 0 };
      cur.free += num(b.free);
      cur.locked += num(b.locked);
      totals.set(asset, cur);
    }
  }

  const addFutures = (arr: any[]) => {
    for (const b of arr) {
      const asset = String(b.asset ?? "").toUpperCase();
      if (!asset) continue;
      const cur = totals.get(asset) ?? { free: 0, locked: 0 };
      cur.free += num(b.balance ?? b.walletBalance ?? b.crossWalletBalance);
      totals.set(asset, cur);
    }
  };

  if (usdsRes.status === "fulfilled" && Array.isArray(usdsRes.value.structured)) {
    addFutures(usdsRes.value.structured);
  }
  if (coinRes.status === "fulfilled" && Array.isArray(coinRes.value.structured)) {
    addFutures(coinRes.value.structured);
  }

  // 每种资产折算 USD：稳定币按 1:1，其余查公开行情
  const prices = new Map<string, { price: number; change24h: number }>();
  const assets = [...totals.entries()].filter(([, v]) => v.free + v.locked > 1e-9);

  for (const [asset] of assets) {
    if (STABLE_USD.has(asset)) {
      prices.set(asset, { price: 1, change24h: 0 });
      continue;
    }
    try {
      const t = await getTicker(`${asset}USDT`);
      prices.set(asset, { price: t.price, change24h: t.change24h });
    } catch {
      prices.set(asset, { price: 0, change24h: 0 });
    }
  }

  const balances: AssetBalance[] = assets
    .map(([asset, v]) => {
      const p = prices.get(asset) ?? { price: 0, change24h: 0 };
      const total = v.free + v.locked;
      const valueUsd = total * p.price;
      return {
        asset,
        free: v.free,
        locked: v.locked,
        total,
        priceUsd: p.price,
        valueUsd,
      };
    })
    .sort((a, b) => b.valueUsd - a.valueUsd);

  const totalUsdc = balances.reduce((s, b) => s + b.valueUsd, 0);
  // 24h 变化近似：Σ 持仓价值 × pct/(100+pct)
  const change24hUsdc = balances.reduce((s, b) => {
    const p = prices.get(b.asset);
    if (!p || !p.change24h || !b.valueUsd) return s;
    return s + (b.valueUsd * p.change24h) / (100 + p.change24h);
  }, 0);
  const change24hPct =
    totalUsdc - change24hUsdc > 0
      ? (change24hUsdc / (totalUsdc - change24hUsdc)) * 100
      : 0;

  return {
    totalUsdc,
    change24hUsdc,
    change24hPct,
    balances,
    fetchedAt: Date.now(),
  };
}

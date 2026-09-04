import { getTicker, getSymbolFilters, roundToStep } from "@/lib/tools/binance";
import { callBinanceTool } from "./binance-mcp";
import { getOpenOrders } from "./orders";

// 单笔市价单的名义价值上限（USDT）。这是用户确认卡片之前的最后一道校验。
const MAX_ORDER_USDT = Number(process.env.ORDER_MAX_USDT ?? 1000);

export type GuardResult = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): GuardResult => ({ ok: false, reason });

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// spot.newOrder 审批前校验（逻辑迁自 app/api/order/route.ts）。
// 注意：这里只能「放行/拒绝」模型已发起的调用，不能改写参数——
// 校验不通过时拒绝并给出中文原因，由 agent 向用户解释、引导用户改参数重试。
export async function checkNewOrder(
  raw: Record<string, unknown>
): Promise<GuardResult> {
  const symbol = typeof raw.symbol === "string" ? raw.symbol.toUpperCase() : "";
  const side = typeof raw.side === "string" ? raw.side.toUpperCase() : "";
  const type = String(raw.type ?? "MARKET").toUpperCase();
  // quoteOrderQty 模式：按金额买入（仅市价买入合法），币安侧自行折算数量
  const isQuote = raw.quantity == null && raw.quoteOrderQty != null;
  const amount = Number(raw.quantity ?? raw.quoteOrderQty ?? NaN);

  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return fail("交易对无效");
  if (side !== "BUY" && side !== "SELL") return fail("side 必须是 BUY 或 SELL");
  if (!Number.isFinite(amount) || amount <= 0) return fail("数量或金额必须是正数");
  if (type !== "MARKET") return fail(`暂仅支持市价单（MARKET），收到 ${type}`);
  if (isQuote && side !== "BUY") return fail("quoteOrderQty 仅支持市价买入");

  let ticker: { price: number } | null = null;
  try {
    ticker = await getTicker(symbol);
  } catch {
    // 行情失败则跳过依赖行情的校验，由币安侧兜底
  }

  const filters = await getSymbolFilters(symbol);
  const baseAsset = filters?.baseAsset ?? symbol.replace(/USDT$/, "");
  const quoteAsset = filters?.quoteAsset ?? "USDT";

  // 现货可用余额预检查，避免把注定失败的订单发给交易所；
  // 提前取余额，让步长提示能直接给出「取整后最多可卖/可买」的可执行数量
  let freeOf: Map<string, number> | null = null;
  try {
    const acc = await callBinanceTool("spot.getAccount", {});
    freeOf = new Map<string, number>(
      (acc.structured?.balances ?? []).map((b: any) => [
        String(b.asset ?? "").toUpperCase(),
        toNum(b.free),
      ])
    );
  } catch {
    // 余额查询失败则跳过预检查，由币安侧返回错误
  }

  if (filters) {
    if (!isQuote) {
      const steps = amount / filters.stepSize;
      if (Math.abs(steps - Math.round(steps)) > 1e-6) {
        let suggestion = roundToStep(amount, filters.stepSize);
        let extra = "";
        const freeBase = side === "SELL" ? (freeOf?.get(baseAsset) ?? null) : null;
        if (freeBase != null) {
          const maxSell = roundToStep(freeBase, filters.stepSize);
          suggestion = Math.min(suggestion, maxSell);
          extra = `；现货可用 ${freeBase} ${filters.baseAsset}（含挂单锁定），按步长最多可卖 ${maxSell}`;
        }
        return fail(
          `数量不符合 ${symbol} 步长 ${filters.stepSize}，请改为 ${suggestion}${extra}`
        );
      }
      if (amount < filters.minQty) {
        return fail(
          `数量低于 ${symbol} 最小下单数量 ${filters.minQty} ${filters.baseAsset}`
        );
      }
    }
    const notional = isQuote && amount ? amount : ticker ? amount * ticker.price : 0;
    if (ticker && filters.minNotional > 0 && notional > 0 && notional < filters.minNotional) {
      return fail(
        `订单金额 ≈ ${notional.toFixed(2)} ${filters.quoteAsset}，低于最小名义金额 ${filters.minNotional} ${filters.quoteAsset}`
      );
    }
  }

  if (MAX_ORDER_USDT > 0 && ticker) {
    const notional = isQuote ? amount : amount * ticker.price;
    if (notional > MAX_ORDER_USDT) {
      return fail(
        `订单名义价值 ≈ ${notional.toFixed(2)} USDT，超过单笔上限 ${MAX_ORDER_USDT} USDT`
      );
    }
  }

  if (freeOf) {
    if (side === "BUY") {
      const freeQuote = freeOf.get(quoteAsset) ?? 0;
      const required = (isQuote || !ticker ? amount : amount * ticker.price) * 1.01; // 1% 余量覆盖滑点
      if (freeQuote < required) {
        const maxQty = ticker ? freeQuote / 1.01 / ticker.price : 0;
        return fail(
          `现货 ${quoteAsset} 可用余额不足：需要 ≈ ${required.toFixed(4)} ${quoteAsset}（含 1% 滑点余量），当前可用 ${freeQuote.toFixed(4)}。` +
            (isQuote
              ? `按现价可用金额上限 ≈ ${(freeQuote / 1.01).toFixed(4)} ${quoteAsset}`
              : maxQty > 0
                ? `按现价可买入上限 ≈ ${maxQty.toFixed(6)} ${baseAsset}`
                : `现货 ${quoteAsset} 可用为 0，请先划转入账`)
        );
      }
    } else {
      const freeBase = freeOf.get(baseAsset) ?? 0;
      if (freeBase < amount) {
        const maxSell = filters ? roundToStep(freeBase, filters.stepSize) : 0;
        return fail(
          `现货 ${baseAsset} 可用数量不足：可用 ${freeBase}，尝试卖出 ${amount}` +
            (maxSell > 0 ? `；按步长最多可卖 ${maxSell}（其余可能被挂单锁定）` : "")
        );
      }
    }
  }

  return { ok: true };
}

// spot.deleteOrder / spot.cancelOrder 审批前校验：orderId 必须存在于当前挂单中
export async function checkCancelOrder(
  raw: Record<string, unknown>
): Promise<GuardResult> {
  const orderId = Number(raw.orderId ?? NaN);
  if (!Number.isFinite(orderId) || orderId <= 0) return fail("订单号无效");

  const symbol = typeof raw.symbol === "string" ? raw.symbol.toUpperCase() : "";

  let open;
  try {
    open = await getOpenOrders();
  } catch (e) {
    return fail(`查询当前挂单失败：${e instanceof Error ? e.message : String(e)}`);
  }

  const found = open.find(
    (o) => o.orderId === orderId && (!symbol || o.symbol === symbol)
  );
  if (!found) return fail(`挂单 ${orderId} 不存在或已成交，无需撤销`);

  return { ok: true };
}

// spot.deleteOpenOrders 审批前校验：symbol 上必须存在挂单
export async function checkCancelOpenOrders(
  raw: Record<string, unknown>
): Promise<GuardResult> {
  const symbol = typeof raw.symbol === "string" ? raw.symbol.toUpperCase() : "";
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return fail("交易对无效");

  let open;
  try {
    open = await getOpenOrders();
  } catch (e) {
    return fail(`查询当前挂单失败：${e instanceof Error ? e.message : String(e)}`);
  }

  if (!open.some((o) => o.symbol === symbol)) {
    return fail(`${symbol} 当前没有挂单，无需撤销`);
  }

  return { ok: true };
}

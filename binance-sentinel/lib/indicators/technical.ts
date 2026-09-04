function sma(values: number[], period: number) {
  if (values.length < period) return null;

  const slice = values.slice(values.length - period);

  return slice.reduce((a, b) => a + b, 0) / period;
}

function rsi(closes: number[], period = 14) {
  if (closes.length <= period) return null;

  let gain = 0;
  let loss = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];

    if (diff >= 0) gain += diff;
    else loss -= diff;
  }

  if (loss === 0) return 100;

  const rs = gain / loss;

  return 100 - 100 / (1 + rs);
}

export function analyzeTechnical(candles: any[]) {
  const closes = candles.map((c) => c.close);

  const ma20 = sma(closes, 20);

  const ma50 = sma(closes, 50);

  const current = closes[closes.length - 1];

  const rsiValue = rsi(closes);

  let trend = "SIDEWAYS";

  if (ma20 && ma50) {
    if (ma20 > ma50) {
      trend = "UPTREND";
    } else {
      trend = "DOWNTREND";
    }
  }

  return {
    current,

    ma20,

    ma50,

    rsi: rsiValue,

    trend,
  };
}

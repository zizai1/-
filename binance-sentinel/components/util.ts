export const fmt = (v: any, digits = 2) =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : Number(v).toFixed(digits);

export const now = () =>
  new Date().toLocaleTimeString("zh-CN", { hour12: false });

export type Msg = { id: string; role: "user" | "assistant"; content: string };

export type Balance = {
  asset: string;
  free: number;
  locked: number;
  total: number;
  priceUsd: number;
  valueUsd: number;
};

export type Portfolio = {
  ok?: boolean;
  totalUsdc: number;
  change24hUsdc: number;
  change24hPct: number;
  balances: Balance[];
  fetchedAt: number;
  error?: string;
  authorizationUrl?: string;
};

export type Confirm = {
  requestId: number;
  tool: string;
  kind: "order" | "cancel";
  params: Record<string, any>;
  summary: string;
};

export type Tone = "info" | "success" | "warning" | "danger";

export type Activity = { id: number; time: string; text: string; tone: Tone };

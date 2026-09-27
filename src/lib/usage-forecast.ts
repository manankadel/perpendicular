const DAY_MS = 24 * 60 * 60 * 1000;

export type CreditForecast = {
  dailyBurn: number;
  ninetyPercentAt: string | null;
  exhaustedAt: string | null;
};

export function creditForecast(args: { limit: number; remaining: number; used: number; periodStart: string; now?: number }): CreditForecast {
  const now = args.now ?? Date.now();
  const periodStart = new Date(args.periodStart).getTime();
  const elapsedDays = Number.isFinite(periodStart) ? Math.max(1, (now - periodStart) / DAY_MS) : 1;
  const dailyBurn = Math.max(0, args.used) / elapsedDays;
  if (!dailyBurn) return { dailyBurn: 0, ninetyPercentAt: null, exhaustedAt: null };
  const ninetyPercentUsed = Math.max(0, args.limit * 0.9 - Math.max(0, args.used));
  const exhaustedDays = Math.max(0, Math.max(0, args.remaining) / dailyBurn);
  return {
    dailyBurn,
    ninetyPercentAt: new Date(now + (ninetyPercentUsed / dailyBurn) * DAY_MS).toISOString(),
    exhaustedAt: new Date(now + exhaustedDays * DAY_MS).toISOString(),
  };
}

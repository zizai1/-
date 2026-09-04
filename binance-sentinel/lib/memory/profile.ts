import { prisma } from "./database";

const DEFAULTS = {
  riskPreference: "medium",
  favoriteAssets: ["BTC", "ETH"],
  tradingStyle: "unknown",
};

export async function getProfile(sessionId: string) {
  const row = await prisma.userProfile.findUnique({
    where: { sessionId },
  });

  if (row) {
    return {
      riskPreference: row.riskPreference,
      favoriteAssets: JSON.parse(row.favoriteAssets),
      tradingStyle: row.tradingStyle,
    };
  }

  await prisma.userProfile.create({
    data: {
      sessionId,
      riskPreference: DEFAULTS.riskPreference,
      favoriteAssets: JSON.stringify(DEFAULTS.favoriteAssets),
      tradingStyle: DEFAULTS.tradingStyle,
    },
  });

  return { ...DEFAULTS };
}

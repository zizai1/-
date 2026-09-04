import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./prisma/dev.db",
});

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function getConversationHistory(
  sessionId: string,
  limit = 10
) {
  const conversation = await prisma.conversation.upsert({
    where: { sessionId },
    update: {},
    create: { sessionId },
  });

  const messages = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return messages
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }));
}

export async function appendMessage(
  sessionId: string,
  role: string,
  content: string
) {
  const conversation = await prisma.conversation.upsert({
    where: { sessionId },
    update: {},
    create: { sessionId },
  });

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role,
      content,
    },
  });
}

// 读取多个会话各自最新的一条 assistant 消息（用于通道间共享结论）
export async function getLatestAssistantMessages(
  sessionIds: string[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  for (const sid of sessionIds) {
    const conversation = await prisma.conversation.findUnique({
      where: { sessionId: sid },
    });
    if (!conversation) continue;

    const last = await prisma.message.findFirst({
      where: { conversationId: conversation.id, role: "assistant" },
      orderBy: { createdAt: "desc" },
    });
    if (last) result[sid] = last.content;
  }

  return result;
}

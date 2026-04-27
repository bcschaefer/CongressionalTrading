import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString =
  process.env.TRADING_STORAGE_POSTGRES_URL ??
  process.env.TRADING_STORAGE_PRISMA_DATABASE_URL ??
  process.env.POSTGRES_URL ??
  (process.env.DATABASE_URL?.startsWith('postgres') ? process.env.DATABASE_URL : undefined);

if (!connectionString) {
  throw new Error('Missing direct Postgres connection string for Prisma runtime.');
}

const adapter = new PrismaPg({ connectionString });

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

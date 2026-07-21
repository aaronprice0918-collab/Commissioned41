import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 needs a driver adapter (no `url` in schema). We use the node-postgres
// adapter against Neon's pooled connection string. Singleton so Next's dev HMR
// doesn't open a new pool on every reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create() {
  const connectionString = process.env.DATABASE_URL;
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? create();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** True once a real Neon URL is configured (not the placeholder). */
export function dbConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  return !!url && !url.startsWith("PASTE");
}

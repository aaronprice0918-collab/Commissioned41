import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js keeps secrets in .env.local; load the same file for the Prisma CLI so
// there's a single source of truth. Fall back to .env if present.
loadEnv({ path: ".env.local" });
loadEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});

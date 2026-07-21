import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve the "@/..." path alias the same way Next/tsconfig does (@/* -> ./*),
// so tests can import modules that use absolute-style imports (e.g. lib/entitlement
// importing "@/lib/stripe").
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // "server-only" throws outside a real Next server build — stub it so
      // server libs (entitlement, stripe) stay unit-testable under vitest.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
});

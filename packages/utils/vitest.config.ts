import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    retry: 0,
    include: ["test/**/*.test.ts"],
    environment: "jsdom",
  },
});

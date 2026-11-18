import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 시험들이 같은 DB를 쓰므로 파일을 하나씩 돌린다.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});

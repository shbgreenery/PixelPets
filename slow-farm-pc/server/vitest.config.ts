import { defineConfig } from 'vitest/config';

// core 测试是 CommonJS 断言脚本，由 scripts/run-core-tests.mjs 单独执行，
// 这里只收 TypeScript 测试，避免重复运行。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

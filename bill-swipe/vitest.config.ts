import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@bill-swipe/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    include: ['backend/tests/**/*.test.ts', 'apps/mobile/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});

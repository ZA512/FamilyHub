import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@familyhub/config': fileURLToPath(
        new URL('./packages/config/src/index.ts', import.meta.url),
      ),
      '@familyhub/contracts': fileURLToPath(
        new URL('./packages/contracts/src/index.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./apps/web', import.meta.url)),
    },
  },
});

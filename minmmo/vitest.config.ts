import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const r = (p: string) => resolve(fileURLToPath(new URL('.', import.meta.url)), p);

export default defineConfig({
  resolve: {
    alias: {
      '@app': r('src/app'),
      '@config': r('src/config'),
      '@content': r('src/content'),
      '@engine': r('src/engine'),
      '@game': r('src/game'),
      '@cms': r('src/cms'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    passWithNoTests: true,
  },
});

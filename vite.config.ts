/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    // In development the API runs separately (npm run dev starts both).
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    root: '.',
    include: ['server/test/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}'],
    setupFiles: ['./web/src/test/setup.ts'],
  },
});

/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    license: { fileName: 'dependency-licenses.md' },
  },
  test: {
    // Other sessions' git worktrees live here; their tests are not this checkout's.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});

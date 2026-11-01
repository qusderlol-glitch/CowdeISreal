import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE=/CowdeISreal/ для GitHub Pages; по умолчанию сайт в корне домена.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: { port: 5173 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as never);

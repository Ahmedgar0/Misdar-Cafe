import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // قاعدة الوضع التجريبي تُحمَّل بملفاتها الثنائية كما هي
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' },
  test: { environment: 'node', testTimeout: 60000 },
});

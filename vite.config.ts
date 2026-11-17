
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves this project from /scan-to-safe-app/.
export default defineConfig({
  base: '/scan-to-safe-app/',
  plugins: [react()],
});

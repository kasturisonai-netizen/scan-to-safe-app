import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative asset paths work both inside the Android WebView and on GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [react()],
});

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',           // relative paths so it works on GitHub Pages sub-paths
  build: {
    sourcemap: false,   // do not ship .map files
    minify: 'esbuild',  // minified, hashed filenames (assets/index-xxxx.js)
  },
})

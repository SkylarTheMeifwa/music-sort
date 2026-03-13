import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Set VITE_BASE_PATH=/music-sort/ when deploying to GitHub Pages.
// Leave unset (or '/') for Vercel / any root-domain host.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH ?? '/',
})

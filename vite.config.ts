import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // AQUALIGHT_PORT / AQUALIGHT_API keep dev off the production port (5175).
    port: Number(process.env.AQUALIGHT_PORT) || 5173,
    proxy: {
      // AQUALIGHT_API=http://aqualight.robix npm run dev  — to drive the real box
      '/api': process.env.AQUALIGHT_API || 'http://localhost:5175',
    },
  },
  test: {
    environment: 'node',
  },
})

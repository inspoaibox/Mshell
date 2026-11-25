import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

// Standalone search verification without Electron, SSH connections or saved user data.
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': resolve(__dirname, '../../src') } },
  server: { host: '127.0.0.1', port: 5189, strictPort: true }
})

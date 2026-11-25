import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { fileURLToPath, URL } from 'url'
import { legacyI18nPlugin } from './src/i18n/vite-plugin'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const mobileRoot = resolve(rootDir, 'src/mobile')

export default defineConfig({
  root: mobileRoot,
  plugins: [legacyI18nPlugin(), vue()],
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src')
    }
  },
  build: {
    target: 'es2020',
    outDir: resolve(rootDir, 'dist-mobile'),
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true
  }
})

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import { resolve } from 'path'
import { legacyI18nPlugin } from './src/i18n/vite-plugin'

export default defineConfig({
  plugins: [
    legacyI18nPlugin(),
    vue(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'electron',
                'ssh2',
                'ssh2-sftp-client',
                '@aws-sdk/client-s3',
                'aws-sdk',
                'archiver',
                'unzipper',
                'tar',
                'node-cron',
                'ws',
                'axios'
              ]
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    ])
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron')
    }
  },
  build: {
    target: 'esnext'
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  }
})

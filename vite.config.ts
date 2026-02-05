import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
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
                'aws-sdk'
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
    target: 'esnext' // 支持 top-level await
  },
  server: {
    host: '127.0.0.1', // 明确使用IPv4地址
    port: 5173,
    strictPort: true // 如果端口被占用则失败，而不是尝试其他端口
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  }
})

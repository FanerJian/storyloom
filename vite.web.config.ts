import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { contentSecurityPolicy } from './build/contentSecurityPolicy'

// Tauri / 纯 Web 构建配置：与 electron-vite 的 renderer 段同源，
// 产物 dist-web/（不含任何 Electron 依赖；api.ts 在 Tauri 下走插件实现）。
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      '@runtime': resolve('src/runtime'),
      '@rtdist': resolve('resources/runtime')
    }
  },
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
    target: 'chrome110',
    chunkSizeWarningLimit: 1200
  },
  server: {
    port: 5174,
    strictPort: true
  }
})

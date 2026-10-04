import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// 单独构建可玩运行时：产物为 resources/runtime/index.html + runtime.js + runtime.css。
// 渲染层通过 ?raw 导入 runtime.js / runtime.css 内联合成导出 HTML（见 lib/exportHtml.ts），
// 因此这里使用固定文件名，避免 hash 变动导致引用失效。
export default defineConfig({
  root: 'src/runtime',
  base: './',
  resolve: {
    alias: {
      '@runtime': fileURLToPath(new URL('./src/runtime', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
    }
  },
  build: {
    outDir: '../../resources/runtime',
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: {
      output: {
        entryFileNames: 'runtime.js',
        assetFileNames: 'runtime.[ext]'
      }
    }
  }
})

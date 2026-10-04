import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { contentSecurityPolicy } from './build/contentSecurityPolicy'

const sharedAliases = {
  '@shared': resolve('src/shared'),
  '@runtime': resolve('src/runtime')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAliases }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAliases }
  },
  renderer: {
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@runtime': resolve('src/runtime'),
        '@rtdist': resolve('resources/runtime')
      }
    },
    server: {
      fs: { allow: [resolve('.')] }
    }
  }
})

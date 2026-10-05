import type { Plugin } from 'vite'

/** Release 只允许本地模块及 Tauri IPC；开发阶段额外允许本机 HMR。 */
export function contentSecurityPolicy(): Plugin {
  return {
    name: 'fableloom-content-security-policy',
    transformIndexHtml(html, ctx) {
      const sources = ["'self'", 'ipc:', 'http://ipc.localhost']
      if (ctx.server) sources.push('http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'ws://127.0.0.1:*')
      return html.replace('__FABLELOOM_CONNECT_SRC__', sources.join(' '))
    }
  }
}

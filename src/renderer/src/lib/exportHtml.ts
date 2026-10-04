import type { StoryProject } from '@shared/schema'
import type { RuntimePluginChunk } from '@shared/plugins'
// 运行时源码在 build:runtime 时以固定文件名产出（见 vite.runtime.config.ts），
// 以字符串内嵌进渲染层包，让「导出可玩 HTML」在 Electron / Tauri / 浏览器三端行为一致。
import runtimeJs from '@rtdist/runtime.js?raw'
import runtimeCss from '@rtdist/runtime.css?raw'

/**
 * 合成单文件可玩 HTML：runtime JS/CSS 内联 + 剧情数据（含内嵌素材）注入
 * + 启用插件的作品面（CSS/JS）。与试玩使用同一份 runtime，保证所见即所得。
 */
export function composeExportHtml(story: StoryProject, plugins: RuntimePluginChunk[] = []): string {
  const safeJson = JSON.stringify(story).replace(/</g, '\\u003c')
  const safePlugins = JSON.stringify(plugins)
    .replace(/</g, '\\u003c')
    .replace(/\u2028|\u2029/g, '')
  const pluginStyles = plugins
    .filter((p) => p.css.trim())
    .map((p) => `    <style data-loom-plugin="${escapeHtml(p.id)}">${p.css.replace(/<\/style/gi, '<\\/style')}</style>`)
    .join('\n')
  const title = story.meta.title || '未命名故事'
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)} · StoryLoom</title>
    <style>html, body, #app { height: 100%; margin: 0 } body { background: #0b0d12; overflow-x: hidden }</style>
    <style>${runtimeCss}</style>
${pluginStyles}
  </head>
  <body>
    <div id="app"></div>
    <script>window.__STORY__ = ${safeJson};</script>
    <script>window.__PLUGINS__ = ${safePlugins};</script>
    <script type="module">${runtimeJs}</script>
  </body>
</html>
`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

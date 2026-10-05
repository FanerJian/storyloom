// 验证导出链路：复刻渲染层 lib/exportHtml.ts 的合成逻辑生成单文件可玩 HTML
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'resources', 'runtime')

const runtimeJs = readFileSync(join(dir, 'runtime.js'), 'utf-8')
const runtimeCss = readFileSync(join(dir, 'runtime.css'), 'utf-8')

const story = {
  version: 3,
  meta: { title: '导出验证故事', author: 'E2E', description: '' },
  assets: {},
  customCss: '',
  customJs: '',
  variables: [{ id: 'v_gold', name: '金币', type: 'number', initial: 10 }],
  nodes: [
    { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
    { id: 'd1', type: 'dialogue', position: { x: 0, y: 0 }, data: { speaker: '旁白', text: '你捡到了一枚金币。' } },
    {
      id: 'c1',
      type: 'choice',
      position: { x: 0, y: 0 },
      data: {
        options: [
          { id: 'o1', text: '买面包', condition: null },
          { id: 'o2', text: '（金币 ≥ 10）买下宝剑', condition: { variableId: 'v_gold', op: '>=', value: 10 } }
        ]
      }
    },
    { id: 'v1', type: 'variable', position: { x: 0, y: 0 }, data: { ops: [{ id: 'op1', variableId: 'v_gold', op: 'sub', value: 10 }] } },
    { id: 'd2', type: 'dialogue', position: { x: 0, y: 0 }, data: { speaker: '铁匠', text: '好眼力，这可是好钢打的。' } },
    { id: 'e1', type: 'end', position: { x: 0, y: 0 }, data: { label: '平凡的一餐' } },
    { id: 'e2', type: 'end', position: { x: 0, y: 0 }, data: { label: '持剑者' } }
  ],
  edges: [
    { id: 'e_s', source: 's', sourceHandle: null, target: 'd1' },
    { id: 'e_1', source: 'd1', sourceHandle: null, target: 'c1' },
    { id: 'e_2', source: 'c1', sourceHandle: 'o1', target: 'e1' },
    { id: 'e_3', source: 'c1', sourceHandle: 'o2', target: 'v1' },
    { id: 'e_4', source: 'v1', sourceHandle: null, target: 'd2' },
    { id: 'e_5', source: 'd2', sourceHandle: null, target: 'e2' }
  ]
}

const safeJson = JSON.stringify(story).replace(/</g, '\\u003c')
// 验证插件注入：一个只带 runtimeCss 的插件块
const plugins = [
  {
    id: 'demo-skin',
    css: '.tgr-vn .tgr-card { border-color: #22d3ee !important; border-width: 2px; }',
    js: ''
  }
]
const safePlugins = JSON.stringify(plugins).replace(/</g, '\\u003c')
const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>导出验证故事 · FableLoom</title>
    <style>html, body, #app { height: 100%; margin: 0 } body { background: #0b0d12; overflow-x: hidden }</style>
    <style>${runtimeCss}</style>
  </head>
  <body>
    <div id="app"></div>
    <script>window.__STORY__ = ${safeJson};</script>
    <script>window.__PLUGINS__ = ${safePlugins};</script>
    <script type="module">${runtimeJs}</script>
  </body>
</html>
`

const out = process.argv[2] ?? join(root, 'e2e-shots', 'exported-game.html')
writeFileSync(out, html, 'utf-8')
console.log('exported to', out, `(${(html.length / 1024).toFixed(1)} KB)`)
if (html.includes('__STORY_DATA__')) {
  console.error('ERROR: story marker remains!')
  process.exit(1)
}

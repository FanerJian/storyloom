// 验证运行时对带透明通道 PNG 的支持：
// 用 zlib 生成一张 RGBA PNG（透明背景 + 实心圆头 + 半透明圆），配合渐变背景合成可玩 HTML。
// E2E 加载后截图，观察立绘周围是否透出背景即可判断透明是否生效。
import { deflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'resources', 'runtime')
const runtimeJs = readFileSync(join(dir, 'runtime.js'), 'utf-8')
const runtimeCss = readFileSync(join(dir, 'runtime.css'), 'utf-8')

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

/** RGBA 像素 → PNG（无滤波，deflate 压缩） */
function makePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  const stride = 1 + width * 4
  const raw = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// 画一张 320x640 立绘：透明底 + 红色圆头 + 绿色身子 + 一颗半透明圆（验证部分 alpha）
const W = 320
const H = 640
const px = Buffer.alloc(W * H * 4)
const put = (x, y, r, g, b, a) => {
  const i = (y * W + x) * 4
  px[i] = r
  px[i + 1] = g
  px[i + 2] = b
  px[i + 3] = a
}
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dh = Math.hypot(x - 160, y - 130)
    if (dh < 78) put(x, y, 214, 92, 92, 255) // 头（不透明）
    else if (x > 112 && x < 208 && y > 208 && y < 600) put(x, y, 88, 166, 120, 255) // 身子
    const dg = Math.hypot(x - 160, y - 380)
    if (dg < 52) put(x, y, 96, 140, 220, 128) // 半透明圆叠加
  }
}
const pngDataUrl = `data:image/png;base64,${makePng(W, H, px).toString('base64')}`

const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2a4d"/><stop offset="1" stop-color="#3a4a72"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/></svg>`
const bgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(bgSvg)}`

const story = {
  version: 3,
  meta: { title: 'PNG 透明验证', author: 'E2E', description: '' },
  assets: {
    bg: { name: '渐变背景.svg', type: 'image', dataUrl: bgUrl },
    sprite: { name: '透明立绘.png', type: 'image', dataUrl: pngDataUrl }
  },
  customCss: '',
  customJs: '',
  variables: [],
  nodes: [
    { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
    { id: 'b', type: 'bg', position: { x: 0, y: 0 }, data: { asset: 'bg' } },
    { id: 'sp', type: 'sprite', position: { x: 0, y: 0 }, data: { asset: 'sprite', character: '透明酱', spritePos: 'center', spriteAction: 'show' } },
    { id: 'd', type: 'dialogue', position: { x: 0, y: 0 }, data: { speaker: '透明酱', text: '我的周围应该是半透明的——能看到背后的渐变夜空。' } },
    { id: 'e', type: 'end', position: { x: 0, y: 0 }, data: { label: '透明生效' } }
  ],
  edges: [
    { id: 'e1', source: 's', sourceHandle: null, target: 'b' },
    { id: 'e2', source: 'b', sourceHandle: null, target: 'sp' },
    { id: 'e3', source: 'sp', sourceHandle: null, target: 'd' },
    { id: 'e4', source: 'd', sourceHandle: null, target: 'e' }
  ]
}

const safeJson = JSON.stringify(story).replace(/</g, '\\u003c')
const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PNG 透明验证 · FableLoom</title>
    <style>html, body, #app { height: 100%; margin: 0 } body { background: #0b0d12; overflow-x: hidden }</style>
    <style>${runtimeCss}</style>
  </head>
  <body>
    <div id="app"></div>
    <script>window.__STORY__ = ${safeJson};</script>
    <script type="module">${runtimeJs}</script>
  </body>
</html>
`

const out = process.argv[2] ?? join(root, 'e2e-shots', 'png-alpha.html')
writeFileSync(out, html, 'utf-8')
console.log('exported to', out, `(${(html.length / 1024).toFixed(1)} KB)`)

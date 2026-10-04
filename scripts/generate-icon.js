// 用 Electron 离屏渲染生成应用图标：build/icon.png（electron-builder 会自动转换为 .ico）
// 运行：npx electron scripts/generate-icon.js
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#a855f7"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="116" fill="url(#g)"/>
  <g stroke="#ffffff" stroke-width="24" stroke-linecap="round" fill="none" opacity="0.9">
    <path d="M164 322 L256 236 L348 322"/>
  </g>
  <circle cx="256" cy="224" r="44" fill="#ffffff"/>
  <circle cx="158" cy="336" r="34" fill="#ffffff" opacity="0.92"/>
  <circle cx="354" cy="336" r="34" fill="#ffffff" opacity="0.92"/>
</svg>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 512,
    height: 512,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true }
  })
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${SVG}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 600))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  const out = path.join(__dirname, '..', 'build', 'icon.png')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, img.toPNG())
  console.log('icon written:', out, img.getSize())
  app.quit()
})

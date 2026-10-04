import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { registerIpc } from '../src/main/ipc'
import { RecoveryFiles } from '../src/main/recovery'
import { emptyProject } from '../src/shared/schema'

const directory = resolve('work/app-test')
mkdirSync(directory, { recursive: true })
const profile = join(directory, `profile-${Date.now()}`)
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.disableHardwareAcceleration()
if (process.env.CI) app.commandLine.appendSwitch('no-sandbox')

async function main(): Promise<void> {
await app.whenReady()
console.log('app smoke: Electron ready')
const win = new BrowserWindow({ show: false, width: 1440, height: 900,
  webPreferences: { preload: resolve('out/preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
registerIpc(() => win)
const failures: string[] = []
win.webContents.on('console-message', (_e, level, message) => {
  if (level >= 3 && !message.includes('ERR_FILE_NOT_FOUND')) failures.push(message)
})
const requests: string[] = []
win.webContents.session.webRequest.onCompleted((details) => requests.push(details.url))
const run = (code: string): Promise<any> => win.webContents.executeJavaScript(code)
async function until(code: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await run(code)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Timed out: ${code}`)
}
const click = (text: string): Promise<any> => run(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw Error('Missing button'); b.click(); })()`)
let exitCode = 0
try {
  await win.loadFile(resolve('out/renderer/index.html'))
  await until(`document.body.textContent.includes('新建空白工程')`)
  console.log('app smoke: welcome loaded')
  assert(!requests.some((url) => /Workspace-|elk\.bundled-|PlaytestModal-/.test(url)), 'welcome should not request canvas, ELK or player chunks')
  assert(!await run(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes('__STORYLOOM_')`))
  assert(await run(`fetch('https://example.com').then(() => false, () => true)`), 'release CSP blocks remote fetch')
  failures.length = 0 // Deliberate CSP rejection is expected.
  await run(`localStorage.setItem('storyloom.plugins.v1', JSON.stringify([{ id:'e2e-hook', name:'E2E', version:'1', apiVersion:1, editorJs:'window.__test = slp;', editorCss:'', runtimeJs:'', runtimeCss:'' }])); localStorage.setItem('storyloom.plugins.enabled.v1', JSON.stringify({'e2e-hook':true}));`)
  const project = emptyProject()
  project.meta.title = '未保存恢复验证'
  project.nodes = [
    { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
    { id: 'd', type: 'dialogue', position: { x: 0, y: 200 }, data: { speaker: '恢复测试', text: '恢复后文本仍然存在。' } },
    { id: 'e', type: 'end', position: { x: 0, y: 400 }, data: { label: '恢复验证结束' } }
  ]
  project.edges = [{ id: 'sd', source: 's', sourceHandle: null, target: 'd' }, { id: 'de', source: 'd', sourceHandle: null, target: 'e' }]
  const files = new RecoveryFiles(join(profile, 'recovery'))
  files.write({ version: 1, id: 'test-recovery', savedAt: Date.now(), project })
  const loaded = new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
  win.webContents.reload()
  await loaded
  await until(`window.__test && document.body.textContent.includes('恢复') && document.body.textContent.includes('未保存恢复验证')`)
  await click('恢复工程')
  await until(`document.querySelector('[data-testid="studio-workspace"]') && window.__test.project.getState().meta.title === '未保存恢复验证'`)
  console.log('app smoke: project restored')
  await run(`window.__test.project.getState().onNodesChange([{id:'d',type:'select',selected:true}]);`)
  assert(await run(`window.__test.project.getState().nodes.find(n => n.id === 'd').selected`), 'lazy canvas installs official flow operations')
  assert(await run(`window.__test.project.getState().dirty && window.__test.project.getState().filePath === null`), 'recovery remains unsaved')
  await run(`window.__test.project.getState().setMeta({title:'最新恢复标题'}); window.__test.project.getState().setCustomCode({customCss:'.tgr-card {border-color:red}'});`)
  for (let i = 0; i < 50 && !files.list().snapshots.some((s) => s.project.meta.title === '最新恢复标题'); i++) {
    await new Promise((r) => setTimeout(r, 100))
  }
  assert(files.list().snapshots.some((s) => s.project.meta.title === '最新恢复标题'), 'debounced snapshot contains latest editing')
  const closeResult = new Promise<any>((r) => ipcMain.once('window:close-result', (_e, token, result) => r({ token, result })))
  await run(`window.__test.project.getState().setMeta({title:'退出前最后一笔'});`)
  win.webContents.send('window:close-request', 'test-close-token')
  const ack = await closeResult
  console.log('app smoke: close flush acknowledged')
  assert.equal(ack.token, 'test-close-token')
  assert.equal(ack.result.ok, true)
  assert(files.list().snapshots.some((s) => s.project.meta.title === '退出前最后一笔'), 'close handshake flushes newest state')
  await run(`window.__test.ui.openPlaytest();`)
  await until(`document.querySelector('.tgr-text')?.textContent.includes('恢复后文本')`)
  await new Promise((r) => setTimeout(r, 450))
  writeFileSync(join(directory, 'playtest.png'), (await win.webContents.capturePage()).toPNG())
  assert(await run(`!!document.querySelector('.tgr-auto') && !!document.querySelector('.tgr-backlog')`), 'player controls load in lazy playtest')
  assert.equal(failures.length, 0, failures.join('\n'))
  writeFileSync(join(directory, 'result.json'), JSON.stringify({ profile, requests, passed: true }, null, 2))
  console.log('app smoke: release CSP, lazy welcome, recovery, dirty state, debounce, close flush, lazy playtest passed')
} catch (err) {
  console.error(err)
  exitCode = 1
} finally {
  win.destroy()
  app.exit(exitCode)
}
}
void main().catch((err) => { console.error(err); app.exit(1) })

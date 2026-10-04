/** Pure browser IndexedDB recovery regression test against the built Web app.
 * Run after npm run build:web: electron scripts/browser-recovery-test.cjs
 * Uses an isolated profile and a hidden window without an Electron preload.
 */
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const entry = path.join(root, 'dist-web', 'index.html')
const work = path.join(root, 'work')
fs.mkdirSync(work, { recursive: true })
const directory = fs.mkdtempSync(path.join(work, 'browser-recovery-test-'))
const profile = path.join(directory, 'profile')
fs.mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.disableHardwareAcceleration()
if (process.env.CI) app.commandLine.appendSwitch('no-sandbox')

let win
let checks = 0
const errors = []
const watchdog = setTimeout(() => {
  console.error('Browser recovery test exceeded its 60 second deadline')
  win?.destroy()
  app.exit(1)
}, 60_000)
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const page = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true)
async function waitFor(fn, label) {
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    if (await page(fn)) return
    await pause(50)
  }
  throw new Error(`Timed out: ${label}`)
}
async function check(label, fn) {
  await fn()
  checks++
  console.log(`ok ${label}`)
}
const click = (text) => page((label) => {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
  if (!button) throw new Error(`Missing button: ${label}`)
  button.click()
}, text)

/** Open a separate readonly connection so checks never modify production storage. */
async function readSnapshots() {
  return page(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('storyloom-recovery', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      try {
        const tx = db.transaction('snapshots', 'readonly')
        const all = tx.objectStore('snapshots').getAll()
        tx.oncomplete = () => { const values = all.result; db.close(); resolve(values) }
        tx.onabort = () => { db.close(); reject(tx.error ?? all.error) }
      } catch (error) { db.close(); reject(error) }
    }
  }))
}

async function waitSnapshot(title) {
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    const snapshots = await readSnapshots()
    const snapshot = snapshots.find((s) => s.project.meta.title === title)
    if (snapshot) return snapshot
    await pause(50)
  }
  throw new Error(`Timed out waiting for committed IndexedDB snapshot: ${title}`)
}

async function reload() {
  // Each caller verifies a committed snapshot before unloading an edited document.
  const loaded = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out reloading the Web app')), 12_000)
    win.webContents.once('did-finish-load', () => { clearTimeout(timeout); resolve() })
  })
  win.webContents.reload()
  await loaded
  await waitFor(() => !!window.__browserRecoveryTest, 'plugin hook after reload')
}

async function main() {
  assert(fs.existsSync(entry), 'dist-web/index.html is missing; run npm run build:web first')
  await app.whenReady()
  win = new BrowserWindow({
    show: false, width: 1280, height: 850,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  })
  // The application correctly requests confirmation for dirty browser documents.
  // The test has already verified committed storage, so permit its controlled reload.
  win.webContents.on('will-prevent-unload', (event) => event.preventDefault())
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' && !event.message.includes('ERR_FILE_NOT_FOUND')) errors.push(event.message)
  })
  win.webContents.on('render-process-gone', (_event, details) => errors.push(`Renderer exited: ${details.reason}`))
  await win.loadFile(entry)
  await waitFor(() => document.body.textContent.includes('新建空白工程'), 'welcome')
  await check('hidden window selects the pure browser adapter', async () => {
    assert.equal(await page(() => window.api === undefined && !('__TAURI_INTERNALS__' in window)), true)
    assert.equal(win.webContents.getLastWebPreferences().preload, undefined)
  })

  // Install only in this isolated profile; the public plugin context supplies the actual store.
  await page(() => {
    localStorage.setItem('storyloom.plugins.v1', JSON.stringify([{
      id: 'browser-recovery-test', name: 'Browser recovery test', version: '1', apiVersion: 1,
      editorJs: 'window.__browserRecoveryTest = slp;', editorCss: '', runtimeJs: '', runtimeCss: ''
    }]))
    localStorage.setItem('storyloom.plugins.enabled.v1', JSON.stringify({ 'browser-recovery-test': true }))
  })
  await reload()
  await click('新建空白工程')
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
  const title = '浏览器未保存恢复实测'
  await page(async (projectTitle, dataUrl) => {
    const store = window.__browserRecoveryTest.project.getState()
    store.setMeta({ title: projectTitle, author: 'Browser test' })
    const node = store.addNode('dialogue', { x: 80, y: 100 })
    store.updateNodeData(node.id, { speaker: '恢复测试', text: 'IndexedDB 中的对白与素材都要保留。' })
    store.setCustomCode({ customCss: '.tgr-card { border-color: rebeccapurple; }' })
    await store.addAsset('pixel.png', 'image', dataUrl)
  }, title, png)
  const initial = await waitSnapshot(title)
  await check('unsaved edits and embedded assets commit to IndexedDB without clearing dirty state', async () => {
    assert.equal(initial.version, 1)
    assert.match(initial.id, /^recovery_/)
    assert.equal(initial.project.nodes.find(n => n.type === 'dialogue').data.text, 'IndexedDB 中的对白与素材都要保留。')
    assert.equal(Object.values(initial.project.assets)[0].dataUrl, png)
    assert.equal(initial.project.customCss, '.tgr-card { border-color: rebeccapurple; }')
    assert.equal(await page(() => {
      const s = window.__browserRecoveryTest.project.getState()
      return s.dirty && s.filePath === null
    }), true)
    assert.equal(await page(() => document.title.startsWith('● ')), true)
    assert(!fs.existsSync(path.join(profile, 'recovery')), 'browser mode must not write host recovery files')
  })

  await reload()
  await waitFor(() => document.body.textContent.includes('发现未保存的工程'), 'recovery prompt')
  await check('reload detects the committed browser snapshot and offers recovery', async () => {
    assert.equal(await page(() => document.body.textContent.includes('浏览器未保存恢复实测')), true)
    assert.equal(await page(() => window.__browserRecoveryTest.project.getState().revision), 0)
    assert.equal((await readSnapshots())[0].id, initial.id)
  })
  await click('稍后')
  await waitFor(() => !document.body.textContent.includes('发现未保存的工程'), 'dismiss recovery')
  await check('later retains IndexedDB data and offers it again after reload', async () => {
    assert.equal((await readSnapshots())[0].id, initial.id)
    await reload()
    await waitFor(() => document.body.textContent.includes('发现未保存的工程'), 'deferred recovery prompt')
    assert.equal(await page(() => document.body.textContent.includes('浏览器未保存恢复实测')), true)
  })
  await click('恢复工程')
  await waitFor(() => document.querySelector('[data-testid="studio-workspace"]') && window.__browserRecoveryTest.project.getState().meta.title === '浏览器未保存恢复实测', 'restored workspace')
  await check('restoration keeps the project dirty with no file path and retains its original snapshot', async () => {
    const state = await page(() => {
      const s = window.__browserRecoveryTest.project.getState()
      return { dirty: s.dirty, filePath: s.filePath, lastSavedJson: s.lastSavedJson,
        text: s.nodes.find(n => n.type === 'dialogue').data.text, assets: Object.values(s.assets) }
    })
    assert.equal(state.dirty, true)
    assert.equal(state.filePath, null)
    assert.equal(state.lastSavedJson, null)
    assert.equal(state.text, 'IndexedDB 中的对白与素材都要保留。')
    assert.equal(state.assets[0].dataUrl, png)
    assert((await readSnapshots()).some((s) => s.id === initial.id))
  })
  const revisedTitle = '浏览器恢复后最新编辑'
  await page((newTitle) => window.__browserRecoveryTest.project.getState().setMeta({ title: newTitle }), revisedTitle)
  const revised = await waitSnapshot(revisedTitle)
  await check('edits after restoration update the same committed snapshot', async () => {
    assert.equal(revised.id, initial.id)
    assert.equal((await readSnapshots()).length, 1)
    assert.equal(await page(() => window.__browserRecoveryTest.project.getState().dirty), true)
  })
  await reload()
  await waitFor(() => document.body.textContent.includes('浏览器恢复后最新编辑') && document.body.textContent.includes('发现未保存的工程'), 'latest recovery prompt')
  await click('丢弃快照')
  await waitFor(() => !document.body.textContent.includes('发现未保存的工程'), 'discard recovery')
  await check('explicit discard deletes only the selected snapshot and prevents another recovery prompt', async () => {
    assert.equal((await readSnapshots()).length, 0)
    await reload()
    await waitFor(() => document.body.textContent.includes('新建空白工程'), 'welcome after discard')
    await pause(200)
    assert.equal((await readSnapshots()).length, 0)
    assert.equal(await page(() => document.body.textContent.includes('发现未保存的工程')), false)
    assert.equal(await page(() => window.__browserRecoveryTest.project.getState().revision), 0)
  })
  assert.deepEqual(errors, [], errors.join('\n'))
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ passed: true, checks, profile }, null, 2))
  console.log(`Browser IndexedDB recovery: ${checks} checks passed`)
}

void main().then(() => {
  clearTimeout(watchdog)
  win?.destroy()
  app.exit(0)
}).catch((error) => {
  clearTimeout(watchdog)
  console.error(error)
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ passed: false, checks, profile, error: String(error), consoleErrors: errors }, null, 2))
  win?.destroy()
  app.exit(1)
})

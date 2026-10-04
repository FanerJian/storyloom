/** Real Chromium DOM regression tests, including persistent file:// progress.
 * Run: electron scripts/player-dom-test.cjs
 * Windows PowerShell: Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
 */
const { app, BrowserWindow } = require('electron')
const { buildSync } = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')

const taskWork = path.resolve(__dirname, '../work')
fs.mkdirSync(taskWork, { recursive: true })
const temp = fs.mkdtempSync(path.join(taskWork, 'storyloom-player-test-'))
app.setPath('userData', path.join(temp, 'profile'))
app.setPath('sessionData', path.join(temp, 'profile'))
if (process.env.CI) app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
const root = path.resolve(__dirname, '..')
const bundle = buildSync({ entryPoints: [path.join(root, 'src/runtime/player.ts')], bundle: true,
  format: 'iife', globalName: 'StoryLoomPlayer', loader: { '.css': 'empty' }, write: false }).outputFiles[0].text
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const wav = Buffer.alloc(8044)
wav.write('RIFF'); wav.writeUInt32LE(8036, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28)
wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(8000, 40); wav.fill(128, 44)
const node = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data })
const story = {
  version: 3, meta: { title: 'DOM regression', author: 'Test', description: '' }, customCss: '', customJs: '',
  // 标题画面关闭：这组回归针对剧情管线本身；标题画面在末尾有专门用例
  release: { titleScreen: { enabled: false } },
  assets: { image: { name: 'image', type: 'image', dataUrl: image }, music: { name: 'music', type: 'audio', dataUrl: `data:audio/wav;base64,${wav.toString('base64')}` } },
  variables: [{ id: 'score', name: 'Score', type: 'number', initial: 0 }],
  nodes: [node('start', 'start'), node('bg', 'bg', { asset: 'image' }),
    node('sprite', 'sprite', { asset: 'image', spritePos: 'custom', spriteX: 35, character: 'Hero' }),
    node('music', 'audio', { asset: 'music', volume: 30, loop: true }),
    node('add1', 'variable', { ops: [{ id: 'o1', variableId: 'score', op: 'add', value: 1 }] }),
    node('first', 'dialogue', { speaker: 'Alice', text: '{speed:0}first line' }),
    node('add2', 'variable', { ops: [{ id: 'o2', variableId: 'score', op: 'add', value: 2 }] }),
    node('script', 'script', { code: 'vars.score += 4; api.setStyle(".tgr-text", "font-weight: 700"); await api.say("Script", "{speed:0}script line"); vars.score += 8;' }),
    node('second', 'dialogue', { speaker: 'Bob', text: '{speed:0}second line' }),
    node('choice', 'choice', { options: [{ id: 'yes', text: 'score is 15', condition: { variableId: 'score', op: '==', value: 15 } }] }),
    node('end', 'end', { label: 'Finished' })],
  edges: []
}
for (let i = 0; i < story.nodes.length - 1; i++) story.edges.push({ id: `e${i}`, source: story.nodes[i].id, target: story.nodes[i + 1].id, sourceHandle: story.nodes[i].type === 'choice' ? 'yes' : null })
const file = path.join(temp, 'game.html')
fs.writeFileSync(file, `<!doctype html><meta charset="UTF-8"><style>html,body{height:100%;margin:0}#app{height:100%}</style><style>${fs.readFileSync(path.join(root, 'src/runtime/player.css'), 'utf8')}</style><div id="app"></div><script>${bundle}</script><script>window.testStory=${JSON.stringify(story)};window.handle=StoryLoomPlayer.mountPlayer(document.getElementById('app'),testStory)</script>`)

let win
let checks = 0
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const page = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true)
async function waitFor(fn, label) {
  const until = Date.now() + 4000
  while (Date.now() < until) { if (await page(fn)) return; await pause(20) }
  throw new Error(`Timed out: ${label}`)
}
async function check(label, fn) { await fn(); checks++; console.log(`ok ${label}`) }
const click = (selector) => page((s) => { const el = document.querySelector(s); if (!el) throw new Error(`Missing ${s}`); el.click() }, selector)
const text = () => page(() => document.querySelector('.tgr-text')?.textContent)
const stored = (slot) => page((i) => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.includes(':game:') && key.endsWith(`:slot:${i}`)))), slot)

app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  await win.loadFile(file)
  await waitFor(() => document.querySelector('.tgr-text')?.textContent === 'first line', 'first dialogue')
  await check('six slots save vars and media references', async () => {
    await click('.tgr-saves'); assert.equal(await page(() => document.querySelectorAll('[data-save]').length), 6)
    await click('[data-save="1"]'); const save = await stored(1)
    assert.equal(save.vars.score, 1); assert.equal(save.media.background, 'image')
    assert.equal(save.media.sprites.custom.x, 35); assert.equal(save.media.bgm.volume, 0.3)
    assert.equal(JSON.stringify(save.media).includes('base64'), false) // 媒体字段只存素材 key（thumb 是独立的小缩略图）
  })
  await check('overlay blocks keyboard and clicks from advancing', async () => {
    await page(() => { document.querySelector('.tgr-stage').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); document.querySelector('.tgr-stage').click(); document.querySelector('.tgr-continue').click() })
    assert.equal(await text(), 'first line'); await click('.tgr-close')
  })
  await click('.tgr-continue')
  await waitFor(() => document.querySelector('.tgr-text')?.textContent === 'script line', 'script say')
  await check('saving is disabled during api.say continuation', async () => {
    await click('.tgr-saves'); assert.equal(await page(() => [...document.querySelectorAll('[data-save]')].every((btn) => btn.disabled)), true)
    assert.match(await page(() => document.querySelector('.tgr-panel-note').textContent), /演出脚本/)
  })
  await check('loading while a script is waiting cancels its continuation', async () => {
    await click('[data-load="1"]'); await pause(50); assert.equal(await text(), 'first line')
    await click('.tgr-saves'); await click('[data-save="3"]'); assert.equal((await stored(3)).vars.score, 1); await click('.tgr-close')
  })
  await check('file URL reload preserves saved progress without replaying variable nodes', async () => {
    await win.loadFile(file); await waitFor(() => !!document.querySelector('.tgr-text'), 'reloaded game')
    await click('.tgr-saves'); assert.equal(await page(() => document.querySelector('[data-load="1"]').disabled), false)
    await click('[data-load="1"]'); await pause(25); await click('.tgr-saves'); await click('[data-save="4"]')
    assert.equal((await stored(4)).vars.score, 1); assert.equal((await stored(4)).backlog.length, 1)
    await click('.tgr-close')
  })
  await click('.tgr-continue'); await waitFor(() => document.querySelector('.tgr-text')?.textContent === 'script line', 'script say again')
  await click('.tgr-continue'); await waitFor(() => document.querySelector('.tgr-text')?.textContent === 'second line', 'second dialogue')
  await check('stable post-script saves restore vars, styles and backlog directly', async () => {
    await click('.tgr-saves'); await click('[data-save="2"]'); const save = await stored(2)
    assert.equal(save.vars.score, 15); assert.deepEqual(save.backlog.map((e) => e.text), ['first line', 'script line', 'second line'])
    assert.equal(save.presentation.rules[0][1], 'font-weight: 700')
    await click('[data-load="1"]'); await click('.tgr-saves'); await click('[data-load="2"]'); await pause(25)
    assert.equal(await text(), 'second line'); assert.match(await page(() => document.querySelector('#tgr-dyn-style').textContent), /font-weight: 700/)
  })
  await check('auto playback waits for text and pauses at choices', async () => {
    await click('.tgr-auto'); await waitFor(() => !!document.querySelector('.tgr-choice'), 'automatic choice arrival')
    assert.equal(await page(() => document.querySelector('.tgr-auto').getAttribute('aria-pressed')), 'false')
    assert.match(await page(() => document.querySelector('.tgr-choice').textContent), /score is 15/)
    await pause(1300); assert.equal(await page(() => !!document.querySelector('.tgr-choice')), true)
  })
  await check('auto playback is paused while backlog is open', async () => {
    await click('.tgr-saves'); await click('[data-load="2"]'); await pause(25)
    await click('.tgr-auto'); await click('.tgr-backlog'); await pause(1350)
    assert.equal(await text(), 'second line'); await click('.tgr-close')
    await waitFor(() => !!document.querySelector('.tgr-choice'), 'auto resumes after backlog')
  })
  await check('backlog includes script lines and selected choices', async () => {
    await click('.tgr-choice'); await click('.tgr-backlog')
    const entries = await page(() => [...document.querySelectorAll('.tgr-history-entry')].map((el) => el.textContent))
    assert.equal(entries.length, 4); assert.match(entries[1], /script line/); assert.match(entries[3], /score is 15/)
    await click('.tgr-close')
  })
  await check('playtest storage is separate from exported game', async () => {
    await page(() => { handle.destroy(); handle = StoryLoomPlayer.mountPlayer(document.getElementById('app'), testStory, { storageNamespace: 'playtest' }) })
    await pause(25); await click('.tgr-saves')
    assert.equal(await page(() => [...document.querySelectorAll('[data-load]')].every((btn) => btn.disabled)), true); await click('.tgr-close')
  })
  await check('damaged slots remain readable as errors and can be replaced', async () => {
    await page(() => { handle.destroy(); handle = StoryLoomPlayer.mountPlayer(document.getElementById('app'), testStory); const key = Object.keys(localStorage).find((key) => key.includes(':game:') && key.endsWith(':slot:6')); const base = Object.keys(localStorage).find((key) => key.includes(':game:') && key.endsWith(':slot:1')); localStorage.setItem(key || base.replace(':slot:1', ':slot:6'), '{broken') })
    await pause(25); await click('.tgr-saves'); assert.equal(await page(() => document.querySelector('[data-load="6"]').disabled), true)
    assert.equal(await page(() => document.querySelector('[data-save="6"]').disabled), false)
    await click('[data-save="6"]'); assert.equal((await stored(6)).vars.score, 1); await click('.tgr-close')
  })
  await check('global speed persists and inline speed still overrides it', async () => {
    await click('.tgr-settings'); await page(() => { const input = document.querySelector('.tgr-speed'); input.value = '0'; input.dispatchEvent(new Event('input')) }); await click('.tgr-close')
    await page(() => { handle.destroy(); const changed = structuredClone(testStory); changed.nodes.find((n) => n.id === 'first').data.text = '{speed:45}ABCDEFGHIJ'; window.speedStory = changed; handle = StoryLoomPlayer.mountPlayer(document.getElementById('app'), changed) })
    await pause(20); const partial = await text(); assert.ok(partial.length > 0 && partial.length < 10)
    await click('.tgr-settings'); assert.equal(await page(() => document.querySelector('.tgr-speed').value), '0')
    await page(() => { const input = document.querySelector('.tgr-speed'); input.dispatchEvent(new Event('input')) })
    await pause(20); assert.equal(await text(), 'ABCDEFGHIJ'); await click('.tgr-close')
  })
  await check('restart and destroy stop detached typewriter writes', async () => {
    await page(() => { handle.destroy(); speedStory.nodes.find((n) => n.id === 'first').data.text = '{speed:45}ABCDEFGHIJKLMNOPQRSTUV'; handle = StoryLoomPlayer.mountPlayer(document.getElementById('app'), speedStory) })
    await pause(20)
    await page(() => { window.oldText = document.querySelector('.tgr-text'); window.oldValue = oldText.textContent; document.querySelector('.tgr-restart').click() })
    await pause(150); assert.equal(await page(() => oldText.textContent === oldValue), true)
    await page(() => { window.destroyedText = document.querySelector('.tgr-text'); window.destroyedValue = destroyedText.textContent; handle.destroy() })
    await pause(150); assert.equal(await page(() => destroyedText.textContent === destroyedValue), true)
  })
  await check('restart cancels old script API and variable effects', async () => {
    await page(() => { const p = structuredClone(testStory); p.nodes = [p.nodes[0], { id: 'slow', type: 'script', position: { x: 0, y: 0 }, data: { code: 'await api.wait(100); vars.score += 9; api.css(".stale { color: red }");' } }, { id: 'stop', type: 'dialogue', position: { x: 0, y: 0 }, data: { text: '{speed:0}after wait' } }]; p.edges = [{ id: 'a', source: 'start', sourceHandle: null, target: 'slow' }, { id: 'b', source: 'slow', sourceHandle: null, target: 'stop' }]; window.cancelStory = p; handle = StoryLoomPlayer.mountPlayer(document.getElementById('app'), p) })
    await pause(20)
    await page(() => { handle.destroy(); handle = StoryLoomPlayer.mountPlayer(document.getElementById('app'), testStory) })
    await pause(140); assert.equal(await text(), 'first line'); assert.equal(await page(() => document.querySelector('#tgr-user-style').textContent.includes('.stale')), false)
  })
  await check('restart clears old fade transitions and shake timers', async () => {
    await page(() => {
      handle.destroy(); const p = structuredClone(testStory); p.customJs = 'api.shake(8, 100); await api.fadeOut("#000", 10000);'
      window.effectStory = p; handle = StoryLoomPlayer.mountPlayer(document.getElementById('app'), p)
    })
    await pause(20)
    await page(() => { effectStory.customJs = 'api.shake(8, 500);'; document.querySelector('.tgr-restart').click() })
    await pause(150)
    assert.equal(await page(() => document.querySelector('.tgr-stage').classList.contains('tgr-shake')), true)
    assert.equal(await page(() => document.querySelector('.tgr-fx').style.transition), 'none')
    assert.equal(await page(() => document.querySelector('.tgr-fx').style.opacity), '0')
  })
  await check('shortcuts work from header focus and preserve modifier keys', async () => {
    await page(() => {
      const button = document.querySelector('.tgr-auto'); button.focus()
      const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })
      button.dispatchEvent(event); window.ctrlWasPrevented = event.defaultPrevented
    })
    assert.equal(await page(() => ctrlWasPrevented), false)
    assert.equal(await page(() => document.querySelector('.tgr-auto').getAttribute('aria-pressed')), 'false')
    await page(() => document.querySelector('.tgr-auto').dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true })))
    assert.equal(await page(() => !document.querySelector('.tgr-overlay').hidden), true)
    await page(() => document.querySelector('.tgr-close').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    assert.equal(await page(() => document.querySelector('.tgr-overlay').hidden), true)
  })
  await check('title screen gates the story and its menu entries work', async () => {
    const mountError = await page(() => {
      try {
        handle.destroy()
        const p = structuredClone(testStory)
        p.release.titleScreen.enabled = true
        window.titleStory = p
        handle = StoryLoomPlayer.mountPlayer(document.getElementById('app'), p)
        return null
      } catch (err) { return String((err && err.stack) || err) }
    })
    if (mountError) throw new Error(mountError)
    await pause(25)
    assert.equal(await page(() => !!document.querySelector('.tgr-title-screen')), true)
    assert.equal(await page(() => document.querySelector('.tgr-text')), null) // 剧情未开始
    await click('.tgr-title-settings')
    assert.equal(await page(() => !document.querySelector('.tgr-overlay').hidden), true)
    await click('.tgr-close')
    await click('.tgr-title-start')
    await waitFor(() => document.querySelector('.tgr-text')?.textContent === 'first line', 'title start enters story')
    await waitFor(() => { const el = document.querySelector('.tgr-title-screen'); return !el || el.hidden }, 'title faded out')
  })
  console.log(`Player DOM: ${checks} checks passed.`)
  win.destroy()
  app.exit(0)
}).catch((error) => { console.error(error); if (win) win.destroy(); app.exit(1) })

app.on('quit', () => {
  // Only remove the temporary directory created above, after checking its absolute location.
  const target = path.resolve(temp)
  if (path.dirname(target) === taskWork && path.basename(target).startsWith('storyloom-player-test-')) {
    try { fs.rmSync(target, { recursive: true, force: true }) } catch { /* Chromium may still release files */ }
  }
})

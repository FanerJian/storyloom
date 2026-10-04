/** 隐藏 Electron 集成测试：只使用软件自身 API/DOM，不使用 Computer Use。 */
import assert from 'node:assert/strict'
import { app, BrowserWindow, dialog } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { registerIpc } from '../src/main/ipc'
import { registerAssetScheme, installAssetProtocol } from '../src/main/assetProtocol'
import { DirectoryProjects } from '../src/main/directoryProject'
import { upgradeAuthoring } from '../src/shared/authoring'
import { emptyProject, type StoryProject } from '../src/shared/schema'

const taskWork = resolve('work/studio-app-test'); mkdirSync(taskWork, { recursive: true })
const directory = mkdtempSync(join(taskWork, 'run-')), profile = join(directory, 'profile')
mkdirSync(profile); app.setPath('userData', profile); app.setPath('sessionData', profile)
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
if (process.env.CI) app.commandLine.appendSwitch('no-sandbox')
registerAssetScheme()
const checks: string[] = [], errors: string[] = []
let scenePressure: { storyNodes: number; scenes: number; renderedNodes: number; openedMs: number } | undefined
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
let win: BrowserWindow
const page = (code: string): Promise<any> => win.webContents.executeJavaScript(code)
async function until(code: string, label: string): Promise<void> {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) { if (await page(code)) return; await pause(40) }
  throw new Error(`Timed out: ${label}`)
}
async function check(name: string, action: () => Promise<void>): Promise<void> { await action(); checks.push(name); console.log(`ok ${name}`) }
const clickText = async (text: string): Promise<any> => {
  const group = ['剧本', '场景图', '节点画布'].includes(text) ? '创作' : ['角色库', '素材库'].includes(text) ? '资源' : null
  if (group) await page(`document.querySelector('button[aria-label="${group}"]').click()`)
  return page(`(() => {const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}); if(!b) throw Error('Missing button: '+${JSON.stringify(text)}); b.click()})()`)
}

function sample(): StoryProject {
  const p = emptyProject(); p.meta.title = '集成测试样例'
  p.assets.bg = { name: 'bg.svg', type: 'image', dataUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="navy"/></svg>') }
  p.nodes = [
    { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
    { id: 'bg', type: 'bg', position: { x: 0, y: 0 }, data: { asset: 'bg' } },
    { id: 'd', type: 'dialogue', position: { x: 0, y: 0 }, data: { speaker: '雨宮 澪', text: '第一句集成测试' } },
    { id: 'c1', type: 'choice', position: { x: 0, y: 0 }, data: { options: [{ id: 'a', text: '接受', condition: null }, { id: 'b', text: '拒绝', condition: null }] } },
    { id: 'c2', type: 'choice', position: { x: 0, y: 0 }, data: { options: [{ id: 'a', text: '加入', condition: null }, { id: 'b', text: '帮忙', condition: null }] } },
    { id: 'e', type: 'end', position: { x: 0, y: 0 }, data: { label: '第一章·完' } }
  ]
  p.edges = [['s', 'bg', null], ['bg', 'd', null], ['d', 'c1', null], ['c1', 'c2', 'a'], ['c1', 'c2', 'b'], ['c2', 'e', 'a'], ['c2', 'e', 'b']].map(([source, target, sourceHandle], i) => ({ id: `e${i}`, source: source!, target: target!, sourceHandle }))
  return upgradeAuthoring(p)
}

async function main(): Promise<void> {
await app.whenReady(); installAssetProtocol()
win = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: { offscreen: true, preload: resolve('out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
registerIpc(() => win)
win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message) })
try {
  const source = process.env.STORYLOOM_TEAM_PROJECT
  const author = new DirectoryProjects()
  const input = source ? author.open(source) : sample()
  const target = join(directory, 'team/project.loomproject')
  const migrated = new DirectoryProjects().save(input, target).project
  // 对话框返回测试目录，验证工具栏确实走正常保存接口。
  dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [join(directory, 'team')] })) as typeof dialog.showOpenDialog
  await win.loadFile(resolve('out/renderer/index.html'))
  await page(`localStorage.setItem('storyloom.plugins.v1',JSON.stringify([{id:'test',name:'test',version:'1',apiVersion:1,editorJs:'window.testContext=slp',editorCss:'',runtimeJs:'',runtimeCss:''}]));localStorage.setItem('storyloom.plugins.enabled.v1',JSON.stringify({test:true}));location.reload()`)
  await until('!!window.testContext && !!window.api', 'test context')
  await page(`window.api.openProjectPath(${JSON.stringify(target)}).then(r=>{if(r.error)throw Error(r.error); testContext.project.getState().loadProject(r.project,r.path)})`)
  await until(`!!document.querySelector('[data-testid="studio-workspace"]')`, 'studio loaded')
  const first = migrated.nodes.find((n) => n.type === 'dialogue')!
  await page(`testContext.project.getState().onNodesChange([{type:'select',id:${JSON.stringify(first.id)},selected:true}])`)
  await check('连续剧本编辑、角色库、场景图与旧节点画布可以切换', async () => {
    assert(await page(`!!document.querySelector('[aria-label="场景名称"]')`))
    await clickText('角色库'); await until(`!!document.querySelector('[aria-label="角色姓名"]')`, 'characters')
    await clickText('场景图'); await until(`!!document.querySelector('.react-flow')`, 'overview')
    const rendered = await page(`document.querySelectorAll('.react-flow__node').length`)
    assert(rendered > 0 && rendered <= migrated.authoring!.scenes.length + migrated.nodes.filter((n) => n.type === 'choice' || n.type === 'end').length)
    await clickText('节点画布'); await until(`!!document.querySelector('.react-flow')`, 'node canvas')
    assert.equal(await page(`document.querySelectorAll('.react-flow__node').length`), migrated.nodes.filter((n) => n.sceneId === migrated.authoring!.scenes[0].id).length)
    await clickText('剧本')
  })
  await check('统一菜单支持键盘、点击空白关闭，900 像素窗口不挤出顶栏', async () => {
    await page(`(()=>{const b=document.querySelector('button[aria-label="创作"]');b.focus();b.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))})()`)
    await until(`document.activeElement?.getAttribute('role')==='menuitem'`, 'menu keyboard focus')
    assert.equal(await page(`document.activeElement.textContent.trim()`), '剧本')
    await page(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`)
    assert.equal(await page(`document.activeElement.textContent.trim()`), '场景图')
    await page(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await until(`!document.querySelector('[role="menu"]')`, 'escape closes menu')
    assert.equal(await page(`document.activeElement.getAttribute('aria-label')`), '创作')
    assert.equal(await page(`document.querySelectorAll('[role="menu"]').length`), 0)
    await page(`document.querySelector('button[aria-label="资源"]').click()`)
    await until(`!!document.querySelector('[role="menu"]')`, 'resource menu opened')
    await page(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
    await until(`!document.querySelector('[role="menu"]')`, 'outside closes menu')
    assert.equal(await page(`document.querySelectorAll('[role="menu"]').length`), 0)
    win.setSize(900, 700); await pause(80)
    assert(await page(`(()=>{const h=document.querySelector('[data-testid="editor-toolbar"]');return h.scrollWidth<=h.clientWidth})()`), 'toolbar fits minimum window')
    win.setSize(1600, 1000)
  })
  await check('场景卡片实时拖动、分支跟随，松开只生成一条历史并可撤销', async () => {
    await clickText('场景图')
    const sceneId = migrated.authoring!.scenes[0].id
    const selector = `.react-flow__node[data-id="${sceneId}"]`
    await page(`document.querySelector('button[aria-label="定位所选场景"]').click()`); await pause(200)
    await until(`document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().width>100`, 'scene measured')
    await pause(100)
    const before = await page(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();const c=document.querySelector('.scene-card-choice[data-scene-id="${sceneId}"]')?.parentElement.getBoundingClientRect();const s=testContext.project.getState();return {x:e.x,y:e.y,childX:c?.x,childY:c?.y,position:s.authoring.scenes[0].position??null,past:s.pastCount}})()`)
    const x = Math.round(before.x + 60), y = Math.round(before.y + 25)
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 8; i++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: x + i * 12, y: y + i * 4, button: 'left' }); await pause(20)
    }
    const moving = await page(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();const c=document.querySelector('.scene-card-choice[data-scene-id="${sceneId}"]')?.parentElement.getBoundingClientRect();const s=testContext.project.getState();return {x:e.x,y:e.y,childX:c?.x,childY:c?.y,position:s.authoring.scenes[0].position??null,past:s.pastCount}})()`)
    assert(moving.x - before.x > 60, 'DOM moves before mouse release')
    assert.deepEqual(moving.position, before.position, 'project is unchanged during drag')
    assert.equal(moving.past, before.past)
    if (before.childX != null) {
      assert(Math.abs((moving.childX - before.childX) - (moving.x - before.x)) < 2)
      assert(Math.abs((moving.childY - before.childY) - (moving.y - before.y)) < 2)
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: x + 96, y: y + 32, button: 'left', clickCount: 1 })
    await until(`testContext.project.getState().pastCount===${before.past + 1}`, 'one drag commit')
    await page('testContext.project.getState().undo()')
    assert.deepEqual(await page('testContext.project.getState().authoring.scenes[0].position??null'), before.position)
    await until(`Math.abs(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().x-${before.x})<2`, 'undo position')
    assert(await page(`(()=>{const labels=[...document.querySelectorAll('.scene-edge-label')].map(e=>e.getBoundingClientRect());const cards=[...document.querySelectorAll('.react-flow__node')].map(e=>e.getBoundingClientRect());return labels.every(a=>cards.every(b=>!(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)))})()`), 'branch labels do not cover cards')
  })
  await check('场景图平移后切换视图保留视口；选左侧场景不跳出场景图', async () => {
    win.webContents.sendInputEvent({ type: 'mouseWheel', x: 400, y: 600, deltaX: 80, deltaY: 100 })
    await pause(300)
    const before = await page(`document.querySelector('.react-flow__viewport').style.transform`)
    await clickText('节点画布'); await pause(80); await clickText('场景图'); await pause(80)
    assert.equal(await page(`document.querySelector('.react-flow__viewport').style.transform`), before)
    await page(`document.querySelector('aside button[data-scene-id="${migrated.authoring!.scenes[0].id}"]').click()`)
    assert.equal(await page(`testContext.project.getState().workspaceMode`), 'scenes')
    await clickText('剧本')
  })
  await check('连线面板按需出现，替换出口需确认且能完整撤销', async () => {
    const scene = migrated.authoring!.scenes[0], source = migrated.nodes.find((n) => n.sceneId === scene.id && n.type !== 'end' && n.type !== 'choice')!
    const before = await page('testContext.project.get().edges')
    const target = await page(`testContext.project.getState().addScene(${JSON.stringify(scene.chapterId)},'连接测试场景')`)
    await page(`document.querySelector('aside button[data-scene-id="${scene.id}"]').click()`)
    await clickText('场景图')
    assert.equal(await page(`!!document.querySelector('[aria-label="场景出口"]')`), false)
    await clickText('连接场景')
    await page(`(()=>{for(const [label,value] of [['场景出口',${JSON.stringify(JSON.stringify([source.id, null]))}],['连接目标场景',${JSON.stringify(target)}]]){const e=document.querySelector('select[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('change',{bubbles:true}))}})()`)
    await clickText('确认连接'); await until(`document.body.textContent.includes('替换剧情出口')`, 'replace confirmation')
    await clickText('取消'); assert.deepEqual(await page('testContext.project.get().edges'), before)
    await clickText('确认连接'); await until(`document.body.textContent.includes('替换剧情出口')`, 'replace confirmation again')
    await clickText('替换连线'); await until(`!document.querySelector('[aria-label="连接场景面板"]')`, 'connected')
    assert(await page(`testContext.project.get().edges.some(e=>e.source===${JSON.stringify(source.id)}&&e.target===testContext.project.get().authoring.scenes.find(s=>s.id===${JSON.stringify(target)}).entryId)`))
    await page('testContext.project.getState().undo();testContext.project.getState().undo()')
    assert.deepEqual(await page('testContext.project.get().edges'), before)
    await clickText('剧本')
  })
  await check('场景整理只更新布局，一次撤销还原位置与剧情', async () => {
    await clickText('场景图')
    const before = await page('({authoring:testContext.project.get().authoring,edges:testContext.project.get().edges,nodes:testContext.project.get().nodes,past:testContext.project.getState().pastCount})')
    await clickText('整理')
    await until(`testContext.project.getState().pastCount===${before.past + 1}`, 'scene layout')
    assert.deepEqual(await page('testContext.project.get().nodes'), before.nodes)
    assert.deepEqual(await page('testContext.project.get().edges'), before.edges)
    await page('testContext.project.getState().undo()')
    assert.deepEqual(await page('testContext.project.get().authoring'), before.authoring)
    await clickText('剧本')
  })
  await check('编辑器正文修改保留节点 ID，撤销还原', async () => {
    const text = first.data.text ?? ''
    const selector = `[aria-label="对白正文 ${first.id}"]`
    await page(`(() => {const e=document.querySelector(${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(e,${JSON.stringify(`${text}（测试编辑）`)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await until(`testContext.project.getState().nodes.find(n=>n.id===${JSON.stringify(first.id)}).data.text.endsWith('（测试编辑）')`, 'edited text')
    await page(`testContext.project.getState().undo()`)
    assert.equal(await page(`testContext.project.getState().nodes.find(n=>n.id===${JSON.stringify(first.id)}).data.text`), text)
  })
  await check('源码前端可以保存目录工程并重新读取外部素材', async () => {
    await page(`testContext.project.getState().updateNodeData(${JSON.stringify(first.id)},{notes:'集成测试备注'})`)
    await page(`document.querySelector('button[title="保存 (Ctrl+S)"]').click()`)
    await until('!testContext.project.getState().dirty', 'directory saved')
    const saved = new DirectoryProjects().open(target)
    assert.equal(saved.nodes.find((n) => n.id === first.id)!.data.notes, '集成测试备注')
    assert(Object.values(saved.assets).every((a) => !a.dataUrl && a.runtimeUrl?.startsWith('storyloom-asset:')))
  })
  await check('受限本地协议实际加载全部图片和音频元数据', async () => {
    const results = await page(`Promise.all(Object.entries(testContext.project.get().assets).map(([id,a])=>new Promise(r=>{const e=a.type==='image'?new Image():new Audio();let done=false;const end=ok=>{if(done)return;done=true;r({id,ok})};e.onload=()=>end(true);e.onloadedmetadata=()=>end(true);e.onerror=()=>end(false);e.preload='metadata';e.src=a.runtimeUrl;setTimeout(()=>end(false),8000)})))`)
    assert(results.every((r: { ok: boolean }) => r.ok), JSON.stringify(results.filter((r: { ok: boolean }) => !r.ok)))
  })
  const routes: { choices: number[]; transcript: string[]; vars: unknown }[] = []
  await check('新版工程四种选项组合均在真实播放器到达第一章结局', async () => {
    for (const combination of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      await page(`testContext.ui.openPlaytest()`)
      await until(`!!document.querySelector('.tgr-root')`, 'player mounted')
      await page(`(()=>{document.querySelector('.tgr-settings').click();const e=document.querySelector('.tgr-speed');if(e){e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('.tgr-close').click()})()`)
      const route = await page(`(async()=>{
        const transcript=[],choices=${JSON.stringify(combination)};let selection=0,last='',step=0;
        while(step++<1600){
          if(document.querySelector('.tgr-end-mark')){
            document.querySelector('.tgr-saves').click();document.querySelector('[data-save="1"]').click();
            const key=Object.keys(localStorage).find(k=>k.includes(':playtest:')&&k.endsWith(':slot:1'));
            return {choices,transcript,vars:JSON.parse(localStorage.getItem(key)).vars};
          }
          const t=document.querySelector('.tgr-text')?.textContent;if(t&&t!==last){transcript.push(t);last=t;}
          const options=[...document.querySelectorAll('.tgr-choice')];
          if(options.length){if(selection>=choices.length)throw Error('Unexpected choice');options[choices[selection++]].click();}
          else document.querySelector('.tgr-continue')?.click();
          await new Promise(r=>setTimeout(r,0));
        }throw Error('Route did not end');
      })()`)
      routes.push(route)
      await page(`document.querySelector('[aria-label="关闭"]').click()`)
      await until(`!document.querySelector('.tgr-root')`, 'playtest closed')
    }
    assert.equal(routes.length, 4)
    if (migrated.variables.some((v) => v.id === 'umbrella_shared')) {
      for (const route of routes) {
        assert.equal((route.vars as Record<string, unknown>).umbrella_shared, route.choices[0] === 0)
        assert.equal((route.vars as Record<string, unknown>).joined_club, route.choices[1] === 0)
        assert(route.transcript.some((t) => t.includes(route.choices[1] === 0 ? '成员。' : '帮手。')))
      }
    }
  })
  await check('外部改动提示与同场景冲突不覆盖磁盘，重新加载后保留独立备份', async () => {
    const foreign = new DirectoryProjects(), p = foreign.open(target)
    p.nodes.find((n) => n.id === first.id)!.data.text = '他人修改后的对白'
    foreign.save(p, target)
    await until(`document.body.textContent.includes('检测到外部文件修改')`, 'external change banner')
    await page(`testContext.project.getState().updateNodeData(${JSON.stringify(first.id)},{text:'本地未保存冲突'})`)
    const result = await page(`window.api.saveProject(testContext.project.get(),{path:${JSON.stringify(target)}})`)
    assert(result.canceled && result.conflicts.length)
    assert.equal(new DirectoryProjects().open(target).nodes.find((n) => n.id === first.id)!.data.text, '他人修改后的对白')
    await clickText('备份并重新加载')
    await until(`document.body.textContent.includes('放弃未保存的更改？')`, 'reload confirmation')
    await clickText('放弃更改')
    await until(`testContext.project.getState().nodes.find(n=>n.id===${JSON.stringify(first.id)}).data.text==='他人修改后的对白'`, 'reloaded')
    const backups = await page(`window.api.listRecovery()`)
    assert(backups.snapshots.some((s: { id: string; project: StoryProject }) => s.id.startsWith('conflict_backup_') && s.project.nodes.some((n) => n.data.text === '本地未保存冲突')))
  })
  await check('一万条剧情、200 个场景仅渲染视口附近的卡片', async () => {
    const previous = await page('({project:testContext.project.get(),path:testContext.project.getState().filePath})')
    const p = upgradeAuthoring(emptyProject()), chapterId = p.authoring!.chapters[0].id
    p.authoring!.scenes = Array.from({ length: 200 }, (_, i) => ({ id: `scene_${i}`, chapterId, name: `长篇场景 ${i + 1}`, entryId: `line_${i * 50}` }))
    p.nodes = Array.from({ length: 10000 }, (_, i) => ({ id: `line_${i}`, sceneId: `scene_${Math.floor(i / 50)}`, type: i === 0 ? 'start' : i === 9999 ? 'end' : 'dialogue', position: { x: 0, y: i * 120 }, data: { text: `长篇对白 ${i}` } }))
    p.edges = p.nodes.slice(0, -1).map((n, i) => ({ id: `edge_${i}`, source: n.id, target: p.nodes[i + 1].id, sourceHandle: null }))
    await page(`testContext.project.getState().loadProject(${JSON.stringify(p)},null)`)
    const started = performance.now()
    await clickText('场景图')
    await until(`document.querySelector('.scene-card-scene')?.getBoundingClientRect().width>100`, 'large overview readable')
    await pause(120)
    const rendered = await page(`document.querySelectorAll('[data-testid="scene-graph"] .react-flow__node').length`)
    assert(rendered > 0 && rendered < 30, `visible node rendering, actual=${rendered}`)
    scenePressure = { storyNodes: p.nodes.length, scenes: p.authoring!.scenes.length, renderedNodes: rendered, openedMs: performance.now() - started }
    writeFileSync(join(directory, 'large-scene-overview.png'), (await win.webContents.capturePage()).toPNG())
    await page(`testContext.project.getState().loadProject(${JSON.stringify(previous.project)},${JSON.stringify(previous.path)})`)
  })
  // 交付截图使用未经测试改稿污染的原样工程。
  if (source) await page(`window.api.openProjectPath(${JSON.stringify(source)}).then(r=>testContext.project.getState().loadProject(r.project,r.path))`)
  await clickText('剧本'); await pause(150)
  writeFileSync(join(directory, 'script-editor.png'), (await win.webContents.capturePage()).toPNG())
  await clickText('场景图'); await pause(150)
  writeFileSync(join(directory, 'scene-overview.png'), (await win.webContents.capturePage()).toPNG())
  await page(`document.querySelector('button[aria-label="创作"]').click()`); await pause(60)
  writeFileSync(join(directory, 'creation-menu.png'), (await win.webContents.capturePage()).toPNG())
  await page(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
  assert.deepEqual(errors, [])
  const report = { status: 'passed', checks, routes, scenePressure, errors, profile, directory, project: target }
  writeFileSync(join(taskWork, 'latest-result.json'), JSON.stringify(report, null, 2))
  console.log(`Studio app: ${checks.length} checks passed. ${directory}`)
  win.destroy(); app.exit(0)
} catch (error) {
  console.error(error)
  writeFileSync(join(taskWork, 'latest-result.json'), JSON.stringify({ status: 'failed', checks, errors, error: String(error), directory }, null, 2))
  if (win && !win.isDestroyed()) win.destroy(); app.exit(1)
}
}
void main().catch((e) => { console.error(e); app.exit(1) })

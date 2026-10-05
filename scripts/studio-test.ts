import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, unlinkSync, openSync, closeSync, ftruncateSync, mkdtempSync, createReadStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { DirectoryProjects, ProjectConflict, within, hydrateRecoveryAssets, embedAssets } from '../src/main/directoryProject'
import { upgradeAuthoring, overviewGraph, createScenePrefetch } from '../src/shared/authoring'
import { emptyProject, migrateProject, type StoryProject, type StoryNode } from '../src/shared/schema'
import { playerIdentity, playerRevision, validatePlayerSave, type PlayerSave } from '../src/shared/playerState'
import { validateProject } from '../src/shared/validate'
import { useProjectStore } from '../src/renderer/src/stores/project'
import { installFlowOperations } from '../src/renderer/src/lib/flowOperations'
import { hostApi } from '../src/renderer/src/lib/api'
import { projectActions } from '../src/renderer/src/lib/projectActions'
import type { SaveResult } from '../src/shared/api'
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'

installFlowOperations({ applyNodeChanges, applyEdgeChanges, addEdge })
const work = resolve('work/studio-tests'); mkdirSync(work, { recursive: true })
const root = mkdtempSync(join(work, 'run-')), target = join(root, 'project.loomproject')
let count = 0
const report: { checks: string[]; pressure?: unknown } = { checks: [] }
function check(name: string, test: () => void): void { test(); count++; report.checks.push(name); console.log(`ok ${name}`) }
const node = (id: string, type: StoryNode['type'], data: StoryNode['data'] = {}): StoryNode => ({ id, type, data, position: { x: 0, y: 0 } })
const original: StoryProject = { ...emptyProject(), meta: { title: '迁移测试', author: 'Test', description: '' },
  assets: { image: { name: '占位.svg', type: 'image', dataUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}`, placeholder: true } },
  nodes: [node('start', 'start'), node('scene1', 'jump', { label: '场景一：开始' }), node('line1', 'dialogue', { speaker: '雨宮 澪', text: '第一句' }),
    node('choice', 'choice', { options: [{ id: 'a', text: '接受', condition: null }, { id: 'b', text: '拒绝', condition: null }] }),
    node('branchA', 'dialogue', { text: '接受后的对白' }), node('branchB', 'dialogue', { text: '拒绝后的对白' }),
    node('scene2', 'jump', { label: '场景二：结尾' }), node('line2', 'dialogue', { text: '共同结尾' }), node('end', 'end', { label: '完' })],
  edges: [['start', 'scene1', null], ['scene1', 'line1', null], ['line1', 'choice', null], ['choice', 'branchA', 'a'], ['choice', 'branchB', 'b'], ['branchA', 'scene2', null], ['branchB', 'scene2', null], ['scene2', 'line2', null], ['line2', 'end', null]].map(([source, target, handle], i) => ({ id: `e${i}`, source: source!, target: target!, sourceHandle: handle })) }
const upgraded = upgradeAuthoring(original), author = new DirectoryProjects()
const saved = author.save(upgraded, target), p = saved.project
check('v1/v2/v3 无损迁移到 v4，保留旧节点、选项、变量和素材 ID', () => {
  for (const version of [1, 2, 3]) assert.equal(upgradeAuthoring(migrateProject({ ...original, version })).version, 4)
  assert.deepEqual(p.nodes.map((n) => n.id).sort(), original.nodes.map((n) => n.id).sort())
  assert.deepEqual(p.edges, original.edges)
  assert.deepEqual(p.nodes.find((n) => n.id === 'choice')!.data.options, original.nodes.find((n) => n.id === 'choice')!.data.options)
  assert.equal(p.authoring!.scenes.length, 2); assert.equal(p.authoring!.characters[0].name, '雨宮 澪')
  assert.throws(() => migrateProject({ version: 99 }), /升级编辑器/)
})
check('外部素材不再包含 base64，原字节可恢复导出，恢复快照可重新绑定', () => {
  assert.equal(p.assets.image.dataUrl, ''); assert(p.assets.image.path); assert(p.assets.image.placeholder)
  assert(!readFileSync(target, 'utf8').includes('base64'))
  assert(embedAssets(p).assets.image.dataUrl.startsWith('data:image/svg+xml;base64,'))
  assert.equal(hydrateRecoveryAssets(p).assets.image.runtimeUrl, p.assets.image.runtimeUrl)
  assert(existsSync(join(root, '.gitattributes')))
})
check('总览保留关键分支、两个选项标签与结局', () => {
  const graph = overviewGraph(p)
  assert.equal(graph.nodes.filter((n) => n.kind === 'scene').length, 2)
  assert.equal(graph.nodes.filter((n) => n.kind === 'choice').length, 1)
  assert.deepEqual(graph.edges.filter((e) => e.source === 'choice_choice').map((e) => e.label).sort(), ['接受', '拒绝'].sort())
  assert(graph.nodes.some((n) => n.kind === 'end'))
})
check('场景预加载只预测当前/相邻的有限图片，不预读音频大文件', () => {
  const fixture = structuredClone(p), scene1 = p.authoring!.scenes[0].id, scene2 = p.authoring!.scenes[1].id
  for (let i = 0; i < 20; i++) {
    fixture.assets[`img${i}`] = { name: `${i}.png`, type: 'image', dataUrl: '', path: `assets/${i}.png`, bytes: 4 * 1024 * 1024 }
    fixture.nodes.push({ ...node(`media${i}`, 'bg', { asset: `img${i}` }), sceneId: i < 10 ? scene1 : scene2 })
  }
  const keys = createScenePrefetch(fixture)(scene1)
  assert(keys.length <= 5); assert(keys.every((k) => fixture.assets[k].type === 'image'))
  const unavailable = { ...p, assets: { ...p.assets, image: { ...p.assets.image, sourcePath: join(root, 'unavailable/assets/example.svg') } } }
  assert(hydrateRecoveryAssets(unavailable).assets.image.missing)
})
check('改一句对白只写一个场景；不改清单、其他场景或素材', () => {
  const before = statSync(p.assets.image.sourcePath!).mtimeMs
  const change = structuredClone(p); change.nodes.find((n) => n.id === 'line1')!.data.text = '修改后的第一句'
  const result = author.save(change, target)
  assert.deepEqual(result.written, [`scenes/${p.nodes.find((n) => n.id === 'line1')!.sceneId}.json`])
  assert.equal(statSync(p.assets.image.sourcePath!).mtimeMs, before)
})
check('两个独立会话修改不同场景可以汇总；外部变化可以检测', () => {
  const one = new DirectoryProjects(), two = new DirectoryProjects()
  const first = one.open(target), second = two.open(target)
  first.nodes.find((n) => n.id === 'line1')!.data.text = '编剧甲'
  one.save(first, target)
  assert.equal(two.changes(target).length, 1)
  second.nodes.find((n) => n.id === 'line2')!.data.text = '编剧乙'
  const result = two.save(second, target)
  assert.equal(result.project.nodes.find((n) => n.id === 'line1')!.data.text, '编剧甲')
  assert.equal(result.project.nodes.find((n) => n.id === 'line2')!.data.text, '编剧乙')
  assert.equal(result.merged.length, 1)
})
check('同场景双方修改时，在写入任何场景之前拒绝保存', () => {
  const one = new DirectoryProjects(), two = new DirectoryProjects()
  const first = one.open(target), second = two.open(target)
  first.nodes.find((n) => n.id === 'line1')!.data.text = '先保存者'
  one.save(first, target)
  second.nodes.find((n) => n.id === 'line1')!.data.text = '冲突者'
  second.nodes.find((n) => n.id === 'line2')!.data.text = '不应部分写入'
  assert.throws(() => two.save(second, target), ProjectConflict)
  const actual = new DirectoryProjects().open(target)
  assert.equal(actual.nodes.find((n) => n.id === 'line1')!.data.text, '先保存者')
  assert.equal(actual.nodes.find((n) => n.id === 'line2')!.data.text, '编剧乙')
})
check('保存事务中断可以补齐，第三方修改不会被事务恢复覆盖', () => {
  const scenePath = `scenes/${p.authoring!.scenes[0].id}.json`, absolute = join(root, scenePath)
  const before = readFileSync(absolute, 'utf8'), next = before.replace('先保存者', '中断后补齐')
  const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
  const journal = join(root, '.fableloom/pending.json')
  writeFileSync(journal, JSON.stringify([{ path: scenePath, before: hash(before), after: hash(next), content: next }]))
  assert.equal(new DirectoryProjects().open(target).nodes.find((n) => n.id === 'line1')!.data.text, '中断后补齐')
  assert(!existsSync(journal))
  writeFileSync(journal, JSON.stringify([{ path: scenePath, before: hash(before), after: hash(next), content: next }]))
  const third = next.replace('中断后补齐', '第三方新版本'); writeFileSync(absolute, third)
  assert.throws(() => new DirectoryProjects().open(target), ProjectConflict)
  assert.equal(readFileSync(absolute, 'utf8'), third); unlinkSync(journal)
})
check('缺失素材可提示，路径逃逸与损坏场景被拒绝', () => {
  assert.throws(() => within(root, '../outside.json'), /越界/)
  assert.throws(() => within(root, 'C:/outside.json'), /越界/)
  const bytes = readFileSync(p.assets.image.sourcePath!); unlinkSync(p.assets.image.sourcePath!)
  const missing = new DirectoryProjects().open(target)
  assert(missing.assets.image.missing); assert(validateProject(missing).some((i) => i.message.includes('外部文件缺失')))
  writeFileSync(p.assets.image.sourcePath!, bytes)
  const file = join(root, `scenes/${p.authoring!.scenes[0].id}.json`), text = readFileSync(file, 'utf8')
  writeFileSync(file, '{broken'); assert.throws(() => new DirectoryProjects().open(target)); writeFileSync(file, text)
})
const current = new DirectoryProjects().open(target)
useProjectStore.getState().loadProject(current, target)
check('剧本与画布共用数据；插入删除自动接线；操作可撤销', () => {
  const store = useProjectStore.getState(), sceneId = current.nodes.find((n) => n.id === 'line1')!.sceneId!
  const inserted = store.insertDialogue(sceneId, 'line1')
  assert(useProjectStore.getState().edges.some((e) => e.source === 'line1' && e.target === inserted))
  assert(useProjectStore.getState().edges.some((e) => e.source === inserted && e.target === 'choice'))
  useProjectStore.getState().removeDialogue(inserted)
  assert(useProjectStore.getState().edges.some((e) => e.source === 'line1' && e.target === 'choice'))
  useProjectStore.getState().undo(); assert(useProjectStore.getState().nodes.some((n) => n.id === inserted))
  useProjectStore.getState().undo(); assert(!useProjectStore.getState().nodes.some((n) => n.id === inserted))
})
check('角色改名、批量角色、查找替换与场景书签保留稳定 ID', () => {
  const store = useProjectStore.getState(), id = store.authoring!.characters[0].id
  store.updateCharacter(id, { name: '雨宮 澪（改名）' })
  assert.equal(useProjectStore.getState().nodes.find((n) => n.id === 'line1')!.data.speaker, '雨宮 澪（改名）')
  useProjectStore.getState().assignCharacter(['line2'], id)
  assert.equal(useProjectStore.getState().nodes.find((n) => n.id === 'line2')!.data.characterId, id)
  useProjectStore.getState().replaceDialogue('第三方', '校订', ['line1'])
  assert(useProjectStore.getState().nodes.find((n) => n.id === 'line1')!.data.text!.includes('校订'))
  useProjectStore.getState().updateScene(store.authoring!.scenes[0].id, { bookmark: true, notes: '待审稿' })
  assert(useProjectStore.getState().authoring!.scenes[0].bookmark)
})
check('v4 标题/正文/同 ID 素材变更保持存档身份；删除节点或改类型拒绝旧档', () => {
  const revised = structuredClone(current); revised.meta.title = '改名'; revised.nodes.find((n) => n.id === 'line1')!.data.text = '修错字'; revised.assets.image.name = '替换素材名'
  assert.equal(playerIdentity(revised), playerIdentity(current)); assert.equal(playerRevision(revised), playerRevision(current))
  const save: PlayerSave = { version: 1, revision: playerRevision(current), savedAt: Date.now(), nodeId: 'line1', vars: {}, backlog: [],
    media: { background: null, sprites: { left: null, right: null, center: null, custom: null }, bgm: null }, presentation: { css: '', rules: [], overlayColor: '', overlayOpacity: '' } }
  assert(validatePlayerSave(save, revised, playerRevision(revised)))
  revised.nodes = revised.nodes.filter((n) => n.id !== 'line1'); assert.equal(validatePlayerSave(save, revised, playerRevision(revised)), null)
  const incompatible = structuredClone(current); incompatible.authoring!.saveCompatibilityVersion++
  assert.equal(validatePlayerSave(save, incompatible, playerRevision(incompatible)), null)
})
check('画布临时选中/尺寸状态不会产生团队文件变更', () => {
  const session = new DirectoryProjects(), project = session.open(target)
  Object.assign(project.nodes[0], { selected: true, measured: { width: 200, height: 150 }, dragging: false })
  assert.deepEqual(session.save(project, target).written, [])
})

// 保存返回前继续打字与外部合并相遇时，后续自动保存不得回写过时副本。
useProjectStore.getState().loadProject(current, target)
useProjectStore.getState().updateNodeData('line1', { text: '保存发出时的内容' })
const captured = useProjectStore.getState().getProject(), foreignResult = structuredClone(captured)
foreignResult.nodes.find((n) => n.id === 'line2')!.data.text = '同时到达的外部改稿'
let resolveSave!: (result: SaveResult) => void, saves = 0
const gate = new Promise<SaveResult>((r) => { resolveSave = r })
const retained: StoryProject[] = []
hostApi.saveProject = async () => { saves++; return gate }
hostApi.listRecovery = async () => ({ snapshots: [] })
hostApi.writeRecovery = async (snapshot) => { retained.push(snapshot.project); return { ok: true } }
const saving = projectActions.autosave()
await new Promise((r) => setTimeout(r, 0))
useProjectStore.getState().updateNodeData('line1', { text: '保存期间的新编辑' })
resolveSave({ canceled: false, path: target, project: foreignResult, merged: [`scenes/${current.authoring!.scenes[1].id}.json`] })
await assert.rejects(saving, /保存期间继续编辑/)
await projectActions.autosave()
check('慢保存加外部合并时保留最新改稿，并阻止下次自动覆盖', () => {
  assert.equal(saves, 1); assert(useProjectStore.getState().saveBlocked)
  assert.equal(useProjectStore.getState().nodes.find((n) => n.id === 'line1')!.data.text, '保存期间的新编辑')
  assert(retained.some((p) => p.nodes.some((n) => n.data.text === '保存期间的新编辑')))
})

// 资源为合法 WAV 头加稀疏静音区，仅测索引读写，不能当作真实配音/解码压力证明。
const pressureRoot = join(root, 'pressure'); mkdirSync(join(pressureRoot, 'assets'), { recursive: true })
const largePath = join(pressureRoot, 'assets/stress.wav'), logicalBytes = Number(process.env.FABLELOOM_STRESS_BYTES ?? 64 * 1024 * 1024)
const fd = openSync(largePath, 'w'), wav = Buffer.alloc(44)
wav.write('RIFF'); wav.writeUInt32LE(logicalBytes - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28)
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(logicalBytes - 44, 40)
writeFileSync(fd, wav); closeSync(fd)
const sparse = process.platform === 'win32' ? spawnSync('fsutil', ['sparse', 'setflag', largePath], { windowsHide: true }).status === 0 : true
const largeFd = openSync(largePath, 'r+'); ftruncateSync(largeFd, logicalBytes); closeSync(largeFd)
const assetHash = createHash('sha256'); for await (const chunk of createReadStream(largePath)) assetHash.update(chunk)
const pressure = upgradeAuthoring(emptyProject()), chapterId = pressure.authoring!.chapters[0].id
pressure.authoring!.scenes = Array.from({ length: 200 }, (_, i) => ({ id: `stress_scene_${i}`, chapterId, name: `场景 ${i}`, entryId: `line_${i === 0 ? 0 : i * 50 + 1}` }))
pressure.nodes = Array.from({ length: 10_002 }, (_, i) => ({ ...node(`line_${i}`, i === 0 ? 'start' : i === 10001 ? 'end' : 'dialogue', { text: `第 ${i} 句长篇压力对白` }), sceneId: `stress_scene_${Math.min(199, Math.max(0, Math.floor((i - 1) / 50)))}` }))
pressure.edges = pressure.nodes.slice(0, -1).map((n, i) => ({ id: `edge_${i}`, source: n.id, target: pressure.nodes[i + 1].id, sourceHandle: null }))
pressure.assets.large = { name: '压力静音.wav', type: 'audio', dataUrl: '', path: 'assets/stress.wav', sourcePath: largePath, contentHash: assetHash.digest('hex'), mime: 'audio/wav', bytes: logicalBytes }
const pressureTarget = join(pressureRoot, 'project.loomproject'), writer = new DirectoryProjects()
writer.save(pressure, pressureTarget)
const memoryBefore = process.memoryUsage().rss, start = performance.now(), loaded = new DirectoryProjects().open(pressureTarget), openedMs = performance.now() - start
loaded.nodes[5555].data.text = '校订一行'
const saveStart = performance.now(), result = writer.save(loaded, pressureTarget), savedMs = performance.now() - saveStart
const validateStart = performance.now(); assert(!validateProject(loaded).some((i) => i.level === 'error')); const checkedMs = performance.now() - validateStart
report.pressure = { dialogueEntries: pressure.nodes.filter((n) => n.type === 'dialogue').length, totalNodes: pressure.nodes.length, scenes: 200, logicalBytes, sparse, openedMs, savedMs, checkedMs, rssIncreaseBytes: process.memoryUsage().rss - memoryBefore,
  written: result.written, note: '稀疏静音 WAV，只验证目录工程索引/增量写入，不代表真实配音解码压力测试。' }
check('万条对白及外部大文件：只写一场景，资源不进入 JSON 或全量内存', () => {
  assert.equal(result.written.length, 1); assert(result.written[0].startsWith('scenes/'))
  assert(statSync(pressureTarget).size < 100_000); assert.equal(loaded.assets.large.dataUrl, '')
  assert(openedMs < 10_000); assert(savedMs < 5000); assert(process.memoryUsage().rss - memoryBefore < 256 * 1024 * 1024)
})
writeFileSync(resolve('work/studio-tests/latest-result.json'), JSON.stringify({ status: 'passed', count, directory: root, ...report }, null, 2))
console.log(`Stage A: ${count} checks passed. ${JSON.stringify(report.pressure)}`)

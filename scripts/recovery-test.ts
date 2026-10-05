/** esbuild --bundle --platform=node --format=esm --external:./exportHtml */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { RecoveryFiles } from '../src/main/recovery'
import { writeFileAtomic } from '../src/main/atomicFile'
import { emptyProject } from '../src/shared/schema'
import { parseRecovery, type RecoverySnapshot } from '../src/shared/recovery'
import { hostApi } from '../src/renderer/src/lib/api'
import { useProjectStore } from '../src/renderer/src/stores/project'
import { useRecoveryStore } from '../src/renderer/src/stores/recovery'
import { useUiStore } from '../src/renderer/src/stores/ui'
import { clearProjectRecovery, deferRecovery, discardRecovery, initializeRecovery, restoreRecovery, writeProjectRecovery, flushRecovery } from '../src/renderer/src/lib/recovery'
import { projectActions, startProjectPersistence } from '../src/renderer/src/lib/projectActions'

const testWork = resolve('work'); mkdirSync(testWork, { recursive: true })
const testDirectory = mkdtempSync(join(testWork, 'fableloom-recovery-test-'))
let passed = 0
function check(label: string, body: () => void): void { body(); passed++; console.log(`  ok  ${label}`) }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
async function tick(): Promise<void> { await new Promise((r) => setImmediate(r)) }
const snapshot = (id: string, title: string): RecoverySnapshot => ({
  version: 1, id, savedAt: Date.now(), project: { ...emptyProject(), meta: { title, author: '', description: '' } }
})

try {
  const files = new RecoveryFiles(join(testDirectory, 'recovery'))
  const first = snapshot('old_project', '启动前未保存工程')
  files.write(first)
  files.write({ ...first, project: { ...first.project, customCss: '完整的新版本' } })
  check('原子覆盖保留完整快照，临时文件已清理', () => {
    assert.equal(files.list().snapshots[0].project.customCss, '完整的新版本')
    assert.deepEqual(readdirSync(join(testDirectory, 'recovery')), ['old_project.json'])
  })
  writeFileSync(join(testDirectory, 'recovery', 'broken.json'), '{截断的数据')
  check('损坏快照会警告并原样保留', () => {
    assert.match(files.list().error ?? '', /broken.json/)
    assert.equal(readFileSync(join(testDirectory, 'recovery', 'broken.json'), 'utf-8'), '{截断的数据')
  })
  check('恢复 ID 防止逃逸目录', () => {
    assert.throws(() => files.clear('../project'))
    assert.throws(() => files.write({ ...first, id: '..\\project' }))
    assert.throws(() => parseRecovery({ ...first, project: {} }))
  })
  const formal = join(testDirectory, 'test.story.json')
  writeFileAtomic(formal, '旧工程')
  writeFileAtomic(formal, '新工程含中文和素材')
  check('正式工程保存原子替换', () => assert.equal(readFileSync(formal, 'utf-8'), '新工程含中文和素材'))
  const blocked = join(testDirectory, 'blocked.story.json')
  mkdirSync(blocked)
  writeFileSync(join(blocked, 'original.txt'), '原内容')
  check('替换失败保留目标且清除临时文件', () => {
    assert.throws(() => writeFileAtomic(blocked, '不能替换目录'))
    assert.equal(readFileSync(join(blocked, 'original.txt'), 'utf-8'), '原内容')
    assert(!readdirSync(testDirectory).some((name) => name.endsWith('.tmp')))
  })

  // 真实磁盘替代 IPC，异步屏障模拟慢盘/文件对话框。
  let writeGate: ReturnType<typeof deferred<void>> | undefined
  let failedWrite = false
  hostApi.listRecovery = async () => files.list()
  hostApi.writeRecovery = async (s) => {
    if (writeGate) { const gate = writeGate; writeGate = undefined; await gate.promise }
    if (failedWrite) return { ok: false, error: '模拟磁盘已满' }
    files.write(s)
    return { ok: true }
  }
  hostApi.clearRecovery = async (id) => { files.clear(id); return { ok: true } }
  await initializeRecovery()
  useProjectStore.getState().newProject()
  useProjectStore.getState().setMeta({ title: '启动后新工程' })
  const assetKey = await useProjectStore.getState().addAsset('image.png', 'image', 'data:image/png;base64,abc')
  await projectActions.autosave()
  check('未保存工程保留脏标记及空路径，素材进入独立快照', () => {
    assert.equal(useProjectStore.getState().filePath, null)
    assert(useProjectStore.getState().dirty)
    const s = files.list().snapshots.find((s) => s.project.meta.title === '启动后新工程')!
    assert.equal(s.project.assets[assetKey].dataUrl, 'data:image/png;base64,abc')
    assert(files.list().snapshots.some((s) => s.id === first.id))
  })
  await useProjectStore.getState().addAsset('sound.ogg', 'audio', 'data:audio/ogg;base64,def')
  await projectActions.autosave()
  check('仅素材变更会更新快照', () => {
    assert.equal(Object.keys(files.list().snapshots.find((s) => s.project.meta.title === '启动后新工程')!.project.assets).length, 2)
  })
  deferRecovery(first.id)
  check('稍后恢复不会删除启动快照', () => assert(existsSync(join(testDirectory, 'recovery', `${first.id}.json`))))
  await restoreRecovery(first)
  check('恢复前备份已开始的新工程，恢复后必须人工保存', () => {
    assert.equal(useProjectStore.getState().meta.title, first.project.meta.title)
    assert(useProjectStore.getState().dirty)
    assert.equal(useProjectStore.getState().filePath, null)
    assert.equal(useProjectStore.getState().lastSavedJson, null)
    assert(files.list().snapshots.some((s) => s.project.meta.title === '启动后新工程'))
    assert(files.list().snapshots.some((s) => s.id === first.id))
  })
  const currentRevision = useProjectStore.getState().revision
  await clearProjectRecovery(currentRevision, false)
  check('成功保存只清当前快照，其他未恢复快照保留', () => {
    assert(!files.list().snapshots.some((s) => s.id === first.id))
    assert(files.list().snapshots.some((s) => s.project.meta.title === '启动后新工程'))
  })
  await writeProjectRecovery()
  writeGate = deferred<void>()
  const gate = writeGate
  useProjectStore.getState().setMeta({ title: '待丢弃工程' })
  const inFlight = writeProjectRecovery()
  await tick()
  const clear = clearProjectRecovery(currentRevision)
  gate.resolve()
  await Promise.all([inFlight, clear])
  await writeProjectRecovery()
  check('放弃工程等待在途写入后清理，过期写入不会复活', () => {
    assert(!files.list().snapshots.some((s) => s.project.meta.title === '待丢弃工程'))
  })

  useProjectStore.getState().newProject()
  useProjectStore.getState().setMeta({ title: '保存对话框前' })
  const saveGate = deferred<{ canceled: boolean; path: string }>()
  let capturedTitle = ''
  hostApi.saveProject = async (p) => { capturedTitle = p.meta.title; return saveGate.promise }
  const saving = projectActions.save(false)
  await tick()
  useProjectStore.getState().setMeta({ title: '保存对话框期间新编辑' })
  saveGate.resolve({ canceled: false, path: formal })
  await saving
  check('人工保存的旧版不会把对话框期间的新编辑标为已保存', () => {
    assert.equal(capturedTitle, '保存对话框前')
    assert.equal(useProjectStore.getState().filePath, formal)
    assert(useProjectStore.getState().dirty)
    assert(files.list().snapshots.some((s) => s.project.meta.title === '保存对话框期间新编辑'))
  })
  const autoGate = deferred<void>()
  hostApi.writeFile = async (path, content) => { await autoGate.promise; writeFileAtomic(path, content); return { ok: true } }
  const autosaving = projectActions.autosave()
  await tick()
  useProjectStore.getState().setMeta({ title: '自动保存期间新编辑' })
  autoGate.resolve()
  await autosaving
  check('自动保存不会清掉写盘期间的脏标记', () => {
    assert(useProjectStore.getState().dirty)
    assert.equal(useProjectStore.getState().meta.title, '自动保存期间新编辑')
  })
  hostApi.writeFile = async (path, content) => { writeFileAtomic(path, content); return { ok: true } }
  await projectActions.autosave()
  check('后续自动保存包含新编辑并清掉对应恢复', () => {
    assert(!useProjectStore.getState().dirty)
    assert.equal(JSON.parse(readFileSync(formal, 'utf-8')).meta.title, '自动保存期间新编辑')
    assert(!files.list().snapshots.some((s) => s.project.meta.title === '保存对话框期间新编辑'))
  })

  useProjectStore.getState().newProject()
  useProjectStore.getState().setMeta({ title: '当前不能丢的工程' })
  failedWrite = true
  const selected = snapshot('protected_restore', '待恢复工程')
  files.write(selected)
  useRecoveryStore.setState({ pending: [selected] })
  await restoreRecovery(selected)
  check('备份失败时恢复不会覆盖当前状态或删除原快照', () => {
    assert.equal(useProjectStore.getState().meta.title, '当前不能丢的工程')
    assert.match(useRecoveryStore.getState().error ?? '', /模拟磁盘已满/)
    assert(files.list().snapshots.some((s) => s.id === selected.id))
  })
  failedWrite = false
  await writeProjectRecovery()
  hostApi.openProject = async () => ({ canceled: true })
  projectActions.openProject()
  await tick()
  useUiStore.getState().closeConfirm(true)
  await tick()
  check('取消文件选择保留当前状态及恢复快照', () => {
    assert.equal(useProjectStore.getState().meta.title, '当前不能丢的工程')
    assert(files.list().snapshots.some((s) => s.project.meta.title === '当前不能丢的工程'))
  })
  hostApi.openProject = async () => ({ canceled: false, path: 'broken.story.json', project: { ...emptyProject(), nodes: [null] } as never })
  projectActions.openProject()
  await tick()
  useUiStore.getState().closeConfirm(true)
  await tick()
  check('载入损坏工程失败不会提前删除当前恢复', () => {
    assert.equal(useProjectStore.getState().meta.title, '当前不能丢的工程')
    assert(files.list().snapshots.some((s) => s.project.meta.title === '当前不能丢的工程'))
  })
  await discardRecovery(selected.id)
  check('明确丢弃只删除指定恢复快照', () => {
    assert(!files.list().snapshots.some((s) => s.id === selected.id))
    assert(files.list().snapshots.some((s) => s.project.meta.title === '启动后新工程'))
  })
  // 模拟桌面 close-request：renderer 必须等待在途写入，并捕获写盘期间的新编辑。
  const windowTarget = new EventTarget()
  const documentTarget = new EventTarget()
  Object.assign(globalThis, { window: windowTarget, document: documentTarget })
  let closeCallback!: () => Promise<void>
  hostApi.onBeforeClose = (cb) => { closeCallback = cb; return () => {} }
  useProjectStore.getState().setMeta({ title: '关闭前旧内容' })
  writeGate = deferred<void>()
  const closingGate = writeGate
  const stopPersistence = startProjectPersistence()
  const closing = closeCallback()
  await tick()
  useProjectStore.getState().setMeta({ title: '关闭写盘期间新内容' })
  closingGate.resolve()
  await closing
  stopPersistence()
  check('关闭握手等待恢复落盘，并保存写盘期间的最后编辑', () => {
    assert(files.list().snapshots.some((s) => s.project.meta.title === '关闭写盘期间新内容'))
    assert(useProjectStore.getState().dirty)
  })
  useProjectStore.getState().setMeta({ title: '关闭失败留在编辑器' })
  failedWrite = true
  const stopFailedPersistence = startProjectPersistence()
  await assert.rejects(closeCallback(), /模拟磁盘已满/)
  stopFailedPersistence()
  check('关闭写盘失败会拒绝关闭且保留当前编辑', () => assert.equal(useProjectStore.getState().meta.title, '关闭失败留在编辑器'))
  failedWrite = false

  const revisionGate = deferred<{ canceled: boolean; path: string }>()
  hostApi.saveProject = async () => revisionGate.promise
  const previousSaving = projectActions.save(false)
  await tick()
  useProjectStore.getState().newProject()
  useProjectStore.getState().setMeta({ title: '保存期间切换的新工程' })
  revisionGate.resolve({ canceled: false, path: formal })
  await previousSaving
  check('旧工程保存结束不会修改已切换的新工程路径或脏标记', () => {
    assert.equal(useProjectStore.getState().filePath, null)
    assert.equal(useProjectStore.getState().meta.title, '保存期间切换的新工程')
    assert(useProjectStore.getState().dirty)
  })
  useProjectStore.getState().loadProject(emptyProject(), formal)
  useProjectStore.getState().setMeta({ title: '排队点击保存的原工程' })
  const queuedGate = deferred<void>()
  hostApi.writeFile = async (path, content) => { await queuedGate.promise; writeFileAtomic(path, content); return { ok: true } }
  const blockingAutosave = projectActions.autosave()
  await tick()
  let queuedTitle = ''
  hostApi.saveProject = async (p) => { queuedTitle = p.meta.title; return { canceled: false, path: formal } }
  const queuedSave = projectActions.save(false)
  useProjectStore.getState().newProject()
  useProjectStore.getState().setMeta({ title: '排队期间已切换工程' })
  queuedGate.resolve()
  await Promise.all([blockingAutosave, queuedSave])
  check('排队人工保存仍对应点击时的工程，不能保存后来切换的工程', () => {
    assert.equal(queuedTitle, '排队点击保存的原工程')
    assert.equal(useProjectStore.getState().meta.title, '排队期间已切换工程')
    assert.equal(useProjectStore.getState().filePath, null)
  })
  await projectActions.autosave()
  hostApi.saveProject = async (p) => { writeFileAtomic(formal, JSON.stringify(p)); return { canceled: false, path: formal } }
  await projectActions.save(false)
  check('人工保存成功赋予文件路径并只删除本工程恢复快照', () => {
    assert.equal(useProjectStore.getState().filePath, formal)
    assert(!useProjectStore.getState().dirty)
    assert.equal(JSON.parse(readFileSync(formal, 'utf-8')).meta.title, '排队期间已切换工程')
    assert(!files.list().snapshots.some((s) => s.project.meta.title === '排队期间已切换工程'))
    assert(files.list().snapshots.some((s) => s.project.meta.title === '启动后新工程'))
  })
  await flushRecovery()
  console.log(`恢复与保存测试：${passed} 项全部通过`)
} finally {
  // 目标来自 mkdtemp，确保删除仅限本测试生成的目录。
  assert(dirname(resolve(testDirectory)) === testWork && testDirectory.startsWith(join(testWork, 'fableloom-recovery-test-')))
  rmSync(testDirectory, { recursive: true, force: true })
}

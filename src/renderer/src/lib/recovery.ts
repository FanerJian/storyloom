import { uid, type StoryProject } from '@shared/schema'
import type { RecoverySnapshot } from '@shared/recovery'
import { hostApi } from './api'
import { useProjectStore } from '../stores/project'
import { useRecoveryStore } from '../stores/recovery'
import { toast } from '../stores/toast'

export type ProjectState = ReturnType<typeof useProjectStore.getState>

/** 函数型 store getters 始终读最新状态；异步保存必须在调用时显式捕获这些字段。 */
export function projectFromState(s: ProjectState): StoryProject {
  return { version: 4, authoring: s.authoring, meta: s.meta, assets: s.assets, release: s.release, customCss: s.customCss, customJs: s.customJs,
    variables: s.variables, nodes: s.nodes, edges: s.edges }
}

export function sameProjectState(a: ProjectState, b: ProjectState): boolean {
  return a.revision === b.revision && a.filePath === b.filePath &&
    a.authoring === b.authoring &&
    a.meta === b.meta && a.assets === b.assets && a.release === b.release &&
    a.customCss === b.customCss && a.customJs === b.customJs &&
    a.variables === b.variables && a.nodes === b.nodes && a.edges === b.edges
}

const ids = new Map<number, string>()
const retired = new Set<number>()
const backedUp = new Map<number, ProjectState>()
let tail: Promise<void> = Promise.resolve()
let initialized: Promise<void> | undefined

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work)
  tail = result.then(() => {}, () => {})
  return result
}

export function initializeRecovery(): Promise<void> {
  if (!initialized) initialized = hostApi.listRecovery().then((result) => {
    // 启动读盘期间用户已经新建的工程拥有独立 id，不会覆盖这里的旧快照。
    useRecoveryStore.setState({ pending: result.snapshots, error: null })
    if (result.error) toast.warn(`恢复存储：${result.error}`)
  })
  return initialized
}

export async function writeProjectRecovery(s = useProjectStore.getState()): Promise<void> {
  if (s.revision === 0 || (s.filePath && !s.dirty) || retired.has(s.revision)) return
  await initializeRecovery()
  if (retired.has(s.revision)) return
  let id = ids.get(s.revision)
  if (!id) { id = uid('recovery_'); ids.set(s.revision, id) }
  const snapshot: RecoverySnapshot = { version: 1, id, savedAt: Date.now(), project: projectFromState(s) }
  await enqueue(async () => {
    if (retired.has(s.revision) || ids.get(s.revision) !== snapshot.id) return
    const last = backedUp.get(s.revision)
    if (last && sameProjectState(last, s)) return
    const result = await hostApi.writeRecovery(snapshot)
    if (!result.ok) throw new Error(result.error ?? '恢复快照写入失败')
    backedUp.set(s.revision, s)
  })
}

/** 仅清理当前工程的快照。启动待恢复的其他工程与明确保留的快照均不受影响。 */
export function clearProjectRecovery(revision: number, retire = true): Promise<void> {
  if (retire) retired.add(revision)
  const id = ids.get(revision)
  ids.delete(revision)
  backedUp.delete(revision)
  return enqueue(async () => {
    if (!id) return
    const result = await hostApi.clearRecovery(id)
    if (!result.ok) throw new Error(result.error ?? '恢复快照清理失败')
  })
}

export async function flushRecovery(): Promise<void> { await tail }

function dismiss(id: string): void {
  useRecoveryStore.setState((s) => ({ pending: s.pending.filter((item) => item.id !== id), error: null }))
}

export function deferRecovery(id: string): void { dismiss(id) }

export async function discardRecovery(id: string): Promise<void> {
  useRecoveryStore.setState({ busy: true, error: null })
  try {
    const result = await enqueue(() => hostApi.clearRecovery(id))
    if (!result.ok) throw new Error(result.error ?? '无法丢弃快照')
    dismiss(id)
  } catch (err) { useRecoveryStore.setState({ error: String(err) }) }
  finally { useRecoveryStore.setState({ busy: false }) }
}

export async function restoreRecovery(snapshot: RecoverySnapshot): Promise<void> {
  useRecoveryStore.setState({ busy: true, error: null })
  try {
    const current = useProjectStore.getState()
    // 恢复提示晚于用户操作到达时，先保护当前工程，成功后才切换。
    await writeProjectRecovery(current)
    if (!sameProjectState(current, useProjectStore.getState())) {
      throw new Error('当前工程在备份期间发生了更改，请再次点击恢复')
    }
    current.loadProject(snapshot.project, null)
    useProjectStore.setState({ dirty: true, lastSavedJson: null })
    const restored = useProjectStore.getState()
    ids.set(restored.revision, snapshot.id)
    backedUp.set(restored.revision, restored)
    dismiss(snapshot.id)
    toast.success(`已恢复「${snapshot.project.meta.title}」，请 Ctrl+S 保存工程`)
  } catch (err) { useRecoveryStore.setState({ error: String(err) }) }
  finally { useRecoveryStore.setState({ busy: false }) }
}

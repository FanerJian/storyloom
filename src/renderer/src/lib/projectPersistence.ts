import { hostApi } from './api'
import { projectActions } from './projectActions'
import { flushRecovery, initializeRecovery, sameProjectState } from './recovery'
import { useProjectStore } from '../stores/project'
import { toast } from '../stores/toast'

/** App 只需在一个 effect 中调用并返回清理函数。 */
export function startProjectPersistence(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let reportedError = ''
  const save = async (): Promise<void> => {
    try {
      await projectActions.autosave()
      reportedError = ''
    } catch (err) {
      const message = String(err)
      if (message !== reportedError) toast.error(`自动保存失败，请手动保存：${message}`)
      reportedError = message
      throw err
    }
  }
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; void save().catch(() => {}) }, 1500)
  }
  void initializeRecovery().then(() => {
    // 开发模式重新挂载 effect 时，也覆盖已存在但尚未落盘的工程。
    if (useProjectStore.getState().revision > 0) schedule()
  }).catch((err) => toast.error(`无法读取恢复快照：${String(err)}`))
  const unsubscribe = useProjectStore.subscribe((s, prev) => {
    if (!sameProjectState(s, prev) || (s.dirty && !prev.dirty)) schedule()
  })
  // 持续输入时防抖可能一直延期，因此另设最长 15 秒的保存间隔。
  const interval = setInterval(() => { void save().catch(() => {}) }, 15_000)
  let checking = false
  const externalTimer = setInterval(() => {
    const s = useProjectStore.getState()
    if (checking || !s.filePath?.toLowerCase().endsWith('.loomproject') || !hostApi.checkProjectChanges) return
    checking = true
    void hostApi.checkProjectChanges(s.filePath).then((files) => {
      if (useProjectStore.getState().filePath === s.filePath && !useProjectStore.getState().saveBlocked && files.join('|') !== s.externalChanges.join('|')) useProjectStore.setState({ externalChanges: files })
    }).catch((e) => toast.warn(`外部文件检查失败：${String(e)}`)).finally(() => { checking = false })
  }, 3000)
  const beforeUnload = (event: BeforeUnloadEvent): void => {
    if (hostApi.isElectron() || hostApi.isTauri()) return // 桌面壳由关闭握手等待写盘。
    if (useProjectStore.getState().dirty) {
      event.preventDefault()
      event.returnValue = ''
    }
    void save().catch(() => {})
  }
  const pageHide = (): void => { void save().catch(() => {}) }
  const onVisibility = (): void => { if (document.visibilityState === 'hidden') pageHide() }
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('pagehide', pageHide)
  document.addEventListener('visibilitychange', onVisibility)
  const stopClose = hostApi.onBeforeClose(async () => {
    if (timer) { clearTimeout(timer); timer = undefined }
    // 也比较未保存工程的内容；恢复快照不会清 dirty，不能以 dirty 判断是否写完。
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = useProjectStore.getState()
      await save()
      await flushRecovery()
      if (sameProjectState(before, useProjectStore.getState())) return
    }
    throw new Error('工程仍在变化，请停止编辑后再次关闭')
  })
  return () => {
    unsubscribe()
    stopClose()
    if (timer) clearTimeout(timer)
    clearInterval(interval)
    clearInterval(externalTimer)
    window.removeEventListener('beforeunload', beforeUnload)
    window.removeEventListener('pagehide', pageHide)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

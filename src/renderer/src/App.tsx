import { lazy, Suspense, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useProjectStore } from './stores/project'
import { useUiStore } from './stores/ui'
import { useToastStore } from './stores/toast'
import { hostApi } from './lib/api'
import { projectActions, dispatchMenuAction, startProjectPersistence } from './lib/projectActions'
import { PluginHost } from './components/PluginHost'
import { RecoveryModal } from './components/RecoveryModal'
import { Welcome } from './components/Welcome'
import { Button, Modal } from './components/ui'

const Workspace = lazy(() => import('./components/Workspace'))
const PlaytestModal = lazy(() => import('./components/PlaytestModal').then((m) => ({ default: m.PlaytestModal })))
const ReleaseModal = lazy(() => import('./components/ReleaseModal').then((m) => ({ default: m.ReleaseModal })))
const CustomCodeModal = lazy(() => import('./components/CustomCodeModal').then((m) => ({ default: m.CustomCodeModal })))
const PluginsModal = lazy(() => import('./components/PluginsModal').then((m) => ({ default: m.PluginsModal })))

export default function App() {
  const opened = useProjectStore((s) => s.revision > 0)
  const setTheme = useUiStore((s) => s.setTheme)

  // 主题初始化
  useEffect(() => {
    const saved = (localStorage.getItem('storyloom.theme') as 'dark' | 'light' | null) ?? 'dark'
    setTheme(saved)
  }, [setTheme])

  // 原生菜单 / 浏览器快捷键
  useEffect(() => {
    const unsub = hostApi.onMenuAction(dispatchMenuAction)
    return unsub
  }, [])

  // 全局试玩事件：detail.nodeId 指定起始节点（画布右键菜单）；无 detail 时从开始节点进入。
  // 节点画布模式下的「试玩选中节点」回退由 FlowCanvas 的监听补充。
  useEffect(() => {
    const handler = (e: Event): void => {
      const nodeId = (e as CustomEvent<{ nodeId?: string }>).detail?.nodeId
      useUiStore.getState().openPlaytest(nodeId ?? null)
    }
    window.addEventListener('storyloom:playtest', handler)
    return () => window.removeEventListener('storyloom:playtest', handler)
  }, [])

  // 浏览器模式下的快捷键（Electron 下由原生菜单加速键接管）
  useEffect(() => {
    if (hostApi.isElectron()) return
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) {
        if (e.key === 'F5') {
          e.preventDefault()
          window.dispatchEvent(new Event('storyloom:playtest'))
        }
        return
      }
      const s = useProjectStore.getState()
      switch (e.key.toLowerCase()) {
        case 'n':
          e.preventDefault()
          projectActions.newProject()
          break
        case 'o':
          e.preventDefault()
          void projectActions.openProject()
          break
        case 'i':
          e.preventDefault()
          void projectActions.openProject()
          break
        case 's':
          e.preventDefault()
          void projectActions.save(e.shiftKey)
          break
        case 'e':
          e.preventDefault()
          void projectActions.exportHtml()
          break
        case 'z':
          e.preventDefault()
          if (e.shiftKey) s.redo()
          else s.undo()
          break
        case 'y':
          e.preventDefault()
          s.redo()
          break
        case 'l':
          if (e.shiftKey) {
            e.preventDefault()
            window.dispatchEvent(new Event('storyloom:autolayout'))
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 启动恢复、定时快照、自动保存与退出落盘共用一个生命周期。
  useEffect(() => startProjectPersistence(), [])

  // 窗口标题
  const title = useProjectStore((s) => s.meta.title)
  const dirty = useProjectStore((s) => s.dirty)
  useEffect(() => {
    void hostApi.setWindowTitle(`${dirty ? '● ' : ''}${title} — StoryLoom`)
  }, [title, dirty])

  if (!opened) {
    return (
      <>
        <Welcome />
        <Overlays />
      </>
    )
  }

  return (
    <>
      <Suspense fallback={<div className="flex h-full items-center justify-center text-[var(--text-dim)]" role="status">正在打开编辑器…</div>}>
        <Workspace />
      </Suspense>
      <Overlays />
    </>
  )
}

/** 全局浮层：试玩 / 发布设置 / 自定义接口 / 插件 / 确认 / Toast */
function Overlays() {
  const playtestOpen = useUiStore((s) => s.playtestOpen)
  const releaseOpen = useUiStore((s) => s.releaseModal)
  const customOpen = useUiStore((s) => s.customOpen)
  const pluginsOpen = useUiStore((s) => s.pluginsOpen)
  return (
    <>
      <PluginHost />
      <RecoveryModal />
      <Suspense fallback={null}>
        {playtestOpen && <PlaytestModal />}
        {releaseOpen && <ReleaseModal />}
        {customOpen && <CustomCodeModal />}
        {pluginsOpen && <PluginsModal />}
      </Suspense>
      <ConfirmModal />
      <Toasts />
    </>
  )
}

function ConfirmModal() {
  const confirm = useUiStore((s) => s.confirm)
  const close = useUiStore((s) => s.closeConfirm)
  return (
    <Modal open={confirm.open} onClose={() => close(false)} title={confirm.title} width={420}>
      <div className="p-5">
        <div className="flex items-start gap-3">
          {confirm.danger && (
            <div className="mt-0.5 rounded-lg bg-rose-500/10 p-2 text-rose-500">
              <AlertTriangle size={16} />
            </div>
          )}
          <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">{confirm.body}</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => close(false)}>取消</Button>
          <Button
            variant={confirm.danger ? 'danger' : 'primary'}
            onClick={() => close(true)}
          >
            {confirm.confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Toasts() {
  const toasts = useToastStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    // 顶部居中：避免遮挡试玩/弹窗底部的快捷栏与操作区
    <div className="pointer-events-none fixed left-1/2 top-14 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={
            'pointer-events-auto rounded-lg border px-4 py-2 text-[13px] shadow-lg backdrop-blur animate-[toast-in_0.18s_ease] ' +
            (t.kind === 'error'
              ? 'border-rose-500/30 bg-rose-500/15 text-rose-600 dark:text-rose-300'
              : t.kind === 'warn'
                ? 'border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-300 whitespace-pre-line text-left max-w-[80vw]'
                : t.kind === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)]')
          }
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { MonitorPlay } from 'lucide-react'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { enabledPlugins } from '../stores/plugins'
import { runtimeChunk } from '@shared/plugins'
import { Modal } from './ui'
import { mountPlayer } from '@runtime/player'
import { nodeTitle } from '../lib/flowHelpers'

export function PlaytestModal() {
  const open = useUiStore((s) => s.playtestOpen)
  const startId = useUiStore((s) => s.playtestStartId)
  const close = useUiStore((s) => s.closePlaytest)
  const containerRef = useRef<HTMLDivElement>(null)
  // 默认不勾选：显式传 titleScreen: false，保持「直接进剧情」的试玩体验。
  const [previewTitle, setPreviewTitle] = useState(false)

  useEffect(() => {
    if (!open || !containerRef.current) return
    const project = useProjectStore.getState().getProject()
    const plugins = enabledPlugins().map(runtimeChunk)
    const handle = mountPlayer(containerRef.current, project, {
      ...(startId ? { startNodeId: startId } : {}),
      // 显式传布尔值：不勾选时跳过标题画面（忽略 release.titleScreen.enabled）。
      titleScreen: previewTitle,
      storageNamespace: 'playtest',
      plugins
    })
    return () => handle.destroy()
  }, [open, startId, previewTitle])

  const startLabel = startId
    ? (() => {
        const n = useProjectStore.getState().nodes.find((x) => x.id === startId)
        return n ? `从「${nodeTitle(n)}」开始` : '从开始节点进入'
      })()
    : '完整流程'

  return (
    <Modal open={open} onClose={close} width={720} title={
      <span className="flex items-center gap-2">
        <MonitorPlay size={15} className="text-indigo-400" />
        试玩 · {startLabel}
      </span>
    }>
      <div className="bg-[#0b0d12] p-3">
        <div className="mx-auto h-[560px] max-w-[640px] overflow-hidden rounded-xl border border-white/10 shadow-2xl">
          <div ref={containerRef} className="h-full w-full" />
        </div>
        <div className="mt-2 flex items-center justify-center gap-4">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-indigo-500"
              checked={previewTitle}
              onChange={(e) => setPreviewTitle(e.target.checked)}
            />
            预览标题画面（按发布设置）
          </label>
        </div>
        <p className="mt-1 text-center text-[11px] text-zinc-500">
          与导出的 HTML 使用同一引擎 · 数字键选择 · Enter/空格继续 · H 回看 / A 自动 · 试玩存档独立
        </p>
      </div>
    </Modal>
  )
}

import { useEffect, useState } from 'react'
import { FolderOpen, FilePlus2, Sparkles, X } from 'lucide-react'
import { hostApi } from '../lib/api'
import { projectActions } from '../lib/projectActions'
import { formatTime, truncate } from '../lib/utils'
import { Button } from './ui'
import type { RecentItem } from '@shared/api'

export function Welcome() {
  const [recent, setRecent] = useState<RecentItem[]>([])

  useEffect(() => {
    void hostApi.listRecent().then(setRecent)
  }, [])

  const refresh = (): void => {
    void hostApi.listRecent().then(setRecent)
  }

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute -right-32 -bottom-32 h-96 w-96 rounded-full bg-purple-500/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'radial-gradient(circle, var(--border) 1px, transparent 1px)',
            backgroundSize: '28px 28px'
          }}
        />
      </div>

      <div className="relative w-full max-w-md px-6">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 text-2xl font-black text-white shadow-lg shadow-indigo-500/25">
            文
          </div>
          <h1 className="text-2xl font-black tracking-wide">FableLoom</h1>
          <p className="mt-1.5 text-[13px] text-[var(--text-dim)]">长篇剧本 · 场景分支 · 团队工程</p>
        </div>

        <div className="flex flex-col gap-2.5">
          <Button variant="primary" size="md" className="h-10 justify-start text-[14px]" onClick={() => projectActions.newProject()}>
            <FilePlus2 size={16} />
            新建空白工程
          </Button>
          <Button size="md" className="h-10 justify-start text-[14px]" onClick={() => void projectActions.openProject()}>
            <FolderOpen size={16} />
            打开工程文件…
          </Button>
          <Button variant="soft" size="md" className="h-10 justify-start text-[14px]" onClick={() => projectActions.newSampleProject()}>
            <Sparkles size={16} />
            载入示例工程「翡翠旅店的夜晚」
          </Button>
          <Button variant="soft" size="md" className="h-10 justify-start text-[14px]" onClick={() => projectActions.newVnSampleProject()}>
            <Sparkles size={16} />
            载入视觉小说示例「雪落车站」
          </Button>
        </div>

        {recent.length > 0 && (
          <div className="mt-8">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--text-dim)] uppercase">最近工程</div>
            <div className="flex flex-col gap-1">
              {recent.map((r) => (
                <div
                  key={r.path}
                  className="group flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-[var(--border)] hover:bg-[var(--surface)]"
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      // 最近列表只记录路径/名称；重新打开走文件对话框或浏览器记录
                      if (hostApi.isElectron()) {
                        void projectActions.openProject()
                      } else {
                        void hostApi.openProject().then((res) => {
                          if (res.project && res.path) projectActions.openProjectForce(res.project, res.path)
                        })
                      }
                    }}
                  >
                    <div className="truncate text-[13px] font-medium">{r.title || truncate(r.path, 36)}</div>
                    <div className="truncate text-[11px] text-[var(--text-dim)]">
                      {truncate(r.path, 48)} · {formatTime(r.lastOpened)}
                    </div>
                  </button>
                  <button
                    className="rounded p-1 text-[var(--text-dim)] opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"
                    title="从列表移除"
                    onClick={() => {
                      void hostApi.removeRecent(r.path).then(refresh)
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mt-10 text-center text-[11px] text-[var(--text-dim)]/70">
          支持 .story.json 与 .loomproject 团队工程 · 可导出单文件 HTML
        </p>
      </div>
    </div>
  )
}

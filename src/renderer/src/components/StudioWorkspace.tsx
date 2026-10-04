import { useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { FolderSync } from 'lucide-react'
import { useProjectStore } from '../stores/project'
import { Button } from './ui'
import { FlowCanvas } from './canvas/FlowCanvas'
import { SceneGraph } from './SceneGraph'
import { Sidebar } from './Sidebar'
import { Inspector } from './Inspector'
import { ChapterTree } from './views/ChapterTree'
import { ScriptEditor } from './views/ScriptEditor'
import { Characters } from './views/Characters'
import { Assets } from './views/Assets'
import { projectActions } from '../lib/projectActions'

/**
 * 工作区外壳：仅负责 workspaceMode 路由与共享横幅；
 * 各视图组件在 components/views/ 下（SceneGraph 独立成文件）。
 * 试玩事件由 App 的全局监听统一处理。
 */
export function StudioWorkspace() {
  const mode = useProjectStore((s) => s.workspaceMode)
  const external = useProjectStore((s) => s.externalChanges)
  const sceneId = useProjectStore((s) => s.activeSceneId)
  const revision = useProjectStore((s) => s.revision)
  return <div className="flex min-h-0 flex-1 flex-col" data-testid="studio-workspace">
    {!!external.length && <div role="alert" className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[12px]">
      <FolderSync size={16} />检测到外部文件修改：{external.join('、')}
      <Button size="sm" className="ml-auto flex-none" onClick={() => void projectActions.reloadDirectory()}>备份并重新加载</Button>
    </div>}
    {mode === 'nodes' ? <div className="flex min-h-0 flex-1"><Sidebar /><main className="min-w-0 flex-1"><ReactFlowProvider key={`${revision}:${sceneId}`}><FlowCanvas sceneId={sceneId ?? undefined} /></ReactFlowProvider></main><Inspector /></div>
      : <div className="flex min-h-0 flex-1">{(mode === 'script' || mode === 'scenes') && <ChapterTree />}
        <main className="min-w-0 flex-1">{mode === 'script' ? <ScriptEditor key={revision} /> : mode === 'scenes' ? <SceneGraph /> : mode === 'characters' ? <Characters /> : <Assets />}</main>
      </div>}
  </div>
}

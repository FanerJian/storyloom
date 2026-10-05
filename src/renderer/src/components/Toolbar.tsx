import { BookOpen, Braces, Clapperboard, Download, FilePlus2, FolderOpen, FolderSync, GitBranch, Image, LayoutTemplate, List, Moon, Play, Plug, Redo2, Save, Settings2, Sun, Undo2, Users } from 'lucide-react'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { Button } from './ui'
import { ActionMenu } from './ActionMenu'
import { projectActions } from '../lib/projectActions'

const creationViews = [
  { id: 'script', label: '剧本', icon: BookOpen },
  { id: 'scenes', label: '场景图', icon: GitBranch },
  { id: 'nodes', label: '节点画布', icon: List }
] as const
const resourceViews = [
  { id: 'characters', label: '角色库', icon: Users },
  { id: 'assets', label: '素材库', icon: Image }
] as const

export function Toolbar() {
  const title = useProjectStore((s) => s.meta.title)
  const dirty = useProjectStore((s) => s.dirty)
  const mode = useProjectStore((s) => s.workspaceMode)
  const canUndo = useProjectStore((s) => s.pastCount > 0)
  const canRedo = useProjectStore((s) => s.futureCount > 0)
  const theme = useUiStore((s) => s.theme)
  const currentCreation = creationViews.find((v) => v.id === mode)
  const currentResource = resourceViews.find((v) => v.id === mode)
  return <header className="flex h-14 flex-none items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4" data-testid="editor-toolbar">
    <div className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-xs font-black text-white" title="FableLoom">文</div>
    <ActionMenu label="工程菜单" actions={[
      { label: '新建工程', icon: FilePlus2, shortcut: 'Ctrl+N', onSelect: () => projectActions.newProject() },
      { label: '打开工程', icon: FolderOpen, shortcut: 'Ctrl+O', onSelect: () => void projectActions.openProject() },
      { label: '保存', icon: Save, shortcut: 'Ctrl+S', separator: true, onSelect: () => void projectActions.save(false) },
      { label: '另存为单文件工程', icon: Save, shortcut: 'Ctrl+Shift+S', onSelect: () => void projectActions.save(true, 'single') },
      { label: '保存为团队工程', icon: FolderSync, onSelect: () => void projectActions.save(true, 'directory') }
    ]}>
      <span className="max-w-36 truncate text-[var(--text)]" title={title}>{title}</span>{dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="未保存" />}
    </ActionMenu>
    <span className="h-5 w-px flex-none bg-[var(--border)]" />
    <nav className="flex items-center gap-1" aria-label="制作视图">
      <ActionMenu label="创作" active={!!currentCreation} actions={creationViews.map((v) => ({ ...v, selected: mode === v.id, onSelect: () => useProjectStore.setState({ workspaceMode: v.id }) }))}>
        <BookOpen size={15} /><span>创作</span>{currentCreation && <span className="hidden text-[11px] opacity-70 lg:inline">· {currentCreation.label}</span>}
      </ActionMenu>
      <ActionMenu label="资源" active={!!currentResource} actions={resourceViews.map((v) => ({ ...v, selected: mode === v.id, onSelect: () => useProjectStore.setState({ workspaceMode: v.id }) }))}>
        <Image size={15} /><span>资源</span>{currentResource && <span className="hidden text-[11px] opacity-70 lg:inline">· {currentResource.label}</span>}
      </ActionMenu>
    </nav>
    <div className="ml-auto flex flex-none items-center gap-1">
      <Button variant="ghost" size="icon" title="撤销 (Ctrl+Z)" aria-label="撤销" disabled={!canUndo} onClick={() => useProjectStore.getState().undo()}><Undo2 size={15} /></Button>
      <Button variant="ghost" size="icon" title="重做 (Ctrl+Shift+Z)" aria-label="重做" disabled={!canRedo} onClick={() => useProjectStore.getState().redo()}><Redo2 size={15} /></Button>
      <span className="mx-1 h-5 w-px bg-[var(--border)]" />
      <Button variant="ghost" size="icon" title="保存 (Ctrl+S)" aria-label="保存" onClick={() => void projectActions.save(false)}><Save size={15} /></Button>
      <Button variant="soft" title="试玩 (F5)" onClick={() => window.dispatchEvent(new Event('fableloom:playtest'))}><Play size={14} className="fill-current" />试玩</Button>
      <Button variant="primary" title="导出可玩 HTML (Ctrl+E)" onClick={() => void projectActions.exportHtml()}><Download size={14} />导出</Button>
      <Button variant="ghost" size="icon" title="发布设置" aria-label="发布设置" onClick={() => useUiStore.getState().openRelease()}><Clapperboard size={15} /></Button>
      <ActionMenu label="工具" align="right" actions={[
        { label: '发布设置', icon: Clapperboard, separator: true, onSelect: () => useUiStore.getState().openRelease() },
        { label: '自动整理布局', icon: LayoutTemplate, shortcut: 'Ctrl+Shift+L', disabled: mode !== 'nodes' && mode !== 'scenes', onSelect: () => window.dispatchEvent(new Event('fableloom:autolayout')) },
        { label: '自定义接口', icon: Braces, separator: true, onSelect: () => useUiStore.getState().openCustom() },
        { label: '插件管理', icon: Plug, onSelect: () => useUiStore.getState().openPlugins() },
        { label: theme === 'dark' ? '切换浅色主题' : '切换深色主题', icon: theme === 'dark' ? Sun : Moon, separator: true, onSelect: () => useUiStore.getState().toggleTheme() }
      ]}><Settings2 size={15} /><span>工具</span></ActionMenu>
    </div>
  </header>
}

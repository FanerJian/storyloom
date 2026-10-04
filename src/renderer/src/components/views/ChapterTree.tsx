import { useState } from 'react'
import { Bookmark, Plus } from 'lucide-react'
import { useProjectStore } from '../../stores/project'
import { Button, Input } from '../ui'
import { safely } from './common'

/** 剧本 / 场景视图左侧的章节与场景树。 */
export function ChapterTree() {
  const a = useProjectStore((s) => s.authoring)
  const active = useProjectStore((s) => s.activeSceneId)
  const [name, setName] = useState('')
  const [addingChapter, setAddingChapter] = useState(false)
  const choose = (id: string): void => useProjectStore.setState((s) => ({ activeSceneId: id, workspaceMode: s.workspaceMode === 'scenes' ? 'scenes' : 'script' }))
  if (!a) return null
  return <aside className="flex w-56 flex-none flex-col border-r border-[var(--border)] bg-[var(--surface)]">
    <div className="border-b border-[var(--border)] px-3 py-3"><div className="text-[13px] font-bold">章节与场景</div><div className="mt-1 text-[11px] text-[var(--text-dim)]">{a.chapters.length} 章 · {a.scenes.length} 场景</div></div>
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {a.chapters.map((chapter) => <section key={chapter.id} className="mb-4">
        <input aria-label="章节名称" value={chapter.name} className="mb-1 w-full rounded bg-transparent px-2 py-1 text-[12px] font-bold" onChange={(e) => useProjectStore.getState().setAuthoring({ chapters: a.chapters.map((c) => c.id === chapter.id ? { ...c, name: e.target.value } : c) })} />
        {a.scenes.filter((s) => s.chapterId === chapter.id).map((scene) => <button key={scene.id} data-scene-id={scene.id} aria-label={`选择场景 ${scene.name}`} onClick={() => choose(scene.id)} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12px] ${active === scene.id ? 'bg-[var(--accent-soft)] text-indigo-400' : 'hover:bg-[var(--surface-2)]'}`}>
          {scene.bookmark ? <Bookmark size={12} /> : <span className="w-3 text-[var(--text-dim)]">·</span>}<span className="truncate">{scene.name}</span>
        </button>)}
        <Button variant="ghost" size="sm" onClick={() => safely(() => choose(useProjectStore.getState().addScene(chapter.id, '新场景')))}><Plus size={12} />添加场景</Button>
      </section>)}
    </div>
    <div className="border-t border-[var(--border)] p-3">
      {addingChapter ? <div className="flex flex-col gap-2">
        <Input aria-label="新增章节名称" placeholder="新章节名称" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => {
          if (e.key === 'Escape') setAddingChapter(false)
          if (e.key === 'Enter' && name.trim()) { useProjectStore.getState().addChapter(name.trim()); setName(''); setAddingChapter(false) }
        }} />
        <div className="flex gap-2"><Button size="sm" className="flex-1" disabled={!name.trim()} onClick={() => { useProjectStore.getState().addChapter(name.trim()); setName(''); setAddingChapter(false) }}>添加</Button><Button size="sm" variant="ghost" onClick={() => setAddingChapter(false)}>取消</Button></div>
      </div> : <Button size="sm" variant="ghost" className="w-full justify-start" onClick={() => setAddingChapter(true)}><Plus size={13} />添加章节</Button>}
    </div>
  </aside>
}

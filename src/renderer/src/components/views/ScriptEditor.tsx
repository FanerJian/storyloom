import { memo, useEffect, useMemo, useState } from 'react'
import { Bookmark, Play, Plus, Search, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../stores/project'
import { useUiStore } from '../../stores/ui'
import { Button, Input, Select, Textarea } from '../ui'
import { NodeForm } from '../Inspector'
import { searchDialogue } from '@shared/authoring'
import { NODE_META } from '../../lib/flowHelpers'
import { toast } from '../../stores/toast'
import { safely } from './common'
import type { StoryCharacter, StoryNode } from '@shared/schema'

/** 连续剧本编辑器：正文行 + 右侧属性栏（ScriptRow 仅此处使用，保留在同一文件）。 */
export function ScriptEditor() {
  const nodes = useProjectStore((s) => s.nodes)
  const a = useProjectStore((s) => s.authoring)
  const sceneId = useProjectStore((s) => s.activeSceneId)
  const focusId = useProjectStore((s) => s.focusedNodeId)
  const [query, setQuery] = useState(''), [replacement, setReplacement] = useState(''), [selected, setSelected] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [checked, setChecked] = useState<string[]>([])
  const scene = a?.scenes.find((s) => s.id === sceneId)
  const list = useMemo(() => query.trim() ? searchDialogue(useProjectStore.getState().getProject(), query) : nodes.filter((n) => n.sceneId === sceneId), [nodes, sceneId, query])
  useEffect(() => { setPage(0); setSelected(null); setChecked([]) }, [sceneId, query])
  useEffect(() => {
    if (!focusId) return
    const index = list.findIndex((n) => n.id === focusId)
    if (index < 0) return
    setPage(Math.floor(index / 80)); setSelected(focusId)
    const timer = setTimeout(() => {
      document.querySelector(`[data-node-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'center' })
      useProjectStore.setState({ focusedNodeId: null })
    }, 80)
    return () => clearTimeout(timer)
  }, [focusId, list])
  const editing = nodes.find((n) => n.id === selected)
  const preview = list.filter((n) => n.type === 'dialogue' && (n.data.text ?? '').includes(query))
  const replace = async (): Promise<void> => {
    const expected = useProjectStore.getState()
    const ok = await useUiStore.getState().askConfirm({ title: '确认替换正文', body: `在 ${preview.length} 句对白中将“${query}”替换为“${replacement}”。此操作可以撤销。`, confirmText: '应用替换' })
    if (!ok) return
    if (expected.nodes !== useProjectStore.getState().nodes || expected.revision !== useProjectStore.getState().revision) { toast.warn('预览期间剧本发生变化，请重新确认'); return }
    expected.replaceDialogue(query, replacement, preview.map((n) => n.id))
  }
  const insert = (): void => safely(() => setSelected(useProjectStore.getState().insertDialogue(sceneId!, editing?.sceneId === sceneId ? editing.id : undefined)))
  if (!scene || !a) return <div className="p-8">请添加或选择一个场景。</div>
  return <div className="flex h-full flex-col">
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
      <Input aria-label="场景名称" value={scene.name} className="max-w-72 font-bold" onChange={(e) => useProjectStore.getState().updateScene(scene.id, { name: e.target.value })} />
      <Select aria-label="场景所属章节" value={scene.chapterId} className="max-w-40" onChange={(e) => useProjectStore.getState().updateScene(scene.id, { chapterId: e.target.value })}>{a.chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      <Button size="sm" variant={scene.bookmark ? 'soft' : 'ghost'} title="场景书签" onClick={() => useProjectStore.getState().updateScene(scene.id, { bookmark: !scene.bookmark })}><Bookmark size={14} /></Button>
      <Button size="sm" onClick={insert}><Plus size={14} />插入对白</Button>
      <Button size="sm" variant="soft" onClick={() => useUiStore.getState().openPlaytest(scene.entryId)}><Play size={13} />试玩场景</Button>
      <span className="ml-auto text-[11px] text-[var(--text-dim)]">{list.length} 项 · {query ? '全文搜索' : '当前场景'}</span>
    </div>
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
      <Search size={14} /><Input aria-label="全文搜索" placeholder="搜索对白或角色（全文）" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-64" />
      <Input aria-label="替换为" placeholder="替换为（正文区分大小写）" value={replacement} onChange={(e) => setReplacement(e.target.value)} className="max-w-64" />
      <Button size="sm" disabled={!query || !preview.length} onClick={() => void replace()}>替换预览 · {query ? preview.length : 0} 句</Button>
      {!!query && <Button size="sm" variant="ghost" onClick={() => setQuery('')}>清除</Button>}
      <Select aria-label="批量修改角色" className="max-w-44" value="" disabled={!checked.length} onChange={(e) => safely(() => useProjectStore.getState().assignCharacter(checked, e.target.value === '__narrator' ? '' : e.target.value))}>
        <option value="">批量设角色 · {checked.length} 项</option><option value="__narrator">旁白</option>{a.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Select aria-label="批量移动场景" className="max-w-44" value="" disabled={!checked.length} onChange={(e) => safely(() => { useProjectStore.getState().assignScene(checked, e.target.value); setChecked([]) })}>
        <option value="">移动所选到场景</option>{a.scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
    </div>
    {!!query && !!preview.length && <div className="max-h-36 flex-none overflow-auto border-b border-[var(--border)] bg-indigo-500/5 px-4 py-2 text-[11px]" data-testid="replacement-preview">{preview.slice(0, 3).map((n) => <p key={n.id} className="mb-1 truncate">{n.data.text} → {(n.data.text ?? '').split(query).join(replacement)}</p>)}</div>}
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {!query && <Textarea aria-label="场景待修改备注" placeholder="场景备注：待修改内容、演出说明、审稿意见……" value={scene.notes ?? ''} rows={2} className="mb-4" onChange={(e) => useProjectStore.getState().updateScene(scene.id, { notes: e.target.value })} />}
        {list.slice(page * 80, page * 80 + 80).map((n) => <ScriptRow key={n.id} node={n} characters={a.characters} selected={selected === n.id} checked={checked.includes(n.id)} toggle={() => setChecked((ids) => ids.includes(n.id) ? ids.filter((id) => id !== n.id) : [...ids, n.id])} choose={() => setSelected(n.id)} />)}
        {!list.length && <p className="p-6 text-center text-[var(--text-dim)]">没有匹配的内容。</p>}
        {list.length > 80 && <div className="flex items-center justify-center gap-3 py-4"><Button size="sm" disabled={!page} onClick={() => setPage(page - 1)}>上一页</Button><span className="text-[12px]">{page + 1} / {Math.ceil(list.length / 80)}</span><Button size="sm" disabled={(page + 1) * 80 >= list.length} onClick={() => setPage(page + 1)}>下一页</Button></div>}
      </div>
      {editing && <aside className="w-80 flex-none overflow-auto border-l border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="mb-3 text-[12px] font-bold">{NODE_META[editing.type].label} · {editing.id}</div>
        <Select aria-label="节点所属场景" value={editing.sceneId ?? ''} onChange={(e) => useProjectStore.getState().assignScene([editing.id], e.target.value)} className="mb-3">{a.scenes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <NodeForm node={editing} />
        <Textarea aria-label="节点备注" rows={3} value={editing.data.notes ?? ''} placeholder="此处的待修改备注" className="mt-3" onChange={(e) => useProjectStore.getState().updateNodeData(editing.id, { notes: e.target.value })} />
        {editing.type === 'dialogue' && <Button size="sm" className="mt-3" onClick={() => safely(() => { useProjectStore.getState().removeDialogue(editing.id); setSelected(null) })}><Trash2 size={13} />删除此句并接回剧情</Button>}
      </aside>}
    </div>
  </div>
}

const ScriptRow = memo(function ScriptRow({ node, characters, selected, checked, toggle, choose }: { node: StoryNode; characters: StoryCharacter[]; selected: boolean; checked: boolean; toggle: () => void; choose: () => void }) {
  const update = useProjectStore((s) => s.updateNodeData)
  const assetName = useProjectStore((s) => node.data.asset ? s.assets[node.data.asset]?.name : '')
  const character = characters.find((c) => c.id === node.data.characterId)
  if (!['dialogue', 'choice', 'script'].includes(node.type)) return <article data-node-id={node.id} className={`mb-1 flex items-center gap-3 rounded-lg border bg-[var(--surface)] px-3 py-2 text-[11px] ${selected ? 'border-indigo-400/70' : 'border-[var(--border)]'}`} onClick={choose}>
    <input aria-label={`选择剧本行 ${node.id}`} type="checkbox" checked={checked} onClick={(e) => e.stopPropagation()} onChange={toggle} />
    <span className="w-12 flex-none text-[var(--text-dim)]">{NODE_META[node.type].label}</span>
    <span className="truncate">{node.data.label || (node.type === 'sprite' && node.data.spriteAction === 'hide' ? `隐藏${node.data.spritePos === 'left' ? '左侧' : node.data.spritePos === 'right' ? '右侧' : '中间'}立绘` : assetName || node.data.character || NODE_META[node.type].label)}</span>
    <code className="ml-auto text-[10px] text-[var(--text-dim)]">{node.id}</code>
  </article>
  return <article data-node-id={node.id} className={`mb-3 rounded-xl border bg-[var(--surface)] p-3 ${selected ? 'border-indigo-400/70 shadow-sm' : 'border-[var(--border)]'}`} onClick={choose}>
    <div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--text-dim)]"><input aria-label={`选择剧本行 ${node.id}`} type="checkbox" checked={checked} onClick={(e) => e.stopPropagation()} onChange={toggle} /><span>{NODE_META[node.type].label}</span><code className="opacity-60">{node.id}</code>{node.data.notes && <span className="ml-auto text-amber-400">待修改</span>}</div>
    {node.type === 'dialogue' ? <>
      <div className="mb-2 flex gap-2">
        <Select aria-label="对白角色" value={node.data.characterId ?? ''} className="max-w-44" style={{ color: character?.color }} onChange={(e) => { const c = characters.find((c) => c.id === e.target.value); update(node.id, { characterId: c?.id, speaker: c?.name ?? '' }) }}><option value="">旁白 / 自定义姓名</option>{characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        {!node.data.characterId && <Input aria-label="对白自定义姓名" value={node.data.speaker ?? ''} placeholder="旁白留空" className="max-w-40" onChange={(e) => update(node.id, { speaker: e.target.value })} />}
      </div>
      <Textarea aria-label={`对白正文 ${node.id}`} rows={Math.min(6, Math.max(2, Math.ceil((node.data.text?.length ?? 0) / 48)))} value={node.data.text ?? ''} onChange={(e) => update(node.id, { text: e.target.value })} className="text-[14px] leading-7" />
    </> : <div className="text-[12px] leading-relaxed">
      {node.type === 'choice' ? node.data.options?.map((o, i) => <p key={o.id}>{i + 1}. {o.text}</p>) : node.type === 'script' ? <><span className="text-amber-400">旧脚本：执行期间不能存档，已原样保留</span><pre className="mt-1 max-h-20 overflow-hidden whitespace-pre-wrap text-[11px] opacity-60">{node.data.code}</pre></> : node.data.label || node.data.character || node.data.asset || NODE_META[node.type].desc}
      <span className="mt-1 block text-[11px] text-[var(--text-dim)]">点击编辑属性与演出</span>
    </div>}
  </article>
})

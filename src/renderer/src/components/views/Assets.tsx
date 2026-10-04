import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../stores/project'
import { Button, Input } from '../ui'
import { assetUrl } from '@shared/authoring'
import { hostApi } from '../../lib/api'
import { toast } from '../../stores/toast'

/** 素材库视图：搜索 / 导入 / 替换 / 引用定位。 */
export function Assets() {
  const assets = useProjectStore((s) => s.assets), nodes = useProjectStore((s) => s.nodes), authoring = useProjectStore((s) => s.authoring)
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(''), [page, setPage] = useState(0)
  const entries = Object.entries(assets).filter(([, a]) => `${a.name} ${a.category ?? ''}`.includes(query))
  const asset = assets[selected]
  const references = asset ? nodes.filter((n) => n.data.asset === selected || n.data.voiceAsset === selected || (n.type === 'script' && ((n.data.code ?? '').includes(asset.name) || (n.data.code ?? '').includes(selected)))) : []
  const characterRefs = authoring?.characters.filter((c) => c.defaultAsset === selected || Object.values(c.expressions).includes(selected)) ?? []
  const importing = async (replace = false): Promise<void> => {
    const expected = useProjectStore.getState(), result = await hostApi.importAsset(expected.filePath ?? undefined)
    if (result.error) { toast.error(result.error); return }
    if (result.canceled) return
    if (expected.revision !== useProjectStore.getState().revision) { toast.warn('工程已切换，未修改素材'); return }
    if (replace && asset) {
      const imported = result.asset ?? (result.dataUrl && result.name ? { name: result.name, type: result.dataUrl.startsWith('data:audio') ? 'audio' as const : 'image' as const, dataUrl: result.dataUrl } : null)
      if (!imported || imported.type !== asset.type) { toast.warn('替换素材必须具有相同类型'); return }
      useProjectStore.getState().updateAsset(selected, { ...imported, name: asset.name, path: result.asset?.path, contentHash: result.asset?.contentHash, runtimeUrl: result.asset?.runtimeUrl, sourcePath: result.asset?.sourcePath, missing: false })
    } else if (result.asset) setSelected(useProjectStore.getState().addImportedAsset(result.asset))
    else if (result.dataUrl && result.name) setSelected(await useProjectStore.getState().addAsset(result.name, result.dataUrl.startsWith('data:audio') ? 'audio' : 'image', result.dataUrl))
  }
  return <div className="flex h-full flex-col"><div className="flex flex-none items-center gap-3 border-b border-[var(--border)] p-4"><h2 className="font-bold">素材库</h2><Input aria-label="素材搜索" className="max-w-72" placeholder="搜索名称 / 分类" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} /><Button size="sm" onClick={() => void importing().catch((e) => toast.error(String(e)))}><Plus size={14} />导入素材</Button><span className="ml-auto text-[11px] text-[var(--text-dim)]">{Object.keys(assets).length} 项 · {Object.values(assets).filter((a) => a.missing).length} 缺失</span></div>
    <div className="flex min-h-0 flex-1"><div className="min-w-0 flex-1 overflow-auto p-4"><div className="grid grid-cols-1 gap-2 xl:grid-cols-2">{entries.slice(page * 100, page * 100 + 100).map(([id, a]) => <button key={id} onClick={() => setSelected(id)} className={`rounded-xl border bg-[var(--surface)] p-3 text-left ${selected === id ? 'border-indigo-400' : 'border-[var(--border)]'}`}><div className="truncate text-[12px] font-semibold">{a.name}</div><div className="mt-1 text-[11px] text-[var(--text-dim)]">{a.type === 'image' ? '图片' : '音频'} · {a.category || '未分类'} · {a.path ? '外部文件' : '内嵌'}{a.placeholder ? ' · 占位' : ''}{a.missing ? ' · 缺失' : ''}</div></button>)}</div>{entries.length > 100 && <div className="flex justify-center gap-3 p-4"><Button size="sm" disabled={!page} onClick={() => setPage(page - 1)}>上一页</Button><Button size="sm" disabled={(page + 1) * 100 >= entries.length} onClick={() => setPage(page + 1)}>下一页</Button></div>}</div>
      {asset && <aside className="w-80 flex-none overflow-auto border-l border-[var(--border)] bg-[var(--surface)] p-4"><code className="text-[10px] text-[var(--text-dim)]">{selected}</code><Input aria-label="素材名称" value={asset.name} className="mt-3" onChange={(e) => useProjectStore.getState().updateAsset(selected, { name: e.target.value })} /><Input aria-label="素材分类" value={asset.category ?? ''} placeholder="分类：背景 / 立绘 / BGM…" className="mt-2" onChange={(e) => useProjectStore.getState().updateAsset(selected, { category: e.target.value })} /><label className="my-3 flex items-center gap-2 text-[12px]"><input type="checkbox" checked={!!asset.placeholder} onChange={(e) => useProjectStore.getState().updateAsset(selected, { placeholder: e.target.checked })} />标为占位素材</label>
        {asset.type === 'image' ? <img alt={asset.name} src={assetUrl(asset)} className="my-3 max-h-64 w-full object-contain" /> : <audio aria-label="素材试听" controls src={assetUrl(asset)} className="my-3 w-full" preload="metadata" />}
        <div className="break-all text-[11px] text-[var(--text-dim)]">{asset.path || '单文件内嵌素材'}</div><Button size="sm" className="my-3" onClick={() => void importing(true).catch((e) => toast.error(String(e)))}>{asset.missing ? '重新定位文件' : '替换文件（保留素材 ID）'}</Button>
        <h3 className="my-2 text-[12px] font-bold">引用位置 · {references.length + characterRefs.length}</h3>{references.map((n) => <button key={n.id} className="mb-1 block w-full rounded p-2 text-left text-[11px] hover:bg-[var(--surface-2)]" onClick={() => useProjectStore.setState({ activeSceneId: n.sceneId ?? null, focusedNodeId: n.id, workspaceMode: 'script' })}>{authoring?.scenes.find((s) => s.id === n.sceneId)?.name} · {n.id}</button>)}{characterRefs.map((c) => <p key={c.id} className="text-[11px]">角色库 · {c.name}</p>)}<p className="my-3 text-[11px] text-[var(--text-dim)]">脚本引用仅按名称/ID 提示；动态生成的名称仍需人工检查。</p>
        <Button size="sm" disabled={!!references.length || !!characterRefs.length} onClick={() => { useProjectStore.getState().removeAsset(selected); setSelected('') }}><Trash2 size={12} />删除未引用素材</Button>
      </aside>}
    </div></div>
}

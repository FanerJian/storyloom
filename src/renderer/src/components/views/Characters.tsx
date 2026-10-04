import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useProjectStore } from '../../stores/project'
import { Button, Input, Select } from '../ui'
import { assetUrl } from '@shared/authoring'

/** 角色库视图。 */
export function Characters() {
  const a = useProjectStore((s) => s.authoring), assets = useProjectStore((s) => s.assets)
  const [name, setName] = useState('')
  const [addingChapter, setAddingChapter] = useState(false), [expression, setExpression] = useState(''), [selectedAsset, setSelectedAsset] = useState('')
  const images = Object.entries(assets).filter(([, a]) => a.type === 'image')
  if (!a) return null
  return <div className="h-full overflow-auto p-6"><h2 className="mb-2 text-lg font-bold">角色库</h2><p className="mb-5 text-[12px] text-[var(--text-dim)]">角色 ID 不随姓名修改而变化，已绑定对白会同步更新姓名。脚本中写死的姓名请人工检查。</p>
    <div className="mb-5 flex gap-2"><Input aria-label="新角色姓名" className="max-w-64" value={name} onChange={(e) => setName(e.target.value)} placeholder="角色姓名" /><Button size="sm" disabled={!name.trim()} onClick={() => { useProjectStore.getState().addCharacter(name.trim()); setName('') }}><Plus size={14} />添加角色</Button></div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{a.characters.map((c) => <section key={c.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <code className="text-[10px] text-[var(--text-dim)]">{c.id}</code><div className="my-3 flex gap-2"><Input aria-label="角色姓名" value={c.name} onChange={(e) => useProjectStore.getState().updateCharacter(c.id, { name: e.target.value })} /><input aria-label="角色姓名颜色" type="color" value={c.color} onChange={(e) => useProjectStore.getState().updateCharacter(c.id, { color: e.target.value })} /></div>
      <Select aria-label="默认立绘" value={c.defaultAsset ?? ''} onChange={(e) => useProjectStore.getState().updateCharacter(c.id, { defaultAsset: e.target.value })}><option value="">默认立绘（未设置）</option>{images.map(([id, a]) => <option key={id} value={id}>{a.name}</option>)}</Select>
      {c.defaultAsset && <img alt={`${c.name} 默认立绘`} src={assetUrl(assets[c.defaultAsset])} className="mt-3 h-44 w-full object-contain" />}
      <div className="mt-3 flex flex-col gap-2">{Object.entries(c.expressions).map(([key, id]) => <div key={key} className="flex items-center gap-2 text-[12px]"><span>{key} → {assets[id]?.name ?? '素材缺失'}</span><Button size="sm" variant="ghost" onClick={() => { const next = { ...c.expressions }; delete next[key]; useProjectStore.getState().updateCharacter(c.id, { expressions: next }) }}>移除</Button></div>)}</div>
      <div className="mt-3 flex flex-wrap gap-2"><Input aria-label={`表情名称 ${c.id}`} placeholder="表情名称" className="max-w-32" value={expression} onChange={(e) => setExpression(e.target.value)} /><Select aria-label={`表情素材 ${c.id}`} className="max-w-48" value={selectedAsset} onChange={(e) => setSelectedAsset(e.target.value)}><option value="">选择立绘</option>{images.map(([id, a]) => <option key={id} value={id}>{a.name}</option>)}</Select><Button size="sm" disabled={!expression.trim() || !selectedAsset} onClick={() => { useProjectStore.getState().updateCharacter(c.id, { expressions: { ...c.expressions, [expression.trim()]: selectedAsset } }); setExpression('') }}>添加表情</Button></div>
    </section>)}</div>
    <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><h3 className="mb-3 text-[13px] font-bold">作品版本</h3><div className="flex flex-wrap items-center gap-3 text-[12px]"><code>作品 ID：{a.gameId}</code><label>发布版本 <Input aria-label="作品发布版本" className="mt-1 max-w-32" value={a.releaseVersion} onChange={(e) => useProjectStore.getState().setAuthoring({ releaseVersion: e.target.value })} /></label><label>存档兼容版本 <Input aria-label="存档兼容版本" type="number" min={1} className="mt-1 max-w-28" value={a.saveCompatibilityVersion} onChange={(e) => useProjectStore.getState().setAuthoring({ saveCompatibilityVersion: Math.max(1, Number(e.target.value) || 1) })} /></label></div><p className="mt-2 text-[11px] text-amber-400">校订对白、改名、替换同 ID 素材无需提高兼容版本。改变剧情流程或变量类型时，需要检查旧档；提高兼容版本会使旧档不能读取。</p></section>
    {!!a.migrationWarnings.length && <section className="mt-5 text-[12px] text-amber-400"><h3 className="mb-2 font-bold">迁移报告</h3>{a.migrationWarnings.map((w, i) => <p key={i} className="mb-2">{w}</p>)}</section>}
  </div>
}

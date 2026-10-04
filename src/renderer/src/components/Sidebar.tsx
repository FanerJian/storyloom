import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CircleAlert, Info, Plus, Trash2 } from 'lucide-react'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { validateProject } from '@shared/validate'
import { Badge, Button, EmptyHint, Input, Select } from './ui'
import { cn } from '../lib/utils'
import type { VarType } from '@shared/schema'
import { NODE_META } from '../lib/flowHelpers'
import type { StoryNode } from '@shared/schema'

type Tab = 'overview' | 'variables' | 'issues'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'variables', label: '变量' },
  { key: 'issues', label: '检查' }
]

export function Sidebar() {
  const tab = useUiStore((s) => s.sidebarTab)
  const setTab = useUiStore((s) => s.setSidebarTab)

  return (
    <aside className="flex w-72 flex-none flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-none gap-1 border-b border-[var(--border)] p-2">
        {TABS.map((t) => (
          <TabButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </TabButton>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'variables' && <VariablesTab />}
        {tab === 'issues' && <IssuesTab />}
      </div>
    </aside>
  )
}

function computedIssues(s: { meta: Parameters<typeof validateProject>[0]['meta']; variables: Parameters<typeof validateProject>[0]['variables']; nodes: Parameters<typeof validateProject>[0]['nodes']; edges: Parameters<typeof validateProject>[0]['edges'] }): ReturnType<typeof validateProject> {
  return validateProject({ assets: useProjectStore.getState().assets, ...s })
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors',
        active
          ? 'bg-[var(--accent-soft)] text-indigo-600 dark:text-indigo-300'
          : 'text-[var(--text-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
      )}
    >
      {children}
    </button>
  )
}

/** ---------- 概览 ---------- */
function OverviewTab() {
  const meta = useProjectStore((s) => s.meta)
  const nodes = useProjectStore((s) => s.nodes)
  const variables = useProjectStore((s) => s.variables)
  const edges = useProjectStore((s) => s.edges)
  const assets = useProjectStore((s) => s.assets)
  const authoring = useProjectStore((s) => s.authoring)
  const setMeta = useProjectStore((s) => s.setMeta)
  const issues = useMemo(() => computedIssues({ meta, variables, nodes, edges }), [meta, variables, nodes, edges])
  const errors = issues.filter((i) => i.level === 'error').length

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const n of nodes) c[n.type] = (c[n.type] ?? 0) + 1
    return c
  }, [nodes])

  // 作品统计：字数 = 对白正文 + 选项文本；阅读时长按 400 字/分钟向上取整。
  const stats = useMemo(() => {
    const chars = nodes.reduce((sum, n) => {
      if (n.type === 'dialogue') return sum + (n.data.text?.length ?? 0)
      if (n.type === 'choice') return sum + (n.data.options ?? []).reduce((s, o) => s + o.text.length, 0)
      return sum
    }, 0)
    return {
      chars,
      minutes: Math.ceil(chars / 400),
      nodes: nodes.length,
      scenes: authoring?.scenes.length ?? 0,
      assets: Object.keys(assets).length
    }
  }, [nodes, assets, authoring])

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex flex-col gap-2">
        <div className="text-[11px] font-semibold tracking-wide text-[var(--text-dim)] uppercase">故事信息</div>
        <Input
          value={meta.title}
          placeholder="故事标题"
          onChange={(e) => setMeta({ title: e.target.value }, { commit: false })}
          className="text-[13px] font-semibold"
        />
        <Input
          value={meta.author}
          placeholder="作者署名（可选）"
          onChange={(e) => setMeta({ author: e.target.value }, { commit: false })}
        />
        <textarea
          value={meta.description}
          placeholder="一句话简介（可选）"
          rows={3}
          onChange={(e) => setMeta({ description: e.target.value }, { commit: false })}
          className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[12px] leading-relaxed focus:border-indigo-500/70 focus:outline-none"
        />
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--text-dim)] uppercase">作品统计</div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-center" title="对白正文与选项文本的总字数">
            <div className="text-[15px] font-bold">{stats.chars.toLocaleString()}</div>
            <div className="text-[10px] text-[var(--text-dim)]">总字数</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-center" title="按 400 字/分钟估算">
            <div className="text-[15px] font-bold">{stats.chars > 0 ? `约 ${stats.minutes} 分钟` : '—'}</div>
            <div className="text-[10px] text-[var(--text-dim)]">预计阅读时长</div>
          </div>
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-center">
            <div className="text-[15px] font-bold">{stats.nodes}</div>
            <div className="text-[10px] text-[var(--text-dim)]">节点</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-center">
            <div className="text-[15px] font-bold">{stats.scenes}</div>
            <div className="text-[10px] text-[var(--text-dim)]">场景</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-center">
            <div className="text-[15px] font-bold">{stats.assets}</div>
            <div className="text-[10px] text-[var(--text-dim)]">素材</div>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--text-dim)] uppercase">剧情规模</div>
        <div className="grid grid-cols-3 gap-1.5">
          {(['dialogue', 'choice', 'variable', 'jump', 'end', 'start', 'bg', 'sprite', 'audio'] as const).map((t) => (
            <div
              key={t}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-center"
              title={NODE_META[t].desc}
            >
              <div className="text-[15px] font-bold">{counts[t] ?? 0}</div>
              <div className="text-[10px] text-[var(--text-dim)]">{NODE_META[t].label}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-3 px-1 text-[11px] text-[var(--text-dim)]">
          <span>{edges.length} 条连线</span>
          <span>{variables.length} 个变量</span>
          {errors > 0 && <Badge tone="red">{errors} 个错误</Badge>}
        </div>
      </div>
    </div>
  )
}

/** ---------- 变量 ---------- */
function VariablesTab() {
  const variables = useProjectStore((s) => s.variables)
  const addVariable = useProjectStore((s) => s.addVariable)
  const updateVariable = useProjectStore((s) => s.updateVariable)
  const removeVariable = useProjectStore((s) => s.removeVariable)
  const nodes = useProjectStore((s) => s.nodes)
  const [name, setName] = useState('')
  const [type, setType] = useState<VarType>('number')

  const usageOf = (id: string): number =>
    nodes.reduce((acc, n) => {
      const inOps = (n.data.ops ?? []).filter((op) => op.variableId === id).length
      const inOpts = (n.data.options ?? []).filter((o) => o.condition?.variableId === id).length
      return acc + inOps + inOpts
    }, 0)

  const handleAdd = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    addVariable(trimmed, type, type === 'number' ? 0 : type === 'boolean' ? false : '')
    setName('')
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-[var(--border)] p-2.5">
        <div className="text-[11px] font-semibold text-[var(--text-dim)]">新建变量</div>
        <Input
          value={name}
          placeholder="变量名，如：金币"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <div className="flex gap-2">
          <Select value={type} onChange={(e) => setType(e.target.value as VarType)}>
            <option value="number">数字</option>
            <option value="string">文本</option>
            <option value="boolean">真假</option>
          </Select>
          <Button variant="primary" size="md" className="flex-none" onClick={handleAdd} disabled={!name.trim()}>
            <Plus size={14} />
            添加
          </Button>
        </div>
      </div>

      {variables.length === 0 ? (
        <EmptyHint>
          还没有变量。
          <span className="max-w-45 opacity-80">
            变量用于记录剧情状态（金币、好感度……），配合「变量节点」和「选项条件」使用。
          </span>
        </EmptyHint>
      ) : (
        <div className="flex flex-col gap-2">
          {variables.map((v) => (
            <div key={v.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2">
              <div className="flex items-center gap-1.5">
                <Input
                  value={v.name}
                  onChange={(e) => updateVariable(v.id, { name: e.target.value })}
                  className="h-7 flex-1 text-[12px] font-semibold"
                />
                <Select
                  value={v.type}
                  onChange={(e) => {
                    const t = e.target.value as VarType
                    updateVariable(v.id, {
                      type: t,
                      initial: t === 'number' ? Number(v.initial) || 0 : t === 'boolean' ? Boolean(v.initial) : String(v.initial)
                    })
                  }}
                  className="h-7 w-18 flex-none text-[11px]"
                >
                  <option value="number">数字</option>
                  <option value="string">文本</option>
                  <option value="boolean">真假</option>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-none text-[var(--text-dim)] hover:text-rose-500"
                  title="删除变量"
                  onClick={() => {
                    const uses = usageOf(v.id)
                    const confirmed = window.confirm(
                      uses > 0
                        ? `变量「${v.name}」被 ${uses} 处引用，删除后这些位置会标记为「未定义变量」。确定删除？`
                        : `确定删除变量「${v.name}」？`
                    )
                    if (confirmed) removeVariable(v.id)
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--text-dim)]">
                <span className="flex-none">初始值</span>
                {v.type === 'boolean' ? (
                  <Select
                    value={String(v.initial)}
                    onChange={(e) => updateVariable(v.id, { initial: e.target.value === 'true' })}
                    className="h-6 flex-1 text-[11px]"
                  >
                    <option value="false">假（false）</option>
                    <option value="true">真（true）</option>
                  </Select>
                ) : (
                  <Input
                    value={String(v.initial)}
                    type={v.type === 'number' ? 'number' : 'text'}
                    onChange={(e) =>
                      updateVariable(v.id, { initial: v.type === 'number' ? Number(e.target.value) || 0 : e.target.value })
                    }
                    className="h-6 flex-1 text-[11px]"
                  />
                )}
                <span className="flex-none">{usageOf(v.id)} 处引用</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** ---------- 检查 ---------- */
function IssuesTab() {
  const nodes = useProjectStore((s) => s.nodes)
  const variables = useProjectStore((s) => s.variables)
  const edges = useProjectStore((s) => s.edges)
  const meta = useProjectStore((s) => s.meta)
  const issues = useMemo(() => computedIssues({ meta, variables, nodes, edges }), [meta, variables, nodes, edges])

  if (issues.length === 0) {
    return <EmptyHint>✓ 没有发现问题，剧情结构完整。</EmptyHint>
  }

  const jumpTo = (nodeId?: string): void => {
    if (!nodeId) return
    const flowNodes = useProjectStore.getState().nodes as (StoryNode & { selected?: boolean })[]
    useProjectStore.setState({
      nodes: flowNodes.map((n) => ({ ...n, selected: n.id === nodeId }))
    })
    window.dispatchEvent(new CustomEvent('storyloom:center-node', { detail: nodeId }))
  }

  const icons = {
    error: <CircleAlert size={13} className="text-rose-500 flex-none" />,
    warn: <AlertTriangle size={13} className="text-amber-500 flex-none" />,
    info: <Info size={13} className="text-sky-500 flex-none" />
  }

  return (
    <div className="flex flex-col gap-1.5 p-3">
      {issues.map((issue) => (
        <button
          key={issue.id}
          onClick={() => jumpTo(issue.nodeId)}
          className={cn(
            'flex items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-[12px] leading-relaxed transition-colors',
            issue.nodeId && 'cursor-pointer hover:border-[var(--border)] hover:bg-[var(--surface-2)]',
            !issue.nodeId && 'cursor-default'
          )}
        >
          {icons[issue.level]}
          <span className="text-[var(--text)]">{issue.message}</span>
        </button>
      ))}
    </div>
  )
}

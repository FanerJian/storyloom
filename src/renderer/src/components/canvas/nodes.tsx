import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  CornerDownRight,
  Flag,
  Image as ImageIcon,
  ListTree,
  Music,
  Play,
  SquareTerminal,
  UserRound,
  Variable as VariableIcon
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useProjectStore } from '../../stores/project'
import type { StoryNode } from '@shared/schema'
import { assetUrl } from '@shared/authoring'

type RFNode = NodeProps

const cardBase =
  'rounded-xl border bg-[var(--surface)] shadow-sm transition-shadow hover:shadow-md'

function NextHandle({ id }: { id?: string }) {
  return (
    <Handle
      type="source"
      position={Position.Right}
      id={id}
      className="!right-[-5px] !h-[10px] !w-[10px] !border-2 !border-[var(--surface)] !bg-indigo-500"
      isConnectable
    />
  )
}

function InHandle() {
  return (
    <Handle
      type="target"
      position={Position.Left}
      className="!left-[-5px] !h-[10px] !w-[10px] !border-2 !border-[var(--surface)] !bg-zinc-400 dark:!bg-zinc-500"
      isConnectable
    />
  )
}

/** ---------- 开始 ---------- */
function StartNode(_props: RFNode) {
  return (
    <div className={cn(cardBase, 'border-emerald-500/50 px-4 py-2.5')}>
      <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">
        <Play size={14} className="fill-current" />
        开始
      </div>
      <NextHandle />
    </div>
  )
}

/** ---------- 对白 ---------- */
function DialogueNode({ data, selected }: RFNode) {
  const speaker = (data as StoryNode['data']).speaker?.trim() || '旁白'
  const text = (data as StoryNode['data']).text ?? ''
  return (
    <div
      className={cn(
        cardBase,
        'w-[250px] border-[var(--border)]',
        selected && 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-[var(--bg)]'
      )}
    >
      <InHandle />
      <div className="border-b border-[var(--border)] px-3 py-1.5 text-[11px] font-bold text-indigo-500 dark:text-indigo-300">
        {speaker}
      </div>
      <div className="max-h-[110px] overflow-hidden px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-[var(--text-dim)]">
        {text.trim() ? text : <span className="italic opacity-60">（空对白）</span>}
      </div>
      <NextHandle />
    </div>
  )
}

/** ---------- 选项 ---------- */
function ChoiceNode({ data, selected }: RFNode) {
  const options = (data as StoryNode['data']).options ?? []
  return (
    <div
      className={cn(
        cardBase,
        'w-[250px] border-amber-500/40',
        selected && 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-[var(--bg)]'
      )}
    >
      <InHandle />
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
        <ListTree size={12} />
        选项
      </div>
      <div className="flex flex-col py-1">
        {options.length === 0 && (
          <div className="px-3 py-2 text-[12px] italic text-[var(--text-dim)]">（没有选项）</div>
        )}
        {options.map((o) => (
          <div
            key={o.id}
            className="relative flex items-center gap-1.5 px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)]"
          >
            {o.condition && (
              <span
                className="rounded bg-cyan-500/15 px-1 py-px font-mono text-[9px] text-cyan-600 dark:text-cyan-300"
                title="有条件显示"
              >
                fx
              </span>
            )}
            <span className={cn('truncate', !o.text.trim() && 'italic opacity-50')}>
              {o.text.trim() || '空选项'}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={o.id}
              className="!right-[-5px] !top-1/2 !h-[10px] !w-[10px] !-translate-y-1/2 !border-2 !border-[var(--surface)] !bg-amber-500"
              isConnectable
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** ---------- 变量 ---------- */
function VariableNode({ data, selected }: RFNode) {
  const variables = useProjectStore((s) => s.variables)
  const nameOf = (id: string) => variables.find((v) => v.id === id)?.name ?? '（未定义）'
  const ops = (data as StoryNode['data']).ops ?? []
  return (
    <div
      className={cn(
        cardBase,
        'w-[240px] border-cyan-500/40',
        selected && 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-[var(--bg)]'
      )}
    >
      <InHandle />
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-1.5 text-[11px] font-bold text-cyan-600 dark:text-cyan-300">
        <VariableIcon size={12} />
        变量操作
      </div>
      <div className="flex flex-col gap-0.5 px-3 py-2 font-mono text-[11px] text-[var(--text-dim)]">
        {ops.length === 0 && <span className="italic opacity-60">（未设置操作）</span>}
        {ops.map((op) => (
          <div key={op.id} className="flex items-center gap-1">
            <span className="text-cyan-600 dark:text-cyan-300">{nameOf(op.variableId)}</span>
            <span>{op.op === 'set' ? '←' : op.op === 'add' ? '+=' : '-='}</span>
            <span>{String(op.value)}</span>
          </div>
        ))}
      </div>
      <NextHandle />
    </div>
  )
}

/** ---------- 跳转 ---------- */
function JumpNode({ data, selected }: RFNode) {
  const label = (data as StoryNode['data']).label ?? ''
  return (
    <div
      className={cn(
        cardBase,
        'border-purple-500/50 px-3 py-2',
        selected && 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-[var(--bg)]'
      )}
    >
      <InHandle />
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-purple-600 dark:text-purple-300">
        <CornerDownRight size={13} />
        {label.trim() || '跳转点'}
      </div>
      <NextHandle />
    </div>
  )
}

/** ---------- 结束 ---------- */
function EndNode({ data, selected }: RFNode) {
  const label = (data as StoryNode['data']).label ?? ''
  return (
    <div
      className={cn(
        cardBase,
        'border-rose-500/50 px-4 py-2.5',
        selected && 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-[var(--bg)]'
      )}
    >
      <InHandle />
      <div className="flex items-center gap-2 text-[13px] font-semibold text-rose-500 dark:text-rose-400">
        <Flag size={14} />
        {label.trim() || '结束'}
      </div>
    </div>
  )
}

/** ---------- 背景（视觉小说演出，自动通过） ---------- */
function BgNode({ data, selected }: RFNode) {
  const assets = useProjectStore((s) => s.assets)
  const asset = assets[(data as StoryNode['data']).asset ?? '']
  return (
    <div
      className={cn(
        cardBase,
        'w-[220px] border-sky-500/40',
        selected && 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-[var(--bg)]'
      )}
    >
      <InHandle />
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-1.5 text-[11px] font-bold text-sky-600 dark:text-sky-300">
        <ImageIcon size={12} />
        背景
      </div>
      {asset?.type === 'image' ? (
        <img src={assetUrl(asset)} alt="" className="h-16 w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-16 items-center justify-center text-[12px] italic text-[var(--text-dim)]">
          （未选择图片）
        </div>
      )}
      <NextHandle />
    </div>
  )
}

/** ---------- 立绘 ---------- */
function SpriteNode({ data, selected }: RFNode) {
  const assets = useProjectStore((s) => s.assets)
  const d = data as StoryNode['data']
  const asset = d.asset ? assets[d.asset] : undefined
  const posLabel =
    d.spritePos === 'custom'
      ? `自定义 ${d.spriteX ?? 50}%`
      : { left: '左侧', center: '居中', right: '右侧' }[d.spritePos ?? 'center']
  return (
    <div
      className={cn(
        cardBase,
        'w-[220px] border-pink-500/40',
        selected && 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-[var(--bg)]'
      )}
    >
      <InHandle />
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-1.5 text-[11px] font-bold text-pink-600 dark:text-pink-300">
        <UserRound size={12} />
        立绘 · {d.spriteAction === 'hide' ? '退场' : '登场'}
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        {asset?.type === 'image' ? (
          <img
            src={assetUrl(asset)}
            alt=""
            className="h-12 w-12 flex-none rounded-md object-contain"
            style={{ background: 'repeating-conic-gradient(rgba(128,128,128,.25) 0% 25%, rgba(128,128,128,.08) 0% 50%) 0 0/10px 10px' }}
            draggable={false}
          />
        ) : (
          <div className="flex h-12 w-12 flex-none items-center justify-center rounded-md bg-[var(--surface-2)] text-[var(--text-dim)]">
            {d.spriteAction === 'hide' ? '—' : <UserRound size={16} />}
          </div>
        )}
        <div className="min-w-0 text-[12px] leading-snug text-[var(--text-dim)]">
          {d.spriteAction === 'hide' ? (
            <span>{posLabel} · 移除立绘</span>
          ) : (
            <>
              <div className="truncate font-semibold text-[var(--text)]">{d.character?.trim() || '未命名角色'}</div>
              <div className="truncate">{asset?.name ?? '未选择图片'} · {posLabel}</div>
            </>
          )}
        </div>
      </div>
      <NextHandle />
    </div>
  )
}

/** ---------- 音乐/音效 ---------- */
function AudioNode({ data, selected }: RFNode) {
  const assets = useProjectStore((s) => s.assets)
  const d = data as StoryNode['data']
  const asset = d.asset ? assets[d.asset] : undefined
  const kindLabel = d.audioKind === 'sfx' ? '音效' : 'BGM'
  return (
    <div
      className={cn(
        cardBase,
        'w-[220px] border-teal-500/40',
        selected && 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-[var(--bg)]'
      )}
    >
      <InHandle />
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-1.5 text-[11px] font-bold text-teal-600 dark:text-teal-300">
        <Music size={12} />
        {kindLabel} · {d.audioAction === 'stop' ? '停止' : '播放'}
      </div>
      <div className="px-3 py-2 text-[12px] leading-snug text-[var(--text-dim)]">
        {d.audioAction === 'stop' ? (
          <span>停止{kindLabel}播放</span>
        ) : (
          <div className="truncate">
            {asset?.name ?? '未选择音频'}
            {d.audioKind !== 'sfx' && (d.loop ?? true) ? ' · 循环' : ''} · 音量 {d.volume ?? 80}
          </div>
        )}
      </div>
      <NextHandle />
    </div>
  )
}

/** ---------- 演出脚本（自定义效果 API，自动通过） ---------- */
function ScriptNode({ data, selected }: RFNode) {
  const code = (data as StoryNode['data']).code ?? ''
  const lines = code.split('\n').filter((l) => l.trim())
  return (
    <div
      className={cn(
        cardBase,
        'w-[230px] border-violet-500/40',
        selected && 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-[var(--bg)]'
      )}
    >
      <InHandle />
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-1.5 text-[11px] font-bold text-violet-600 dark:text-violet-300">
        <SquareTerminal size={12} />
        演出脚本
      </div>
      <div className="max-h-[72px] overflow-hidden px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--text-dim)]">
        {lines.length > 0 ? (
          lines.slice(0, 3).map((l, i) => (
            <div key={i} className="truncate">
              {l.trim()}
            </div>
          ))
        ) : (
          <span className="italic opacity-60">（空脚本）</span>
        )}
        {lines.length > 3 && <div className="opacity-60">…共 {lines.length} 行</div>}
      </div>
      <NextHandle />
    </div>
  )
}

export const nodeTypes = {
  start: StartNode,
  dialogue: DialogueNode,
  choice: ChoiceNode,
  variable: VariableNode,
  jump: JumpNode,
  end: EndNode,
  bg: BgNode,
  sprite: SpriteNode,
  audio: AudioNode,
  script: ScriptNode
}

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Plus, Sparkles, Trash2, Zap } from 'lucide-react'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { hostApi } from '../lib/api'
import { toast } from '../stores/toast'
import { Badge, Button, EmptyHint, Field, Input, Select, Textarea } from './ui'
import { NODE_META, nodeTitle } from '../lib/flowHelpers'
import type { AssignOp, CompareOp, Condition, StoryAsset, StoryNode, VarType, VarValue } from '@shared/schema'
import { assetUrl } from '@shared/authoring'

export function Inspector() {
  const nodes = useProjectStore((s) => s.nodes)
  const open = useUiStore((s) => s.inspectorOpen)

  const selected = useMemo(() => nodes.filter((n) => (n as StoryNode & { selected?: boolean }).selected), [nodes])

  if (!open) return null

  return (
    <aside className="flex w-80 flex-none flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-none items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
        <span className="text-[12px] font-bold tracking-wide">属性</span>
        {selected.length > 1 && <Badge>{selected.length} 个已选</Badge>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {selected.length === 0 ? (
          <EmptyHint>
            <Sparkles size={20} className="opacity-40" />
            选中一个节点以编辑属性
          </EmptyHint>
        ) : selected.length > 1 ? (
          <EmptyHint>
            已选中 {selected.length} 个节点。
            <span className="opacity-70">可拖动整体移动，按 Delete 删除。</span>
          </EmptyHint>
        ) : (
          <NodeForm key={selected[0].id} node={selected[0]} />
        )}
      </div>
    </aside>
  )
}

export function NodeForm({ node }: { node: StoryNode }) {
  const meta = NODE_META[node.type]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Badge tone="accent">{meta.label}</Badge>
        <span className="truncate text-[12px] text-[var(--text-dim)]">{nodeTitle(node)}</span>
      </div>
      {node.type === 'start' && <StartForm />}
      {node.type === 'dialogue' && <DialogueForm node={node} />}
      {node.type === 'choice' && <ChoiceForm node={node} />}
      {node.type === 'variable' && <VariableForm node={node} />}
      {node.type === 'jump' && <JumpForm node={node} />}
      {node.type === 'end' && <EndForm node={node} />}
      {node.type === 'bg' && <BgForm node={node} />}
      {node.type === 'sprite' && <SpriteForm node={node} />}
      {node.type === 'audio' && <AudioForm node={node} />}
      {node.type === 'script' && <ScriptForm node={node} />}
    </div>
  )
}

function StartForm() {
  return (
    <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-[12px] leading-relaxed text-[var(--text-dim)]">
      剧情从「开始」节点出发。它没有可编辑属性——把它的出口连到第一个内容节点即可。
    </p>
  )
}

function DialogueForm({ node }: { node: StoryNode }) {
  const updateNodeData = useProjectStore((s) => s.updateNodeData)
  return (
    <>
      <Field label="说话人" hint="留空显示「旁白」">
        <Input
          value={node.data.speaker ?? ''}
          placeholder="如：店家 / 老者"
          onChange={(e) => updateNodeData(node.id, { speaker: e.target.value })}
        />
      </Field>
      <Field label="正文" hint={`${(node.data.text ?? '').length} 字`}>
        <Textarea
          value={node.data.text ?? ''}
          placeholder="写下这一段故事……支持换行"
          rows={8}
          onChange={(e) => updateNodeData(node.id, { text: e.target.value })}
        />
      </Field>
    </>
  )
}

function ChoiceForm({ node }: { node: StoryNode }) {
  const options = node.data.options ?? []
  const addOption = useProjectStore((s) => s.addOption)
  const updateOption = useProjectStore((s) => s.updateOption)
  const removeOption = useProjectStore((s) => s.removeOption)
  const moveOption = useProjectStore((s) => s.moveOption)
  const selectedOption = useProjectStore((s) => s.selectedOption)
  const setSelectedOption = useProjectStore.setState

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-[var(--text-dim)] uppercase">
          选项（{options.length}）
        </span>
        <Button variant="soft" size="sm" onClick={() => addOption(node.id)}>
          <Plus size={12} />
          加一项
        </Button>
      </div>
      {options.map((o, i) => {
        const expanded = selectedOption?.nodeId === node.id && selectedOption?.optionId === o.id
        return (
          <div key={o.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)]">
            <div className="flex items-center gap-1 p-1.5">
              <span className="w-4 flex-none text-center text-[11px] font-bold text-[var(--text-dim)]">{i + 1}</span>
              <input
                value={o.text}
                placeholder={`选项 ${i + 1} 文本`}
                onChange={(e) => updateOption(node.id, o.id, { text: e.target.value })}
                onFocus={() => setSelectedOption({ selectedOption: { nodeId: node.id, optionId: o.id } })}
                className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-[12px] focus:border-indigo-500/50 focus:outline-none"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="上移"
                disabled={i === 0}
                onClick={() => moveOption(node.id, o.id, -1)}
              >
                <ArrowUp size={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="下移"
                disabled={i === options.length - 1}
                onClick={() => moveOption(node.id, o.id, 1)}
              >
                <ArrowDown size={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:text-rose-500"
                title="删除选项（同时断开其连线）"
                onClick={() => removeOption(node.id, o.id)}
              >
                <Trash2 size={12} />
              </Button>
            </div>
            {expanded && (
              <div className="border-t border-[var(--border)] p-2">
                <ConditionEditor
                  condition={o.condition}
                  onChange={(c) => updateOption(node.id, o.id, { condition: c })}
                />
              </div>
            )}
          </div>
        )
      })}
      <p className="text-[11px] leading-relaxed text-[var(--text-dim)]">
        每个选项右侧有一个琥珀色端口，从端口拖出连线决定去向；点击选项文本可展开显示条件。
      </p>
    </div>
  )
}

function VariableForm({ node }: { node: StoryNode }) {
  const variables = useProjectStore((s) => s.variables)
  const ops = node.data.ops ?? []
  const addOp = useProjectStore((s) => s.addOp)
  const updateOp = useProjectStore((s) => s.updateOp)
  const removeOp = useProjectStore((s) => s.removeOp)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-[var(--text-dim)] uppercase">操作（按顺序执行）</span>
        <Button variant="soft" size="sm" onClick={() => addOp(node.id)} disabled={variables.length === 0}>
          <Plus size={12} />
          加一步
        </Button>
      </div>
      {variables.length === 0 && (
        <p className="text-[12px] text-amber-500">先在左侧「变量」页创建变量，再回来添加操作。</p>
      )}
      {ops.map((op, i) => {
        const def = variables.find((v) => v.id === op.variableId)
        return (
          <div key={op.id} className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2">
            <div className="flex items-center gap-1.5">
              <span className="w-4 flex-none text-center text-[11px] font-bold text-[var(--text-dim)]">{i + 1}</span>
              <Select
                value={op.variableId}
                onChange={(e) => updateOp(node.id, op.id, { variableId: e.target.value, value: defaultValueFor(e.target.value) })}
                className="h-7 min-w-0 flex-1 text-[12px]"
              >
                {variables.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
                {variables.length === 0 && <option value="">（无变量）</option>}
              </Select>
              <Select
                value={op.op}
                onChange={(e) => updateOp(node.id, op.id, { op: e.target.value as AssignOp })}
                className="h-7 w-20 flex-none text-[12px]"
              >
                <option value="set">设为</option>
                <option value="add" disabled={def?.type !== 'number'}>
                  加
                </option>
                <option value="sub" disabled={def?.type !== 'number'}>
                  减
                </option>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-none hover:text-rose-500"
                title="删除此操作"
                onClick={() => removeOp(node.id, op.id)}
              >
                <Trash2 size={12} />
              </Button>
            </div>
            <ValueInput
              type={def?.type ?? 'number'}
              value={op.value}
              onChange={(v) => updateOp(node.id, op.id, { value: v })}
            />
          </div>
        )
      })}
    </div>
  )
}

function defaultValueFor(variableId: string): VarValue {
  const def = useProjectStore.getState().variables.find((v) => v.id === variableId)
  if (!def) return 0
  return def.type === 'number' ? 0 : def.type === 'boolean' ? true : ''
}

function JumpForm({ node }: { node: StoryNode }) {
  const updateNodeData = useProjectStore((s) => s.updateNodeData)
  return (
    <Field label="跳转点名称" hint="用于在画布上标记位置">
      <Input
        value={node.data.label ?? ''}
        placeholder="如：第三章 · 回到旅店"
        onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
      />
    </Field>
  )
}

function EndForm({ node }: { node: StoryNode }) {
  const updateNodeData = useProjectStore((s) => s.updateNodeData)
  return (
    <Field label="结局名称" hint="试玩与导出中显示">
      <Input
        value={node.data.label ?? ''}
        placeholder="如：一夜好眠"
        onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
      />
    </Field>
  )
}

/** ---------- 演出脚本（自定义效果 API） ---------- */

/** 效果模板：一键插入到脚本末尾 */
const SCRIPT_TEMPLATES: { label: string; snippet: string; title: string }[] = [
  { label: '震屏', snippet: 'api.shake(8, 400)', title: '屏幕震动：强度 px、时长 ms' },
  { label: '闪光', snippet: "api.flash('#ffffff', 300)", title: '全屏闪光后淡出：颜色、时长 ms' },
  { label: '转场', snippet: "await api.fadeOut('#000000', 600)\nawait api.wait(300)\nawait api.fadeIn(600)", title: '黑场转场（淡入遮罩 → 停顿 → 淡出）' },
  { label: '等待', snippet: 'await api.wait(800)', title: '等待指定毫秒' },
  { label: '连续对白', snippet: "await api.say('小雪', '这一句会等待点击后才继续。')\nawait api.say('小雪', '可以连续写很多句。')", title: '脚本内连续演出多句对白' },
  { label: '样式', snippet: "api.setStyle('.tgr-card', 'background: rgba(20,10,30,.9)')", title: '注入一条动态样式规则' }
]

/** 语法检查：脚本以 async 函数体编译（与运行时一致），报出第一条错误 */
function checkScript(code: string): string | null {
  const trimmed = code.trim()
  if (!trimmed) return null
  try {
    void new Function('api', 'vars', 'story', `"use strict";\nreturn (async () => {\n${trimmed}\n})();`)
    return null
  } catch (err) {
    return String(err instanceof Error ? err.message : err)
  }
}

function ScriptForm({ node }: { node: StoryNode }) {
  const updateNodeData = useProjectStore((s) => s.updateNodeData)
  const code = node.data.code ?? ''
  const error = checkScript(code)

  const append = (snippet: string): void => {
    const base = code.trimEnd()
    updateNodeData(node.id, { code: base ? `${base}\n${snippet}\n` : `${snippet}\n` })
  }

  return (
    <>
      <Field label="效果模板" hint="点击插入">
        <div className="flex flex-wrap gap-1.5">
          {SCRIPT_TEMPLATES.map((t) => (
            <Button key={t.label} variant="soft" size="sm" title={t.title} onClick={() => append(t.snippet)}>
              {t.label}
            </Button>
          ))}
        </div>
      </Field>
      <Field label="脚本代码" hint="可 await · 入参 api / vars / story">
        <Textarea
          value={code}
          rows={10}
          spellCheck={false}
          className="font-mono text-[12px] leading-relaxed"
          placeholder={`await api.shake(8, 400)          // 震屏\nawait api.wait(200)\nawait api.say('小雪', '……你听到了吗？')\nvars.好感 = (vars.好感 ?? 0) + 1   // 直接读写变量`}
          onChange={(e) => updateNodeData(node.id, { code: e.target.value })}
        />
      </Field>
      {error ? (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 font-mono text-[11px] leading-relaxed text-rose-500">
          {error}
        </p>
      ) : (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-2.5 text-[11px] leading-relaxed text-[var(--text-dim)]">
          脚本节点运行时自动通过：依次执行这里的代码，结束后进入下一节点。可用的完整接口见工具栏
          「自定义 → 接口文档」。素材按名称引用（如 <code>api.bg('雪夜车站.svg')</code>）。
        </p>
      )}
    </>
  )
}

/** ---------- 素材选择器（视觉小说媒体节点共用） ---------- */
function AssetPicker({
  node,
  accept,
  hint
}: {
  node: StoryNode
  accept: StoryAsset['type']
  hint?: string
}) {
  const assets = useProjectStore((s) => s.assets)
  const addAsset = useProjectStore((s) => s.addAsset)
  const updateNodeData = useProjectStore((s) => s.updateNodeData)
  const entries = Object.entries(assets).filter(([, a]) => a.type === accept)
  const current = node.data.asset ? assets[node.data.asset] : undefined

  const doImport = async (): Promise<void> => {
    const expected = useProjectStore.getState()
    const res = await hostApi.importAsset(expected.filePath ?? undefined)
    if (res.canceled) {
      if (res.error) toast.error(res.error)
      return
    }
    if (expected.revision !== useProjectStore.getState().revision) { toast.warn('工程已切换，未插入素材'); return }
    if (res.asset) {
      if (res.asset.type !== accept) { toast.warn('素材类型与当前节点不符'); return }
      const key = useProjectStore.getState().addImportedAsset(res.asset)
      updateNodeData(node.id, { asset: key }); return
    }
    if (!res.dataUrl || !res.name) return
    const type: StoryAsset['type'] = res.dataUrl.startsWith('data:audio') ? 'audio' : 'image'
    try {
      const before = useProjectStore.getState().assets
      const key = await addAsset(res.name, type, res.dataUrl)
      updateNodeData(node.id, { asset: key })
      const asset = useProjectStore.getState().assets[key]
      toast.success(before[key] || asset.name !== res.name ? `已复用相同素材「${asset.name}」` : `已导入素材「${res.name}」`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '素材导入失败')
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <Select
          value={node.data.asset ?? ''}
          onChange={(e) => updateNodeData(node.id, { asset: e.target.value })}
          className="h-8 min-w-0 flex-1 text-[12px]"
        >
          <option value="">（未选择{accept === 'image' ? '图片' : '音频'}）</option>
          {entries.map(([key, a]) => (
            <option key={key} value={key}>
              {a.name}
            </option>
          ))}
        </Select>
        <Button variant="soft" size="md" className="flex-none px-2" title="从电脑导入新素材" onClick={() => void doImport()}>
          <ImagePlus size={14} />
        </Button>
        {node.data.asset && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-none hover:text-rose-500"
            title="清除此引用"
            onClick={() => updateNodeData(node.id, { asset: '' })}
          >
            <Trash2 size={13} />
          </Button>
        )}
      </div>
      {accept === 'image' && current?.type === 'image' && (
        <img
          src={assetUrl(current)}
          alt=""
          className="max-h-28 w-full rounded-lg border border-[var(--border)] object-contain"
          style={{ background: 'repeating-conic-gradient(rgba(128,128,128,.25) 0% 25%, rgba(128,128,128,.08) 0% 50%) 0 0/14px 14px' }}
        />
      )}
      {hint && <p className="text-[11px] leading-relaxed text-[var(--text-dim)]">{hint}</p>}
    </div>
  )
}

function BgForm({ node }: { node: StoryNode }) {
  return (
    <Field label="背景图片" hint="运行时铺满画面">
      <AssetPicker node={node} accept="image" hint="背景节点自动通过。团队工程的素材保存在 assets 文件夹。" />
    </Field>
  )
}

function SpriteForm({ node }: { node: StoryNode }) {
  const updateNodeData = useProjectStore((s) => s.updateNodeData)
  const hide = node.data.spriteAction === 'hide'
  return (
    <>
      <Field label="动作">
        <Select
          value={node.data.spriteAction ?? 'show'}
          onChange={(e) => updateNodeData(node.id, { spriteAction: e.target.value as 'show' | 'hide' })}
        >
          <option value="show">登场（显示立绘）</option>
          <option value="hide">退场（移除立绘）</option>
        </Select>
      </Field>
      {!hide && (
        <Field label="立绘图片">
          <AssetPicker node={node} accept="image" hint="支持带透明通道的 PNG / WebP / SVG（透明区域显示背景）。" />
        </Field>
      )}
      <Field label="角色名" hint="画布与立绘管理用，可留空">
        <Input
          value={node.data.character ?? ''}
          placeholder="如：小雪"
          disabled={hide}
          onChange={(e) => updateNodeData(node.id, { character: e.target.value })}
        />
      </Field>
      <Field label="位置">
        <Select
          value={node.data.spritePos ?? 'center'}
          onChange={(e) => {
            const v = e.target.value as 'left' | 'center' | 'right' | 'custom'
            updateNodeData(node.id, v === 'custom' ? { spritePos: v, spriteX: node.data.spriteX ?? 50 } : { spritePos: v })
          }}
        >
          <option value="left">左侧</option>
          <option value="center">居中</option>
          <option value="right">右侧</option>
          <option value="custom">自定义位置…</option>
        </Select>
      </Field>
      {(node.data.spritePos ?? 'center') === 'custom' && (
        <Field label={`水平位置：${node.data.spriteX ?? 50}%`} hint="0=最左 · 100=最右（立绘中心）">
          <input
            type="range"
            min={0}
            max={100}
            value={node.data.spriteX ?? 50}
            onChange={(e) => updateNodeData(node.id, { spriteX: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </Field>
      )}
      <p className="rounded-lg border border-dashed border-[var(--border)] p-2.5 text-[11px] leading-relaxed text-[var(--text-dim)]">
        同一位置再次登场会替换立绘；立绘节点自动通过，随后继续对白。
      </p>
    </>
  )
}

function AudioForm({ node }: { node: StoryNode }) {
  const updateNodeData = useProjectStore((s) => s.updateNodeData)
  const stop = node.data.audioAction === 'stop'
  return (
    <>
      <Field label="类型">
        <Select
          value={node.data.audioKind ?? 'bgm'}
          onChange={(e) => updateNodeData(node.id, { audioKind: e.target.value as 'bgm' | 'sfx' })}
        >
          <option value="bgm">背景音乐 BGM（同时只有一首）</option>
          <option value="sfx">音效（叠加播放一次）</option>
        </Select>
      </Field>
      <Field label="动作">
        <Select
          value={node.data.audioAction ?? 'play'}
          onChange={(e) => updateNodeData(node.id, { audioAction: e.target.value as 'play' | 'stop' })}
        >
          <option value="play">播放</option>
          <option value="stop">停止</option>
        </Select>
      </Field>
      {!stop && (
        <Field label="音频文件">
          <AssetPicker node={node} accept="audio" hint="支持 mp3 / wav / ogg。素材内嵌保存在工程文件里。" />
        </Field>
      )}
      {!stop && node.data.audioKind !== 'sfx' && (
        <label className="flex cursor-pointer items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={node.data.loop ?? true}
            onChange={(e) => updateNodeData(node.id, { loop: e.target.checked })}
            className="h-3.5 w-3.5 accent-indigo-500"
          />
          循环播放
        </label>
      )}
      {!stop && (
        <Field label={`音量：${node.data.volume ?? 80}`}>
          <input
            type="range"
            min={0}
            max={100}
            value={node.data.volume ?? 80}
            onChange={(e) => updateNodeData(node.id, { volume: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </Field>
      )}
    </>
  )
}

/** ---------- 条件编辑 ---------- */
function ConditionEditor({
  condition,
  onChange
}: {
  condition: Condition | null
  onChange: (c: Condition | null) => void
}) {
  const variables = useProjectStore((s) => s.variables)
  const enabled = !!condition

  const def = variables.find((v) => v.id === condition?.variableId)

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-[12px]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? { variableId: variables[0]?.id ?? '', op: '>=' as CompareOp, value: 1 } : null)}
          className="h-3.5 w-3.5 accent-indigo-500"
        />
        <span className="flex items-center gap-1 font-medium">
          <Zap size={12} className="text-cyan-500" />
          满足条件时才显示此选项
        </span>
      </label>
      {enabled && condition && (
        <div className="flex items-center gap-1.5 pl-5">
          <Select
            value={condition.variableId}
            onChange={(e) =>
              onChange({ ...condition, variableId: e.target.value, value: defaultValueFor(e.target.value) })
            }
            className="h-7 min-w-0 flex-1 text-[12px]"
          >
            {variables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
            {variables.length === 0 && <option value="">（无变量）</option>}
          </Select>
          <Select
            value={condition.op}
            onChange={(e) => onChange({ ...condition, op: e.target.value as CompareOp })}
            className="h-7 w-16 flex-none text-[12px]"
          >
            <option value="==">＝</option>
            <option value="!=">≠</option>
            <option value=">">＞</option>
            <option value=">=">≥</option>
            <option value="<">＜</option>
            <option value="<=">≤</option>
          </Select>
          {def?.type === 'boolean' ? (
            <Select
              value={String(condition.value)}
              onChange={(e) => onChange({ ...condition, value: e.target.value === 'true' })}
              className="h-7 w-20 flex-none text-[12px]"
            >
              <option value="false">假</option>
              <option value="true">真</option>
            </Select>
          ) : (
            <Input
              value={String(condition.value)}
              type={def?.type === 'number' ? 'number' : 'text'}
              onChange={(e) =>
                onChange({
                  ...condition,
                  value: def?.type === 'number' ? Number(e.target.value) || 0 : e.target.value
                })
              }
              className="h-7 w-20 flex-none text-[12px]"
            />
          )}
        </div>
      )}
    </div>
  )
}

function ValueInput({ type, value, onChange }: { type: VarType; value: VarValue; onChange: (v: VarValue) => void }) {
  if (type === 'boolean') {
    return (
      <Select value={String(value)} onChange={(e) => onChange(e.target.value === 'true')} className="h-7 text-[12px]">
        <option value="false">假（false）</option>
        <option value="true">真（true）</option>
      </Select>
    )
  }
  return (
    <Input
      value={String(value)}
      type={type === 'number' ? 'number' : 'text'}
      onChange={(e) => onChange(type === 'number' ? Number(e.target.value) || 0 : e.target.value)}
      className="h-7 text-[12px]"
      placeholder={type === 'number' ? '数值' : '文本值'}
    />
  )
}

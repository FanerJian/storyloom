/**
 * Yarn（Yarn Spinner / Twine yarn）文本格式导入导出。
 *
 * 导出约定：
 * - 线性节点链合并为一个 yarn 节点，在选项/跳转/终点/汇合点断开
 * - 选项导出为 [[文本|目标]]，条件选项包在 <<if>>…<<endif>> 里
 * - 变量导出为 <<set $名称 操作符 值>>
 * - 多媒体节点导出为自定义命令 <<bg>> / <<sprite>> / <<audio>>
 *   （素材本体不随 yarn 存储，重新导入时需在编辑器里重新选取）
 * - 演出脚本导出为效果命令 <<shake>> / <<flash>> / <<fadeout>> / <<fadein>> /
 *   <<wait>>，其余代码行导出为 <<js 行>>；导入时这些命令恢复为演出脚本节点
 */
import type { AssignOp, StoryProject, VarValue } from '../schema'
import {
  chainsToProject,
  fmtCondition,
  fmtValue,
  parseCondExpr,
  parseValueToken,
  planChains,
  sanitizeTitle,
  splitSpeaker,
  varNameMap,
  type ImportResult,
  type ParsedOption,
  type ParsedSetOp,
  type ScriptChain,
  type Segment,
  type VarSeed
} from './common'

/** 变量名标识符（可含中文） */
const V = '[A-Za-z_\\u4e00-\\u9fff][A-Za-z0-9_\\u4e00-\\u9fff]*'

/** 顶层逗号分割函数实参（同时去掉引号，供糖命令使用） */
function splitArgs(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let q: string | null = null
  for (const ch of s) {
    if (q) {
      if (ch === q) q = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      q = ch
      continue
    }
    if (ch === ',') {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const isNum = (x: string): boolean => /^\d+(\.\d+)?$/.test(x)

/** 演出脚本单行 → yarn 命令（效果调用转糖命令，注释转注释，其余原样包进 <<js …>>） */
function scriptLineToYarn(line: string): string {
  if (line.startsWith('//')) return line
  const m = line
    .replace(/^await\s+/, '')
    .match(/^api\.(\w+)\s*\((.*)\)\s*;?$/s)
  if (m) {
    const fn = m[1]
    const args = splitArgs(m[2])
    switch (fn) {
      case 'shake':
        if (args.length === 0) return '<<shake>>'
        if (args.length === 2 && isNum(args[0]) && isNum(args[1])) return `<<shake ${args[0]} ${args[1]}>>`
        break
      case 'flash':
        if (args.length === 0) return '<<flash>>'
        if (args.length === 2 && isNum(args[1])) return `<<flash ${args[0]} ${args[1]}>>`
        break
      case 'fadeOut':
        if (args.length === 0) return '<<fadeout>>'
        if (args.length === 1 && isNum(args[0])) return `<<fadeout ${args[0]}>>`
        if (args.length === 2 && args[0].toLowerCase() === '#000000' && isNum(args[1])) return `<<fadeout ${args[1]}>>`
        break
      case 'fadeIn':
        if (args.length === 0) return '<<fadein>>'
        if (args.length === 1 && isNum(args[0])) return `<<fadein ${args[0]}>>`
        break
      case 'wait':
        if (args.length === 1 && isNum(args[0])) return `<<wait ${args[0]}>>`
        break
    }
  }
  return `<<js ${line}>>`
}

export function exportYarn(project: StoryProject): { text: string; warnings: string[] } {
  const warnings: string[] = []
  const { chains, nameOf } = planChains(project, { nameStyle: 'free' })

  // yarn 约定入口节点叫 Start：把第一条链整体重命名为 Start
  if (chains.length > 0) {
    const taken = new Set(nameOf.values())
    let startName = 'Start'
    let k = 2
    while (taken.has(startName)) startName = `Start_${k++}`
    for (const id of chains[0].steps) nameOf.set(id, startName)
  }

  const byId = new Map(project.nodes.map((n) => [n.id, n]))
  const vmap = varNameMap(project, 'free')
  const outsOf = (id: string) => project.edges.filter((e) => e.source === id)
  const assetName = (key?: string): string => (key ? (project.assets[key]?.name ?? '') : '')

  const blocks: string[] = []

  for (const chain of chains) {
    const lines: string[] = []

    for (const stepId of chain.steps) {
      const n = byId.get(stepId)!
      switch (n.type) {
        case 'start':
          break
        case 'dialogue': {
          const speaker = n.data.speaker?.trim()
          for (const raw of (n.data.text ?? '').split('\n')) {
            lines.push(speaker ? `${speaker}: ${raw}` : raw)
          }
          break
        }
        case 'choice': {
          const outs = outsOf(stepId)
          for (const o of n.data.options ?? []) {
            const e = outs.find((x) => (x.sourceHandle ?? null) === o.id)
            if (!e) {
              warnings.push(`选项「${o.text || '未命名'}」未连线，导出时已跳过。`)
              continue
            }
            const target = nameOf.get(e.target) ?? 'Missing'
            const link = `[[${o.text}|${target}]]`
            if (o.condition) {
              const vn = vmap.get(o.condition.variableId)
              if (!vn) {
                warnings.push(`选项条件引用了未知变量，已按无条件导出。`)
                lines.push(link)
              } else {
                lines.push(fmtCondition(o.condition, vn, 'yarn'))
                lines.push(link)
                lines.push('<<endif>>')
              }
            } else {
              lines.push(link)
            }
          }
          break
        }
        case 'variable': {
          for (const op of n.data.ops ?? []) {
            const vn = vmap.get(op.variableId)
            if (!vn) {
              warnings.push(`变量操作引用了未知变量，已跳过。`)
              continue
            }
            const sym = op.op === 'set' ? '=' : op.op === 'add' ? '+=' : '-='
            lines.push(`<<set $${vn} ${sym} ${fmtValue(op.value)}>>`)
          }
          break
        }
        case 'jump': {
          const e = outsOf(stepId)[0]
          if (e) lines.push(`<<jump ${nameOf.get(e.target) ?? 'Missing'}>>`)
          else warnings.push(`跳转点「${n.data.label || '未命名'}」没有去向，导出为悬空。`)
          break
        }
        case 'end':
          lines.push(`【完】${n.data.label?.trim() ?? ''}`.trimEnd())
          break
        case 'bg': {
          const name = assetName(n.data.asset)
          if (name) lines.push(`<<bg ${name}>>`)
          else warnings.push(`背景节点缺少素材，导出为注释。`), lines.push(`// <<bg 素材名>>`)
          break
        }
        case 'sprite': {
          const action = n.data.spriteAction ?? 'show'
          const pos = n.data.spritePos ?? 'center'
          const ch = n.data.character?.trim() ?? ''
          if (action === 'show') {
            const name = assetName(n.data.asset)
            const posTok = pos === 'custom' ? `x${Math.round(n.data.spriteX ?? 50)}` : pos
            if (name) lines.push(`<<sprite show ${name} ${posTok}${ch ? ` ${ch}` : ''}>>`)
            else warnings.push(`立绘节点缺少素材，导出为注释。`), lines.push(`// <<sprite show 立绘图 ${posTok}>>`)
          } else {
            lines.push(`<<sprite hide ${pos === 'custom' ? `x${Math.round(n.data.spriteX ?? 50)}` : pos}>>`)
          }
          break
        }
        case 'audio': {
          const kind = n.data.audioKind ?? 'bgm'
          const action = n.data.audioAction ?? 'play'
          if (action === 'stop') {
            lines.push(`<<audio ${kind} stop>>`)
          } else {
            const name = assetName(n.data.asset)
            if (name) {
              const loop = (n.data.loop ?? kind === 'bgm') ? ' loop' : ''
              lines.push(`<<audio ${kind} play ${name}${loop} ${n.data.volume ?? 80}>>`)
            } else warnings.push(`音频节点缺少素材，导出为注释。`), lines.push(`// <<audio ${kind} play 音频名>>`)
          }
          break
        }
        case 'script': {
          const codeLines = (n.data.code ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
          if (codeLines.length === 0) break
          for (const l of codeLines) lines.push(scriptLineToYarn(l))
          break
        }
      }
    }

    // 链尾：线性内容断在汇合点时补显式跳转；自然悬空即 yarn 语义的节点结束
    const lastId = chain.steps[chain.steps.length - 1]
    const lastNode = byId.get(lastId)!
    if (lastNode.type !== 'choice' && lastNode.type !== 'end' && lastNode.type !== 'jump') {
      const outs = outsOf(lastId)
      if (outs.length === 1) lines.push(`<<jump ${nameOf.get(outs[0].target) ?? 'Missing'}>>`)
    }

    const pos = chain.position
    blocks.push(
      [
        `title: ${nameOf.get(chain.steps[0]) ?? 'Node'}`,
        `tags:`,
        `position: ${Math.round(pos?.x ?? 0)},${Math.round(pos?.y ?? 0)}`,
        `color:`,
        `---`,
        ...(lines.length > 0 ? lines : [`//（空节点）`]),
        `===`
      ].join('\n')
    )
  }

  const header =
    `// 由 StoryLoom 导出的 Yarn 脚本。\n` +
    `// 多媒体演出导出为自定义命令：<<bg 名称>> / <<sprite show 名称 center 角色名>> / <<audio bgm play 名称 loop 80>>。\n` +
    `// 屏幕效果导出为：<<shake>> / <<flash>> / <<fadeout>> / <<fadein>> / <<wait 500>>，任意脚本行为 <<js …>>。\n` +
    `// 这些命令在其他 Yarn 运行时中会被忽略；重新导入 StoryLoom 时恢复为节点（素材需重新选取）。\n\n`

  return { text: header + blocks.join('\n\n') + '\n', warnings }
}

/** ---------- 导入 ---------- */

interface RawYarnNode {
  title: string
  position?: { x: number; y: number }
  body: string[]
}

export function parseYarn(text: string, opts: { metaTitle?: string } = {}): ImportResult {
  const warnings: string[] = []
  const rawNodes = splitYarnNodes(text)
  if (rawNodes.length === 0) {
    throw new Error('没有解析到任何 yarn 节点（文件格式可能不正确）。')
  }

  const used = new Set<string>()
  const varSeeds = new Map<string, VarSeed>()
  const chains: ScriptChain[] = []

  for (const rn of rawNodes) {
    const name = sanitizeTitle(rn.title || 'Node', 'Node', used)
    const segments = parseBody(rn.body, varSeeds, warnings)
    chains.push({ name, segments, position: rn.position })
  }

  const project = chainsToProject(chains, [...varSeeds.values()], {
    title: opts.metaTitle ?? '导入的 Yarn 故事',
    author: '',
    description: ''
  }, warnings)
  return { project, warnings }
}

function splitYarnNodes(text: string): RawYarnNode[] {
  const nodes: RawYarnNode[] = []
  let cur: RawYarnNode | null = null
  let inBody = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (/^===+\s*$/.test(line)) {
      if (cur) {
        nodes.push(cur)
        cur = null
        inBody = false
      }
      continue
    }
    if (!cur) {
      cur = { title: '', body: [] }
      inBody = false
    }
    if (!inBody) {
      if (/^-{3,}\s*$/.test(line)) {
        inBody = true
        continue
      }
      const kv = line.match(/^([A-Za-z_]+)\s*:\s*(.*)$/)
      if (kv) {
        if (kv[1] === 'title') cur.title = kv[2].trim()
        else if (kv[1] === 'position') {
          const p = kv[2].split(',').map((s) => Number(s.trim()))
          if (p.length >= 2 && p.every((n) => !isNaN(n))) cur.position = { x: p[0], y: p[1] }
        }
      }
      continue
    }
    cur.body.push(raw)
  }
  if (cur) nodes.push(cur)
  return nodes
}

function parseBody(lines: string[], varSeeds: Map<string, VarSeed>, warnings: string[]): Segment[] {
  const segments: Segment[] = []
  /** 条件栈（<<if>> 嵌套） */
  const condStack: ParsedOption['condition'][] = []
  let textAcc: { speaker: string; lines: string[] } | null = null
  let setAcc: ParsedSetOp[] = []
  let choiceAcc: ParsedOption[] = []
  let scriptAcc: string[] = []

  const flushText = (): void => {
    if (textAcc) {
      segments.push({ kind: 'text', speaker: textAcc.speaker, text: textAcc.lines.join('\n') })
      textAcc = null
    }
  }
  const flushSets = (): void => {
    if (setAcc.length > 0) {
      segments.push({ kind: 'set', ops: setAcc })
      setAcc = []
    }
  }
  const flushChoice = (): void => {
    if (choiceAcc.length > 0) {
      segments.push({ kind: 'choice', options: choiceAcc })
      choiceAcc = []
    }
  }
  const flushScript = (): void => {
    if (scriptAcc.length > 0) {
      segments.push({ kind: 'script', code: scriptAcc.join('\n') })
      scriptAcc = []
    }
  }
  const flushAll = (): void => {
    flushText()
    flushSets()
    flushChoice()
    flushScript()
  }
  const seedVar = (name: string, value: VarValue): void => {
    if (!varSeeds.has(name)) {
      varSeeds.set(name, {
        name,
        type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
        initial: value
      })
    }
  }

  /** 效果糖命令 / <<js …>> → 演出脚本行；其他命令原样保留（跨运行时互通）。
   *  wait/fadeOut/fadeIn 是异步接口，糖命令导入时补回 await 前缀。 */
  const scriptFromCommand = (line: string): string => {
    let m = line.match(/^<<shake(?:\s+([^ >]+))?(?:\s+([^ >]+))?\s*>>$/i)
    if (m) {
      const a = [m[1], m[2]].filter(Boolean) as string[]
      return `api.shake(${a.join(', ')})`
    }
    m = line.match(/^<<flash(?:\s+([^ >]+))?(?:\s+([^ >]+))?\s*>>$/i)
    if (m) {
      const a = [m[1], m[2]].filter(Boolean) as string[]
      if (a.length === 1 && isNum(a[0])) return `api.flash('#ffffff', ${a[0]})`
      return `api.flash(${a.map((x, i) => (i === 0 && !isNum(x) ? `'${x}'` : x)).join(', ')})`
    }
    m = line.match(/^<<fadeout(?:\s+(\d+))?\s*>>$/i)
    if (m) return m[1] ? `await api.fadeOut(${m[1]})` : 'await api.fadeOut()'
    m = line.match(/^<<fadein(?:\s+(\d+))?\s*>>$/i)
    if (m) return m[1] ? `await api.fadeIn(${m[1]})` : 'await api.fadeIn()'
    m = line.match(/^<<wait\s+(\d+)\s*>>$/i)
    if (m) return `await api.wait(${m[1]})`
    m = line.match(/^<<js\s+(.+?)\s*>>$/s)
    if (m) return m[1]
    return line.slice(2, -2).trim()
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('/*')) continue

    let m: RegExpMatchArray | null

    if ((m = line.match(/^<<if\s+(.+?)>>$/i))) {
      // 只断开文本/变量段；不 flush 选项，否则条件选项会被拆成多个选项组
      flushText()
      flushSets()
      flushScript()
      const cond = parseCondExpr(m[1], (n) => n)
      if (cond) condStack.push(cond)
      else warnings.push(`无法解析条件「${line}」，其中的选项将无条件显示。`)
      continue
    }
    if (/^<<else/i.test(line)) {
      warnings.push('<<else>> / <<elseif>> 暂不支持，块内内容按无条件处理。')
      continue
    }
    if (/^<<endif/i.test(line)) {
      condStack.pop()
      continue
    }
    if ((m = line.match(new RegExp(`^<<set\\s+\\$(${V})\\s*(=|\\+=|-=)\\s*(.+?)>>$`, 'i')))) {
      flushText()
      flushChoice()
      flushScript()
      const name = m[1]
      const sym = m[2] as '=' | '+=' | '-='
      const expr = m[3].trim()
      // <<set $x = $x + 2>> 归一为 add/sub
      const self = expr.match(new RegExp(`^\\$(${V})\\s*([+-])\\s*(.+)$`))
      let op: AssignOp = sym === '=' ? 'set' : sym === '+=' ? 'add' : 'sub'
      let value: VarValue = parseValueToken(expr)
      if (op === 'set' && self && self[1] === name) {
        op = self[2] === '+' ? 'add' : 'sub'
        value = parseValueToken(self[3])
      }
      setAcc.push({ variable: name, op, value })
      seedVar(name, op === 'set' ? value : typeof value === 'number' ? value : 0)
      continue
    }
    if ((m = line.match(/^<<jump\s+(.+?)>>$/i))) {
      flushAll()
      segments.push({ kind: 'jump', target: m[1].trim() })
      continue
    }
    // StoryLoom 导出的结局标记：【完】结局名
    if ((m = line.match(/^【完】\s*(.*)$/))) {
      flushAll()
      segments.push({ kind: 'end', label: m[1].trim() })
      continue
    }
    if ((m = line.match(/^<<bg\s+(.+?)>>$/i))) {
      flushAll()
      segments.push({ kind: 'bg', asset: '' })
      warnings.push(`背景命令 <<bg ${m[1]}>> 已转为背景节点（素材需重新选取）。`)
      continue
    }
    if ((m = line.match(/^<<sprite\s+show\s+(\S+?)(?:\s+(left|center|right|x\d+))?(?:\s+([^>]+?))?>>$/i))) {
      flushAll()
      const posTok = m[2]?.toLowerCase()
      segments.push({
        kind: 'sprite',
        asset: '',
        action: 'show',
        pos: posTok?.startsWith('x') ? 'custom' : ((posTok as 'left' | 'center' | 'right') ?? 'center'),
        x: posTok?.startsWith('x') ? Math.max(0, Math.min(100, Number(posTok.slice(1)) || 0)) : undefined,
        character: m[3]?.trim() ?? ''
      })
      warnings.push(`立绘命令已转为立绘节点（素材需重新选取）。`)
      continue
    }
    if ((m = line.match(/^<<sprite\s+hide(?:\s+(left|center|right|x\d+))?\s*>>$/i))) {
      flushAll()
      const posTok = m[1]?.toLowerCase()
      segments.push({
        kind: 'sprite',
        asset: '',
        action: 'hide',
        pos: posTok?.startsWith('x') ? 'custom' : ((posTok as 'left' | 'center' | 'right') ?? 'center'),
        x: posTok?.startsWith('x') ? Math.max(0, Math.min(100, Number(posTok.slice(1)) || 0)) : undefined,
        character: ''
      })
      continue
    }
    if ((m = line.match(/^<<audio\s+(bgm|sfx)\s+(play|stop)(?:\s+(\S+))?(?:\s+(loop))?(?:\s+(\d+))?\s*>>$/i))) {
      flushAll()
      segments.push({
        kind: 'audio',
        audioKind: m[1].toLowerCase() as 'bgm' | 'sfx',
        action: m[2].toLowerCase() as 'play' | 'stop',
        asset: '',
        loop: !!m[4],
        volume: m[5] ? Math.max(0, Math.min(100, Number(m[5]))) : 80
      })
      if (m[3]) warnings.push(`音频命令已转为音频节点（素材需重新选取）。`)
      continue
    }
    if ((m = line.match(/^\[\[(.+)\]\]$/))) {
      flushText()
      flushSets()
      flushScript()
      const inner = m[1]
      let text: string
      let target: string | null
      if (inner.includes('|')) {
        const [t, tt] = splitOnce(inner, '|')
        text = t.trim()
        target = tt.trim() || null
      } else if (inner.includes('->')) {
        const [t, tt] = splitOnce(inner, '->')
        text = t.trim()
        target = tt.trim() || null
      } else if (inner.includes('<-')) {
        const [tt, t] = splitOnce(inner, '<-')
        text = t.trim()
        target = tt.trim() || null
      } else {
        text = inner.trim()
        target = inner.trim()
      }
      choiceAcc.push({ text, condition: condStack[condStack.length - 1] ?? null, target })
      continue
    }
    if (/^<<.+>>$/.test(line)) {
      // 命令（效果糖 / js / 其他运行时自定义命令）→ 演出脚本节点；连续命令合并
      flushText()
      flushSets()
      const cmd = scriptFromCommand(line)
      scriptAcc.push(cmd)
      if (!cmd.startsWith('api.') && !/^<<js /i.test(line)) {
        warnings.push(`命令「${line}」已保留为演出脚本行。`)
      }
      continue
    }

    // 普通文本行（「说话人： 内容」前缀识别）
    const sp = splitSpeaker(line)
    if (textAcc && textAcc.speaker === sp.speaker) textAcc.lines.push(sp.text)
    else {
      // 先清空此前积压的脚本/变量段，保证段落顺序与文本顺序一致
      flushScript()
      flushSets()
      flushText()
      flushChoice()
      textAcc = { speaker: sp.speaker, lines: [sp.text] }
    }
  }
  flushAll()
  return segments
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep)
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + sep.length)]
}

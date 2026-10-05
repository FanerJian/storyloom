/**
 * Ink 脚本格式导入导出（实用子集）。
 *
 * 支持的语法：
 * - `=== knot ===` 与 `= stitch`（stitch 按独立节点处理）
 * - 文本行、`* / +` 选项（含 `{条件}` 与 `[抑制显示]`）、`- ` gather
 * - `-> divert`、`-> END` / `-> DONE`
 * - `VAR name = value` 与 `~ name = / += / -= value`
 * - 行注释（双斜线）与块注释（斜线星号）
 *
 * 不支持（导入时告警并近似处理）：weave 嵌套、inline 分支 `{a: x|b: y}`、
 * 函数/列表/隧道/线程、标签。
 */
import type { AssignOp, StoryProject, VarValue } from '../schema'
import {
  chainsToProject,
  fmtCondition,
  fmtValue,
  parseCondExpr,
  parseValueToken,
  planChains,
  sanitizeIdent,
  splitSpeaker,
  varNameMap,
  type ImportResult,
  type ParsedOption,
  type ParsedSetOp,
  type ScriptChain,
  type Segment,
  type VarSeed
} from './common'

export function exportInk(project: StoryProject): { text: string; warnings: string[] } {
  const warnings: string[] = []
  const { chains, nameOf } = planChains(project)
  const byId = new Map(project.nodes.map((n) => [n.id, n]))
  const vmap = varNameMap(project)
  const outsOf = (id: string) => project.edges.filter((e) => e.source === id)
  const assetName = (key?: string): string => (key ? (project.assets[key]?.name ?? '') : '')

  const escapeText = (s: string): string => s.replace(/^([*+\-~=>\s]+)/, (m) => m.replace(/\S/g, (ch) => `\\${ch}`))

  const varLines = project.variables.map((v) => {
    const name = vmap.get(v.id) ?? `var${v.id}`
    return `VAR ${name} = ${fmtValue(v.initial)}`
  })

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
            lines.push(escapeText(speaker ? `${speaker}: ${raw}` : raw))
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
            const cond =
              o.condition && vmap.get(o.condition.variableId)
                ? `${fmtCondition(o.condition, vmap.get(o.condition.variableId)!, 'ink')} `
                : o.condition
                  ? (warnings.push(`选项条件引用了未知变量，已按无条件导出。`), '')
                  : ''
            lines.push(`* ${cond}[${o.text}] -> ${target}`)
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
            lines.push(`~ ${vn} ${sym} ${fmtValue(op.value)}`)
          }
          break
        }
        case 'jump': {
          const e = outsOf(stepId)[0]
          if (e) lines.push(`-> ${nameOf.get(e.target) ?? 'Missing'}`)
          else warnings.push(`跳转点「${n.data.label || '未命名'}」没有去向，已导出为 END。`), lines.push(`-> END`)
          break
        }
        case 'end': {
          // 与 Yarn 导出共用【完】标记，导入端识别为结局节点
          lines.push(`【完】${n.data.label?.trim() ?? ''}`.trimEnd())
          lines.push(`-> END`)
          break
        }
        case 'bg':
          lines.push(`// [背景] ${assetName(n.data.asset) || '（未选取素材）'}`)
          warnings.push(`Ink 无多媒体标准语法，背景节点导出为注释。`)
          break
        case 'sprite': {
          const a = n.data.spriteAction ?? 'show'
          lines.push(
            a === 'show'
              ? `// [立绘·${a}] ${assetName(n.data.asset)} ${n.data.spritePos ?? 'center'} ${n.data.character?.trim() ?? ''}`
              : `// [立绘·隐藏] ${n.data.spritePos ?? 'center'}`
          )
          warnings.push(`Ink 无多媒体标准语法，立绘节点导出为注释。`)
          break
        }
        case 'audio':
          lines.push(
            `// [音频] ${n.data.audioKind ?? 'bgm'} ${n.data.audioAction ?? 'play'} ${assetName(n.data.asset)}`
          )
          warnings.push(`Ink 无多媒体标准语法，音频节点导出为注释。`)
          break
        case 'script': {
          const codeLines = (n.data.code ?? '').split('\n').filter((l) => l.trim())
          lines.push('// [演出]')
          for (const l of codeLines) lines.push(`// ${l}`)
          if (codeLines.length > 0) warnings.push(`Ink 无演出脚本标准语法，脚本代码导出为注释。`)
          break
        }
      }
    }

    // 链尾：线性内容断在汇合点时补显式 divert
    const lastId = chain.steps[chain.steps.length - 1]
    const lastNode = byId.get(lastId)!
    if (lastNode.type !== 'choice' && lastNode.type !== 'end' && lastNode.type !== 'jump') {
      const outs = outsOf(lastId)
      if (outs.length === 1) lines.push(`-> ${nameOf.get(outs[0].target) ?? 'Missing'}`)
    }

    blocks.push(
      [`=== ${nameOf.get(chain.steps[0]) ?? 'Node'} ===`, ...(lines.length > 0 ? lines : [`//（空节点）`])].join('\n')
    )
  }

  const entryChain = chains[0] ? (nameOf.get(chains[0].steps[0]) ?? null) : null
  const entry = entryChain ? [`-> ${entryChain}`] : []

  const header = `// 由 FableLoom 导出的 Ink 脚本（子集）。\n// 多媒体演出无法用 Ink 表达，导出为注释；Yarn 格式支持多媒体命令。\n\n`

  return {
    text: header + [...varLines, ...entry, '', ...blocks].join('\n\n') + '\n',
    warnings
  }
}

/** ---------- 导入 ---------- */

export function parseInk(text: string, opts: { metaTitle?: string } = {}): ImportResult {
  const warnings: string[] = []
  const varSeeds = new Map<string, VarSeed>()
  const chains: ScriptChain[] = []
  const used = new Set<string>()

  let cur: ScriptChain | null = null
  const condStack: ParsedOption['condition'][] = []
  let textAcc: { speaker: string; lines: string[] } | null = null
  let setAcc: ParsedSetOp[] = []
  let choiceAcc: ParsedOption[] = []
  let nestedWarned = false

  const flushText = (): void => {
    if (textAcc) {
      segments().push({ kind: 'text', speaker: textAcc.speaker, text: textAcc.lines.join('\n') })
      textAcc = null
    }
  }
  const flushSets = (): void => {
    if (setAcc.length > 0) {
      segments().push({ kind: 'set', ops: setAcc })
      setAcc = []
    }
  }
  const flushChoice = (): void => {
    if (choiceAcc.length > 0) {
      segments().push({ kind: 'choice', options: choiceAcc })
      choiceAcc = []
    }
  }
  const flushAll = (): void => {
    flushText()
    flushSets()
    flushChoice()
  }
  const segments = (): Segment[] => {
    if (!cur) {
      cur = { name: sanitizeIdent('Top', 'Node', used), segments: [] }
      chains.push(cur)
    }
    return cur.segments
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

  // 去注释（不处理字符串里的 //，MVP 足够）
  const stripped = text
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const lines = stripped.split(/\r?\n/)
  let knotSeq = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      // 空行：段落分隔，结束当前文本聚合
      flushText()
      continue
    }
    if (/^\r?$/.test(line)) continue

    // knot / stitch 标题
    let m: RegExpMatchArray | null
    if ((m = line.match(/^(=+)\s*(.+?)\s*=*$/))) {
      flushAll()
      const rawName = m[2]
      const name = sanitizeIdent(rawName.replace(/\./g, '_') || `knot${++knotSeq}`, 'Node', used)
      cur = { name, segments: [] }
      chains.push(cur)
      continue
    }

    if ((m = line.match(/^VAR\s+([A-Za-z_]\w*)\s*=\s*(.+)$/))) {
      const value = parseValueToken(m[2])
      seedVar(m[1], value)
      continue
    }
    if ((m = line.match(/^~\s*([A-Za-z_]\w*)\s*(\+=|-=|=)\s*(.+)$/))) {
      flushText()
      flushChoice()
      const sym = m[2] as '=' | '+=' | '-='
      const op: AssignOp = sym === '=' ? 'set' : sym === '+=' ? 'add' : 'sub'
      const self = m[3].trim().match(/^([A-Za-z_]\w*)\s*([+-])\s*(.+)$/)
      if (op === 'set' && self && self[1] === m[1]) {
        setAcc.push({
          variable: m[1],
          op: self[2] === '+' ? 'add' : 'sub',
          value: parseValueToken(self[3])
        })
      } else {
        setAcc.push({ variable: m[1], op, value: parseValueToken(m[3]) })
      }
      continue
    }

    // divert 行（整行）
    if ((m = line.match(/^->\s*(.+)$/))) {
      flushAll()
      const t = m[1].trim()
      if (/^END(\s|$)/.test(t) || t === 'DONE') {
        const segs = segments()
        const prev = segs[segs.length - 1]
        // 【完】结局后紧跟的 -> END 不重复生成结束节点
        if (!prev || prev.kind !== 'end') segs.push({ kind: 'end', label: '' })
      } else {
        segments().push({ kind: 'jump', target: t })
      }
      continue
    }

    // FableLoom 导出的结局标记：【完】结局名
    if ((m = line.match(/^【完】\s*(.*)$/))) {
      flushAll()
      segments().push({ kind: 'end', label: m[1].trim() })
      continue
    }

    // 选项行
    if (/^[*+]\s/.test(line) || line === '*' || line === '+') {
      flushText()
      flushSets()
      if (/^\s/.test(rawLine) && !nestedWarned) {
        nestedWarned = true
        warnings.push('检测到嵌套 weave，已按平铺结构导入（语义可能略有差异）。')
      }
      let rest = line.replace(/^[*+]\s*/, '')
      let condition: ParsedOption['condition'] = null
      const condM = rest.match(/^\{([^}]+)\}\s*/)
      if (condM) {
        condition = parseCondExpr(condM[1], (n) => n)
        if (!condition) warnings.push(`无法解析选项条件「${condM[1]}」，按无条件处理。`)
        rest = rest.slice(condM[0].length)
      }
      let choiceText = ''
      let target: string | null = null
      const bracket = rest.match(/^\[(.+?)\]\s*(->\s*(.+))?$/)
      if (bracket) {
        choiceText = bracket[1].trim()
        target = bracket[3]?.trim() ?? null
      } else {
        const div = rest.match(/^(.*?)\s*->\s*(.+)$/)
        if (div) {
          choiceText = div[1].replace(/^\[|\]$/g, '').trim()
          target = div[2].trim()
        } else {
          choiceText = rest.replace(/^\[(.+)\]$/, '$1').trim()
          target = null
        }
      }
      const t = target && (target === 'END' || target === 'DONE') ? null : target
      if (target && !t) {
        // 选项直达 END：给一个空文本目标占位，chainsToProject 会为未知目标生成结束节点
        choiceAcc.push({ text: choiceText, condition, target: null })
        warnings.push(`选项「${choiceText}」直接 -> END，未连线。`)
      } else {
        choiceAcc.push({ text: choiceText, condition, target: t })
      }
      continue
    }

    // gather 行 `- text`（不匹配 `->` divert）
    if ((m = line.match(/^-\s+(.+)$/)) && !line.startsWith('->')) {
      flushAll()
      const g = m[1]
      const div = g.match(/^(.*?)\s*->\s*(.+)$/)
      if (div) {
        segments().push({ kind: 'text', speaker: splitSpeaker(div[1]).speaker, text: splitSpeaker(div[1]).text })
        const t = div[2].trim()
        if (t === 'END' || t === 'DONE') segments().push({ kind: 'end', label: '' })
        else segments().push({ kind: 'jump', target: t })
      } else {
        const sp = splitSpeaker(g)
        textAcc = { speaker: sp.speaker, lines: [sp.text] }
      }
      continue
    }

    // inline 条件 {cond: text}：取主干，告警
    if ((m = line.match(/^\{[^:}]+:\s*(.+)\}$/))) {
      warnings.push('inline 条件分支 {cond: 文本} 暂不支持，已取主文本。')
      textAcc = { speaker: '', lines: [m[1]] }
      flushText()
      continue
    }

    // 普通文本行
    const sp = splitSpeaker(line.replace(/^\\/, '').replace(/^>\s*/, ''))
    if (textAcc && textAcc.speaker === sp.speaker) textAcc.lines.push(sp.text)
    else {
      // 先清空此前积压的变量段，保证段落顺序与文本顺序一致
      flushSets()
      flushText()
      flushChoice()
      textAcc = { speaker: sp.speaker, lines: [sp.text] }
    }
  }
  flushAll()

  if (chains.length === 0) {
    throw new Error('没有解析到任何 Ink 内容（文件格式可能不正确）。')
  }

  const project = chainsToProject(chains, [...varSeeds.values()], {
    title: opts.metaTitle ?? '导入的 Ink 故事',
    author: '',
    description: ''
  }, warnings)
  return { project, warnings }
}

/**
 * Ink / Yarn 导入导出共享工具。
 *
 * 两种脚本格式的共同结构：一段线性内容（对白/变量/媒体）后跟分支（选项）或
 * 显式跳转。节点图 → 脚本时把「线性链」合并为一个脚本节点，在选项/跳转/终点/
 * 汇合点断开；脚本 → 节点图时把每个脚本节点展开为一段节点链。
 */
import {
  uid,
  type AssignOp,
  type Condition,
  type CompareOp,
  type StoryEdge,
  type StoryNode,
  type StoryProject,
  type VarType,
  type VarValue
} from '../schema'

/** 脚本里解析出的一段内容 */
export type Segment =
  | { kind: 'text'; speaker: string; text: string }
  | { kind: 'set'; ops: ParsedSetOp[] }
  | { kind: 'choice'; options: ParsedOption[] }
  | { kind: 'jump'; target: string }
  | { kind: 'bg'; asset: string }
  | {
      kind: 'sprite'
      asset: string
      character: string
      pos: 'left' | 'center' | 'right' | 'custom'
      /** pos === 'custom' 时的水平位置（0-100） */
      x?: number
      action: 'show' | 'hide'
    }
  | {
      kind: 'audio'
      audioKind: 'bgm' | 'sfx'
      action: 'play' | 'stop'
      asset: string
      loop: boolean
      volume: number
    }
  | { kind: 'script'; code: string }
  | { kind: 'end'; label: string }

export interface ParsedSetOp {
  variable: string
  op: AssignOp
  value: VarValue
}

export interface ParsedOption {
  text: string
  condition: Condition | null
  /** 脚本里的跳转目标名；null 表示落到后续 gather（或无去向） */
  target: string | null
}

/** 一个脚本节点（knot / yarn node）展开前的中间表示 */
export interface ScriptChain {
  name: string
  segments: Segment[]
  position?: { x: number; y: number }
}

export interface VarSeed {
  name: string
  type: VarType
  initial: VarValue
}

export interface ImportResult {
  project: StoryProject
  warnings: string[]
}

/** ---------- 值与条件的序列化/解析 ---------- */

export function fmtValue(v: VarValue): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function parseValueToken(tok: string): VarValue {
  const t = tok.trim()
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (t === 'true') return true
  if (t === 'false') return false
  const q = t.match(/^"(.*)"$/s)
  if (q) return q[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  return t
}

export function fmtCondition(c: Condition, varName: string, style: 'yarn' | 'ink'): string {
  const val = typeof c.value === 'string' ? fmtValue(c.value) : String(c.value)
  return style === 'yarn' ? `<<if $${varName} ${c.op} ${val}>>` : `{${varName} ${c.op} ${val}}`
}

/** 标识符（含中文，yarn 变量名/条件解析用） */
const IDENT_P = '[A-Za-z_\\u4e00-\\u9fff][A-Za-z0-9_\\u4e00-\\u9fff]*'

/** 解析 `name op value` 形式的条件表达式；裸变量视为 != 0 */
export function parseCondExpr(expr: string, ensureVar: (name: string) => string): Condition | null {
  const e = expr.trim().replace(/^\$/, '')
  const m = e.match(new RegExp(`^(${IDENT_P})\\s*(==|!=|>=|<=|>|<)\\s*(.+)$`))
  if (m) {
    return { variableId: ensureVar(m[1]), op: m[2] as CompareOp, value: parseValueToken(m[3]) }
  }
  if (new RegExp(`^${IDENT_P}$`).test(e)) {
    return { variableId: ensureVar(e), op: '!=', value: 0 }
  }
  return null
}

/** ---------- 标识符清理 ---------- */

/** ink 标识符（ASCII）；yarn 用 sanitizeTitle（可含中文） */
export function sanitizeIdent(raw: string, fallback: string, used: Set<string>): string {
  let base = raw.replace(/[^A-Za-z0-9_]/g, '')
  if (!base || /^\d/.test(base)) base = fallback
  let name = base
  let i = 2
  while (used.has(name)) name = `${base}_${i++}`
  used.add(name)
  return name
}

/** 自由命名（yarn 标题/变量名允许中文）：去掉空白与命令敏感字符 */
export function sanitizeTitle(raw: string, fallback: string, used: Set<string>): string {
  let base = raw.replace(/\s+/g, '').replace(/[[\]{}|<>=!<>+\-*/]/g, '')
  if (!base) base = fallback
  let name = base
  let i = 2
  while (used.has(name)) name = `${base}_${i++}`
  used.add(name)
  return name
}

/** 「店家： 你好」→ { speaker: '店家', text: '你好' }；说话人不能以数字开头（避免误判时间） */
export function splitSpeaker(line: string): { speaker: string; text: string } {
  const m = line.match(/^([^\d:：][^:：]{0,14})[:：]\s*(.+)$/)
  if (m) return { speaker: m[1].trim(), text: m[2] }
  return { speaker: '', text: line }
}

/** 工程变量 → 脚本标识符映射。ascii 用于 ink；free 保留中文（yarn） */
export function varNameMap(project: StoryProject, style: 'ascii' | 'free' = 'ascii'): Map<string, string> {
  const used = new Set<string>()
  const map = new Map<string, string>()
  project.variables.forEach((v, i) => {
    const raw = v.name || `var${i + 1}`
    map.set(v.id, style === 'free' ? sanitizeTitle(raw, 'var', used) : sanitizeIdent(raw, 'var', used))
  })
  return map
}

/** ---------- 节点图 → 脚本链计划 ---------- */

export interface ChainPlan {
  /** 每条链的节点 id 序列（第一条链从 start 的目标开始） */
  chains: { steps: string[]; position?: { x: number; y: number } }[]
  /** 节点 id → 脚本节点名 */
  nameOf: Map<string, string>
}

/**
 * 把节点图切成脚本链：线性段合并，在选项/跳转/终点/汇合点断开。
 * 每个节点恰好属于一条链。nameStyle 决定脚本节点名风格：
 * ascii（ink，标识符）或 free（yarn，可含中文）。
 */
export function planChains(project: StoryProject, opts: { nameStyle?: 'ascii' | 'free' } = {}): ChainPlan {
  const nameStyle = opts.nameStyle ?? 'ascii'
  const byId = new Map<string, StoryNode>(project.nodes.map((n) => [n.id, n]))
  const out = new Map<string, StoryEdge[]>()
  const inDeg = new Map<string, number>()
  for (const e of project.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue
    if (!out.has(e.source)) out.set(e.source, [])
    out.get(e.source)!.push(e)
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1)
  }

  const visited = new Set<string>()
  const chains: ChainPlan['chains'] = []

  const walk = (seed: string): void => {
    const steps: string[] = []
    let cur: string | null = seed
    while (cur && byId.has(cur) && !visited.has(cur)) {
      const node = byId.get(cur)!
      visited.add(cur)
      steps.push(cur)
      // 选项/终点/跳转处断链：选项逐条 divert，跳转显式 divert
      if (node.type === 'choice' || node.type === 'end' || node.type === 'jump') break
      const outs: StoryEdge[] = out.get(cur) ?? []
      if (outs.length !== 1) break
      const next: string = outs[0].target
      // 汇合点（多入边）另起一条链
      if ((inDeg.get(next) ?? 0) !== 1) break
      cur = next
    }
    if (steps.length > 0) {
      chains.push({ steps, position: byId.get(steps[0])!.position })
    }
  }

  const start = project.nodes.find((n) => n.type === 'start')
  const startTarget = start ? (out.get(start.id) ?? [])[0]?.target : undefined
  if (startTarget) walk(startTarget)

  // 未访问的节点（汇合点、断开子图）各自成链
  for (const n of project.nodes) {
    if (n.type === 'start') continue
    if (!visited.has(n.id)) walk(n.id)
  }

  // 命名：对白取文本摘要，其余按类型
  const used = new Set<string>()
  const nameOf = new Map<string, string>()
  const nameOfRaw = (base: string, fallback: string): string =>
    nameStyle === 'free' ? sanitizeTitle(base, fallback, used) : sanitizeIdent(base, fallback, used)
  const baseOf = (id: string): string => {
    const n = byId.get(id)!
    switch (n.type) {
      case 'dialogue': {
        const t = (n.data.speaker?.trim() || n.data.text?.trim() || '').split('\n')[0].trim()
        return t ? t.slice(0, 16) : 'Scene'
      }
      case 'choice':
        return 'Choice'
      case 'variable':
        return 'SetVars'
      case 'jump':
        return n.data.label?.trim() || 'Jump'
      case 'end':
        return n.data.label?.trim() || 'End'
      case 'bg':
        return 'Backdrop'
      case 'sprite':
        return 'Sprite'
      case 'audio':
        return 'Audio'
      case 'script':
        return 'Fx'
      case 'start':
        return 'Start'
    }
  }
  for (const chain of chains) {
    // 一条链就是一个脚本节点：链内所有节点共享链首的名字（链名 = 首节点名）
    const name = nameOfRaw(baseOf(chain.steps[0]), 'Node')
    for (const id of chain.steps) {
      nameOf.set(id, name)
    }
  }

  return { chains, nameOf }
}

/** ---------- 脚本链 → 节点图 ---------- */

/**
 * 把解析出的脚本链组装为工程（两阶段）。
 * 第一阶段：展开每条链为节点序列，串起链内线性连线；
 * 第二阶段：全部链建完后统一解析跨链目标（选项/跳转），并补「开始」节点。
 * 未知目标生成占位结束节点；链尾悬空的线性内容接入共享「结束」节点。
 */
export function chainsToProject(
  chains: ScriptChain[],
  varSeeds: VarSeed[],
  meta: StoryProject['meta'],
  warnings: string[]
): StoryProject {
  const project: StoryProject = {
    version: 3,
    meta,
    assets: {},
    customCss: '',
    customJs: '',
    variables: [],
    nodes: [],
    edges: []
  }

  // 变量表：先放入声明的种子；遇到未声明变量自动补数字 0
  const ensureVar = (name: string): string => {
    const found = project.variables.find((v) => v.name === name)
    if (found) return found.id
    const id = uid('v_')
    project.variables.push({ id, name, type: 'number', initial: 0 })
    warnings.push(`变量「${name}」未声明，已按数字 0 处理。`)
    return id
  }
  for (const seed of varSeeds) {
    if (!project.variables.some((v) => v.name === seed.name)) {
      project.variables.push({ id: uid('v_'), name: seed.name, type: seed.type, initial: seed.initial })
    }
  }

  const firstNodeOf = new Map<string, string>()

  const placeholderEnds = new Map<string, string>()
  const resolveTarget = (name: string): string => {
    const known = firstNodeOf.get(name)
    if (known) return known
    let endId = placeholderEnds.get(name)
    if (!endId) {
      endId = uid('n_')
      placeholderEnds.set(name, endId)
      project.nodes.push({ id: endId, type: 'end', position: { x: 0, y: 0 }, data: { label: name } })
      warnings.push(`跳转目标「${name}」在脚本中未定义，已生成占位结束节点。`)
    }
    return endId
  }

  let endNodeId: string | null = null
  const sharedEnd = (): string => {
    if (!endNodeId) {
      endNodeId = uid('n_')
      project.nodes.push({ id: endNodeId, type: 'end', position: { x: 0, y: 0 }, data: { label: '结束' } })
    }
    return endNodeId
  }

  /**
   * 第二阶段待执行的连线任务。
   * id 直连；name 为脚本链名，需在第二阶段（全部链建完）再解析，
   * 否则前向跳转会误判为未定义。
   */
  type Link = { source: string; handle: string | null; id?: string; name?: string }
  const links: Link[] = []
  const link = (source: string, handle: string | null, target: string): void => {
    links.push({ source, handle, id: target })
  }
  const linkByName = (source: string, handle: string | null, name: string): void => {
    links.push({ source, handle, name })
  }

  // ---- 第一阶段：建节点 + 链内线性连线 ----
  chains.forEach((chain, ci) => {
    if (chain.segments.length === 0) return
    const bx = chain.position?.x ?? (ci % 4) * 300
    const by = chain.position?.y ?? Math.floor(ci / 4) * 220

    const created: string[] = []
    let prev: string | null = null
    let prevIsChoice = false

    chain.segments.forEach((seg, si) => {
      const pos = { x: bx + (si % 6) * 46, y: by + si * 130 }
      let nodeId: string

      if (seg.kind === 'text') {
        nodeId = uid('n_')
        project.nodes.push({
          id: nodeId,
          type: 'dialogue',
          position: pos,
          data: { speaker: seg.speaker, text: seg.text }
        })
      } else if (seg.kind === 'set') {
        nodeId = uid('n_')
        project.nodes.push({
          id: nodeId,
          type: 'variable',
          position: pos,
          data: {
            ops: seg.ops.map((o) => ({
              id: uid('op_'),
              variableId: ensureVar(o.variable),
              op: o.op,
              value: o.value
            }))
          }
        })
      } else if (seg.kind === 'choice') {
        nodeId = uid('n_')
        project.nodes.push({
          id: nodeId,
          type: 'choice',
          position: pos,
          data: {
            options: seg.options.map((o) => ({
              id: uid('o_'),
              text: o.text,
              // 导入时条件里的 variableId 是变量名，这里统一解析成内部变量 id
              condition: o.condition
                ? { ...o.condition, variableId: ensureVar(o.condition.variableId) }
                : null
            }))
          }
        })
      } else if (seg.kind === 'bg') {
        nodeId = uid('n_')
        project.nodes.push({ id: nodeId, type: 'bg', position: pos, data: { asset: '' } })
      } else if (seg.kind === 'sprite') {
        nodeId = uid('n_')
        project.nodes.push({
          id: nodeId,
          type: 'sprite',
          position: pos,
          data: { asset: '', character: seg.character, spritePos: seg.pos, spriteX: seg.x, spriteAction: seg.action }
        })
      } else if (seg.kind === 'audio') {
        nodeId = uid('n_')
        project.nodes.push({
          id: nodeId,
          type: 'audio',
          position: pos,
          data: {
            asset: '',
            audioKind: seg.audioKind,
            audioAction: seg.action,
            loop: seg.loop,
            volume: seg.volume
          }
        })
      } else if (seg.kind === 'script') {
        nodeId = uid('n_')
        project.nodes.push({ id: nodeId, type: 'script', position: pos, data: { code: seg.code } })
      } else if (seg.kind === 'end') {
        nodeId = uid('n_')
        project.nodes.push({ id: nodeId, type: 'end', position: pos, data: { label: seg.label } })
      } else {
        nodeId = uid('n_')
        project.nodes.push({ id: nodeId, type: 'jump', position: pos, data: { label: seg.target } })
      }

      created.push(nodeId)
      if (!firstNodeOf.has(chain.name)) firstNodeOf.set(chain.name, nodeId)

      if (prev && !prevIsChoice) {
        // 链中段的 jump 是显式 divert，不连向下一段
        const prevSeg = chain.segments[si - 1]
        if (prevSeg.kind !== 'jump') {
          link(prev, null, nodeId)
        }
      }
      prev = nodeId
      prevIsChoice = seg.kind === 'choice'
    })

    // 链中段的 jump → 显式目标
    chain.segments.forEach((seg, si) => {
      if (seg.kind !== 'jump' || si === chain.segments.length - 1) return
      linkByName(created[si], null, seg.target)
    })

    // 选项连线：有 divert 连目标；无 divert 且链有后续内容则连到 gather；否则告警
    chain.segments.forEach((seg, si) => {
      if (seg.kind !== 'choice') return
      const cId = created[si]
      const cNode = project.nodes.find((n) => n.id === cId)
      const options = cNode?.data.options ?? []
      const gatherFirst = si < chain.segments.length - 1 ? created[si + 1] : null
      seg.options.forEach((o, oi) => {
        const handle = options[oi]?.id ?? null
        if (o.target) linkByName(cId, handle, o.target)
        else if (gatherFirst) link(cId, handle, gatherFirst)
        else warnings.push(`链「${chain.name}」的选项「${o.text || '未命名'}」没有跳转目标，未连线。`)
      })
    })

    // 链尾去向
    const lastIdx = chain.segments.length - 1
    const last = chain.segments[lastIdx]
    const lastId = created[lastIdx]
    if (last.kind === 'jump') {
      linkByName(lastId, null, last.target)
    } else if (last.kind !== 'choice' && last.kind !== 'end') {
      // 文本/变量/媒体节点悬空时接入共享「结束」节点
      link(lastId, null, sharedEnd())
    }
  })

  // ---- 第二阶段：跨链目标已可解析，执行全部连线 ----
  for (const l of links) {
    const target = l.id ?? resolveTarget(l.name!)
    project.edges.push({ id: uid('e_'), source: l.source, sourceHandle: l.handle, target })
  }

  // 脚本没有「开始」概念，补一个入口连到第一条链
  if (chains.length > 0 && !project.nodes.some((n) => n.type === 'start')) {
    const firstTarget = chains.map((c) => firstNodeOf.get(c.name)).find(Boolean)
    if (firstTarget) {
      const startId = uid('n_')
      project.nodes.push({ id: startId, type: 'start', position: { x: -220, y: 80 }, data: {} })
      project.edges.push({ id: uid('e_'), source: startId, sourceHandle: null, target: firstTarget })
    }
  }

  // 占位/共享结束节点铺开摆放，避免叠在 (0,0)
  let endSeq = 0
  for (const n of project.nodes) {
    if (n.type === 'end' && n.position.x === 0 && n.position.y === 0) {
      n.position = { x: 80 + (endSeq % 3) * 220, y: 60 + Math.floor(endSeq / 3) * 150 }
      endSeq++
    }
  }

  return project
}

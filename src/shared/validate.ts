import type { StoryProject, StoryNode } from './schema'

export type IssueLevel = 'error' | 'warn' | 'info'

export interface Issue {
  id: string
  level: IssueLevel
  message: string
  nodeId?: string
}

/** 不需要玩家交互、运行时自动通过的节点（bg/sprite/audio 为视觉小说演出节点，script 为自定义演出脚本） */
export const AUTO_TYPES = ['start', 'variable', 'jump', 'bg', 'sprite', 'audio', 'script']

/** 校验输入：核心四字段必填，其余（version/assets/custom*）可选 */
export type ValidateInput = Pick<StoryProject, 'meta' | 'variables' | 'nodes' | 'edges'> & Partial<StoryProject>

/**
 * 剧情静态校验。返回问题列表（按严重度排序），供「检查」面板展示。
 */
export function validateProject(project: ValidateInput): Issue[] {
  const issues: Issue[] = []
  const { nodes, edges, variables } = project
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let seq = 0
  const push = (level: IssueLevel, message: string, nodeId?: string) => {
    issues.push({ id: `i${seq++}`, level, message, nodeId })
  }

  if (nodes.length === 0) {
    push('info', '画布为空，从左侧「节点」面板添加一个开始节点开始创作。')
    return sort(issues)
  }

  const starts = nodes.filter((n) => n.type === 'start')
  if (starts.length === 0) push('error', '缺少「开始」节点，剧情没有入口。')
  if (starts.length > 1) push('error', `存在 ${starts.length} 个「开始」节点，只允许一个。`)

  // 可达性
  const adjacency = new Map<string, string[]>()
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue
    if (!adjacency.has(e.source)) adjacency.set(e.source, [])
    adjacency.get(e.source)!.push(e.target)
  }
  const reachable = new Set<string>()
  const queue = starts.map((n) => n.id)
  if (starts.length === 0 && nodes.length > 0) queue.push(nodes[0].id)
  while (queue.length) {
    const id = queue.pop()!
    if (reachable.has(id)) continue
    reachable.add(id)
    for (const t of adjacency.get(id) ?? []) queue.push(t)
  }
  for (const n of nodes) {
    if (!reachable.has(n.id)) push('warn', `「${nodeTitle(n)}」从开始节点出发不可达。`, n.id)
  }

  // 变量定义
  const varIds = new Set(variables.map((v) => v.id))
  const varName = new Map(variables.map((v) => [v.id, v.name]))
  const nameCount = new Map<string, number>()
  for (const v of variables) nameCount.set(v.name, (nameCount.get(v.name) ?? 0) + 1)
  for (const v of variables) {
    if (nameCount.get(v.name)! > 1) push('warn', `变量「${v.name}」存在重名。`, undefined)
  }

  const outlets = new Map<string, Map<string | null, number>>()
  for (const e of edges) {
    const counts = outlets.get(e.source) ?? new Map<string | null, number>()
    const handle = e.sourceHandle ?? null
    counts.set(handle, (counts.get(handle) ?? 0) + 1); outlets.set(e.source, counts)
  }
  const outCount = (id: string, handle: string | null = null) => outlets.get(id)?.get(handle) ?? 0
  if (new Set(nodes.map((n) => n.id)).size !== nodes.length) push('error', '存在重复节点 ID。')
  if (project.authoring) {
    const scenes = new Map(project.authoring.scenes.map((s) => [s.id, s]))
    const chapters = new Set(project.authoring.chapters.map((c) => c.id))
    const characters = new Set(project.authoring.characters.map((c) => c.id))
    for (const scene of scenes.values()) {
      if (!chapters.has(scene.chapterId)) push('error', `场景「${scene.name}」所属章节不存在。`)
      if (scene.entryId && byId.get(scene.entryId)?.sceneId !== scene.id) push('warn', `场景「${scene.name}」的试玩入口不在本场景。`)
    }
    for (const n of nodes) {
      if (!n.sceneId || !scenes.has(n.sceneId)) push('error', '节点没有有效的所属场景。', n.id)
      if (n.data.characterId && !characters.has(n.data.characterId)) push('error', '对白引用的角色不存在。', n.id)
      if (n.type === 'script') push('info', '任意脚本执行期间不能存档；旧脚本已保留。', n.id)
    }
    for (const [id, asset] of Object.entries(project.assets ?? {})) {
      if (asset.missing) push('error', `素材「${asset.name}」的外部文件缺失（${id}），请在素材库重新定位。`)
      if (asset.placeholder) push('warn', `素材「${asset.name}」仍是占位素材。`)
    }
  }

  for (const n of nodes) {
    switch (n.type) {
      case 'start':
        if (outCount(n.id) === 0) push('warn', '「开始」节点还没有连接后续剧情。', n.id)
        break
      case 'dialogue': {
        if (!n.data.text?.trim()) push('warn', `「${nodeTitle(n)}」的正文是空的。`, n.id)
        if (outCount(n.id) === 0) push('warn', `「${nodeTitle(n)}」之后剧情中断（没有出口）。`, n.id)
        break
      }
      case 'choice': {
        const options = n.data.options ?? []
        if (options.length === 0) push('warn', `「${nodeTitle(n)}」没有任何选项。`, n.id)
        for (const opt of options) {
          if (!opt.text.trim()) push('warn', `「${nodeTitle(n)}」存在空选项文本。`, n.id)
          if (outCount(n.id, opt.id) === 0) push('warn', `「${nodeTitle(n)}」的选项「${opt.text || '未命名'}」未连接后续节点。`, n.id)
          if (opt.condition && !varIds.has(opt.condition.variableId)) {
            push('error', `「${nodeTitle(n)}」的选项条件引用了未定义变量。`, n.id)
          }
        }
        break
      }
      case 'variable': {
        const ops = n.data.ops ?? []
        if (ops.length === 0) push('warn', `「${nodeTitle(n)}」没有设置任何变量操作。`, n.id)
        for (const op of ops) {
          if (!varIds.has(op.variableId)) {
            push('error', `「${nodeTitle(n)}」操作了未定义的变量。`, n.id)
            continue
          }
          const def = variables.find((v) => v.id === op.variableId)!
          if ((op.op === 'add' || op.op === 'sub') && def.type !== 'number') {
            push('error', `「${nodeTitle(n)}」对非数字变量「${def.name}」使用加/减。`, n.id)
          }
        }
        if (outCount(n.id) === 0) push('warn', `「${nodeTitle(n)}」之后剧情中断（没有出口）。`, n.id)
        break
      }
      case 'jump':
        if (!n.data.label?.trim()) push('warn', `「${nodeTitle(n)}」没有命名。`, n.id)
        if (outCount(n.id) === 0) push('warn', `「${nodeTitle(n)}」没有连接去向。`, n.id)
        break
      case 'end':
        break
      case 'bg': {
        checkAsset(n)
        if (outCount(n.id) === 0) push('warn', `「${nodeTitle(n)}」之后剧情中断（没有出口）。`, n.id)
        break
      }
      case 'sprite': {
        if ((n.data.spriteAction ?? 'show') === 'show') checkAsset(n)
        if (outCount(n.id) === 0) push('warn', `「${nodeTitle(n)}」之后剧情中断（没有出口）。`, n.id)
        break
      }
      case 'audio': {
        if ((n.data.audioAction ?? 'play') === 'play') checkAsset(n)
        if (outCount(n.id) === 0) push('warn', `「${nodeTitle(n)}」之后剧情中断（没有出口）。`, n.id)
        break
      }
      case 'script': {
        if (!n.data.code?.trim()) push('warn', `「${nodeTitle(n)}」没有脚本代码，运行时将直接通过。`, n.id)
        if (outCount(n.id) === 0) push('warn', `「${nodeTitle(n)}」之后剧情中断（没有出口）。`, n.id)
        break
      }
    }
  }

  return sort(issues)

  function checkAsset(n: StoryNode): void {
    const key = n.data.asset ?? ''
    if (!key) {
      push('warn', `「${nodeTitle(n)}」还没有选择素材。`, n.id)
      return
    }
    if (!project.assets?.[key]) push('error', `「${nodeTitle(n)}」引用的素材已不存在（可能在导入时丢失）。`, n.id)
  }
}

function nodeTitle(n: StoryNode): string {
  switch (n.type) {
    case 'start':
      return '开始'
    case 'end':
      return n.data.label?.trim() || '结束'
    case 'jump':
      return n.data.label?.trim() || '跳转点'
    case 'dialogue':
      return n.data.speaker?.trim() || '对白'
    case 'choice':
      return '选项'
    case 'variable':
      return '变量操作'
    case 'bg':
      return '背景'
    case 'sprite':
      return n.data.character?.trim() || '立绘'
    case 'audio':
      return n.data.audioKind === 'sfx' ? '音效' : '音乐'
    case 'script':
      return '演出脚本'
  }
}

function sort(issues: Issue[]): Issue[] {
  const rank = { error: 0, warn: 1, info: 2 } as const
  return issues.sort((a, b) => rank[a.level] - rank[b.level])
}

import { uid, type AuthoringData, type StoryProject, type StoryNode, type StoryAsset } from './schema'

/** 无损升版：原节点、选项、变量和素材 id 全部保留。 */
export function upgradeAuthoring(project: StoryProject): StoryProject {
  if (project.version === 4 && project.authoring) return project
  const chapterId = uid('chapter_')
  const headings = project.nodes.filter((n) => n.type === 'jump' && /^场景[一二三四五六七八九十\d]+[：:]/.test(n.data.label ?? ''))
  const boundaries = new Set(headings.map((n) => n.id))
  const scenes: AuthoringData['scenes'] = headings.length ? headings.map((n) => ({
    id: `scene_${n.id}`, chapterId, name: n.data.label!, entryId: n.id
  })) : [{ id: uid('scene_'), chapterId, name: '场景一', entryId: project.nodes.find((n) => n.type === 'start')?.id ?? project.nodes[0]?.id ?? '' }]
  // 仅有明确场景标题时才沿连线推断归属；不靠画布坐标或名字重排剧情。
  const ownership = new Map<string, string>()
  const adjacency = new Map<string, string[]>()
  for (const e of project.edges) adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target])
  for (const scene of scenes) {
    const pending = [scene.entryId]
    while (pending.length) {
      const id = pending.pop()!
      if (ownership.has(id) || (id !== scene.entryId && boundaries.has(id))) continue
      ownership.set(id, scene.id)
      pending.push(...(adjacency.get(id) ?? []))
    }
  }
  const names = [...new Set(project.nodes.map((n) => n.data.speaker || n.data.character).filter((n): n is string => !!n))]
  const characters = names.map((name) => ({ id: uid('character_'), name, color: '#c7d2fe', expressions: {} as Record<string, string> }))
  const byName = new Map(characters.map((c) => [c.name, c.id]))
  const nodes = project.nodes.map((n) => ({ ...n, sceneId: ownership.get(n.id) ?? scenes[0].id,
    data: { ...n.data, ...(byName.has(n.data.speaker || n.data.character || '') ? { characterId: byName.get(n.data.speaker || n.data.character || '') } : {}) } }))
  const migrationWarnings = project.nodes.filter((n) => n.type === 'script').map((n) =>
    `脚本 ${n.id} 已原样保留；任意 JavaScript 无法自动转换，执行期间仍不能存档。`)
  if (!headings.length && project.nodes.length) migrationWarnings.unshift('未找到明确场景标题，原剧情整体放入场景一；可在剧本编辑器中重新分配场景。')
  return { ...project, version: 4, nodes, authoring: { gameId: uid('game_'), releaseVersion: '0.1.0', saveCompatibilityVersion: 1,
    chapters: [{ id: chapterId, name: '第一章' }], scenes, characters, migrationWarnings } }
}

export function assetUrl(asset?: StoryAsset): string { return asset?.runtimeUrl || asset?.dataUrl || '' }

/** 去除 React Flow 临时状态，保存结果与选中/测量状态无关。 */
export function persistedNode(n: StoryNode): StoryNode {
  return { id: n.id, type: n.type, sceneId: n.sceneId, position: n.position, data: n.data }
}

export function sceneLinks(project: StoryProject): { source: string; target: string; label: string; edgeId: string }[] {
  const nodes = new Map(project.nodes.map((n) => [n.id, n]))
  return project.edges.flatMap((e) => {
    const source = nodes.get(e.source), target = nodes.get(e.target)
    if (!source?.sceneId || !target?.sceneId || source.sceneId === target.sceneId) return []
    const label = source.data.options?.find((o) => o.id === e.sourceHandle)?.text ?? ''
    return [{ source: source.sceneId, target: target.sceneId, label, edgeId: e.id }]
  })
}

export function searchDialogue(project: StoryProject, query: string): StoryNode[] {
  const q = query.trim().toLocaleLowerCase()
  return q ? project.nodes.filter((n) => n.type === 'dialogue' && `${n.data.speaker ?? ''}\n${n.data.text ?? ''}`.toLocaleLowerCase().includes(q)) : []
}

/** 图片预加载索引：当前场景及最多两个相邻场景，避免扫描/加载全部资源。 */
export function createScenePrefetch(project: StoryProject): (sceneId: string) => string[] {
  const byNode = new Map(project.nodes.map((n) => [n.id, n.sceneId]))
  const media = new Map<string, string[]>(), next = new Map<string, Set<string>>()
  for (const n of project.nodes) if (n.sceneId && (n.type === 'bg' || n.type === 'sprite') && n.data.asset && project.assets[n.data.asset]?.type === 'image') {
    const list = media.get(n.sceneId) ?? []
    if (!list.includes(n.data.asset)) list.push(n.data.asset)
    media.set(n.sceneId, list)
  }
  for (const e of project.edges) {
    const source = byNode.get(e.source), target = byNode.get(e.target)
    if (source && target && source !== target) { const list = next.get(source) ?? new Set<string>(); list.add(target); next.set(source, list) }
  }
  return (sceneId) => {
    const candidates = [...(media.get(sceneId) ?? []).slice(0, 4), ...[...(next.get(sceneId) ?? [])].slice(0, 2).flatMap((s) => (media.get(s) ?? []).slice(0, 2))]
    let bytes = 0
    return [...new Set(candidates)].filter((key) => {
      const a = project.assets[key], size = a.bytes ?? 0
      if (!a.path || a.missing || bytes + size > 20 * 1024 * 1024) return false
      bytes += size; return true
    }).slice(0, 8)
  }
}

/** 场景与关键分支投影：折叠连续对白/演出，同时保留选项标签及汇合。 */
export function overviewGraph(project: StoryProject): {
  nodes: { id: string; sceneId: string; kind: 'scene' | 'choice' | 'end'; name: string; nodeId?: string }[]
  edges: { id: string; source: string; target: string; label: string }[]
} {
  const byId = new Map(project.nodes.map((n) => [n.id, n]))
  const adjacency = new Map<string, typeof project.edges>()
  for (const edge of project.edges) { const list = adjacency.get(edge.source) ?? []; list.push(edge); adjacency.set(edge.source, list) }
  const scenes = project.authoring?.scenes ?? []
  const nodes: ReturnType<typeof overviewGraph>['nodes'] = scenes.map((s) => ({ id: s.id, sceneId: s.id, kind: 'scene', name: s.name }))
  for (const n of project.nodes) if ((n.type === 'choice' || n.type === 'end') && n.sceneId) nodes.push({
    id: `${n.type}_${n.id}`, sceneId: n.sceneId, kind: n.type, name: n.type === 'choice' ? '分支选择' : n.data.label || '结局', nodeId: n.id
  })
  const edges: ReturnType<typeof overviewGraph>['edges'] = []
  const trace = (source: string, sceneId: string, entries: string[], label: string): void => {
    const pending = [...entries], visited = new Set<string>(), targets = new Set<string>()
    while (pending.length) {
      const id = pending.pop()!
      if (visited.has(id)) continue
      visited.add(id)
      const n = byId.get(id)
      if (!n) continue
      if (n.sceneId && n.sceneId !== sceneId) targets.add(n.sceneId)
      else if (n.type === 'choice' || n.type === 'end') targets.add(`${n.type}_${n.id}`)
      else pending.push(...(adjacency.get(id) ?? []).map((e) => e.target))
    }
    for (const target of targets) edges.push({ id: `overview_${edges.length}`, source, target, label })
  }
  for (const s of scenes) trace(s.id, s.id, [s.entryId], '')
  for (const n of project.nodes) if (n.type === 'choice' && n.sceneId) for (const option of n.data.options ?? []) {
    trace(`choice_${n.id}`, n.sceneId, (adjacency.get(n.id) ?? []).filter((e) => e.sourceHandle === option.id).map((e) => e.target), option.text)
  }
  return { nodes, edges }
}

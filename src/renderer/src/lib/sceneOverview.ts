import { applyNodeChanges, MarkerType, type Edge, type Node, type NodeChange } from '@xyflow/react'
import { overviewGraph } from '@shared/authoring'
import type { StoryProject } from '@shared/schema'

export type OverviewNode = Node<{
  sceneId: string; nodeId?: string; kind: 'scene' | 'choice' | 'end'
  title: string; subtitle: string
}, 'sceneOverview'>
export type OverviewLink = Edge<{ labels: string[] }, 'overview'>
export interface SceneOverview { nodes: OverviewNode[]; edges: OverviewLink[] }

/** 只在剧情或场景资料改变时投影；拖动和选中不重新扫描整个剧本。 */
export function buildSceneOverview(project: StoryProject): SceneOverview {
  const overview = overviewGraph(project)
  const scenes = project.authoring?.scenes ?? []
  const chapters = new Map(project.authoring?.chapters.map((c) => [c.id, c.name]))
  const byId = new Map(project.nodes.map((n) => [n.id, n]))
  const counts = new Map<string, { total: number; dialogue: number }>()
  for (const node of project.nodes) if (node.sceneId) {
    const count = counts.get(node.sceneId) ?? { total: 0, dialogue: 0 }
    count.total++; if (node.type === 'dialogue') count.dialogue++
    counts.set(node.sceneId, count)
  }
  const children = new Map<string, number>()
  for (const n of overview.nodes) if (n.kind !== 'scene') children.set(n.sceneId, (children.get(n.sceneId) ?? 0) + 1)
  const rowHeight = Math.max(280, ...scenes.map((s) => 160 + (children.get(s.id) ?? 0) * 136 + 70))
  const positions = new Map(scenes.map((s, i) => [s.id, s.position ?? { x: (i % 3) * 420, y: Math.floor(i / 3) * rowHeight }]))
  const sceneById = new Map(scenes.map((s) => [s.id, s]))
  const order = new Map<string, number>()
  const nodes: OverviewNode[] = overview.nodes.map((n) => {
    const root = positions.get(n.sceneId) ?? { x: 0, y: 0 }, index = order.get(n.sceneId) ?? 0
    if (n.kind !== 'scene') order.set(n.sceneId, index + 1)
    const scene = sceneById.get(n.sceneId), count = counts.get(n.sceneId)
    const subtitle = n.kind === 'scene'
      ? `${chapters.get(scene?.chapterId ?? '') ?? '章节'} · ${count?.dialogue ?? 0} 句对白 · ${count?.total ?? 0} 项`
      : n.kind === 'choice' ? `${byId.get(n.nodeId ?? '')?.data.options?.length ?? 0} 个选项` : '故事在此结束'
    return { id: n.id, type: 'sceneOverview', draggable: n.kind === 'scene',
      position: n.kind === 'scene' ? root : { x: root.x + 12, y: root.y + 160 + index * 136 },
      data: { sceneId: n.sceneId, nodeId: n.nodeId, kind: n.kind, title: n.name, subtitle },
      ariaLabel: `${n.name}，${subtitle}`, style: { width: n.kind === 'scene' ? 264 : 240 } }
  })
  const groups = new Map<string, typeof overview.edges>()
  for (const edge of overview.edges) {
    const key = JSON.stringify([edge.source, edge.target]), group = groups.get(key) ?? []
    group.push(edge); groups.set(key, group)
  }
  const nodeScene = new Map(nodes.map((n) => [n.id, n.data.sceneId]))
  const edges: OverviewLink[] = [...groups.values()].map((group) => {
    const e = group[0], inside = nodeScene.get(e.source) === nodeScene.get(e.target)
    const labels = group.map((link) => link.label).filter(Boolean)
    // 相同去向的选项共享一条可视连线，完整标签保留在悬停提示中。
    return { ...e, label: labels.join(' / '), type: 'overview', sourceHandle: inside ? 'down' : 'right', targetHandle: inside ? 'up' : 'left',
      data: { labels }, markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' },
      style: { stroke: 'var(--accent)', strokeWidth: 1.6 } }
  })
  return { nodes, edges }
}

/** 场景移动只修改局部画布状态，所属关键分支同步平移。 */
export function applyOverviewChanges(changes: NodeChange<OverviewNode>[], nodes: OverviewNode[]): OverviewNode[] {
  const deltas = new Map<string, { x: number; y: number }>()
  const originals = new Map(nodes.map((n) => [n.id, n]))
  for (const change of changes) if (change.type === 'position' && change.position) {
    const n = originals.get(change.id)
    if (n?.data.kind === 'scene') deltas.set(n.id, { x: change.position.x - n.position.x, y: change.position.y - n.position.y })
  }
  const next = applyNodeChanges(changes, nodes)
  if (!deltas.size) return next
  return next.map((n) => {
    const delta = n.data.kind !== 'scene' ? deltas.get(n.data.sceneId) : undefined
    return delta ? { ...n, position: { x: n.position.x + delta.x, y: n.position.y + delta.y } } : n
  })
}

/** ELK 仍然仅在点击整理时加载；按场景组的实际高度留出空间。 */
export async function arrangeSceneGroups(graph: SceneOverview): Promise<{ id: string; position: { x: number; y: number } }[]> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const elk = new ELK(), byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const heights = new Map<string, number>()
  for (const n of graph.nodes) if (n.data.kind !== 'scene') heights.set(n.data.sceneId, (heights.get(n.data.sceneId) ?? 0) + 136)
  const links = new Map<string, { id: string; sources: string[]; targets: string[] }>()
  for (const edge of graph.edges) {
    const source = byId.get(edge.source)?.data.sceneId, target = byId.get(edge.target)?.data.sceneId
    if (source && target && source !== target) links.set(JSON.stringify([source, target]), { id: edge.id, sources: [source], targets: [target] })
  }
  const result = await elk.layout({ id: 'scene-groups', layoutOptions: {
    'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '100',
    'elk.layered.spacing.nodeNodeBetweenLayers': '180'
  }, children: graph.nodes.filter((n) => n.data.kind === 'scene').map((n) => ({ id: n.id, width: 288, height: 160 + (heights.get(n.id) ?? 0) })), edges: [...links.values()] })
  return (result.children ?? []).map((n) => ({ id: n.id, position: { x: n.x ?? 0, y: n.y ?? 0 } }))
}

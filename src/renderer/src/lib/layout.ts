import type { StoryEdge, StoryNode } from '@shared/schema'

interface MeasuredNode extends StoryNode {
  measured?: { width?: number; height?: number }
}

/**
 * 用 elkjs 分层布局整理画布（自上而下）。
 * 布局后只改节点坐标，不改任何逻辑数据。
 */
export async function autoLayout(
  nodes: StoryNode[],
  edges: StoryEdge[]
): Promise<{ x: number; y: number }[]> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const elk = new ELK()

  const children = (nodes as MeasuredNode[]).map((n) => ({
    id: n.id,
    width: n.measured?.width ?? 250,
    height: n.measured?.height ?? 110
  }))

  const result = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': '70',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF'
    },
    children,
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }))
  })

  const map = new Map<string, { x: number; y: number }>()
  for (const c of result.children ?? []) {
    if (c.id && typeof c.x === 'number' && typeof c.y === 'number') map.set(c.id, { x: c.x, y: c.y })
  }
  return nodes.map((n) => map.get(n.id) ?? n.position)
}

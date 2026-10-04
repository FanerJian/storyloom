import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, Handle, Panel, Position, ReactFlow, ReactFlowProvider, getBezierPath, useReactFlow, type EdgeProps, type NodeProps, type Viewport } from '@xyflow/react'
import { ArrowRight, BookOpen, Flag, GitBranch, LayoutTemplate, Link2, LocateFixed, X } from 'lucide-react'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { Button, Select } from './ui'
import { NODE_META } from '../lib/flowHelpers'
import { applyOverviewChanges, arrangeSceneGroups, buildSceneOverview, type OverviewNode, type OverviewLink } from '../lib/sceneOverview'
import { toast } from '../stores/toast'

const SceneCard = memo(function SceneCard({ data, selected }: NodeProps<OverviewNode>) {
  const Icon = data.kind === 'scene' ? BookOpen : data.kind === 'choice' ? GitBranch : Flag
  return <div data-scene-id={data.sceneId} className={`scene-card scene-card-${data.kind} ${selected ? 'scene-card-active' : ''}`}>
    <Handle id="left" type="target" position={Position.Left} isConnectable={false} />
    <Handle id="up" type="target" position={Position.Top} isConnectable={false} />
    <div className="flex items-center gap-2.5"><span className="scene-card-icon"><Icon size={16} /></span><span className="min-w-0 flex-1 truncate font-semibold" title={data.title}>{data.title}</span></div>
    <div className="mt-2 truncate text-[11px] text-[var(--text-dim)]" title={data.subtitle}>{data.subtitle}</div>
    <Handle id="right" type="source" position={Position.Right} isConnectable={false} />
    <Handle id="down" type="source" position={Position.Bottom} isConnectable={false} />
  </div>
})
const sceneNodeTypes = { sceneOverview: SceneCard }

function OverviewEdge(props: EdgeProps<OverviewLink>) {
  const [path, x, y] = getBezierPath(props)
  return <><BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd} />{props.label && <EdgeLabelRenderer>
    <div className="nodrag nopan scene-edge-label" title={String(props.label)} style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>{props.label}</div>
  </EdgeLabelRenderer>}</>
}
const overviewEdgeTypes = { overview: OverviewEdge }
const viewports = new Map<number, Viewport>()

export function SceneGraph() {
  const revision = useProjectStore((s) => s.revision)
  return <ReactFlowProvider key={revision}><SceneGraphView revision={revision} /></ReactFlowProvider>
}

function SceneGraphView({ revision }: { revision: number }) {
  const scenes = useProjectStore((s) => s.authoring?.scenes)
  const chapters = useProjectStore((s) => s.authoring?.chapters)
  const storyNodes = useProjectStore((s) => s.nodes), storyEdges = useProjectStore((s) => s.edges)
  const active = useProjectStore((s) => s.activeSceneId)
  const graph = useMemo(() => buildSceneOverview(useProjectStore.getState().getProject()), [scenes, chapters, storyNodes, storyEdges])
  const [nodes, setNodes] = useState(graph.nodes)
  const [connecting, setConnecting] = useState(false), [outlet, setOutlet] = useState(''), [target, setTarget] = useState(''), [arranging, setArranging] = useState(false)
  const { fitView, getViewport, setViewport } = useReactFlow<OverviewNode, OverviewLink>()
  const flowRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(true), layoutPending = useRef(false)
  const initialViewport = useRef(viewports.get(revision))
  const remember = useCallback((_event: unknown, viewport: Viewport): void => {
    viewports.set(revision, viewport)
    if (viewports.size > 20) viewports.delete(viewports.keys().next().value!)
  }, [revision])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; remember(null, getViewport()) } }, [getViewport, remember])
  useEffect(() => {
    setNodes((current) => {
      const previous = new Map(current.map((n) => [n.id, n]))
      return graph.nodes.map((n) => ({ ...n, measured: previous.get(n.id)?.measured, selected: n.id === useProjectStore.getState().activeSceneId }))
    })
  }, [graph.nodes])
  useEffect(() => {
    setNodes((current) => current.map((n) => n.selected === (n.id === active) ? n : { ...n, selected: n.id === active }))
    setOutlet(''); setTarget('')
  }, [active])
  const arrange = useCallback(async (): Promise<void> => {
    if (layoutPending.current) return
    layoutPending.current = true; setArranging(true)
    const before = useProjectStore.getState()
    try {
      const positions = await arrangeSceneGroups(graph)
      const current = useProjectStore.getState()
      if (!mounted.current || current.authoring?.scenes !== before.authoring?.scenes || current.nodes !== before.nodes || current.edges !== before.edges) {
        if (mounted.current) toast.warn('布局期间剧情已变化，请重新整理')
        return
      }
      current.applyScenePositions(positions)
      requestAnimationFrame(() => { if (mounted.current) void fitView({ padding: 0.2, maxZoom: 1, duration: 180 }) })
      toast.success('已整理场景，可撤销')
    } catch (e) { if (mounted.current) toast.error(`整理失败：${String(e)}`) }
    finally { layoutPending.current = false; if (mounted.current) setArranging(false) }
  }, [graph, fitView])
  useEffect(() => {
    const handler = (): void => { void arrange() }
    window.addEventListener('storyloom:autolayout', handler)
    return () => window.removeEventListener('storyloom:autolayout', handler)
  }, [arrange])
  const exits = useMemo(() => {
    const occupied = new Map(storyEdges.map((e) => [JSON.stringify([e.source, e.sourceHandle ?? null]), e.target]))
    return storyNodes.filter((n) => n.sceneId === active && n.type !== 'end').flatMap((n) => {
      const entries = n.type === 'choice' ? (n.data.options ?? []).map((o) => ({ id: o.id, name: `选项 · ${o.text}` })) : [{ id: null, name: `${NODE_META[n.type].label} · ${n.data.text?.slice(0, 28) || n.data.label || '出口'}` }]
      return entries.map((e) => ({ value: JSON.stringify([n.id, e.id]), name: e.name, occupied: occupied.has(JSON.stringify([n.id, e.id])) }))
    }).sort((a, b) => Number(a.occupied) - Number(b.occupied))
  }, [storyNodes, storyEdges, active])
  const connect = async (): Promise<void> => {
    if (!exits.some((e) => e.value === outlet)) return
    const [source, sourceHandle] = JSON.parse(outlet) as [string, string | null]
    const before = useProjectStore.getState(), scene = before.authoring?.scenes.find((s) => s.id === target)
    if (!scene?.entryId) return
    const existing = before.edges.find((e) => e.source === source && (e.sourceHandle ?? null) === sourceHandle)
    if (existing && existing.target !== scene.entryId && !await useUiStore.getState().askConfirm({ title: '替换剧情出口', body: '这个出口已有连线。连接新场景将替换原去向，可以撤销。', confirmText: '替换连线' })) return
    const current = useProjectStore.getState()
    if (!mounted.current || before.nodes !== current.nodes || before.edges !== current.edges || before.authoring?.scenes !== current.authoring?.scenes) { toast.warn('剧情已变化，请重新连接'); return }
    current.onConnect({ source, sourceHandle, target: scene.entryId, targetHandle: null })
    setConnecting(false); toast.success('已连接场景')
  }
  const scene = scenes?.find((s) => s.id === active)
  return <div ref={flowRef} className="scene-graph relative h-full" data-testid="scene-graph">
    <ReactFlow<OverviewNode, OverviewLink> nodes={nodes} edges={graph.edges} nodeTypes={sceneNodeTypes} edgeTypes={overviewEdgeTypes}
      onNodesChange={(changes) => setNodes((current) => applyOverviewChanges(changes, current))}
      onNodeClick={(_e, n) => useProjectStore.setState({ activeSceneId: n.data.sceneId })}
      onNodeDoubleClick={(_e, n) => useProjectStore.setState({ activeSceneId: n.data.sceneId, focusedNodeId: n.data.nodeId ?? null, workspaceMode: 'script' })}
      onNodeDragStop={(_e, n) => { if (n.data.kind === 'scene') useProjectStore.getState().applyScenePositions([{ id: n.id, position: n.position }]) }}
      onMoveEnd={remember} defaultViewport={initialViewport.current} fitView={!initialViewport.current && graph.nodes.length <= 24} fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
      onInit={() => { if (!initialViewport.current && graph.nodes.length > 24) {
        const n = graph.nodes.find((n) => n.id === active) ?? graph.nodes[0]
        const rect = flowRef.current?.getBoundingClientRect()
        if (n && rect) void setViewport({ x: rect.width / 2 - n.position.x - 132, y: rect.height / 2 - n.position.y - 48, zoom: 1 })
      } }}
      nodesConnectable={false} deleteKeyCode={null} minZoom={0.08} maxZoom={1.6} zoomOnDoubleClick={false}
      panOnScroll zoomOnScroll={false} zoomActivationKeyCode={['Control', 'Meta']} onlyRenderVisibleElements className="bg-[var(--bg)]">
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} className="opacity-35" />
      <Controls showInteractive={false} position="bottom-right" fitViewOptions={{ padding: 0.2, maxZoom: 1 }} />
      <Panel position="top-left"><div className="scene-graph-toolbar"><GitBranch size={15} /><span className="font-semibold">场景图</span><span className="text-[var(--text-dim)]">{scenes?.length ?? 0} 个场景</span></div></Panel>
      <Panel position="top-right"><div className="scene-graph-toolbar gap-1">
        <Button variant="ghost" size="sm" disabled={!active} title="定位所选场景" aria-label="定位所选场景" onClick={() => void fitView({ nodes: [{ id: active! }], padding: 1, minZoom: 0.7, maxZoom: 1, duration: 160 })}><LocateFixed size={14} /></Button>
        <Button variant="ghost" size="sm" disabled={arranging} onClick={() => void arrange()}><LayoutTemplate size={14} />{arranging ? '整理中…' : '整理'}</Button>
        <Button variant={connecting ? 'soft' : 'ghost'} size="sm" disabled={!scene} aria-expanded={connecting} onClick={() => setConnecting(!connecting)}><Link2 size={14} />连接场景</Button>
      </div></Panel>
      <Panel position="bottom-left"><div className="rounded-lg bg-[var(--surface)]/90 px-3 py-2 text-[11px] text-[var(--text-dim)]">拖动卡片整理 · 双击编辑 · 滚轮平移 · Ctrl + 滚轮缩放</div></Panel>
    </ReactFlow>
    {connecting && <section role="region" aria-label="连接场景面板" className="absolute right-4 top-16 z-10 w-80 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl shadow-black/15">
      <div className="mb-4 flex items-center justify-between"><span className="text-[13px] font-semibold">连接场景</span><Button variant="ghost" size="icon" aria-label="关闭场景连接" onClick={() => setConnecting(false)}><X size={15} /></Button></div>
      <p className="mb-2 truncate text-[12px] text-[var(--text-dim)]">从「{scene?.name}」的出口出发</p>
      <Select aria-label="场景出口" value={outlet} onChange={(e) => setOutlet(e.target.value)}><option value="">选择剧情出口</option>{exits.map((e) => <option key={e.value} value={e.value}>{e.name}{e.occupied ? '（已有去向）' : '（未连接）'}</option>)}</Select>
      <div className="my-3 flex justify-center text-[var(--text-dim)]"><ArrowRight size={16} className="rotate-90" /></div>
      <Select aria-label="连接目标场景" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">选择目标场景</option>{scenes?.filter((s) => s.id !== active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
      <Button className="mt-4 w-full" variant="primary" disabled={!outlet || !target} onClick={() => void connect()}><Link2 size={14} />确认连接</Button>
    </section>}
  </div>
}

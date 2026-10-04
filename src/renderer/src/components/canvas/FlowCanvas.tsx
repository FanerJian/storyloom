import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  useStoreApi,
  type Connection,
  type NodeTypes
} from '@xyflow/react'
import {
  CornerDownRight,
  Flag,
  Image as ImageIcon,
  ListTree,
  LocateFixed,
  MessageSquareText,
  Music,
  Play,
  SquareTerminal,
  UserRound,
  Variable as VariableIcon
} from 'lucide-react'
import { useProjectStore } from '../../stores/project'
import { useUiStore } from '../../stores/ui'
import { toast } from '../../stores/toast'
import { NODE_META } from '../../lib/flowHelpers'
import { autoLayout } from '../../lib/layout'
import { nodeTypes } from './nodes'
import type { NodeType, StoryEdge, StoryNode } from '@shared/schema'
import { cn } from '../../lib/utils'

const PALETTE: NodeType[] = ['dialogue', 'choice', 'variable', 'jump', 'end', 'start', 'bg', 'sprite', 'audio', 'script']

const paletteIcons: Record<NodeType, ReactNode> = {
  dialogue: <MessageSquareText size={13} />,
  choice: <ListTree size={13} />,
  variable: <VariableIcon size={13} />,
  jump: <CornerDownRight size={13} />,
  end: <Flag size={13} />,
  start: <Play size={13} />,
  bg: <ImageIcon size={13} />,
  sprite: <UserRound size={13} />,
  audio: <Music size={13} />,
  script: <SquareTerminal size={13} />
}

const paletteColors: Record<NodeType, string> = {
  start: 'text-emerald-500',
  dialogue: 'text-indigo-500',
  choice: 'text-amber-500',
  variable: 'text-cyan-500',
  jump: 'text-purple-500',
  end: 'text-rose-500',
  bg: 'text-sky-500',
  sprite: 'text-pink-500',
  audio: 'text-teal-500',
  script: 'text-violet-500'
}

export function FlowCanvas({ sceneId }: { sceneId?: string }) {
  const allNodes = useProjectStore((s) => s.nodes)
  const allEdges = useProjectStore((s) => s.edges)
  const nodes = useMemo(() => sceneId ? allNodes.filter((n) => n.sceneId === sceneId) : allNodes, [allNodes, sceneId])
  const ids = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes])
  const edges = useMemo(() => sceneId ? allEdges.filter((e) => ids.has(e.source) && ids.has(e.target)) : allEdges, [allEdges, ids, sceneId])
  const onNodesChange = useProjectStore((s) => s.onNodesChange)
  const onEdgesChange = useProjectStore((s) => s.onEdgesChange)
  const onConnect = useProjectStore((s) => s.onConnect)
  const addNode = useProjectStore((s) => s.addNode)
  const revision = useProjectStore((s) => s.revision)

  const { screenToFlowPosition, fitView } = useReactFlow()
  const wrapper = useRef<HTMLDivElement>(null)
  const openPlaytest = useUiStore((s) => s.openPlaytest)
  const storeApi = useStoreApi()
  // 节点右键菜单：{ 节点 id, 视口坐标 }
  const [ctxMenu, setCtxMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  /**
   * 直接把视口 transform 写入 DOM 并同步 RF 内部 store。
   * 不走 RF 的 fitView：其 promise 依赖 d3-zoom 程序化 transform 事件，
   * 在部分 WebView 中会挂起且不生效；手动同步在所有环境确定生效。
   */
  const applyViewport = useCallback(
    (tx: number, ty: number, zoom: number): void => {
      const el = wrapper.current?.querySelector<HTMLElement>('.react-flow__viewport')
      if (el) el.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`
      storeApi.setState({ transform: [tx, ty, zoom] })
      // 同步 d3-zoom 内部状态（元素上的 __zoom），否则任何手势都会把视图弹回旧变换
      const pane = wrapper.current?.querySelector<HTMLElement>('.react-flow__pane') as unknown as {
        __zoom?: { k: number; x: number; y: number }
      }
      if (pane && pane.__zoom) pane.__zoom = { k: zoom, x: tx, y: ty }
    },
    [storeApi]
  )

  const nodeSize = useCallback(
    (n: StoryNode) => ({
      w: (n as StoryNode & { measured?: { width?: number } }).measured?.width ?? NODE_META[n.type].width,
      h: (n as StoryNode & { measured?: { height?: number } }).measured?.height ?? NODE_META[n.type].estHeight
    }),
    []
  )

  /** 自适应视野：计算包围盒后手动设置视口（padding 为相对留白） */
  const fitAll = useCallback(
    (padding = 0.25): void => {
      const rect = wrapper.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return
      const ns = useProjectStore.getState().nodes.filter((n) => !sceneId || n.sceneId === sceneId)
      if (ns.length === 0) return
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const n of ns) {
        const { w, h } = nodeSize(n)
        minX = Math.min(minX, n.position.x)
        minY = Math.min(minY, n.position.y)
        maxX = Math.max(maxX, n.position.x + w)
        maxY = Math.max(maxY, n.position.y + h)
      }
      const bw = Math.max(1, maxX - minX)
      const bh = Math.max(1, maxY - minY)
      const zoom = Math.min(
        Math.max(Math.min((rect.width * (1 - 2 * padding)) / bw, (rect.height * (1 - 2 * padding)) / bh), 0.15),
        1.5
      )
      const tx = (rect.width - bw * zoom) / 2 - minX * zoom
      const ty = (rect.height - bh * zoom) / 2 - minY * zoom
      applyViewport(tx, ty, zoom)
    },
    [applyViewport, nodeSize, sceneId]
  )

  /** 自适应视野（带兜底）：优先 RF 原生 fitView，若程序化视口未生效则手动写入 transform */
  const fitWithFallback = useCallback(
    (padding = 0.2): void => {
      const before = storeApi.getState().transform.slice() as [number, number, number]
      void Promise.resolve(fitView({ padding })).catch(() => {})
      setTimeout(() => {
        const after = storeApi.getState().transform
        const changed = Math.abs(after[0] - before[0]) + Math.abs(after[1] - before[1]) + Math.abs(after[2] - before[2]) > 1e-6
        if (!changed) fitAll(padding)
      }, 380)
    },
    [fitAll, fitView, storeApi]
  )

  /** 让某个节点居中显示 */
  const centerNode = useCallback(
    (id: string): void => {
      const rect = wrapper.current?.getBoundingClientRect()
      if (!rect) return
      const n = useProjectStore.getState().nodes.find((x) => x.id === id)
      if (!n) return
      const { w, h } = nodeSize(n)
      const zoom = Math.min(storeApi.getState().transform[2], 1)
      const tx = rect.width / 2 - (n.position.x + w / 2) * zoom
      const ty = rect.height / 2 - (n.position.y + h / 2) * zoom
      applyViewport(tx, ty, zoom)
    },
    [applyViewport, nodeSize, storeApi]
  )

  // 载入工程后自适应视野（延后到节点完成测量后执行）
  useEffect(() => {
    if (nodes.length === 0) return
    const timers = [250, 900].map((ms) => setTimeout(() => fitWithFallback(0.15), ms))
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, sceneId])

  const isValidConnection = useCallback(
    (conn: Connection | StoryEdge) => {
      const s = useProjectStore.getState()
      const src = s.nodes.find((n) => n.id === conn.source)
      const dst = s.nodes.find((n) => n.id === conn.target)
      if (!src || !dst) return false
      if (src.id === dst.id) return false
      if (dst.type === 'start') return false
      if (src.type === 'end') return false
      const handle = conn.sourceHandle ?? null
      const dup = s.edges.some(
        (e) => e.source === conn.source && (e.sourceHandle ?? null) === handle && e.target === conn.target
      )
      return !dup
    },
    []
  )

  const handleAdd = useCallback(
    (type: NodeType) => {
      const rect = wrapper.current?.getBoundingClientRect()
      const center = screenToFlowPosition({
        x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 + (Math.random() * 80 - 40),
        y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 + (Math.random() * 60 - 30)
      })
      const node = addNode(type, center)
      if (!node) {
        toast.error('「开始」节点只能有一个')
        return
      }
      toast.info(`已添加「${NODE_META[type].label}」节点`)
    },
    [addNode, screenToFlowPosition]
  )

  /** 供工具栏调用的自动布局（通过自定义事件解耦） */
  useEffect(() => {
    const handler = async (): Promise<void> => {
      const s = useProjectStore.getState()
      if (s.nodes.length === 0) return
      try {
        const visible = sceneId ? s.nodes.filter((n) => n.sceneId === sceneId) : s.nodes
        const ids = new Set(visible.map((n) => n.id))
        const links = s.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
        const positions = await autoLayout(visible, links)
        const current = useProjectStore.getState()
        if (current.revision !== s.revision || current.nodes !== s.nodes || current.edges !== s.edges) {
          toast.warn('布局期间剧情已变化，请重新整理'); return
        }
        const updated = new Map(visible.map((n, i) => [n.id, positions[i]]))
        current.applyPositions(current.nodes.map((n) => updated.get(n.id) ?? n.position))
        setTimeout(() => fitWithFallback(0.2), 100)
        toast.success('已自动整理布局')
      } catch (err) {
        toast.error(`自动布局失败：${String(err)}`)
      }
    }
    window.addEventListener('storyloom:autolayout', handler)
    return () => window.removeEventListener('storyloom:autolayout', handler)
  }, [fitWithFallback, sceneId])

  /** 试玩事件（工具栏/F5 触发；事件 detail.nodeId 优先，其次回退到选中节点） */
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ nodeId?: string }>).detail
      const selected = useProjectStore.getState().nodes.find((n) => (n as StoryNode & { selected?: boolean }).selected)
      openPlaytest(detail?.nodeId ?? selected?.id ?? null)
    }
    window.addEventListener('storyloom:playtest', handler)
    return () => window.removeEventListener('storyloom:playtest', handler)
  }, [openPlaytest])

  /** 节点右键菜单：从该节点试玩 / 定位到节点 */
  const onNodeContextMenu = useCallback((event: ReactMouseEvent, node: StoryNode) => {
    event.preventDefault()
    setCtxMenu({ nodeId: node.id, x: event.clientX, y: event.clientY })
  }, [])

  useEffect(() => {
    if (!ctxMenu) return
    const close = (): void => setCtxMenu(null)
    const outside = (e: PointerEvent): void => {
      if (!ctxMenuRef.current?.contains(e.target as globalThis.Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('wheel', close, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('wheel', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  /** 「检查」面板点击 → 画布居中到节点 */
  useEffect(() => {
    const handler = (e: Event): void => {
      const id = (e as CustomEvent<string>).detail
      if (useProjectStore.getState().nodes.some((x) => x.id === id)) centerNode(id)
    }
    window.addEventListener('storyloom:center-node', handler)
    return () => window.removeEventListener('storyloom:center-node', handler)
  }, [centerNode])

  return (
    <div className="relative h-full w-full" ref={wrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes as NodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeContextMenu={onNodeContextMenu}
        isValidConnection={isValidConnection}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
        minZoom={0.15}
        maxZoom={1.6}
        snapToGrid
        snapGrid={[10, 10]}
        fitView
        proOptions={{ hideAttribution: false }}
        className="bg-[var(--bg)]"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} className="opacity-60" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          pannable
          zoomable
          position="bottom-left"
          className="!bg-[var(--surface)] !border !border-[var(--border)]"
          nodeColor={(n) => NODE_META[(n.type ?? 'dialogue') as NodeType]?.color ?? '#6366f1'}
          maskColor="rgba(0,0,0,0.25)"
        />
        <Panel position="top-left" className="!m-3">
          <div className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-lg shadow-black/5">
            <div className="px-1.5 pt-1 pb-1 text-[10px] font-bold tracking-widest text-[var(--text-dim)] uppercase">
              添加节点
            </div>
            {PALETTE.map((t) => (
              <button
                key={t}
                onClick={() => handleAdd(t)}
                className={cn(
                  'group flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                )}
                title={`添加 ${NODE_META[t].label}：${NODE_META[t].desc}`}
              >
                <span className={paletteColors[t]}>{paletteIcons[t]}</span>
                {NODE_META[t].label}
              </button>
            ))}
          </div>
        </Panel>
        {nodes.length === 0 && (
          <Panel position="top-center" className="!mt-24">
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)]/80 px-6 py-4 text-center text-[13px] text-[var(--text-dim)] backdrop-blur">
              从左上角添加节点开始创作，或用菜单「文件 → 新建示例工程」
            </div>
          </Panel>
        )}
      </ReactFlow>
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          role="menu"
          aria-label="节点操作"
          className="fixed z-[70] min-w-40 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-xl shadow-black/20"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 180), top: Math.min(ctxMenu.y, window.innerHeight - 100) }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] text-[var(--text)] outline-none hover:bg-[var(--surface-2)] focus:bg-[var(--surface-2)]"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('storyloom:playtest', { detail: { nodeId: ctxMenu.nodeId } }))
              setCtxMenu(null)
            }}
          >
            <Play size={14} className="flex-none text-indigo-400" />
            从此节点试玩
          </button>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] text-[var(--text)] outline-none hover:bg-[var(--surface-2)] focus:bg-[var(--surface-2)]"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('storyloom:center-node', { detail: ctxMenu.nodeId }))
              setCtxMenu(null)
            }}
          >
            <LocateFixed size={14} className="flex-none text-purple-400" />
            定位到节点
          </button>
        </div>
      )}
    </div>
  )
}

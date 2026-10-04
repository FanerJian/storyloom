import { create } from 'zustand'
import type { Connection, EdgeChange, NodeChange } from '@xyflow/react'
import { getFlowOperations } from '../lib/flowOperations'
import {
  defaultRelease,
  emptyProject,
  migrateProject,
  uid,
  type ChoiceOption,
  type NodeType,
  type ReleaseConfig,
  type ReleaseQuickMenu,
  type ReleaseSettingsScreen,
  type ReleaseTitleScreen,
  type StoryAsset,
  type StoryEdge,
  type StoryMeta,
  type StoryNode,
  type StoryProject,
  type StoredProject,
  type VarOp,
  type VariableDef,
  type VarType,
  type VarValue
} from '@shared/schema'
import type { AuthoringData, StoryCharacter, StoryScene } from '@shared/schema'
import { upgradeAuthoring } from '@shared/authoring'
import { findAssetByContent, hashAssetDataUrl } from '@shared/assets'

interface Snapshot {
  authoring?: AuthoringData
  meta: StoryMeta
  assets: Record<string, StoryAsset>
  customCss: string
  customJs: string
  variables: VariableDef[]
  nodes: StoryNode[]
  edges: StoryEdge[]
  release?: ReleaseConfig
}

/** updateRelease 的局部补丁：分组内字段可选，labels/defaults 支持部分更新 */
export interface ReleasePatch {
  titleScreen?: Partial<Omit<ReleaseTitleScreen, 'labels'>> & { labels?: Partial<ReleaseTitleScreen['labels']> }
  settings?: Partial<Omit<ReleaseSettingsScreen, 'defaults'>> & { defaults?: Partial<ReleaseSettingsScreen['defaults']> }
  quickMenu?: Partial<ReleaseQuickMenu>
  version?: string
  credits?: string
}

interface ProjectState extends Snapshot {
  activeSceneId: string | null
  focusedNodeId: string | null
  workspaceMode: 'script' | 'scenes' | 'nodes' | 'characters' | 'assets'
  externalChanges: string[]
  saveBlocked: boolean
  setAuthoring: (patch: Partial<AuthoringData>) => void
  addChapter: (name: string) => string
  addScene: (chapterId: string, name: string) => string
  updateScene: (id: string, patch: Partial<StoryScene>) => void
  applyScenePositions: (positions: { id: string; position: { x: number; y: number } }[]) => void
  assignScene: (nodeIds: string[], sceneId: string) => void
  insertDialogue: (sceneId: string, afterId?: string) => string
  removeDialogue: (id: string) => void
  replaceDialogue: (find: string, replacement: string, ids: string[]) => void
  assignCharacter: (ids: string[], characterId: string) => void
  addCharacter: (name: string) => string
  updateCharacter: (id: string, patch: Partial<StoryCharacter>) => void
  updateAsset: (key: string, patch: Partial<StoryAsset>) => void
  addImportedAsset: (asset: StoryAsset) => string
  filePath: string | null
  lastSavedJson: string | null
  dirty: boolean
  /** 工程（重新）载入计数，画布用于触发 fitView */
  revision: number
  /** 历史深度（用于撤销/重做按钮的可用态） */
  pastCount: number
  futureCount: number
  /** 画布选项选中态：nodeId -> 选中的 optionId */
  selectedOption: { nodeId: string; optionId: string } | null

  // ---- 工程 ----
  loadProject: (project: StoryProject, filePath: string | null) => void
  newProject: (project?: StoryProject) => void
  setMeta: (patch: Partial<StoryMeta>, opts?: { commit?: boolean }) => void
  /** 编辑发布配置（release）；离散变更默认一次 commit，滑条/文本输入传 { typing: true } 合并历史 */
  updateRelease: (patch: ReleasePatch, opts?: { typing?: boolean }) => void
  /** 应用自动布局结果（带历史记录） */
  applyPositions: (positions: { x: number; y: number }[]) => void

  // ---- 画布 ----
  onNodesChange: (changes: NodeChange<StoryNode>[]) => void
  onEdgesChange: (changes: EdgeChange<StoryEdge>[]) => void
  onConnect: (conn: Connection) => void
  addNode: (type: NodeType, position: { x: number; y: number }) => StoryNode | null
  deleteNode: (id: string) => void
  updateNodeData: (id: string, patch: Partial<StoryNode['data']>, opts?: { commit?: boolean }) => void

  // ---- 选项 ----
  addOption: (nodeId: string) => void
  updateOption: (nodeId: string, optionId: string, patch: Partial<ChoiceOption>) => void
  removeOption: (nodeId: string, optionId: string) => void
  moveOption: (nodeId: string, optionId: string, dir: -1 | 1) => void

  // ---- 变量 ----
  addVariable: (name: string, type: VarType, initial: VarValue) => void
  updateVariable: (id: string, patch: Partial<VariableDef>) => void
  removeVariable: (id: string) => void

  // ---- 变量操作（variable 节点） ----
  addOp: (nodeId: string) => void
  updateOp: (nodeId: string, opId: string, patch: Partial<VarOp>) => void
  removeOp: (nodeId: string, opId: string) => void

  // ---- 素材 ----
  /** 导入素材（dataUrl 内嵌），同类型相同内容重用已有素材 key */
  addAsset: (name: string, type: StoryAsset['type'], dataUrl: string) => Promise<string>
  removeAsset: (key: string) => void

  // ---- 自定义代码（CSS / JS） ----
  setCustomCode: (patch: { customCss?: string; customJs?: string }) => void

  // ---- 历史 ----
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  // ---- 保存 ----
  serialize: () => string
  markSaved: (path: string | null) => void
  getProject: () => StoryProject
}

interface History {
  past: Snapshot[]
  future: Snapshot[]
  typingActive: boolean
  typingTimer: ReturnType<typeof setTimeout> | null
  dragCommitted: boolean
}

const history: History = { past: [], future: [], typingActive: false, typingTimer: null, dragCommitted: false }
const LIMIT = 300

function snap(s: ProjectState): Snapshot {
  return {
    authoring: s.authoring,
    meta: { ...s.meta },
    assets: { ...s.assets },
    customCss: s.customCss,
    customJs: s.customJs,
    variables: [...s.variables],
    nodes: [...s.nodes],
    edges: [...s.edges],
    release: s.release ? { ...s.release } : undefined
  }
}

/** 离散动作：先记录历史再变更 */
function commit(s: ProjectState): void
/** 连续动作（输入/拖拽）：同一会话只记录一次 */
function commit(s: ProjectState, kind: 'typing' | 'drag'): void
function commit(s: ProjectState, kind?: 'typing' | 'drag'): void {
  if (!kind) {
    history.past.push(snap(s))
    if (history.past.length > LIMIT) history.past.shift()
    history.future = []
    endTyping()
    return
  }
  if (kind === 'drag') {
    if (!history.dragCommitted) {
      history.past.push(snap(s))
      if (history.past.length > LIMIT) history.past.shift()
      history.future = []
      history.dragCommitted = true
    }
    return
  }
  // typing：空闲 800ms 后结束一次会话
  if (!history.typingActive) {
    history.past.push(snap(s))
    if (history.past.length > LIMIT) history.past.shift()
    history.future = []
    history.typingActive = true
  }
  endTyping(true)
}

function endTyping(reschedule = false): void {
  if (history.typingTimer) clearTimeout(history.typingTimer)
  history.typingTimer = setTimeout(() => {
    history.typingActive = false
    history.dragCommitted = false
  }, 800)
  if (!reschedule) {
    // 离散提交直接结束 typing 会话（timer 仅用于复位标记）
  }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  ...emptyProject(),
  authoring: undefined,
  release: undefined,
  activeSceneId: null,
  focusedNodeId: null,
  workspaceMode: 'script',
  externalChanges: [],
  saveBlocked: false,
  filePath: null,
  lastSavedJson: null,
  dirty: false,
  revision: 0,
  pastCount: 0,
  futureCount: 0,
  selectedOption: null,

  loadProject: (raw, filePath) => {
    const project = upgradeAuthoring(migrateProject(raw as StoredProject))
    history.past = []
    history.future = []
    set((s) => ({
      ...project,
      // 空白工程没有 release 键，显式覆盖避免残留上一部作品的发布配置。
      release: project.release,
      authoring: project.authoring,
      activeSceneId: project.authoring!.scenes[0]?.id ?? null,
      workspaceMode: 'script',
      externalChanges: [],
      saveBlocked: false,
      focusedNodeId: null,
      filePath,
      lastSavedJson: JSON.stringify(project),
      dirty: false,
      revision: s.revision + 1,
      selectedOption: null
    }))
  },

  applyPositions: (positions) => {
    const s = get()
    commit(s)
    set({
      nodes: s.nodes.map((n, i) => ({ ...n, position: positions[i] ?? n.position })),
      dirty: true
    })
  },

  newProject: (project) => {
    let p = project ?? emptyProject()
    if (!project) {
      p = upgradeAuthoring(p)
      const id = uid('n_'), sceneId = p.authoring!.scenes[0].id
      p = { ...p, nodes: [{ id, type: 'start', sceneId, position: { x: 0, y: 0 }, data: {} }], authoring: { ...p.authoring!, scenes: p.authoring!.scenes.map((s) => ({ ...s, entryId: id })) } }
    }
    get().loadProject(p, null)
  },

  setMeta: (patch, opts) => {
    if (opts?.commit !== false) commit(get())
    set((s) => ({ meta: { ...s.meta, ...patch }, dirty: true }))
  },

  updateRelease: (patch, opts) => {
    const s = get()
    const base = s.release ?? defaultRelease()
    if (opts?.typing) commit(s, 'typing')
    else commit(s)
    const t = patch.titleScreen
    const sc = patch.settings
    const release: ReleaseConfig = {
      ...base,
      version: patch.version ?? base.version,
      credits: patch.credits ?? base.credits,
      titleScreen: t
        ? {
            enabled: t.enabled ?? base.titleScreen.enabled,
            backgroundAsset: t.backgroundAsset ?? base.titleScreen.backgroundAsset,
            showMeta: t.showMeta ?? base.titleScreen.showMeta,
            showVersion: t.showVersion ?? base.titleScreen.showVersion,
            labels: { ...base.titleScreen.labels, ...(t.labels ?? {}) }
          }
        : base.titleScreen,
      settings: sc
        ? {
            textSpeed: sc.textSpeed ?? base.settings.textSpeed,
            autoSpeed: sc.autoSpeed ?? base.settings.autoSpeed,
            bgmVolume: sc.bgmVolume ?? base.settings.bgmVolume,
            sfxVolume: sc.sfxVolume ?? base.settings.sfxVolume,
            defaults: { ...base.settings.defaults, ...(sc.defaults ?? {}) }
          }
        : base.settings,
      quickMenu: patch.quickMenu ? { ...base.quickMenu, ...patch.quickMenu } : base.quickMenu
    }
    set({ release, dirty: true })
  },

  setAuthoring: (patch) => {
    const s = get(); if (!s.authoring) return
    commit(s); set({ authoring: { ...s.authoring, ...patch }, dirty: true })
  },
  addChapter: (name) => {
    const s = get(), id = uid('chapter_'); if (!s.authoring) throw new Error('请先新建工程')
    s.setAuthoring({ chapters: [...s.authoring.chapters, { id, name }] }); return id
  },
  addScene: (chapterId, name) => {
    const s = get(); if (!s.authoring?.chapters.some((c) => c.id === chapterId)) throw new Error('章节不存在')
    commit(s)
    const id = uid('scene_'), entryId = uid('n_')
    set({ authoring: { ...s.authoring, scenes: [...s.authoring.scenes, { id, chapterId, name, entryId }] },
      nodes: [...s.nodes, { id: entryId, sceneId: id, type: 'jump', position: { x: 0, y: 0 }, data: { label: name } }],
      activeSceneId: id, dirty: true })
    return id
  },
  updateScene: (id, patch) => {
    const s = get(); if (!s.authoring) return
    commit(s, 'typing'); set({ authoring: { ...s.authoring, scenes: s.authoring.scenes.map((c) => c.id === id ? { ...c, ...patch, id } : c) }, dirty: true })
  },
  applyScenePositions: (positions) => {
    const s = get(); if (!s.authoring) return
    const changes = new Map(positions.map((p) => [p.id, p.position]))
    if (!s.authoring.scenes.some((scene) => {
      const p = changes.get(scene.id)
      return p && (p.x !== scene.position?.x || p.y !== scene.position?.y)
    })) return
    // 一次拖动或整理是一条独立历史，不在每一帧写入工程。
    commit(s)
    set({ authoring: { ...s.authoring, scenes: s.authoring.scenes.map((scene) => changes.has(scene.id) ? { ...scene, position: changes.get(scene.id)! } : scene) }, dirty: true })
  },
  assignScene: (ids, sceneId) => {
    const s = get(); if (!s.authoring?.scenes.some((c) => c.id === sceneId)) throw new Error('场景不存在')
    commit(s); const selected = new Set(ids)
    set({ nodes: s.nodes.map((n) => selected.has(n.id) ? { ...n, sceneId } : n), dirty: true })
  },
  insertDialogue: (sceneId, afterId) => {
    const s = get(); if (!s.authoring?.scenes.some((c) => c.id === sceneId)) throw new Error('场景不存在')
    let previous = afterId ? s.nodes.find((n) => n.id === afterId) : s.nodes.filter((n) => n.sceneId === sceneId).at(-1)
    if (previous?.type === 'end') {
      const incoming = s.edges.filter((e) => e.target === previous!.id)
      if (incoming.length !== 1) throw new Error('结局有多个入口，请选择要插入对白的前置节点')
      previous = s.nodes.find((n) => n.id === incoming[0].source)
    }
    const outgoing = s.edges.filter((e) => e.source === previous?.id)
    if (previous?.type === 'choice' || outgoing.length > 1) throw new Error('请选择具体分支中的节点后插入对白')
    commit(s)
    const id = uid('n_'), node: StoryNode = { id, sceneId, type: 'dialogue', position: { x: previous?.position.x ?? 0, y: (previous?.position.y ?? 0) + 168 }, data: { speaker: '', text: '' } }
    const nodes = [...s.nodes]; nodes.splice(previous ? nodes.indexOf(previous) + 1 : nodes.length, 0, node)
    const edges = s.edges.filter((e) => e.source !== previous?.id)
    if (previous) edges.push({ id: uid('e_'), source: previous.id, sourceHandle: null, target: id })
    if (outgoing[0]) edges.push({ ...outgoing[0], source: id, sourceHandle: null })
    const scenes = s.authoring.scenes.map((c) => c.id === sceneId && !c.entryId ? { ...c, entryId: id } : c)
    set({ nodes, edges, authoring: { ...s.authoring, scenes }, dirty: true }); return id
  },
  removeDialogue: (id) => {
    const s = get(), node = s.nodes.find((n) => n.id === id)
    if (node?.type !== 'dialogue') throw new Error('仅连续对白支持自动接线删除')
    const outgoing = s.edges.filter((e) => e.source === id)
    if (outgoing.length > 1) throw new Error('对白有多个出口，请在节点画布处理')
    commit(s)
    const target = outgoing[0]?.target
    const edges = s.edges.filter((e) => e.source !== id && (e.target !== id || !!target)).map((e) => e.target === id ? { ...e, target: target! } : e)
    set({ nodes: s.nodes.filter((n) => n.id !== id), edges, authoring: s.authoring ? { ...s.authoring, scenes: s.authoring.scenes.map((c) => c.entryId === id ? { ...c, entryId: target ?? '' } : c) } : undefined, dirty: true })
  },
  replaceDialogue: (find, replacement, ids) => {
    if (!find) return
    const s = get(), selected = new Set(ids); commit(s)
    set({ nodes: s.nodes.map((n) => n.type === 'dialogue' && selected.has(n.id) ? { ...n, data: { ...n.data, text: (n.data.text ?? '').split(find).join(replacement) } } : n), dirty: true })
  },
  assignCharacter: (ids, characterId) => {
    const s = get(), character = s.authoring?.characters.find((c) => c.id === characterId)
    if (characterId && !character) throw new Error('角色不存在')
    const selected = new Set(ids); commit(s)
    set({ nodes: s.nodes.map((n) => n.type === 'dialogue' && selected.has(n.id) ? { ...n, data: { ...n.data, characterId: character?.id, speaker: character?.name ?? '' } } : n), dirty: true })
  },
  addCharacter: (name) => {
    const s = get(), id = uid('character_'); if (!s.authoring) throw new Error('请先新建工程')
    s.setAuthoring({ characters: [...s.authoring.characters, { id, name, color: '#c7d2fe', expressions: {} }] }); return id
  },
  updateCharacter: (id, patch) => {
    const s = get(); if (!s.authoring) return
    commit(s, 'typing')
    set({ authoring: { ...s.authoring, characters: s.authoring.characters.map((c) => c.id === id ? { ...c, ...patch, id } : c) },
      nodes: patch.name === undefined ? s.nodes : s.nodes.map((n) => n.data.characterId === id ? { ...n, data: { ...n.data, ...(n.type === 'dialogue' ? { speaker: patch.name } : { character: patch.name }) } } : n), dirty: true })
  },
  updateAsset: (key, patch) => {
    const s = get(); if (!s.assets[key]) return
    commit(s); set({ assets: { ...s.assets, [key]: { ...s.assets[key], ...patch } }, dirty: true })
  },
  addImportedAsset: (asset) => {
    const s = get(), existing = Object.entries(s.assets).find(([, a]) => a.type === asset.type && a.contentHash && a.contentHash === asset.contentHash)
    if (existing) return existing[0]
    commit(s); const key = uid('asset_'); set({ assets: { ...s.assets, [key]: asset }, dirty: true }); return key
  },

  onNodesChange: (changes) => {
    const s = get()
    const hasDrag = changes.some((c) => c.type === 'position' && (c as { dragging?: boolean }).dragging)
    const hasDragEnd = changes.some((c) => c.type === 'position' && (c as { dragging?: boolean }).dragging === false)
    if (hasDrag) commit(s, 'drag')
    if (hasDragEnd) history.dragCommitted = false
    const structural = changes.some((c) => c.type === 'remove' || c.type === 'add')
    if (structural) commit(s)
    // select / dimensions 等内部变更不算用户编辑，不标脏
    const userEdit = changes.some((c) => c.type === 'remove' || c.type === 'add' || c.type === 'position')

    const nodes = getFlowOperations().applyNodeChanges(changes, s.nodes)
    let edges = s.edges
    const removed = changes.filter((c) => c.type === 'remove')
    if (removed.length > 0) {
      const ids = new Set(removed.map((c) => (c as { id: string }).id))
      edges = edges.filter((e) => !ids.has(e.source) && !ids.has(e.target))
      set({ selectedOption: null })
    }
    set({ nodes, edges, ...(userEdit ? { dirty: true } : null) })
  },

  onEdgesChange: (changes) => {
    const s = get()
    const structural = changes.some((c) => c.type === 'remove' || c.type === 'add')
    if (structural) commit(s)
    set({ edges: getFlowOperations().applyEdgeChanges(changes, s.edges), dirty: true })
  },

  onConnect: (conn) => {
    const s = get()
    const src = s.nodes.find((n) => n.id === conn.source)
    const dst = s.nodes.find((n) => n.id === conn.target)
    if (!src || !dst || src.id === dst.id || dst.type === 'start' || src.type === 'end') return
    const handle = conn.sourceHandle ?? null

    commit(s)
    // 单出口槽位（start/dialogue/variable/jump 与 choice 的同一选项）只保留一条连线
    const edges = s.edges.filter((e) => !(e.source === conn.source && (e.sourceHandle ?? null) === handle))
    const edge: StoryEdge = { id: uid('e_'), source: conn.source, sourceHandle: handle, target: conn.target }
    set({ edges: getFlowOperations().addEdge(edge, edges as unknown as never[]), dirty: true })
  },

  addNode: (type, position) => {
    const s = get()
    if (type === 'start' && s.nodes.some((n) => n.type === 'start')) return null
    commit(s)
    const id = uid('n_')
    let node: StoryNode
    switch (type) {
      case 'start':
        node = { id, type, position, data: {} }
        break
      case 'dialogue':
        node = { id, type, position, data: { speaker: '', text: '' } }
        break
      case 'choice':
        node = {
          id,
          type,
          position,
          data: {
            options: [
              { id: uid('o_'), text: '', condition: null },
              { id: uid('o_'), text: '', condition: null }
            ]
          }
        }
        break
      case 'variable':
        node = { id, type, position, data: { ops: [] } }
        break
      case 'jump':
        node = { id, type, position, data: { label: '' } }
        break
      case 'end':
        node = { id, type, position, data: { label: '' } }
        break
      case 'bg':
        node = { id, type, position, data: { asset: '' } }
        break
      case 'sprite':
        node = { id, type, position, data: { asset: '', character: '', spritePos: 'center', spriteAction: 'show' } }
        break
      case 'audio':
        node = {
          id,
          type,
          position,
          data: { asset: '', audioKind: 'bgm', audioAction: 'play', loop: true, volume: 80 }
        }
        break
      case 'script':
        node = { id, type, position, data: { code: '' } }
        break
    }
    node.sceneId = s.activeSceneId ?? s.authoring?.scenes[0]?.id
    set((st) => ({ nodes: [...st.nodes, node], dirty: true }))
    return node
  },

  deleteNode: (id) => {
    const s = get()
    commit(s)
    set((st) => ({
      nodes: st.nodes.filter((n) => n.id !== id),
      edges: st.edges.filter((e) => e.source !== id && e.target !== id),
      dirty: true
    }))
  },

  updateNodeData: (id, patch, opts) => {
    const s = get()
    if (opts?.commit !== false) commit(s, 'typing')
    set((st) => ({
      nodes: st.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      dirty: true
    }))
  },

  addOption: (nodeId) => {
    const s = get()
    commit(s)
    set((st) => ({
      nodes: st.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, options: [...(n.data.options ?? []), { id: uid('o_'), text: '', condition: null }] } }
          : n
      ),
      dirty: true
    }))
  },

  updateOption: (nodeId, optionId, patch) => {
    const s = get()
    commit(s, 'typing')
    set((st) => ({
      nodes: st.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                options: (n.data.options ?? []).map((o) => (o.id === optionId ? { ...o, ...patch } : o))
              }
            }
          : n
      ),
      dirty: true
    }))
  },

  removeOption: (nodeId, optionId) => {
    const s = get()
    commit(s)
    set((st) => ({
      nodes: st.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, options: (n.data.options ?? []).filter((o) => o.id !== optionId) } }
          : n
      ),
      edges: st.edges.filter((e) => !(e.source === nodeId && (e.sourceHandle ?? null) === optionId)),
      dirty: true
    }))
  },

  moveOption: (nodeId, optionId, dir) => {
    const s = get()
    commit(s)
    set((st) => ({
      nodes: st.nodes.map((n) => {
        if (n.id !== nodeId) return n
        const opts = [...(n.data.options ?? [])]
        const i = opts.findIndex((o) => o.id === optionId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= opts.length) return n
        ;[opts[i], opts[j]] = [opts[j], opts[i]]
        return { ...n, data: { ...n.data, options: opts } }
      }),
      dirty: true
    }))
  },

  addVariable: (name, type, initial) => {
    const s = get()
    commit(s)
    set((st) => ({
      variables: [...st.variables, { id: uid('v_'), name, type, initial }],
      dirty: true
    }))
  },

  updateVariable: (id, patch) => {
    const s = get()
    commit(s, 'typing')
    set((st) => ({
      variables: st.variables.map((v) => (v.id === id ? { ...v, ...patch } : v)),
      dirty: true
    }))
  },

  removeVariable: (id) => {
    const s = get()
    commit(s)
    set((st) => ({ variables: st.variables.filter((v) => v.id !== id), dirty: true }))
  },

  addOp: (nodeId) => {
    const s = get()
    commit(s)
    const firstVar = s.variables[0]
    set((st) => ({
      nodes: st.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                ops: [
                  ...(n.data.ops ?? []),
                  { id: uid('op_'), variableId: firstVar?.id ?? '', op: 'set' as const, value: firstVar?.type === 'boolean' ? true : firstVar?.type === 'number' ? 0 : '' }
                ]
              }
            }
          : n
      ),
      dirty: true
    }))
  },

  updateOp: (nodeId, opId, patch) => {
    const s = get()
    commit(s, 'typing')
    set((st) => ({
      nodes: st.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, ops: (n.data.ops ?? []).map((op) => (op.id === opId ? { ...op, ...patch } : op)) } }
          : n
      ),
      dirty: true
    }))
  },

  removeOp: (nodeId, opId) => {
    const s = get()
    commit(s)
    set((st) => ({
      nodes: st.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ops: (n.data.ops ?? []).filter((op) => op.id !== opId) } } : n
      ),
      dirty: true
    }))
  },

  addAsset: async (name, type, dataUrl) => {
    const revision = get().revision
    const hash = await hashAssetDataUrl(dataUrl)
    // 摘要计算期间可能切换工程或有另一次导入完成，不能使用过期的素材库。
    for (;;) {
      const assets = get().assets
      const existing = await findAssetByContent(assets, type, hash)
      const s = get()
      if (s.revision !== revision) throw new Error('工程已切换，请在当前工程重新导入素材')
      if (s.assets !== assets) continue
      if (existing) return existing
      // 检查与写入之间不再 await，保证并发导入仅创建一份素材。
      commit(s)
      const key = uid('a_')
      set({ assets: { ...assets, [key]: { name, type, dataUrl } }, dirty: true })
      return key
    }
  },

  removeAsset: (key) => {
    const s = get()
    commit(s)
    set((st) => {
      const assets = { ...st.assets }
      delete assets[key]
      return {
        assets,
        nodes: st.nodes.map((n) => (n.data.asset === key ? { ...n, data: { ...n.data, asset: '' } } : n)),
        dirty: true
      }
    })
  },

  setCustomCode: (patch) => {
    const s = get()
    commit(s, 'typing')
    set((st) => ({
      customCss: patch.customCss ?? st.customCss,
      customJs: patch.customJs ?? st.customJs,
      dirty: true
    }))
  },

  undo: () => {
    const s = get()
    if (history.past.length === 0) return
    const prev = history.past.pop()!
    history.future.unshift(snap(s))
    set({ ...prev, dirty: true, pastCount: history.past.length, futureCount: history.future.length })
  },

  redo: () => {
    const s = get()
    if (history.future.length === 0) return
    const next = history.future.shift()!
    history.past.push(snap(s))
    set({ ...next, dirty: true, pastCount: history.past.length, futureCount: history.future.length })
  },

  canUndo: () => history.past.length > 0,
  canRedo: () => history.future.length > 0,

  serialize: () => {
    const s = get()
    return JSON.stringify(
      {
        version: 4,
        authoring: s.authoring,
        meta: s.meta,
        assets: s.assets,
        release: s.release,
        customCss: s.customCss,
        customJs: s.customJs,
        variables: s.variables,
        nodes: s.nodes,
        edges: s.edges
      } satisfies StoryProject,
      null,
      2
    )
  },

  getProject: () => {
    const s = get()
    return {
      version: 4,
      authoring: s.authoring,
      meta: s.meta,
      assets: s.assets,
      release: s.release,
      customCss: s.customCss,
      customJs: s.customJs,
      variables: s.variables,
      nodes: s.nodes,
      edges: s.edges
    }
  },

  markSaved: (path) => {
    const s = get()
    set({
      filePath: path ?? s.filePath,
      lastSavedJson: s.serialize(),
      dirty: false
    })
  }
}))

/** 清空历史（工程切换时由 loadProject 处理，此处导出便于测试） */
export function resetHistory(): void {
  history.past = []
  history.future = []
  history.typingActive = false
  history.dragCommitted = false
}

// 历史在 zustand 之外维护；订阅状态变化把历史深度同步进 store 以驱动 UI
useProjectStore.subscribe(() => {
  const st = useProjectStore.getState()
  if (st.pastCount !== history.past.length || st.futureCount !== history.future.length) {
    useProjectStore.setState({ pastCount: history.past.length, futureCount: history.future.length })
  }
})

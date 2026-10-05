/**
 * FableLoom 工程文件数据模型（.story.json）
 * 编辑器与可玩运行时共用此定义。
 *
 * version 2：新增视觉小说多媒体节点（bg / sprite / audio）与内嵌素材库 assets。
 * 素材以 data URL 内嵌在工程文件里，保证 .story.json 单文件即完整可移植。
 * version 3：新增演出脚本节点（script，自定义效果 API）与工程级自定义代码
 * customCss / customJs（对试玩与导出 HTML 同时生效）。
 */

export type NodeType =
  | 'start'
  | 'dialogue'
  | 'choice'
  | 'variable'
  | 'jump'
  | 'end'
  | 'bg'
  | 'sprite'
  | 'audio'
  | 'script'

export type VarType = 'number' | 'string' | 'boolean'
export type VarValue = number | string | boolean

export type CompareOp = '==' | '!=' | '>' | '>=' | '<' | '<='
export type AssignOp = 'set' | 'add' | 'sub'

/** 结构化条件：变量 操作符 值（不做任意表达式求值） */
export interface Condition {
  variableId: string
  op: CompareOp
  value: VarValue
}

export interface ChoiceOption {
  id: string
  text: string
  /** 为空表示永远可见 */
  condition: Condition | null
}

export interface VarOp {
  id: string
  variableId: string
  op: AssignOp
  value: VarValue
}

/** 内嵌素材（图片/音频），dataUrl 直接可被 <img>/<audio> 使用 */
export interface StoryAsset {
  name: string
  type: 'image' | 'audio'
  dataUrl: string
  /** v4 团队工程只存相对路径与摘要；以下运行时地址不进入工程清单。 */
  path?: string
  contentHash?: string
  bytes?: number
  mime?: string
  category?: string
  placeholder?: boolean
  missing?: boolean
  runtimeUrl?: string
  sourcePath?: string
}

export interface StoryChapter { id: string; name: string }
export interface StoryScene {
  id: string; chapterId: string; name: string; entryId: string
  notes?: string; bookmark?: boolean; position?: { x: number; y: number }
}
export interface StoryCharacter {
  id: string; name: string; color: string; defaultAsset?: string
  expressions: Record<string, string>
}
export interface AuthoringData {
  gameId: string
  releaseVersion: string
  saveCompatibilityVersion: number
  chapters: StoryChapter[]
  scenes: StoryScene[]
  characters: StoryCharacter[]
  migrationWarnings: string[]
}

export interface StoryNode {
  id: string
  /** 节点 id 同时作为稳定对白 id；编辑文本不重新编号。 */
  sceneId?: string
  type: NodeType
  position: { x: number; y: number }
  data: {
    /** dialogue */
    speaker?: string
    characterId?: string
    notes?: string
    expression?: string
    voiceAsset?: string
    text?: string
    /** choice */
    options?: ChoiceOption[]
    /** variable */
    ops?: VarOp[]
    /** jump / end 的展示标签 */
    label?: string
    /** bg / sprite / audio 引用的素材 key（project.assets 的键） */
    asset?: string
    /** sprite */
    character?: string
    spritePos?: 'left' | 'center' | 'right' | 'custom'
    /** spritePos === 'custom' 时的水平位置：画面宽度百分比 0-100（立绘中心点） */
    spriteX?: number
    spriteAction?: 'show' | 'hide'
    /** audio */
    audioKind?: 'bgm' | 'sfx'
    audioAction?: 'play' | 'stop'
    loop?: boolean
    /** 音量 0-100 */
    volume?: number
    /** script：演出脚本代码（可 await，可用 api / vars / story 三个入参） */
    code?: string
  }
}

export interface StoryEdge {
  id: string
  source: string
  /** choice 节点每个选项一个端口；其余节点为 null（单出口） */
  sourceHandle: string | null
  target: string
}

export interface StoryMeta {
  title: string
  author: string
  description: string
}

export interface VariableDef {
  id: string
  name: string
  type: VarType
  initial: VarValue
}

export interface StoryProject {
  version: 3 | 4
  authoring?: AuthoringData
  meta: StoryMeta
  /** 发布配置（v0.6+，可选）：标题画面/玩家设置/快捷菜单；缺省按 normalizeRelease 的默认值 */
  release?: ReleaseConfig
  assets: Record<string, StoryAsset>
  /** 工程级自定义 CSS：注入试玩容器与导出 HTML（.tgr- 前缀选择器可覆盖运行时样式） */
  customCss: string
  /** 工程级自定义 JS：运行时启动时执行一次，可用 api / vars / story（同演出脚本） */
  customJs: string
  variables: VariableDef[]
  nodes: StoryNode[]
  edges: StoryEdge[]
}

/** 旧版/不完整工程（磁盘上读到的原始 JSON） */
export type StoredProject = Partial<Omit<StoryProject, 'version'>> & { version?: number }

/**
 * 自定义接口：演出脚本节点与工程级 customJs 运行时可用的效果 API。
 * 脚本以 `api` / `vars` / `story` 三个入参注入；say/narrate/wait/fadeOut/fadeIn
 * 返回 Promise，可在脚本里 await 实现连续演出。
 */
export interface ScriptApi {
  /** 显示一句对白，玩家点击「继续」后返回（可在脚本里连续调用） */
  say(speaker: string, text: string): Promise<void>
  /** 显示一句旁白（无说话人），点击继续后返回 */
  narrate(text: string): Promise<void>
  /** 等待指定毫秒 */
  wait(ms: number): Promise<void>
  /** 屏幕震动（强度 px，默认 8；时长 ms，默认 400） */
  shake(intensity?: number, ms?: number): void
  /** 全屏闪光后淡出（颜色默认白色；时长 ms，默认 300） */
  flash(color?: string, ms?: number): void
  /** 遮罩淡入（转场出）：颜色默认黑色，时长 ms 默认 600 */
  fadeOut(color?: string, ms?: number): Promise<void>
  /** 遮罩淡出（转场入）：时长 ms 默认 600 */
  fadeIn(ms?: number): Promise<void>
  /** 切换背景（按素材名），在 fade 毫秒内交叉淡化（默认 500） */
  bg(name: string, opts?: { fade?: number }): void
  /** 显示立绘（按素材名；pos 默认居中，传 x 时按 x 定位（0-100，画面宽度百分比）） */
  sprite(name: string, pos?: 'left' | 'center' | 'right', opts?: { character?: string; x?: number }): void
  /** 移除指定位置的立绘 */
  hideSprite(pos?: 'left' | 'center' | 'right'): void
  /** 播放 BGM（按素材名）；不传名称或传空字符串表示停止 */
  bgm(name: string | '', opts?: { volume?: number; loop?: boolean }): void
  /** 播放一次音效（按素材名） */
  sfx(name: string, opts?: { volume?: number }): void
  /** 注入/更新一条动态样式规则，如 api.setStyle('.tgr-card', 'background:#123') */
  setStyle(selector: string, cssText: string): void
  /** 追加一段自定义 CSS（一次性） */
  css(cssText: string): void
  /** 跳转到指定名称的「跳转点/结局」节点（脚本结束后生效） */
  goto(nodeLabel: string): void
}

/**
 * ---------- 发布配置（release） ----------
 * 创作者对「导出作品」呈现方式的定制：标题画面、玩家设置面板、快捷菜单等。
 * 随 .story.json 一起存储，试玩与导出 HTML 共用同一份配置（所见即所得）。
 * 所有字段均可选，运行时经 normalizeRelease 与默认值合并，旧工程无需迁移。
 */

export interface ReleaseTitleScreen {
  /** 是否启用标题画面（默认启用） */
  enabled: boolean
  /** 标题画面背景素材 key（project.assets 的键）；空字符串 = 主题深色底 */
  backgroundAsset: string
  /** 标题下方显示作品名与作者 */
  showMeta: boolean
  /** 显示作品版本号 */
  showVersion: boolean
  /** 菜单文案；空字符串用默认文案 */
  labels: { start: string; continue: string; load: string; settings: string; credits: string }
}

export interface ReleaseSettingsScreen {
  /** 玩家可调文字速度 */
  textSpeed: boolean
  /** 玩家可调自动播放速度 */
  autoSpeed: boolean
  /** 玩家可调 BGM 音量 */
  bgmVolume: boolean
  /** 玩家可调音效音量 */
  sfxVolume: boolean
  /** 各设置项的出厂默认值 */
  defaults: { textSpeed: number; autoLevel: number; bgmVolume: number; sfxVolume: number }
}

/** 游戏内快捷菜单的入口开关（全部默认开启） */
export interface ReleaseQuickMenu {
  saves: boolean
  backlog: boolean
  auto: boolean
  skip: boolean
  settings: boolean
  /** 回到标题画面 */
  title: boolean
  fullscreen: boolean
}

export interface ReleaseConfig {
  titleScreen: ReleaseTitleScreen
  settings: ReleaseSettingsScreen
  quickMenu: ReleaseQuickMenu
  /** 作品版本号（标题画面与关于页展示） */
  version: string
  /** 关于/制作名单文本；空 = 隐藏「关于」入口 */
  credits: string
}

export function defaultRelease(): ReleaseConfig {
  return {
    titleScreen: {
      enabled: true,
      backgroundAsset: '',
      showMeta: true,
      showVersion: false,
      labels: { start: '', continue: '', load: '', settings: '', credits: '' }
    },
    settings: {
      textSpeed: true,
      autoSpeed: true,
      bgmVolume: true,
      sfxVolume: true,
      defaults: { textSpeed: 24, autoLevel: 5, bgmVolume: 80, sfxVolume: 80 }
    },
    quickMenu: { saves: true, backlog: true, auto: true, skip: true, settings: true, title: true, fullscreen: true },
    version: '',
    credits: ''
  }
}

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const clampNum = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 磁盘上读到的 release 可能缺字段/来自旧版本，与默认值深合并并收紧取值范围。 */
export function normalizeRelease(raw: unknown): ReleaseConfig {
  const d = defaultRelease()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReleaseConfig>
  const t = (r.titleScreen && typeof r.titleScreen === 'object' ? r.titleScreen : {}) as Partial<ReleaseTitleScreen>
  const s = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Partial<ReleaseSettingsScreen>
  const sd = (s.defaults && typeof s.defaults === 'object' ? s.defaults : {}) as Partial<ReleaseSettingsScreen['defaults']>
  const q = (r.quickMenu && typeof r.quickMenu === 'object' ? r.quickMenu : {}) as Partial<ReleaseQuickMenu>
  const l = (t.labels && typeof t.labels === 'object' ? t.labels : {}) as Partial<ReleaseTitleScreen['labels']>
  return {
    titleScreen: {
      enabled: bool(t.enabled, d.titleScreen.enabled),
      backgroundAsset: text(t.backgroundAsset),
      showMeta: bool(t.showMeta, d.titleScreen.showMeta),
      showVersion: bool(t.showVersion, d.titleScreen.showVersion),
      labels: {
        start: text(l.start),
        continue: text(l.continue),
        load: text(l.load),
        settings: text(l.settings),
        credits: text(l.credits)
      }
    },
    settings: {
      textSpeed: bool(s.textSpeed, d.settings.textSpeed),
      autoSpeed: bool(s.autoSpeed, d.settings.autoSpeed),
      bgmVolume: bool(s.bgmVolume, d.settings.bgmVolume),
      sfxVolume: bool(s.sfxVolume, d.settings.sfxVolume),
      defaults: {
        textSpeed: clampNum(sd.textSpeed, 0, 100, d.settings.defaults.textSpeed),
        autoLevel: clampNum(sd.autoLevel, 1, 10, d.settings.defaults.autoLevel),
        bgmVolume: clampNum(sd.bgmVolume, 0, 100, d.settings.defaults.bgmVolume),
        sfxVolume: clampNum(sd.sfxVolume, 0, 100, d.settings.defaults.sfxVolume)
      }
    },
    quickMenu: {
      saves: bool(q.saves, d.quickMenu.saves),
      backlog: bool(q.backlog, d.quickMenu.backlog),
      auto: bool(q.auto, d.quickMenu.auto),
      skip: bool(q.skip, d.quickMenu.skip),
      settings: bool(q.settings, d.quickMenu.settings),
      title: bool(q.title, d.quickMenu.title),
      fullscreen: bool(q.fullscreen, d.quickMenu.fullscreen)
    },
    version: text(r.version),
    credits: typeof r.credits === 'string' && r.credits.length <= 20_000 ? r.credits : ''
  }
}

export const PROJECT_EXT = 'story.json'

export function emptyMeta(): StoryMeta {
  return { title: '未命名故事', author: '', description: '' }
}

export function emptyProject(): StoryProject {
  return { version: 3, meta: emptyMeta(), assets: {}, customCss: '', customJs: '', variables: [], nodes: [], edges: [] }
}

/**
 * 兼容载入：v1/v2 工程补上空素材库与自定义代码；缺失字段全部兜底。
 * v1 → v2 只新增 assets 与媒体节点类型；v2 → v3 只新增 script 节点与
 * customCss/customJs，均为可选字段，无需转换节点。
 */
export function migrateProject(raw: StoredProject | null | undefined): StoryProject {
  if (raw?.version != null && raw.version > 4) throw new Error(`工程版本 ${raw.version} 高于当前支持的版本 4，请升级编辑器。`)
  const p = (raw ?? {}) as Partial<StoryProject>
  return {
    version: p.version === 4 ? 4 : 3,
    authoring: p.authoring,
    meta: {
      title: p.meta?.title ?? '未命名故事',
      author: p.meta?.author ?? '',
      description: p.meta?.description ?? ''
    },
    assets: p.assets && typeof p.assets === 'object' ? p.assets : {},
    release: normalizeRelease(p.release),
    customCss: typeof p.customCss === 'string' ? p.customCss : '',
    customJs: typeof p.customJs === 'string' ? p.customJs : '',
    variables: Array.isArray(p.variables) ? p.variables : [],
    nodes: (Array.isArray(p.nodes) ? p.nodes : []).map((n) =>
      n.type === 'script' ? { ...n, data: { code: '', ...n.data } } : n
    ),
    edges: Array.isArray(p.edges) ? p.edges : []
  }
}

let seq = 0
export function uid(prefix = ''): string {
  seq = (seq + 1) % 1000
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, '0')}`
}

/** ---------- 运行时语义（编辑器试玩与导出运行时保持一致） ---------- */

export function evalCondition(c: Condition, vars: Record<string, VarValue>): boolean {
  const actual = vars[c.variableId]
  const expected = c.value
  const bothNumeric =
    (typeof actual === 'number' || (typeof actual === 'string' && actual.trim() !== '' && !isNaN(Number(actual)))) &&
    typeof expected !== 'boolean' && !isNaN(Number(expected))
  const a: number | string | boolean = bothNumeric ? Number(actual) : actual ?? ''
  const b: number | string | boolean = bothNumeric ? Number(expected) : expected
  switch (c.op) {
    case '==':
      return a === b
    case '!=':
      return a !== b
    case '>':
      return a > b
    case '>=':
      return a >= b
    case '<':
      return a < b
    case '<=':
      return a <= b
  }
}

export function applyOp(op: VarOp, vars: Record<string, VarValue>): void {
  const current = vars[op.variableId]
  if (op.op === 'set') {
    vars[op.variableId] = op.value
    return
  }
  const delta = Number(op.value) || 0
  const base = typeof current === 'number' ? current : Number(current) || 0
  vars[op.variableId] = op.op === 'add' ? base + delta : base - delta
}

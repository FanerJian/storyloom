import type { StoryProject, VarValue } from './schema'

/** Player progress has its own version; it does not change the authoring schema. */
export const PLAYER_SAVE_VERSION = 1
export const PLAYER_SLOT_COUNT = 6
export const BACKLOG_LIMIT = 500
export type PlayerSpritePos = 'left' | 'center' | 'right' | 'custom'
export interface BacklogEntry { speaker: string; text: string; kind: 'dialogue' | 'choice' }
export interface SavedSprite { asset: string; character: string; x: number | null }
export interface PlayerSave {
  version: 1
  revision: string
  savedAt: number
  nodeId: string
  vars: Record<string, VarValue>
  backlog: BacklogEntry[]
  media: {
    background: string | null
    sprites: Record<PlayerSpritePos, SavedSprite | null>
    bgm: { asset: string; volume: number; loop: boolean; time: number } | null
  }
  presentation: { css: string; rules: [string, string][]; overlayColor: string; overlayOpacity: string }
  /** 存档时画面的缩略图（jpeg data URL，可选；仅用于存档面板展示） */
  thumb?: string
}

/** ---------- 玩家设置（文字速度/自动播放/音量），按作品隔离存放在浏览器 ---------- */

export interface PlayerSettings {
  /** 每字间隔 ms（0 立即显示） */
  textSpeed: number
  /** 自动播放速度档位 1-10（越大越快） */
  autoLevel: number
  /** BGM 主音量 0-100（与节点/脚本的音量相乘） */
  bgmVolume: number
  /** 音效主音量 0-100 */
  sfxVolume: number
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = { textSpeed: 24, autoLevel: 5, bgmVolume: 80, sfxVolume: 80 }

function hash(text: string): string {
  let a = 2166136261
  let b = 0x9e3779b9
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 16777619)
    b = Math.imul(b ^ c, 2246822519)
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function playerIdentity(story: StoryProject, namespace = 'game', startNodeId?: string): string {
  if (story.authoring?.gameId) return `storyloom:player:${namespace}:${story.authoring.gameId}${namespace === 'playtest' && startNodeId ? `:${startNodeId}` : ''}`
  const start = startNodeId ?? story.nodes.find((n) => n.type === 'start')?.id ?? story.nodes[0]?.id ?? ''
  return `storyloom:player:${namespace}:${hash(canonical([story.meta.title, story.meta.author, start]))}`
}

/** Asset bytes are hashed separately so we never duplicate all base64 data in a JSON string. */
export function playerRevision(story: StoryProject, plugins: unknown = []): string {
  if (story.authoring) return `v4:${story.authoring.gameId}:${story.authoring.saveCompatibilityVersion}`
  return hash(canonical({
    meta: story.meta, variables: story.variables, customJs: story.customJs, customCss: story.customCss, plugins,
    nodes: story.nodes.map(({ id, type, data }) => ({ id, type, data })).sort((a, b) => a.id.localeCompare(b.id)),
    edges: story.edges.map(({ source, sourceHandle, target }) => ({ source, sourceHandle, target })),
    assets: Object.keys(story.assets ?? {}).sort().map((key) => {
      const asset = story.assets[key]
      return [key, asset.name, asset.type, hash(asset.dataUrl)]
    })
  }))
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isText = (v: unknown, max = 100_000): v is string => typeof v === 'string' && v.length <= max
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function validatePlayerSave(raw: unknown, story: StoryProject, revision: string): PlayerSave | null {
  if (!isObject(raw) || raw.version !== PLAYER_SAVE_VERSION || raw.revision !== revision ||
      !finite(raw.savedAt) || raw.savedAt < 0 || !isText(raw.nodeId)) return null
  const node = story.nodes.find((n) => n.id === raw.nodeId)
  if (!node || !['dialogue', 'choice', 'end'].includes(node.type)) return null
  if (!isObject(raw.vars) || Object.keys(raw.vars).length > 10_000 ||
      !Object.values(raw.vars).every((v) => finite(v) || isText(v) || typeof v === 'boolean')) return null
  const vars = raw.vars
  if (story.variables.some((v) => typeof vars[v.id] !== v.type)) return null
  if (!Array.isArray(raw.backlog) || raw.backlog.length > BACKLOG_LIMIT ||
      !raw.backlog.every((v) => isObject(v) && isText(v.speaker) && isText(v.text) && ['dialogue', 'choice'].includes(String(v.kind)))) return null
  const media = raw.media
  const asset = (key: unknown, kind: 'image' | 'audio'): boolean => isText(key) && story.assets[key]?.type === kind
  if (!isObject(media) || !(media.background === null || asset(media.background, 'image')) || !isObject(media.sprites)) return null
  for (const pos of ['left', 'center', 'right', 'custom']) {
    const sprite = media.sprites[pos]
    if (sprite !== null && (!isObject(sprite) || !asset(sprite.asset, 'image') || !isText(sprite.character) ||
        !(sprite.x === null || (finite(sprite.x) && sprite.x >= 0 && sprite.x <= 100)))) return null
  }
  if (media.bgm !== null && (!isObject(media.bgm) || !asset(media.bgm.asset, 'audio') ||
      !finite(media.bgm.volume) || media.bgm.volume < 0 || media.bgm.volume > 1 || typeof media.bgm.loop !== 'boolean' ||
      !finite(media.bgm.time) || media.bgm.time < 0)) return null
  const view = raw.presentation
  if (!isObject(view) || !isText(view.css, 500_000) || !isText(view.overlayColor, 1000) ||
      !['', '0', '1'].includes(String(view.overlayOpacity)) || !Array.isArray(view.rules) || view.rules.length > 1000 ||
      !view.rules.every((v) => Array.isArray(v) && v.length === 2 && v.every((s) => isText(s)))) return null
  // thumb 是可选的展示用缩略图：必须是小体积 image data URL（会作为 <img src> 渲染）
  if (raw.thumb !== undefined && (!isText(raw.thumb, 300_000) || !raw.thumb.startsWith('data:image/'))) return null
  return raw as unknown as PlayerSave
}

export type SlotResult = { kind: 'empty' } | { kind: 'invalid' } | { kind: 'ready'; save: PlayerSave }
export interface PlayerStorage {
  available: boolean
  read(slot: number): SlotResult
  write(slot: number, save: PlayerSave): boolean
  remove(slot: number): boolean
  speed(value?: number): number
  /** 完整玩家设置；传参即持久化（范围外的值按默认值收敛，任何异常不中断游戏） */
  settings(value?: Partial<PlayerSettings>): PlayerSettings
}

const clamp = (n: number, min: number, max: number, fallback = DEFAULT_PLAYER_SETTINGS.textSpeed): number =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback

/** Browser policies and quota failures must never interrupt the game. */
export function createPlayerStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
  key: string, story: StoryProject, revision: string): PlayerStorage {
  let settingsCache: PlayerSettings | null = null
  const readSettings = (): PlayerSettings => {
    if (settingsCache) return settingsCache
    let merged: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS }
    try {
      const raw = storage?.getItem(`${key}:settings`)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PlayerSettings>
        if (parsed && typeof parsed === 'object') {
          merged = {
            textSpeed: clamp(Number(parsed.textSpeed), 0, 100, DEFAULT_PLAYER_SETTINGS.textSpeed),
            autoLevel: clamp(Number(parsed.autoLevel), 1, 10, DEFAULT_PLAYER_SETTINGS.autoLevel),
            bgmVolume: clamp(Number(parsed.bgmVolume), 0, 100, DEFAULT_PLAYER_SETTINGS.bgmVolume),
            sfxVolume: clamp(Number(parsed.sfxVolume), 0, 100, DEFAULT_PLAYER_SETTINGS.sfxVolume)
          }
        }
      }
    } catch { /* 损坏的设置按默认值处理 */ }
    settingsCache = merged
    return merged
  }
  const result: PlayerStorage = {
    available: !!storage,
    read(slot) {
      let json: string | null | undefined
      try {
        json = storage?.getItem(`${key}:slot:${slot}`)
      } catch { result.available = false; return { kind: 'invalid' } }
      if (!json) return { kind: 'empty' }
      try {
        const save = validatePlayerSave(JSON.parse(json), story, revision)
        return save ? { kind: 'ready', save } : { kind: 'invalid' }
      } catch { return { kind: 'invalid' } }
    },
    write(slot, save) {
      try {
        if (!storage || slot < 1 || slot > PLAYER_SLOT_COUNT || !validatePlayerSave(save, story, revision)) return false
        const json = JSON.stringify(save)
        if (json.length > 2_000_000) return false
        storage.setItem(`${key}:slot:${slot}`, json)
        result.available = true
        return true
      } catch { result.available = false; return false }
    },
    remove(slot) {
      try { if (!storage) return false; storage.removeItem(`${key}:slot:${slot}`); result.available = true; return true }
      catch { result.available = false; return false }
    },
    speed(value) {
      const s = readSettings()
      if (value !== undefined) {
        result.settings({ textSpeed: clamp(value, 0, 100, s.textSpeed) })
        return clamp(value, 0, 100, s.textSpeed)
      }
      return s.textSpeed
    },
    settings(value) {
      try {
        if (value !== undefined) {
          const next: PlayerSettings = { ...readSettings(), ...value }
          next.textSpeed = clamp(next.textSpeed, 0, 100, DEFAULT_PLAYER_SETTINGS.textSpeed)
          next.autoLevel = clamp(next.autoLevel, 1, 10, DEFAULT_PLAYER_SETTINGS.autoLevel)
          next.bgmVolume = clamp(next.bgmVolume, 0, 100, DEFAULT_PLAYER_SETTINGS.bgmVolume)
          next.sfxVolume = clamp(next.sfxVolume, 0, 100, DEFAULT_PLAYER_SETTINGS.sfxVolume)
          storage?.setItem(`${key}:settings`, JSON.stringify(next))
          settingsCache = next
          result.available = true
          return { ...next }
        }
        return { ...readSettings() }
      } catch { result.available = false; return { ...readSettings() } }
    }
  }
  return result
}

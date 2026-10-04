import type { StoryProject, StoryAsset } from './schema'
import type { RecoverySnapshot } from './recovery'

export type { RecoverySnapshot } from './recovery'

export interface WriteResult {
  ok: boolean
  error?: string
}

export interface RecoveryListResult {
  snapshots: RecoverySnapshot[]
  /** 无法读取的文件会保留，供用户排查，而不会被覆盖或删除。 */
  error?: string
}

/** 宿主 API 类型（Electron preload / Tauri 适配层 / 浏览器回退三端实现同一接口） */

export interface OpenResult {
  canceled: boolean
  path?: string
  project?: StoryProject
  /** Yarn / Ink 脚本文本（按 path 扩展名分派解析），与 project 二选一 */
  content?: string
  error?: string
}

export interface SaveResult {
  canceled: boolean
  path?: string
  error?: string
  project?: StoryProject
  written?: string[]
  conflicts?: string[]
  merged?: string[]
}

export interface SaveOptions { as?: boolean; path?: string; format?: 'directory' | 'single' }

export interface RecentItem {
  path: string
  title: string
  lastOpened: number
}

export interface FileFilter {
  name: string
  extensions: string[]
}

/** 选取并读取一个素材文件（图片/音频），返回 data URL */
export interface ImportAssetResult {
  canceled: boolean
  name?: string
  dataUrl?: string
  error?: string
  asset?: StoryAsset
}

/** 打开一个文本文件（Yarn/Ink 导入） */
export interface OpenTextResult {
  canceled: boolean
  path?: string
  content?: string
  error?: string
}

export interface HostApi {
  openProject: () => Promise<OpenResult>
  saveProject: (project: StoryProject, opts?: SaveOptions) => Promise<SaveResult>
  writeFile: (path: string, content: string) => Promise<WriteResult>
  listRecovery: () => Promise<RecoveryListResult>
  writeRecovery: (snapshot: RecoverySnapshot) => Promise<WriteResult>
  clearRecovery: (id: string) => Promise<WriteResult>
  importAsset: (projectPath?: string) => Promise<ImportAssetResult>
  openProjectPath?: (path: string) => Promise<OpenResult>
  checkProjectChanges?: (path: string) => Promise<string[]>
  embedProjectAssets?: (project: StoryProject) => Promise<StoryProject>
  openTextFile: (filters: FileFilter[], title?: string) => Promise<OpenTextResult>
  saveTextFile: (defaultName: string, content: string, filters: FileFilter[], title?: string) => Promise<SaveResult>
  listRecent: () => Promise<RecentItem[]>
  removeRecent: (path: string) => Promise<{ ok: boolean }>
  setWindowTitle: (title: string) => Promise<void>
  appInfo: () => Promise<{ version: string; isDev: boolean }>
  onMenuAction: (cb: (action: string) => void) => () => void
  /** 桌面壳等待此回调完成再关闭；拒绝时保留窗口。 */
  onBeforeClose: (cb: () => Promise<void>) => () => void
}

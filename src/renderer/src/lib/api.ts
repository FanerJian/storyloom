import type { StoryProject } from '@shared/schema'
import type { FileFilter, HostApi, ImportAssetResult, OpenResult, OpenTextResult, RecentItem, SaveResult, SaveOptions, RecoveryListResult, RecoverySnapshot, WriteResult } from '@shared/api'
import { MIME_BY_EXT } from '@shared/mime'
import { parseRecovery } from '@shared/recovery'
import { listBrowserRecovery, writeBrowserRecovery, clearBrowserRecovery } from './browserRecovery'

/**
 * 统一的宿主 API：同一套 HostApi 接口有三套实现——
 * - Electron：window.api（preload IPC）
 * - Tauri：@tauri-apps/plugin-dialog / plugin-fs（见 src-tauri）
 * - 浏览器调试模式：文件选择/下载 + localStorage 回退
 * 按运行环境自动选择，渲染层 UI 无感知。
 */

const LS_KEY = 'storyloom.browser-projects'
const LS_RECENT = 'storyloom.browser-recent'

interface BrowserRecord {
  name: string
  content: string
  savedAt: number
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.api
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function readRecords(): BrowserRecord[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as BrowserRecord[]
  } catch {
    return []
  }
}

function writeRecords(items: BrowserRecord[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(items.slice(0, 20)))
}

function pickFile(accept: string): Promise<{ name: string; content: string } | null> {
  return new Promise((resolvePromise) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolvePromise(null)
      const reader = new FileReader()
      reader.onload = () => resolvePromise({ name: file.name, content: String(reader.result ?? '') })
      reader.onerror = () => resolvePromise(null)
      reader.readAsText(file)
    }
    input.click()
  })
}

function downloadFile(name: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function extAccept(filters: FileFilter[]): string {
  return filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',')
}

// 扩展名 → MIME 映射统一在 @shared/mime（main 进程与渲染层共用）

function base64Of(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/* ---------------- Tauri 实现 ---------------- */

async function tauriOpenProject(): Promise<OpenResult> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({
    title: '打开工程 / 导入',
    multiple: false,
    filters: [
      { name: '文字游戏工程', extensions: ['story.json', 'json'] },
      { name: 'Yarn 脚本', extensions: ['yarn'] },
      { name: 'Ink 脚本', extensions: ['ink'] }
    ]
  })
  if (!path || typeof path !== 'string') return { canceled: true }
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'yarn' || ext === 'ink') {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    return { canceled: false, path, content: await readTextFile(path) }
  }
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const project = JSON.parse(await readTextFile(path)) as StoryProject
    pushRecent(path, project.meta?.title ?? '')
    return { canceled: false, path, project }
  } catch (err) {
    return { canceled: true, error: String(err) }
  }
}

async function tauriSaveProject(
  project: StoryProject,
  opts: { as?: boolean; path?: string }
): Promise<SaveResult> {
  const content = JSON.stringify(project, null, 2)
  let path = opts.as || !opts.path ? null : opts.path
  if (!path) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    path = await save({
      title: '保存工程',
      defaultPath: `${project.meta?.title || '未命名故事'}.story.json`,
      filters: [{ name: '文字游戏工程', extensions: ['story.json'] }]
    })
  }
  if (!path) return { canceled: true }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('write_project_file', { path, content })
    pushRecent(path, project.meta?.title ?? '')
    return { canceled: false, path }
  } catch (err) {
    return { canceled: true, error: String(err) }
  }
}

async function tauriImportAsset(): Promise<ImportAssetResult> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({
    title: '导入素材（图片 / 音频）',
    multiple: false,
    filters: [
      {
        name: '图片与音频',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp3', 'wav', 'ogg', 'm4a']
      }
    ]
  })
  if (!path || typeof path !== 'string') return { canceled: true }
  try {
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    const mime = MIME_BY_EXT[ext]
    if (!mime) return { canceled: true, error: `不支持的素材格式：${ext}` }
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const bytes = await readFile(path)
    const name = path.replace(/\\/g, '/').split('/').pop() ?? path
    return { canceled: false, name, dataUrl: `data:${mime};base64,${base64Of(bytes)}` }
  } catch (err) {
    return { canceled: true, error: String(err) }
  }
}

async function tauriOpenTextFile(filters: FileFilter[], title?: string): Promise<OpenTextResult> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({ title: title ?? '导入', multiple: false, filters })
  if (!path || typeof path !== 'string') return { canceled: true }
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    return { canceled: false, path, content: await readTextFile(path) }
  } catch (err) {
    return { canceled: true, error: String(err) }
  }
}

async function tauriSaveTextFile(
  defaultName: string,
  content: string,
  filters: FileFilter[],
  title?: string
): Promise<SaveResult> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ title: title ?? '导出', defaultPath: defaultName, filters })
  if (!path) return { canceled: true }
  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(path, content)
    return { canceled: false, path }
  } catch (err) {
    return { canceled: true, error: String(err) }
  }
}

function pushRecent(path: string, title: string): void {
  try {
    const recents = (JSON.parse(localStorage.getItem(LS_RECENT) ?? '[]') as RecentItem[]).filter(
      (r) => r.path !== path
    )
    recents.unshift({ path, title, lastOpened: Date.now() })
    localStorage.setItem(LS_RECENT, JSON.stringify(recents.slice(0, 10)))
  } catch {
    /* 忽略 */
  }
}

/* ---------------- 统一出口 ---------------- */

export const hostApi: HostApi & { isElectron: () => boolean; isTauri: () => boolean } = {
  isElectron,
  isTauri,

  openProject(): Promise<OpenResult> {
    if (isElectron()) return window.api!.openProject()
    if (isTauri()) return tauriOpenProject()
    return pickFile('.json,.story.json,.yarn,.ink,application/json').then(async (file) => {
      if (!file) return { canceled: true }
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (ext === 'yarn' || ext === 'ink') {
        return { canceled: false, path: file.name, content: file.content }
      }
      try {
        const project = JSON.parse(file.content) as StoryProject
        pushRecent(file.name, project.meta?.title ?? '')
        const records = readRecords().filter((r) => r.name !== file.name)
        records.unshift({ name: file.name, content: file.content, savedAt: Date.now() })
        writeRecords(records)
        return { canceled: false, path: file.name, project }
      } catch (err) {
        return { canceled: true, error: String(err) }
      }
    })
  },

  async saveProject(project: StoryProject, opts: SaveOptions = {}): Promise<SaveResult> {
    if (isElectron()) return window.api!.saveProject(project, opts)
    if (opts.format === 'directory') return { canceled: true, error: '团队目录工程目前由 Windows Electron 版提供；此环境仍可使用单文件工程。' }
    if (isTauri()) return tauriSaveProject(project, opts)
    const content = JSON.stringify(project, null, 2)
    const name = opts.path && !opts.as ? opts.path : `${project.meta.title || '未命名故事'}.story.json`
    downloadFile(name, content)
    pushRecent(name, project.meta.title)
    const records = readRecords().filter((r) => r.name !== name)
    records.unshift({ name, content, savedAt: Date.now() })
    writeRecords(records)
    return { canceled: false, path: name }
  },

  async writeFile(path: string, content: string): Promise<{ ok: boolean; error?: string }> {
    if (isElectron()) return window.api!.writeFile(path, content)
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('write_project_file', { path, content })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    }
    try {
      const records = readRecords()
      const idx = records.findIndex((r) => r.name === path)
      if (idx >= 0) records[idx] = { name: path, content, savedAt: Date.now() }
      else records.unshift({ name: path, content, savedAt: Date.now() })
      writeRecords(records)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },

  async listRecovery(): Promise<RecoveryListResult> {
    try {
      if (isElectron()) return await window.api!.listRecovery()
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core')
        const result = await invoke<RecoveryListResult>('list_recovery')
        const snapshots: RecoverySnapshot[] = []
        let invalid = 0
        for (const value of result.snapshots) {
          try { snapshots.push(parseRecovery(value)) } catch { invalid++ }
        }
        const errors = [result.error, invalid ? `${invalid} 个恢复快照格式无效，原文件已保留` : ''].filter(Boolean)
        return { snapshots, ...(errors.length ? { error: errors.join('；') } : {}) }
      }
      return await listBrowserRecovery()
    } catch (err) { return { snapshots: [], error: String(err) } }
  },

  async writeRecovery(snapshot: RecoverySnapshot): Promise<WriteResult> {
    try {
      parseRecovery(snapshot)
      if (isElectron()) return await window.api!.writeRecovery(snapshot)
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('write_recovery', { snapshot })
      } else await writeBrowserRecovery(snapshot)
      return { ok: true }
    } catch (err) { return { ok: false, error: String(err) } }
  },

  async clearRecovery(id: string): Promise<WriteResult> {
    try {
      if (isElectron()) return await window.api!.clearRecovery(id)
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('clear_recovery', { id })
      } else await clearBrowserRecovery(id)
      return { ok: true }
    } catch (err) { return { ok: false, error: String(err) } }
  },

  async importAsset(path?: string): Promise<ImportAssetResult> {
    if (isElectron()) return window.api!.importAsset(path)
    if (isTauri()) return tauriImportAsset()
    // 浏览器回退：input 直接读 data URL
    return new Promise((resolvePromise) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = Object.keys(MIME_BY_EXT)
        .map((e) => `.${e}`)
        .join(',')
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return resolvePromise({ canceled: true })
        const reader = new FileReader()
        reader.onload = () => resolvePromise({ canceled: false, name: file.name, dataUrl: String(reader.result ?? '') })
        reader.onerror = () => resolvePromise({ canceled: true, error: '读取失败' })
        reader.readAsDataURL(file)
      }
      input.click()
    })
  },

  openProjectPath(path) {
    if (isElectron() && window.api!.openProjectPath) return window.api!.openProjectPath(path)
    return Promise.resolve({ canceled: true, error: '此环境不支持按路径重新加载' })
  },
  checkProjectChanges(path) { return isElectron() && window.api!.checkProjectChanges ? window.api!.checkProjectChanges(path) : Promise.resolve([]) },
  embedProjectAssets(project) {
    if (isElectron() && window.api!.embedProjectAssets) return window.api!.embedProjectAssets(project)
    if (Object.values(project.assets).some((a) => a.path)) return Promise.reject(new Error('请在 Windows Electron 版导出外部素材工程'))
    return Promise.resolve(project)
  },

  async openTextFile(filters: FileFilter[], title?: string): Promise<OpenTextResult> {
    if (isElectron()) return window.api!.openTextFile(filters, title)
    if (isTauri()) return tauriOpenTextFile(filters, title)
    const file = await pickFile(extAccept(filters))
    if (!file) return { canceled: true }
    return { canceled: false, path: file.name, content: file.content }
  },

  async saveTextFile(
    defaultName: string,
    content: string,
    filters: FileFilter[],
    title?: string
  ): Promise<SaveResult> {
    if (isElectron()) return window.api!.saveTextFile(defaultName, content, filters, title)
    if (isTauri()) return tauriSaveTextFile(defaultName, content, filters, title)
    const firstExt = filters[0]?.extensions[0] ?? 'txt'
    const mime =
      firstExt === 'html'
        ? 'text/html'
        : firstExt === 'ink'
          ? 'text/plain'
          : firstExt === 'yarn'
            ? 'text/plain'
            : 'application/json'
    downloadFile(defaultName, content, mime)
    return { canceled: false, path: defaultName }
  },

  async listRecent(): Promise<RecentItem[]> {
    if (isElectron()) return window.api!.listRecent()
    try {
      return (JSON.parse(localStorage.getItem(LS_RECENT) ?? '[]') as RecentItem[]).sort(
        (a, b) => b.lastOpened - a.lastOpened
      )
    } catch {
      return []
    }
  },

  async removeRecent(path: string): Promise<{ ok: boolean }> {
    if (isElectron()) return window.api!.removeRecent(path)
    const recents = (JSON.parse(localStorage.getItem(LS_RECENT) ?? '[]') as RecentItem[]).filter(
      (r) => r.path !== path
    )
    localStorage.setItem(LS_RECENT, JSON.stringify(recents))
    return { ok: true }
  },

  async setWindowTitle(title: string): Promise<void> {
    if (isElectron()) return window.api!.setWindowTitle(title)
    if (isTauri()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        await getCurrentWindow().setTitle(title)
      } catch {
        document.title = title
      }
      return
    }
    document.title = title
  },

  async appInfo(): Promise<{ version: string; isDev: boolean }> {
    if (isElectron()) return window.api!.appInfo()
    if (isTauri()) {
      try {
        const { getVersion } = await import('@tauri-apps/api/app')
        return { version: await getVersion(), isDev: false }
      } catch {
        return { version: '0.5.1', isDev: false }
      }
    }
    return { version: '0.5.1', isDev: true }
  },

  onBeforeClose(cb: () => Promise<void>): () => void {
    if (isElectron()) return window.api!.onBeforeClose(cb)
    if (!isTauri()) return () => {}
    let disposed = false
    let unlisten: (() => void) | undefined
    let allowClose = false
    let closing = false
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow()
      unlisten = await win.onCloseRequested(async (event) => {
        if (allowClose) return
        event.preventDefault()
        if (closing) return
        closing = true
        try {
          await cb()
          allowClose = true
          await win.close()
        } catch {
          allowClose = false
        } finally { closing = false }
      })
      if (disposed) unlisten()
    })
    return () => { disposed = true; unlisten?.() }
  },

  onMenuAction(cb: (action: string) => void): () => void {
    if (isElectron()) return window.api!.onMenuAction(cb)
    // Tauri / 浏览器模式：无原生菜单
    void cb
    return () => {}
  }
}


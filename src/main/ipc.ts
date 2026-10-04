import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FileFilter, SaveOptions } from '@shared/api'
import type { StoryProject } from '@shared/schema'
import type { RecoverySnapshot } from '@shared/recovery'
import { MIME_BY_EXT } from '@shared/mime'
import { RecoveryFiles } from './recovery'
import { writeFileAtomic } from './atomicFile'
import { DirectoryProjects, ProjectConflict, embedAssets, hydrateRecoveryAssets } from './directoryProject'
import { addRecent, listRecent, removeRecent } from './recentFiles'
import { upgradeAuthoring } from '../shared/authoring'

const PROJECT_FILTERS: FileFilter[] = [
  { name: '团队工程', extensions: ['loomproject'] },
  { name: '文字游戏工程', extensions: ['story.json'] },
  { name: 'JSON 文件', extensions: ['json'] },
  { name: '所有文件', extensions: ['*'] }
]

const ASSET_FILTERS: FileFilter[] = [
  { name: '图片与音频', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp3', 'wav', 'ogg', 'm4a'] },
  { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
  { name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }
]

function toFilters(filters?: FileFilter[]): Electron.FileFilter[] {
  const list = filters && filters.length > 0 ? filters : PROJECT_FILTERS
  return list.map((f) => ({ name: f.name, extensions: f.extensions }))
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const directories = new DirectoryProjects()
  const openPath = (path: string) => {
    try {
      const project = path.toLowerCase().endsWith('.loomproject') ? directories.open(path) : upgradeAuthoring(JSON.parse(readFileSync(path, 'utf8')) as StoryProject)
      addRecent({ path, title: project.meta.title })
      return { canceled: false, path, project }
    } catch (err) { return { canceled: true, error: String(err) } }
  }
  ipcMain.handle('project:openPath', (_e, path: string) => openPath(path))
  ipcMain.handle('project:changes', (_e, path: string) => directories.changes(path))
  ipcMain.handle('project:embedAssets', (_e, project: StoryProject) => embedAssets(project))
  const recovery = new RecoveryFiles(join(app.getPath('userData'), 'recovery'))
  ipcMain.handle('recovery:list', () => {
    try { const result = recovery.list(); return { ...result, snapshots: result.snapshots.map((s) => ({ ...s, project: hydrateRecoveryAssets(s.project) })) } } catch (err) { return { snapshots: [], error: String(err) } }
  })
  ipcMain.handle('recovery:write', (_e, snapshot: RecoverySnapshot) => {
    try { recovery.write(snapshot); return { ok: true } } catch (err) { return { ok: false, error: String(err) } }
  })
  ipcMain.handle('recovery:clear', (_e, id: string) => {
    try { recovery.clear(id); return { ok: true } } catch (err) { return { ok: false, error: String(err) } }
  })
  ipcMain.handle('project:open', async () => {
    const win = getWindow()
    if (!win) return { canceled: true }
    const result = await dialog.showOpenDialog(win, {
      title: '打开工程 / 导入',
      filters: [
        ...PROJECT_FILTERS,
        { name: 'Yarn 脚本', extensions: ['yarn'] },
        { name: 'Ink 脚本', extensions: ['ink'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    const path = result.filePaths[0]
    const ext = path.split('.').pop()?.toLowerCase()
    try {
      // 脚本格式由渲染层解析，这里只回传文本
      if (ext === 'yarn' || ext === 'ink') {
        return { canceled: false, path, content: readFileSync(path, 'utf-8') }
      }
      return openPath(path)
    } catch (err) {
      dialog.showErrorBox('打开失败', `无法解析文件：\n${String(err)}`)
      return { canceled: true, error: String(err) }
    }
  })

  ipcMain.handle('project:save', async (_e, project: StoryProject, opts: SaveOptions = {}) => {
    const win = getWindow()
    if (!win) return { canceled: true }
    let target = opts.path
    if (opts.format === 'directory' && (opts.as || !target?.toLowerCase().endsWith('.loomproject'))) {
      const selection = await dialog.showOpenDialog(win, { title: '选择团队工程文件夹（将创建 project.loomproject）', properties: ['openDirectory', 'createDirectory'] })
      if (selection.canceled || !selection.filePaths[0]) return { canceled: true }
      target = join(selection.filePaths[0], 'project.loomproject')
    } else if (opts.as || !target) target = await pickSavePath(win, project) ?? undefined
    if (!target) return { canceled: true }
    try {
      if (target.toLowerCase().endsWith('.loomproject')) {
        if (opts.as && existsSync(target)) throw new Error('团队工程另存为需要新的文件夹；已有工程请使用普通保存。')
        const result = directories.save(project, target)
        addRecent({ path: target, title: project.meta.title })
        return { canceled: false, path: target, ...result }
      }
      if (Object.values(project.assets).some((a) => a.path)) project = embedAssets(project)
      // 旧版另存或升版前保留磁盘原件。
      if (existsSync(target) && !existsSync(`${target}.pre-v4.bak`)) {
        const raw = JSON.parse(readFileSync(target, 'utf8')) as StoryProject
        if (raw.version < 4 && project.version === 4) copyFileSync(target, `${target}.pre-v4.bak`, 1)
      }
      writeFileAtomic(target, JSON.stringify(project, null, 2))
      addRecent({ path: target, title: project.meta?.title ?? '' })
      return { canceled: false, path: target }
    } catch (err) {
      return { canceled: true, error: String(err), ...(err instanceof ProjectConflict ? { conflicts: err.files } : {}) }
    }
  })

  // 静默写盘（自动保存 / 覆盖保存），不弹对话框
  ipcMain.handle('project:write', (_e, path: string, content: string) => {
    try {
      if (path.toLowerCase().endsWith('.loomproject')) throw new Error('团队工程必须通过分场景保存接口写入')
      if (existsSync(path) && !existsSync(`${path}.pre-v4.bak`)) {
        const next = JSON.parse(content) as StoryProject, previous = JSON.parse(readFileSync(path, 'utf8')) as StoryProject
        if (next.version === 4 && previous.version < 4) copyFileSync(path, `${path}.pre-v4.bak`, 1)
      }
      writeFileAtomic(path, content)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // 选取素材文件并读为 data URL（图片/音频直接内嵌进工程）
  ipcMain.handle('asset:import', async (_e, projectPath?: string) => {
    const win = getWindow()
    if (!win) return { canceled: true }
    const result = await dialog.showOpenDialog(win, {
      title: '导入素材（图片 / 音频）',
      filters: ASSET_FILTERS,
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    const path = result.filePaths[0]
    try {
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      const mime = MIME_BY_EXT[ext]
      if (!mime) return { canceled: true, error: `不支持的素材格式：${ext}` }
      if (projectPath?.toLowerCase().endsWith('.loomproject')) {
        const asset = await directories.importAsset(projectPath, path, mime.startsWith('audio/') ? 'audio' : 'image', mime)
        return { canceled: false, name: asset.name, asset }
      }
      const buf = readFileSync(path)
      const name = path.replace(/\\/g, '/').split('/').pop() ?? path
      return { canceled: false, name, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
    } catch (err) {
      return { canceled: true, error: String(err) }
    }
  })

  // 打开文本文件（Yarn / Ink 导入）
  ipcMain.handle('io:openText', async (_e, filters: FileFilter[], title?: string) => {
    const win = getWindow()
    if (!win) return { canceled: true }
    const result = await dialog.showOpenDialog(win, {
      title: title ?? '导入',
      filters: toFilters(filters),
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    const path = result.filePaths[0]
    try {
      return { canceled: false, path, content: readFileSync(path, 'utf-8') }
    } catch (err) {
      return { canceled: true, error: String(err) }
    }
  })

  // 保存文本文件（HTML / Yarn / Ink 导出）；内容由渲染层合成
  ipcMain.handle(
    'io:saveText',
    async (_e, defaultName: string, content: string, filters: FileFilter[], title?: string) => {
      const win = getWindow()
      if (!win) return { canceled: true }
      const result = await dialog.showSaveDialog(win, {
        title: title ?? '导出',
        defaultPath: defaultName,
        filters: toFilters(filters)
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      try {
        mkdirSync(dirname(result.filePath), { recursive: true })
        writeFileSync(result.filePath, content, 'utf-8')
        return { canceled: false, path: result.filePath }
      } catch (err) {
        dialog.showErrorBox('导出失败', String(err))
        return { canceled: true, error: String(err) }
      }
    }
  )

  ipcMain.handle('recent:list', () => listRecent())

  ipcMain.handle('recent:remove', (_e, path: string) => {
    removeRecent(path)
    return { ok: true }
  })

  ipcMain.handle('window:setTitle', (_e, title: string) => {
    getWindow()?.setTitle(title)
  })

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), isDev: !app.isPackaged }))
}

async function pickSavePath(win: BrowserWindow, project: StoryProject): Promise<string | null> {
  const result = await dialog.showSaveDialog(win, {
    title: '保存工程',
    defaultPath: `${project.meta?.title || '未命名故事'}.story.json`,
    filters: PROJECT_FILTERS
  })
  return result.canceled ? null : (result.filePath ?? null)
}

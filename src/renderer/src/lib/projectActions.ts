import { hostApi } from './api'
import { exportInk, parseInk } from '@shared/io/ink'
import { exportYarn, parseYarn } from '@shared/io/yarn'
import { runtimeChunk } from '@shared/plugins'
import { enabledPlugins } from '../stores/plugins'
import { useProjectStore, resetHistory } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { toast } from '../stores/toast'
import { uid, type StoryProject } from '@shared/schema'
import type { SaveResult } from '@shared/api'
import { clearProjectRecovery, projectFromState, sameProjectState, writeProjectRecovery, type ProjectState } from './recovery'

export { startProjectPersistence } from './projectPersistence'

/** 工程（新建/打开/导入/保存/导出）的用户动作，供工具栏、菜单与欢迎页复用。 */

function ensureNotDirtyThen(action: () => void, dirtyMessage = '当前工程有未保存的更改。'): void {
  const run = (): void => { try { action() } catch (err) { toast.error(`工程操作失败：${String(err)}`) } }
  const s = useProjectStore.getState()
  if (!s.dirty) {
    run()
    return
  }
  void useUiStore
    .getState()
    .askConfirm({
      title: '放弃未保存的更改？',
      body: `${dirtyMessage}若继续，更改将丢失（可先 Ctrl+S 保存）。`,
      confirmText: '放弃更改',
      danger: true
    })
    .then((ok) => {
      if (!ok) return
      if (!sameProjectState(s, useProjectStore.getState())) {
        ensureNotDirtyThen(action, '确认期间工程又有新的更改。')
      } else run()
    })
}

function clearReplacedRecovery(revision: number): void {
  void clearProjectRecovery(revision).catch((err) => toast.warn(`旧恢复快照未能清理：${String(err)}`))
}

function replaceProject(project: StoryProject, path: string | null, expected: ProjectState, done: () => void): void {
  const apply = (): void => {
    const previous = useProjectStore.getState()
    previous.loadProject(project, path)
    clearReplacedRecovery(previous.revision)
    done()
  }
  if (sameProjectState(expected, useProjectStore.getState())) apply()
  else ensureNotDirtyThen(apply, '选取文件期间当前工程又有新的更改。')
}

let fileOperations: Promise<void> = Promise.resolve()
function acceptDirectorySave(result: SaveResult): void {
  if (!result.project) return
  const p = result.project
  if (result.merged?.length) {
    resetHistory()
    toast.info(`已合并外部修改：${result.merged.join('、')}；撤销历史已重置以保护合并内容。`)
  }
  useProjectStore.setState({ meta: p.meta, authoring: p.authoring, assets: p.assets, release: p.release, nodes: p.nodes, edges: p.edges,
    variables: p.variables, customCss: p.customCss, customJs: p.customJs, externalChanges: [], saveBlocked: false })
}
function queueFileOperation<T>(action: () => Promise<T>): Promise<T> {
  const result = fileOperations.then(action)
  fileOperations = result.then(() => {}, () => {})
  return result
}

/** 导入产生的告警列表 → toast（超过 3 条折叠） */
function toastWarnings(warnings: string[], prefix: string): void {
  if (warnings.length === 0) return
  const head = warnings.slice(0, 3).map((w) => `· ${w}`)
  const rest = warnings.length > 3 ? `\n· ……等共 ${warnings.length} 条提示` : ''
  toast.warn(`${prefix}${head.join('\n')}${rest}`)
}

function applyImported(project: StoryProject, path: string | null, warnings: string[], label: string, expected: ProjectState): void {
  replaceProject(project, path, expected, () => {
    if (!path) useProjectStore.setState({ dirty: true, lastSavedJson: null })
    toast.success(`已导入${label}「${project.meta.title}」（${project.nodes.length} 个节点）`)
    toastWarnings(warnings, '导入提示：\n')
  })
}

export const projectActions = {
  async reloadDirectory(): Promise<void> {
    const s = useProjectStore.getState()
    if (!s.filePath || !hostApi.openProjectPath) return
    // 独立备份不绑定当前 revision，重新加载后仍保留在启动恢复列表中。
    if (s.dirty) {
      const backup = await hostApi.writeRecovery({ version: 1, id: uid('conflict_backup_'), savedAt: Date.now(), project: projectFromState(s) })
      if (!backup.ok) { toast.error(`未能备份当前更改：${backup.error}`); return }
      if (!sameProjectState(s, useProjectStore.getState())) { toast.warn('备份期间工程继续变化，请再次重新加载'); return }
    }
    ensureNotDirtyThen(() => {
      const expected = useProjectStore.getState()
      void hostApi.openProjectPath!(s.filePath!).then((r) => {
        if (r.error) toast.error(r.error)
        if (r.project && r.path) replaceProject(r.project, r.path, expected, () => toast.success('已重新加载外部修改'))
      }).catch((e) => toast.error(String(e)))
    }, '当前修改已经保留为独立恢复快照，重新打开软件可找回。')
  },
  newProject(): void {
    ensureNotDirtyThen(() => {
      const previous = useProjectStore.getState()
      previous.newProject()
      clearReplacedRecovery(previous.revision)
      toast.success('已新建空白工程')
    })
  },

  newSampleProject(): void {
    void import('./sample').then(({ sampleProject }) => ensureNotDirtyThen(() => {
      const previous = useProjectStore.getState()
      previous.newProject(sampleProject())
      clearReplacedRecovery(previous.revision)
      toast.success('已载入示例工程「翡翠旅店的夜晚」')
    })).catch((err) => toast.error(`示例载入失败：${String(err)}`))
  },

  newVnSampleProject(): void {
    void import('./sampleVN').then(({ vnSampleProject }) => ensureNotDirtyThen(() => {
      const previous = useProjectStore.getState()
      previous.newProject(vnSampleProject())
      clearReplacedRecovery(previous.revision)
      toast.success('已载入视觉小说示例「雪落车站」（含背景/立绘/音乐）')
    })).catch((err) => toast.error(`示例载入失败：${String(err)}`))
  },

  /** 打开工程 / 导入 Yarn / 导入 Ink（按扩展名分派） */
  async openProject(): Promise<void> {
    const doOpen = async (): Promise<void> => {
      const expected = useProjectStore.getState()
      const result = await hostApi.openProject()
      if (result.canceled) {
        if (result.error) toast.error(`打开失败：${result.error}`)
        return
      }
      if (result.content != null && result.path) {
        const ext = result.path.split('.').pop()?.toLowerCase()
        try {
          if (ext === 'yarn') {
            const { project, warnings } = parseYarn(result.content)
            applyImported(project, null, warnings, 'Yarn 脚本', expected)
          } else if (ext === 'ink') {
            const { project, warnings } = parseInk(result.content)
            applyImported(project, null, warnings, 'Ink 脚本', expected)
          } else {
            toast.error(`无法识别的文件格式：${ext ?? '未知'}`)
          }
        } catch (err) {
          toast.error(`导入失败：${String(err)}`)
        }
        return
      }
      if (result.project && result.path) {
        replaceProject(result.project, result.path, expected, () => toast.success(`已打开「${result.project!.meta?.title ?? result.path}」`))
      }
    }
    ensureNotDirtyThen(() => {
      void doOpen().catch((err) => toast.error(`打开失败：${String(err)}`))
    })
  },

  openProjectForce(project: StoryProject, path: string | null): void {
    ensureNotDirtyThen(() => {
      const previous = useProjectStore.getState()
      previous.loadProject(project, path)
      clearReplacedRecovery(previous.revision)
    })
  },

  async save(as: boolean, format?: 'directory' | 'single'): Promise<void> {
    // 点击保存时捕获用户所指的工程；前面的自动保存排队期间可能切换工程。
    const s = useProjectStore.getState()
    if (s.saveBlocked && !as) { toast.warn('协作修改需要处理，请先备份并重新加载，或另存到新的团队文件夹。'); return }
    const project = projectFromState(s)
    await queueFileOperation(async () => {
      try {
        const result = await hostApi.saveProject(project, { as, path: s.filePath ?? undefined, format })
        if (result.canceled) {
          if (result.conflicts && useProjectStore.getState().revision === s.revision) {
            useProjectStore.setState({ externalChanges: result.conflicts, saveBlocked: true })
            await writeProjectRecovery()
          }
          if (result.error) toast.error(`保存失败：${result.error}`); return
        }
        if (result.path) {
          const now = useProjectStore.getState()
          if (sameProjectState(s, now)) {
            acceptDirectorySave(result)
            useProjectStore.getState().markSaved(result.path)
            await clearProjectRecovery(s.revision, false)
          } else if (now.revision === s.revision && now.filePath === s.filePath) {
            // 对话框/写盘期间的编辑仍然是脏的；仅记录已保存的那一版与新路径。
            useProjectStore.setState({ filePath: result.path, lastSavedJson: JSON.stringify(project, null, 2), dirty: true })
            if (as && !result.merged?.length) useProjectStore.setState({ saveBlocked: false, externalChanges: [] })
            if (result.merged?.length) {
              useProjectStore.setState({ saveBlocked: true, externalChanges: result.merged })
              toast.warn('保存期间又有本地编辑，同时收到了外部改稿；已暂停自动保存，请先备份并重新加载。')
            }
            await writeProjectRecovery()
          }
          toast.success(as ? `已另存为 ${result.path}` : '已保存')
        }
      } catch (err) { toast.error(`保存失败：${String(err)}`) }
    })
  },

  /** 导出单文件可玩 HTML（渲染层合成，三端一致；启用的作品面插件一并注入） */
  async exportHtml(): Promise<void> {
    const { composeExportHtml } = await import('./exportHtml')
    const s = useProjectStore.getState()
    const plugins = enabledPlugins().map(runtimeChunk)
    const project = hostApi.embedProjectAssets ? await hostApi.embedProjectAssets(s.getProject()) : s.getProject()
    const html = composeExportHtml(project, plugins)
    const name = `${s.meta.title || '未命名故事'}.html`
    const result = await hostApi.saveTextFile(
      name,
      html,
      [{ name: '网页文件', extensions: ['html'] }],
      '导出可玩 HTML'
    )
    if (result.canceled) return
    if (result.path) toast.success(`已导出：${result.path}${plugins.length ? `（含 ${plugins.length} 个插件）` : ''}`)
  },

  async exportYarn(): Promise<void> {
    const s = useProjectStore.getState()
    const { text, warnings } = exportYarn(s.getProject())
    const name = `${s.meta.title || '未命名故事'}.yarn`
    const result = await hostApi.saveTextFile(
      name,
      text,
      [{ name: 'Yarn 脚本', extensions: ['yarn'] }],
      '导出 Yarn 脚本'
    )
    if (result.canceled) return
    if (result.path) {
      toast.success(`已导出：${result.path}`)
      toastWarnings(warnings, '导出提示：\n')
    }
  },

  async exportInk(): Promise<void> {
    const s = useProjectStore.getState()
    const { text, warnings } = exportInk(s.getProject())
    const name = `${s.meta.title || '未命名故事'}.ink`
    const result = await hostApi.saveTextFile(
      name,
      text,
      [{ name: 'Ink 脚本', extensions: ['ink'] }],
      '导出 Ink 脚本'
    )
    if (result.canceled) return
    if (result.path) {
      toast.success(`已导出：${result.path}`)
      toastWarnings(warnings, '导出提示：\n')
    }
  },

  /** 有路径时自动保存工程，未保存工程只写恢复快照，保留脏标记。 */
  async autosave(): Promise<void> {
    await queueFileOperation(async () => {
      const s = useProjectStore.getState()
      if (s.revision === 0) return
      if (!s.filePath) { await writeProjectRecovery(s); return }
      if (!s.dirty) return
      if (s.saveBlocked) { await writeProjectRecovery(s); return }
      if (s.filePath.toLowerCase().endsWith('.loomproject')) {
        const result = await hostApi.saveProject(projectFromState(s), { path: s.filePath })
        if (result.canceled) {
          await writeProjectRecovery(s)
          if (result.conflicts) useProjectStore.setState({ externalChanges: result.conflicts, saveBlocked: true })
          throw new Error(result.error ?? '团队工程保存失败')
        }
        if (sameProjectState(s, useProjectStore.getState())) {
          acceptDirectorySave(result)
          useProjectStore.getState().markSaved(s.filePath)
          await clearProjectRecovery(s.revision, false)
        } else if (useProjectStore.getState().revision === s.revision && result.merged?.length) {
          useProjectStore.setState({ saveBlocked: true, externalChanges: result.merged })
          await writeProjectRecovery()
          throw new Error('保存期间继续编辑且发生外部合并，请先备份并重新加载。')
        }
        return
      }
      const result = await hostApi.writeFile(s.filePath, JSON.stringify(projectFromState(s), null, 2))
      if (!result.ok) throw new Error(result.error ?? '自动保存失败')
      const now = useProjectStore.getState()
      if (sameProjectState(s, now)) {
        now.markSaved(s.filePath)
        await clearProjectRecovery(s.revision, false)
      }
    })
  }
}

// 原生菜单动作 → projectActions（由 App 订阅分发）
export function dispatchMenuAction(action: string): void {
  switch (action) {
    case 'project:new':
      projectActions.newProject()
      break
    case 'project:open':
    case 'project:import':
      void projectActions.openProject()
      break
    case 'project:save':
      void projectActions.save(false)
      break
    case 'project:saveAs':
      void projectActions.save(true)
      break
    case 'project:export':
      void projectActions.exportHtml()
      break
    case 'project:exportYarn':
      void projectActions.exportYarn()
      break
    case 'project:exportInk':
      void projectActions.exportInk()
      break
    case 'edit:undo':
      useProjectStore.getState().undo()
      break
    case 'edit:redo':
      useProjectStore.getState().redo()
      break
    case 'edit:layout':
      window.dispatchEvent(new Event('storyloom:autolayout'))
      break
    case 'view:playtest':
      window.dispatchEvent(new Event('storyloom:playtest'))
      break
    case 'view:custom':
      useUiStore.getState().openCustom()
      break
    case 'view:plugins':
      useUiStore.getState().openPlugins()
      break
  }
}

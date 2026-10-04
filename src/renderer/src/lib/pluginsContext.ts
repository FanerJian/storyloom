import { PLUGIN_API_VERSION } from '@shared/plugins'
import type { StoryProject } from '@shared/schema'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { toast } from '../stores/toast'
import { hostApi } from './api'

/**
 * 编辑器插件的运行上下文：以 window.StoryLoom 暴露给 editorJs。
 * 这是插件兼容性的「稳定面」——apiVersion 内保证不破坏性变更；
 * 更底层的 store 结构不属于承诺范围。
 */

export interface StoryLoomEditorContext {
  apiVersion: number
  version: string
  project: {
    /** 当前工程快照（结构化副本） */
    get(): StoryProject
    /** zustand 原始状态（含 nodes/edges/assets…；内部结构，跨版本可能变化） */
    getState(): unknown
    /** 任何工程变化时回调（无参数；用 get()/getState() 取最新值） */
    subscribe(cb: () => void): () => void
  }
  ui: {
    openPlaytest(startId?: string | null): void
    openCustom(): void
    openPlugins(): void
  }
  toast: {
    info(message: string): void
    success(message: string): void
    warn(message: string): void
    error(message: string): void
  }
}

declare global {
  interface Window {
    StoryLoom?: StoryLoomEditorContext
  }
}

export function getPluginsContext(): StoryLoomEditorContext {
  if (!window.StoryLoom) {
    const ctx: StoryLoomEditorContext = {
      apiVersion: PLUGIN_API_VERSION,
      version: '',
      project: {
        get: () => useProjectStore.getState().getProject(),
        getState: () => useProjectStore.getState(),
        subscribe: (cb) => useProjectStore.subscribe(cb)
      },
      ui: {
        openPlaytest: (startId) => useUiStore.getState().openPlaytest(startId ?? null),
        openCustom: () => useUiStore.getState().openCustom(),
        openPlugins: () => useUiStore.getState().openPlugins()
      },
      toast: {
        info: (m) => toast.info(m),
        success: (m) => toast.success(m),
        warn: (m) => toast.warn(m),
        error: (m) => toast.error(m)
      }
    }
    window.StoryLoom = ctx
    void hostApi.appInfo().then((info) => {
      ctx.version = info.version
    })
  }
  return window.StoryLoom
}

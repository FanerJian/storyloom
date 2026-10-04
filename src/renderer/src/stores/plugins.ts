import { create } from 'zustand'
import { parsePlugin, type LoomPlugin } from '@shared/plugins'
import { toast } from './toast'

/**
 * 插件库：安装的插件与启用状态，localStorage 持久化（三端一致，
 * 无需主进程参与）。插件本体是纯文本 JSON，体积小，localStorage 足够。
 */
const LS_PLUGINS = 'storyloom.plugins.v1'
const LS_ENABLED = 'storyloom.plugins.enabled.v1'

interface PluginsState {
  plugins: LoomPlugin[]
  /** id -> 是否启用 */
  enabled: Record<string, boolean>

  /** 从 JSON 文本导入（按 id 覆盖升级），返回错误信息或 null */
  importText: (text: string) => string | null
  remove: (id: string) => void
  toggle: (id: string) => void
  setEnabled: (id: string, on: boolean) => void
}

function load(): { plugins: LoomPlugin[]; enabled: Record<string, boolean> } {
  try {
    const plugins = JSON.parse(localStorage.getItem(LS_PLUGINS) ?? '[]') as LoomPlugin[]
    const enabled = JSON.parse(localStorage.getItem(LS_ENABLED) ?? '{}') as Record<string, boolean>
    return {
      plugins: Array.isArray(plugins) ? plugins.filter((p) => p && typeof p.id === 'string') : [],
      enabled: enabled && typeof enabled === 'object' ? enabled : {}
    }
  } catch {
    return { plugins: [], enabled: {} }
  }
}

function persist(s: { plugins: LoomPlugin[]; enabled: Record<string, boolean> }): void {
  localStorage.setItem(LS_PLUGINS, JSON.stringify(s.plugins))
  localStorage.setItem(LS_ENABLED, JSON.stringify(s.enabled))
}

const initial = load()

export const usePluginsStore = create<PluginsState>((set, get) => ({
  plugins: initial.plugins,
  enabled: initial.enabled,

  importText: (text) => {
    const { plugin, error, notice } = parsePlugin(text)
    if (error || !plugin) {
      toast.error(`插件导入失败：${error ?? '未知错误'}`)
      return error ?? '未知错误'
    }
    const s = get()
    const exists = s.plugins.some((p) => p.id === plugin.id)
    const plugins = exists ? s.plugins.map((p) => (p.id === plugin.id ? plugin : p)) : [...s.plugins, plugin]
    const next = { plugins, enabled: s.enabled }
    persist(next)
    set(next)
    toast.success(`已${exists ? '更新' : '安装'}插件「${plugin.name}」${plugin.version}`)
    if (notice) toast.warn(notice)
    return null
  },

  remove: (id) => {
    const s = get()
    const next = {
      plugins: s.plugins.filter((p) => p.id !== id),
      enabled: { ...s.enabled, [id]: false }
    }
    persist(next)
    set(next)
  },

  toggle: (id) => {
    const s = get()
    const next = { ...s, enabled: { ...s.enabled, [id]: !s.enabled[id] } }
    persist({ plugins: s.plugins, enabled: next.enabled })
    set({ enabled: next.enabled })
  },

  setEnabled: (id, on) => {
    const s = get()
    const next = { plugins: s.plugins, enabled: { ...s.enabled, [id]: on } }
    persist(next)
    set({ enabled: next.enabled })
  }
}))

/** 当前启用的插件列表（编辑器注入、试玩、导出共用） */
export function enabledPlugins(): LoomPlugin[] {
  const { plugins, enabled } = usePluginsStore.getState()
  return plugins.filter((p) => enabled[p.id])
}

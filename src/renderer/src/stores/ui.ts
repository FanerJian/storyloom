import { create } from 'zustand'

export type Theme = 'dark' | 'light'

interface UiState {
  theme: Theme
  sidebarTab: 'overview' | 'variables' | 'issues'
  sidebarOpen: boolean
  inspectorOpen: boolean
  playtestOpen: boolean
  playtestStartId: string | null
  releaseModal: boolean
  customOpen: boolean
  pluginsOpen: boolean
  confirm: {
    open: boolean
    title: string
    body: string
    confirmText: string
    danger: boolean
    resolve: ((ok: boolean) => void) | null
  }

  setTheme: (t: Theme) => void
  toggleTheme: () => void
  setSidebarTab: (t: UiState['sidebarTab']) => void
  setSidebarOpen: (open: boolean) => void
  setInspectorOpen: (open: boolean) => void
  openPlaytest: (startId?: string | null) => void
  closePlaytest: () => void
  openRelease: () => void
  closeRelease: () => void
  openCustom: () => void
  closeCustom: () => void
  openPlugins: () => void
  closePlugins: () => void
  askConfirm: (opts: { title: string; body: string; confirmText?: string; danger?: boolean }) => Promise<boolean>
  closeConfirm: (ok: boolean) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: 'dark',
  sidebarTab: 'issues',
  sidebarOpen: true,
  inspectorOpen: true,
  playtestOpen: false,
  playtestStartId: null,
  releaseModal: false,
  customOpen: false,
  pluginsOpen: false,
  confirm: { open: false, title: '', body: '', confirmText: '确定', danger: false, resolve: null },

  setTheme: (t) => {
    document.documentElement.classList.toggle('dark', t === 'dark')
    localStorage.setItem('storyloom.theme', t)
    set({ theme: t })
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  setSidebarTab: (t) => set({ sidebarTab: t, sidebarOpen: true }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
  openPlaytest: (startId = null) => set({ playtestOpen: true, playtestStartId: startId }),
  closePlaytest: () => set({ playtestOpen: false, playtestStartId: null }),
  openRelease: () => set({ releaseModal: true }),
  closeRelease: () => set({ releaseModal: false }),
  openCustom: () => set({ customOpen: true }),
  closeCustom: () => set({ customOpen: false }),
  openPlugins: () => set({ pluginsOpen: true }),
  closePlugins: () => set({ pluginsOpen: false }),

  askConfirm: (opts) =>
    new Promise((resolve) => {
      set({
        confirm: {
          open: true,
          title: opts.title,
          body: opts.body,
          confirmText: opts.confirmText ?? '确定',
          danger: opts.danger ?? false,
          resolve
        }
      })
    }),
  closeConfirm: (ok) => {
    const { confirm } = get()
    confirm.resolve?.(ok)
    set({ confirm: { ...confirm, open: false, resolve: null } })
  }
}))

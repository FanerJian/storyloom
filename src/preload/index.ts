import { contextBridge, ipcRenderer } from 'electron'
import type { FileFilter, HostApi } from '@shared/api'

const api: HostApi = {
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (project, opts = {}) => ipcRenderer.invoke('project:save', project, opts),
  writeFile: (path, content) => ipcRenderer.invoke('project:write', path, content),
  listRecovery: () => ipcRenderer.invoke('recovery:list'),
  writeRecovery: (snapshot) => ipcRenderer.invoke('recovery:write', snapshot),
  clearRecovery: (id) => ipcRenderer.invoke('recovery:clear', id),
  importAsset: (path) => ipcRenderer.invoke('asset:import', path),
  openProjectPath: (path) => ipcRenderer.invoke('project:openPath', path),
  checkProjectChanges: (path) => ipcRenderer.invoke('project:changes', path),
  embedProjectAssets: (project) => ipcRenderer.invoke('project:embedAssets', project),
  openTextFile: (filters: FileFilter[], title?: string) => ipcRenderer.invoke('io:openText', filters, title),
  saveTextFile: (defaultName, content, filters, title) =>
    ipcRenderer.invoke('io:saveText', defaultName, content, filters, title),
  listRecent: () => ipcRenderer.invoke('recent:list'),
  removeRecent: (path) => ipcRenderer.invoke('recent:remove', path),
  setWindowTitle: (title) => ipcRenderer.invoke('window:setTitle', title),
  appInfo: () => ipcRenderer.invoke('app:info'),
  onBeforeClose: (cb) => {
    const handler = async (_e: unknown, token: string): Promise<void> => {
      try {
        await cb()
        ipcRenderer.send('window:close-result', token, { ok: true })
      } catch (err) {
        ipcRenderer.send('window:close-result', token, { ok: false, error: String(err) })
      }
    }
    ipcRenderer.on('window:close-request', handler)
    return () => ipcRenderer.removeListener('window:close-request', handler)
  },
  onMenuAction: (cb) => {
    const handler = (_e: unknown, action: string): void => cb(action)
    ipcRenderer.on('menu:action', handler)
    return () => ipcRenderer.removeListener('menu:action', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

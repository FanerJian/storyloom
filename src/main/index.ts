import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { registerAssetScheme, installAssetProtocol } from './assetProtocol'
import { registerIpc } from './ipc'
import { buildAppMenu } from './menu'
import { clampWindowBounds } from './windowBounds'
import { loadBounds, scheduleSaveBounds } from './windowState'
import { runE2E } from './e2eHarness'

const isDev = !!process.env['ELECTRON_RENDERER_URL']
registerAssetScheme()
// 解压版可把配置与恢复文件保存在程序旁，减少系统盘写入。
const besideData = join(dirname(app.getPath('exe')), 'portable-data')
const portableData = process.env.FABLELOOM_DATA_DIR || (existsSync(besideData) ? besideData : '')
if (portableData) {
  const dataDirectory = resolve(portableData); mkdirSync(dataDirectory, { recursive: true })
  app.setPath('userData', dataDirectory); app.setPath('sessionData', dataDirectory)
}

// 单实例锁：再次启动时聚焦已有窗口（E2E 钩子实例豁免，允许与正式实例并行）
if (!process.env['FABLELOOM_E2E'] && !app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const saved = loadBounds()
  const display = saved.x != null && saved.y != null
    ? screen.getDisplayMatching({ x: Math.round(saved.x), y: Math.round(saved.y), width: Math.round(saved.width), height: Math.round(saved.height) })
    : screen.getPrimaryDisplay()
  const bounds = clampWindowBounds(saved, display.workArea)
  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: Math.min(900, display.workArea.width),
    minHeight: Math.min(600, display.workArea.height),
    show: false,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (bounds.maximized) mainWindow.maximize()

  mainWindow.on('ready-to-show', () => { if (!process.env.FABLELOOM_TEST_HIDDEN) mainWindow?.show() })

  // 尺寸/位置变化后延时写盘
  const onBoundsChange = (): void => {
    if (mainWindow) scheduleSaveBounds(mainWindow)
  }
  mainWindow.on('resize', onBoundsChange)
  mainWindow.on('move', onBoundsChange)
  mainWindow.on('maximize', onBoundsChange)
  mainWindow.on('unmaximize', onBoundsChange)

  // 关闭前等待渲染层完成工程保存/恢复快照。失败或无响应时保留窗口。
  const win = mainWindow
  let closeAllowed = false
  let closeToken: string | null = null
  let closeTimer: ReturnType<typeof setTimeout> | null = null
  const clearCloseRequest = (): void => {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = null
    closeToken = null
  }
  const closeFailed = async (detail: string): Promise<void> => {
    if (win.isDestroyed()) return
    const answer = await dialog.showMessageBox(win, {
      type: 'warning', title: '工程尚未完成保存',
      message: '恢复快照未能保存，是否仍然退出？',
      detail: `${detail}\n仍然退出可能丢失最近的更改。可以留在编辑器，先手动保存工程。`,
      buttons: ['留在编辑器', '仍然退出'], defaultId: 0, cancelId: 0
    })
    if (answer.response === 1 && !win.isDestroyed()) {
      closeAllowed = true
      win.close()
    }
  }
  const onCloseResult = (event: Electron.IpcMainEvent, token: string, result: { ok?: boolean; error?: string }): void => {
    if (event.sender !== win.webContents || !closeToken || token !== closeToken) return
    clearCloseRequest()
    if (result?.ok === true) {
      closeAllowed = true
      win.close()
    } else {
      void closeFailed(result?.error ?? '写入未能完成。')
    }
  }
  ipcMain.on('window:close-result', onCloseResult)
  win.on('close', (event) => {
    if (closeAllowed) return
    event.preventDefault()
    if (closeToken) return
    closeToken = randomUUID()
    win.webContents.send('window:close-request', closeToken)
    closeTimer = setTimeout(() => {
      clearCloseRequest()
      void closeFailed('编辑器未能及时完成保存。')
    }, 10000)
  })
  win.on('closed', () => {
    clearCloseRequest()
    ipcMain.removeListener('window:close-result', onCloseResult)
    if (mainWindow === win) mainWindow = null
  })

  // 新窗口一律走系统浏览器（如外部链接）
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('http')) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 开发用 E2E 钩子（实现见 e2eHarness.ts）
  if (process.env['FABLELOOM_E2E']) {
    mainWindow.webContents.once('did-finish-load', () => {
      void runE2E(mainWindow!)
    })
  }
}

app.whenReady().then(() => {
  installAssetProtocol()
  registerIpc(() => mainWindow)
  Menu.setApplicationMenu(buildAppMenu(() => mainWindow))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

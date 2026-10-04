import { app, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WindowBounds } from './windowBounds'

/** 窗口尺寸/位置记忆（userData/window-bounds.json），最大化状态一并记住。
 *  纯函数（clampWindowBounds）在 windowBounds.ts，本文件只负责 IO 与防抖。 */

const BOUNDS_FILE = 'window-bounds.json'
const DEFAULT_BOUNDS: WindowBounds = { width: 1440, height: 900, maximized: false }

export function loadBounds(): WindowBounds {
  try {
    const raw = JSON.parse(readFileSync(join(app.getPath('userData'), BOUNDS_FILE), 'utf-8')) as WindowBounds
    if (raw && Number.isFinite(raw.width) && Number.isFinite(raw.height) && raw.width >= 500 && raw.height >= 400) {
      return {
        x: Number.isFinite(raw.x) ? raw.x : undefined,
        y: Number.isFinite(raw.y) ? raw.y : undefined,
        width: raw.width,
        height: raw.height,
        maximized: !!raw.maximized
      }
    }
  } catch {
    /* 首次启动或损坏时用默认值 */
  }
  return DEFAULT_BOUNDS
}

let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null

/** 尺寸/位置变化后延时写盘（防抖 800ms） */
export function scheduleSaveBounds(win: BrowserWindow): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(() => {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    const b = maximized || win.isFullScreen() ? win.getNormalBounds() : win.getBounds()
    try {
      writeFileSync(
        join(app.getPath('userData'), BOUNDS_FILE),
        JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized } satisfies WindowBounds),
        'utf-8'
      )
    } catch {
      /* 写不进去就算了 */
    }
  }, 800)
}

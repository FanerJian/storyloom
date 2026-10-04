import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from './atomicFile'

/** 最近打开的工程列表（userData/recent.json），纯展示用途，任何读写失败都静默 */
export interface RecentItem {
  path: string
  title: string
  lastOpened: number
}

const RECENT_MAX = 10

function recentPath(): string {
  return join(app.getPath('userData'), 'recent.json')
}

function readRecent(): RecentItem[] {
  try {
    if (!existsSync(recentPath())) return []
    return JSON.parse(readFileSync(recentPath(), 'utf-8')) as RecentItem[]
  } catch {
    return []
  }
}

function writeRecent(items: RecentItem[]): void {
  try {
    mkdirSync(dirname(recentPath()), { recursive: true })
    writeFileAtomic(recentPath(), JSON.stringify(items, null, 2))
  } catch {
    /* 忽略最近列表写入失败 */
  }
}

/** 记录一次打开/保存（同路径去重后置顶） */
export function addRecent(item: Omit<RecentItem, 'lastOpened'>): void {
  const items = readRecent().filter((it) => it.path !== item.path)
  items.unshift({ ...item, lastOpened: Date.now() })
  writeRecent(items.slice(0, RECENT_MAX))
}

/** 仍存在于磁盘上的最近工程，按时间倒序 */
export function listRecent(): RecentItem[] {
  return readRecent()
    .filter((it) => existsSync(it.path))
    .sort((a, b) => b.lastOpened - a.lastOpened)
    .slice(0, RECENT_MAX)
}

export function removeRecent(path: string): void {
  writeRecent(readRecent().filter((it) => it.path !== path))
}

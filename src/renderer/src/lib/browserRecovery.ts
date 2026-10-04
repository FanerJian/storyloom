import { parseRecovery, validRecoveryId, type RecoverySnapshot } from '@shared/recovery'
import type { RecoveryListResult } from '@shared/api'

let database: Promise<IDBDatabase> | undefined

function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('storyloom-recovery', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = undefined; reject(request.error ?? new Error('浏览器恢复存储不可用')) }
    request.onblocked = () => { database = undefined; reject(new Error('浏览器恢复存储被其他页面占用')) }
  })
  return database
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', mode)
    const request = run(tx.objectStore('snapshots'))
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = () => reject(tx.error ?? request.error ?? new Error('浏览器恢复存储写入失败'))
    tx.onerror = () => reject(tx.error ?? request.error ?? new Error('浏览器恢复存储读写失败'))
  })
}

export async function listBrowserRecovery(): Promise<RecoveryListResult> {
  const values = await transaction('readonly', (s) => s.getAll())
  const snapshots: RecoverySnapshot[] = []
  let invalid = 0
  for (const value of values) {
    try { snapshots.push(parseRecovery(value)) } catch { invalid++ }
  }
  return {
    snapshots: snapshots.sort((a, b) => b.savedAt - a.savedAt),
    ...(invalid ? { error: `${invalid} 个恢复快照无法读取，原数据已保留` } : {})
  }
}

export async function writeBrowserRecovery(snapshot: RecoverySnapshot): Promise<void> {
  await transaction('readwrite', (s) => s.put(parseRecovery(snapshot)))
}

export async function clearBrowserRecovery(id: string): Promise<void> {
  if (!validRecoveryId(id)) throw new Error('恢复快照 ID 无效')
  await transaction('readwrite', (s) => s.delete(id))
}

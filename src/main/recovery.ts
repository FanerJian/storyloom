import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { parseRecovery, validRecoveryId, type RecoverySnapshot } from '../shared/recovery'
import type { RecoveryListResult } from '../shared/api'
import { writeFileAtomic } from './atomicFile'

export class RecoveryFiles {
  constructor(private readonly directory: string) {}

  list(): RecoveryListResult {
    if (!existsSync(this.directory)) return { snapshots: [] }
    const snapshots: RecoverySnapshot[] = []
    const errors: string[] = []
    for (const name of readdirSync(this.directory)) {
      if (!name.endsWith('.json')) continue
      try {
        const s = parseRecovery(JSON.parse(readFileSync(join(this.directory, name), 'utf-8')))
        if (name !== `${s.id}.json`) throw new Error('快照名称与内容不匹配')
        snapshots.push(s)
      } catch {
        errors.push(name)
      }
    }
    return {
      snapshots: snapshots.sort((a, b) => b.savedAt - a.savedAt),
      ...(errors.length ? { error: `${errors.length} 个恢复文件无法读取，原文件已保留：${errors.join('、')}` } : {})
    }
  }

  write(snapshot: RecoverySnapshot): void {
    const s = parseRecovery(snapshot)
    writeFileAtomic(join(this.directory, `${s.id}.json`), JSON.stringify(s))
  }

  clear(id: string): void {
    if (!validRecoveryId(id)) throw new Error('恢复快照 ID 无效')
    const path = join(this.directory, `${id}.json`)
    if (existsSync(path)) unlinkSync(path)
  }
}

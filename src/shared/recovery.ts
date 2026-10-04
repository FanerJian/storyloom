import type { StoryProject } from './schema'

/** 恢复文件与工程格式分别版本化，不改变 .story.json 的 schema。 */
export interface RecoverySnapshot {
  version: 1
  id: string
  savedAt: number
  project: StoryProject
}

export function validRecoveryId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)
}

export function parseRecovery(value: unknown): RecoverySnapshot {
  const s = value as Partial<RecoverySnapshot> | null
  const p = s?.project
  if (
    !s || s.version !== 1 || !validRecoveryId(s.id) ||
    typeof s.savedAt !== 'number' || !Number.isFinite(s.savedAt) || s.savedAt <= 0 ||
    !p || ![3, 4].includes(p.version) || !p.meta || typeof p.meta.title !== 'string' ||
    typeof p.meta.author !== 'string' || typeof p.meta.description !== 'string' ||
    !p.assets || typeof p.assets !== 'object' || Array.isArray(p.assets) ||
    typeof p.customCss !== 'string' || typeof p.customJs !== 'string' ||
    !Array.isArray(p.nodes) || !Array.isArray(p.edges) || !Array.isArray(p.variables) ||
    p.nodes.some((n) => !n || typeof n.id !== 'string' || typeof n.type !== 'string' || !n.data || !n.position) ||
    p.edges.some((e) => !e || typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string')
  ) throw new Error('恢复快照格式无效；原文件已保留')
  return s as RecoverySnapshot
}

import { RotateCcw } from 'lucide-react'
import { Button, Modal } from './ui'
import { useRecoveryStore } from '../stores/recovery'
import { useProjectStore } from '../stores/project'
import { useUiStore } from '../stores/ui'
import { deferRecovery, discardRecovery, restoreRecovery } from '../lib/recovery'

export function RecoveryModal() {
  const { pending, busy, error } = useRecoveryStore()
  const opened = useProjectStore((s) => s.revision > 0)
  const confirming = useUiStore((s) => s.confirm.open)
  const snapshot = pending[0]
  if (!snapshot) return null
  return (
    <Modal open={!confirming} title={<span className="flex items-center gap-2"><RotateCcw size={16} />发现未保存的工程</span>}
      width={480} closeOnBackdrop={!busy} onClose={() => { if (!busy) deferRecovery(snapshot.id) }}>
      <div className="p-5">
        <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
          「{snapshot.project.meta.title}」的恢复快照保存于 {new Date(snapshot.savedAt).toLocaleString()}。
          恢复后仍需手动保存工程；选择稍后会保留快照，下次启动再次提示。
          {opened && '当前工程会先保留恢复快照，再载入此工程。'}
        </p>
        {pending.length > 1 && <p className="mt-2 text-xs text-[var(--text-dim)]">另有 {pending.length - 1} 个工程可恢复。</p>}
        {error && <p className="mt-3 text-xs text-rose-500" role="alert">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button disabled={busy} onClick={() => deferRecovery(snapshot.id)}>稍后</Button>
          <Button disabled={busy} variant="danger" onClick={() => void discardRecovery(snapshot.id)}>丢弃快照</Button>
          <Button disabled={busy} variant="primary" onClick={() => void restoreRecovery(snapshot)}>{busy ? '处理中…' : '恢复工程'}</Button>
        </div>
      </div>
    </Modal>
  )
}

import { create } from 'zustand'
import type { RecoverySnapshot } from '@shared/recovery'

export const useRecoveryStore = create<{
  pending: RecoverySnapshot[]
  busy: boolean
  error: string | null
}>(() => ({ pending: [], busy: false, error: null }))

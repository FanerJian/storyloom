import React from 'react'
import { cn } from '../lib/utils'
import { X } from 'lucide-react'

/** 轻量 UI 套件：shadcn 风格的自绘组件（MVP 阶段避免引入 radix 全家桶） */

type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger' | 'soft'
type ButtonSize = 'sm' | 'md' | 'icon'

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors select-none disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500'

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-indigo-600 text-white hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400 shadow-sm shadow-indigo-600/20',
  default:
    'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)]',
  ghost: 'text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]',
  danger: 'border border-rose-500/40 text-rose-500 hover:bg-rose-500/10',
  soft: 'bg-[var(--accent-soft)] text-indigo-600 dark:text-indigo-300 hover:brightness-110'
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-[13px]',
  icon: 'h-8 w-8 text-[15px]'
}

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)} {...props} />
}

const fieldBase =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-[13px] text-[var(--text)] placeholder:text-[var(--text-dim)]/70 focus:outline-none focus:border-indigo-500/70 focus:ring-2 focus:ring-indigo-500/15 transition-colors'

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, 'h-8', className)} {...props} />
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, 'py-2 leading-relaxed resize-y min-h-20', className)} {...props} />
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        fieldBase,
        'h-8 appearance-none bg-no-repeat pr-6',
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%239aa1b2%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')]",
        '[background-position:right_8px_center]',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Badge({
  className,
  tone = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'default' | 'accent' | 'green' | 'red' | 'amber' | 'purple' }) {
  const tones: Record<string, string> = {
    default: 'bg-[var(--surface-2)] text-[var(--text-dim)] border-[var(--border)]',
    accent: 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-300 border-indigo-500/25',
    green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    red: 'bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/25',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
    purple: 'bg-purple-500/10 text-purple-500 dark:text-purple-300 border-purple-500/25'
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none',
        tones[tone],
        className
      )}
      {...props}
    />
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 560,
  closeOnBackdrop = true
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  children: React.ReactNode
  width?: number
  closeOnBackdrop?: boolean
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 backdrop-blur-[2px] animate-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && closeOnBackdrop) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div className="text-[14px] font-semibold">{title}</div>
          <button
            className="rounded-md p-1 text-[var(--text-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  className
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-[var(--text-dim)] uppercase">{label}</span>
        {hint && <span className="text-[11px] text-[var(--text-dim)]/70">{hint}</span>}
      </div>
      {children}
    </label>
  )
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[12px] text-[var(--text-dim)]">
      {children}
    </div>
  )
}

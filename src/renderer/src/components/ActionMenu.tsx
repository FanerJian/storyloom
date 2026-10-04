import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import { Button } from './ui'
import { cn } from '../lib/utils'

export interface MenuAction {
  label: string
  icon?: LucideIcon
  shortcut?: string
  selected?: boolean
  disabled?: boolean
  separator?: boolean
  onSelect: () => void
}

/** 点击、键盘和触摸共用的轻量菜单。 */
export function ActionMenu({ label, children, actions, active = false, align = 'left', className }: {
  label: string; children: ReactNode; actions: MenuAction[]; active?: boolean
  align?: 'left' | 'right'; className?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  const focusItem = (last = false): void => {
    requestAnimationFrame(() => {
      const items = root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      items?.[last ? items.length - 1 : 0]?.focus()
    })
  }
  const close = (restoreFocus = false): void => {
    setOpen(false)
    if (restoreFocus) root.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus()
  }
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return <div ref={root} className={cn('relative flex-none', className)} onBlur={(e) => {
    if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) close()
  }} onKeyDown={(e) => {
    if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(true) }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    if (!open) { setOpen(true); focusItem(e.key === 'ArrowUp'); return }
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
    items[next]?.focus()
  }}>
    <Button variant={active || open ? 'soft' : 'ghost'} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { if (open) close(); else { setOpen(true); focusItem() } }}>
      {children}<ChevronDown size={12} className={cn('opacity-60 transition-transform', open && 'rotate-180')} />
    </Button>
    {open && <div id={id} role="menu" aria-label={label} className={cn('absolute top-full z-50 mt-2 min-w-56 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-xl shadow-black/20', align === 'right' ? 'right-0' : 'left-0')}>
      {actions.map(({ label: name, icon: Icon, shortcut, selected, disabled, separator, onSelect }) => <div key={name} className={separator ? 'mt-1 border-t border-[var(--border)] pt-1' : ''}>
        <button role="menuitem" disabled={disabled} tabIndex={-1} className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] outline-none hover:bg-[var(--surface-2)] focus:bg-[var(--surface-2)] disabled:opacity-40', selected && 'text-[var(--accent)]')}
          onClick={() => { close(true); onSelect() }}>
          {Icon && <Icon size={15} className="flex-none" />}<span className="flex-1 whitespace-nowrap">{name}</span>
          {shortcut && <span className="ml-3 text-[10px] text-[var(--text-dim)]">{shortcut}</span>}{selected && <Check size={13} />}
        </button>
      </div>)}
    </div>}
  </div>
}

'use client'
import { useEffect, useRef, ReactNode } from 'react'
import { X, AlertTriangle, QrCode, Loader2 } from 'lucide-react'
import { cn, getStatusColor, getStatusLabel } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'

// ── Modal ──────────────────────────────────────────────────────────────────
interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  footer?: ReactNode
}

export function Modal({ open, onClose, title, children, size = 'md', footer }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const sizeMap = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div
        ref={ref}
        className={cn('bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[90vh]', sizeMap[size])}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  )
}

// ── StatusBadge ────────────────────────────────────────────────────────────
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('badge', getStatusColor(status))}>
      {getStatusLabel(status)}
    </span>
  )
}

// ── ConfirmDialog ──────────────────────────────────────────────────────────
interface ConfirmProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger = false, loading = false }: ConfirmProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="flex gap-3">
        {danger && (
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
        )}
        <p className="text-sm text-slate-600 leading-relaxed">{message}</p>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <button onClick={onClose} className="btn-secondary btn-sm" disabled={loading}>Cancel</button>
        <button onClick={onConfirm} className={cn(danger ? 'btn-danger' : 'btn-primary', 'btn-sm')} disabled={loading}>
          {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing...</> : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

// ── Loading spinner ────────────────────────────────────────────────────────
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-brand-600', className ?? 'w-6 h-6')} />
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center py-24">
      <Spinner className="w-8 h-8" />
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, description, action }: {
  icon?: React.ElementType
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      {Icon && <Icon className="w-12 h-12 mb-3 opacity-30" />}
      <p className="text-base font-semibold text-slate-500">{title}</p>
      {description && <p className="text-sm text-slate-400 mt-1 text-center max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── PageGuard ──────────────────────────────────────────────────────────────
export function PageGuard({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { profile, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !profile) router.replace('/auth/login')
  }, [loading, profile, router])

  if (loading) return <PageLoader />
  if (!profile) return null
  if (roles && !roles.includes(profile.role)) {
    return (
      <div className="empty-state">
        <AlertTriangle className="w-12 h-12 mb-3 text-amber-400" />
        <p className="text-base font-semibold">Access denied</p>
        <p className="text-sm text-slate-400 mt-1">You don't have permission to view this page.</p>
      </div>
    )
  }

  return <>{children}</>
}

// ── FormField ──────────────────────────────────────────────────────────────
export function FormField({
  label, error, required, children, hint
}: { label: string; error?: string; required?: boolean; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

// ── Pagination ──────────────────────────────────────────────────────────────
export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
      <span>Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
        <button className="btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next</button>
      </div>
    </div>
  )
}

// ── Search input ────────────────────────────────────────────────────────────
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input pl-9 w-64"
        placeholder={placeholder ?? 'Search...'}
      />
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </div>
  )
}

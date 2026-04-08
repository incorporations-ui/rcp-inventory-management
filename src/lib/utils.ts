import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(amount)
}

export function formatDate(date: string | Date): string {
  if (!date) return '-'
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'dd MMM yyyy')
}

export function formatDateTime(date: string | Date): string {
  if (!date) return '-'
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'dd MMM yyyy, hh:mm a')
}

export function generateQRData(entityType: string, entityId: string): string {
  return `RCP:${entityType.toUpperCase()}:${entityId}`
}

export function parseQRData(qrData: string): { entityType: string; entityId: string } | null {
  const parts = qrData.split(':')
  if (parts.length !== 3 || parts[0] !== 'RCP') return null
  return { entityType: parts[1].toLowerCase(), entityId: parts[2] }
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    // General
    active: 'bg-emerald-100 text-emerald-800',
    inactive: 'bg-gray-100 text-gray-600',
    // PO / SO
    draft: 'bg-gray-100 text-gray-700',
    approved: 'bg-blue-100 text-blue-800',
    completed: 'bg-emerald-100 text-emerald-800',
    cancelled: 'bg-red-100 text-red-800',
    // GRN
    in_progress: 'bg-amber-100 text-amber-800',
    finalized: 'bg-emerald-100 text-emerald-800',
    // GRN lines
    pending: 'bg-gray-100 text-gray-700',
    received: 'bg-emerald-100 text-emerald-800',
    not_received: 'bg-red-100 text-red-800',
    damaged: 'bg-orange-100 text-orange-800',
    // Packing
    packed: 'bg-emerald-100 text-emerald-800',
    unavailable: 'bg-red-100 text-red-800',
    packing_in_progress: 'bg-amber-100 text-amber-800',
    // Invoice
    invoiced: 'bg-blue-100 text-blue-800',
    dispatched: 'bg-emerald-100 text-emerald-800',
    ready: 'bg-blue-100 text-blue-800',
    // Payment
    unpaid: 'bg-red-100 text-red-800',
    partial: 'bg-amber-100 text-amber-800',
    paid: 'bg-emerald-100 text-emerald-800',
    // SO
    proforma_sent: 'bg-indigo-100 text-indigo-800',
    grn_in_progress: 'bg-amber-100 text-amber-800',
  }
  return map[status] || 'bg-gray-100 text-gray-700'
}

export function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: 'Draft',
    approved: 'Approved',
    grn_in_progress: 'GRN In Progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
    in_progress: 'In Progress',
    finalized: 'Finalized',
    pending: 'Pending',
    received: 'Received',
    not_received: 'Not Received',
    damaged: 'Damaged',
    packed: 'Packed',
    unavailable: 'Unavailable',
    packing_in_progress: 'Packing In Progress',
    invoiced: 'Invoiced',
    dispatched: 'Dispatched',
    ready: 'Ready',
    unpaid: 'Unpaid',
    partial: 'Partial',
    paid: 'Paid',
    proforma_sent: 'Proforma Sent',
    active: 'Active',
    inactive: 'Inactive',
  }
  return map[status] || status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

export function getRoleLabel(role: string): string {
  const map: Record<string, string> = {
    admin: 'Admin',
    sales_manager: 'Sales Manager',
    packing_executive: 'Packing Executive',
    accounts: 'Accounts',
    view_only: 'View Only',
  }
  return map[role] || role
}

export function canEdit(role: string, section: string): boolean {
  const permissions: Record<string, string[]> = {
    masters: ['admin'],
    customers_suppliers: ['admin', 'sales_manager'],
    purchase: ['admin', 'sales_manager'],
    grn: ['admin', 'sales_manager', 'packing_executive'],
    stocking: ['admin', 'packing_executive'],
    sales: ['admin', 'sales_manager'],
    packing: ['admin', 'packing_executive'],
    invoice: ['admin', 'sales_manager', 'accounts'],
    returns: ['admin', 'sales_manager'],
    users: ['admin'],
  }
  return permissions[section]?.includes(role) ?? false
}

export function exportToCSV(data: Record<string, any>[], filename: string) {
  if (!data.length) return
  const headers = Object.keys(data[0])
  const csv = [
    headers.join(','),
    ...data.map(row =>
      headers.map(h => {
        const val = row[h]
        if (val === null || val === undefined) return ''
        const str = String(val)
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str
      }).join(',')
    )
  ].join('\n')

  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}_${format(new Date(), 'yyyyMMdd')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

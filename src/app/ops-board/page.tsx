'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, StatusBadge } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import { RefreshCw, Clock, PackageCheck, PackageSearch, Truck, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import toast from 'react-hot-toast'

interface OpsCard {
  id: string
  section: string
  docNumber: string
  title: string
  subtitle?: string
  status: string
  totalQty?: number
  processedQty?: number
  pendingQty?: number
  docDate: string
  href: string
  urgency?: 'normal' | 'warning' | 'urgent'
}

const SECTIONS = [
  { key: 'grn_stocking', label: 'Stocking Queue', icon: Truck, color: 'border-purple-400', href: '/purchases/stocking', emptyMsg: 'All lots have been stocked' },
  { key: 'packing', label: 'Packing In Progress', icon: PackageSearch, color: 'border-amber-400', href: '/sales/packing', emptyMsg: 'No active packing lists' },
  { key: 'ready_dispatch', label: 'Ready for Dispatch', icon: PackageCheck, color: 'border-emerald-500', href: '/sales/invoices', emptyMsg: 'No invoices awaiting dispatch' },
]

export default function OpsBoardPage() {
  const [cards, setCards] = useState<OpsCard[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [mismatches, setMismatches] = useState<any[]>([])
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)

    // Load stocking queue
    const { data: stockingQ } = await supabase
      .from('grn_stocking_queue')
      .select('*, skus(display_name, sku_code), grns(grn_number)')
      .in('status', ['pending', 'partial'])
      .order('created_at', { ascending: true })

    // Load packing lists
    const { data: packingLists } = await supabase
      .from('packing_lists')
      .select('*, sales_orders(so_number, customers(name)), packing_list_lines(ordered_units, packed_units, status)')
      .in('status', ['pending', 'in_progress'])
      .order('created_at', { ascending: true })

    // Load ready-to-dispatch invoices
    const { data: readyInvoices } = await supabase
      .from('invoices')
      .select('*, customers(name), sales_orders(so_number)')
      .eq('dispatch_status', 'ready')
      .order('created_at', { ascending: true })

    // Load mismatch flags
    const { data: mmLines } = await supabase
      .from('packing_list_lines')
      .select('*, skus(display_name), packing_lists(pl_number)')
      .eq('mismatch_flagged', true)
      .eq('status', 'unavailable')

    const built: OpsCard[] = []

    stockingQ?.forEach(q => {
      const pct = q.total_units > 0 ? q.stocked_units / q.total_units : 0
      built.push({
        id: q.id, section: 'grn_stocking',
        docNumber: (q.grns as any)?.grn_number,
        title: (q.skus as any)?.display_name,
        subtitle: (q.skus as any)?.sku_code,
        status: q.status,
        totalQty: q.total_units,
        processedQty: q.stocked_units,
        pendingQty: q.total_units - q.stocked_units,
        docDate: q.created_at,
        href: '/purchases/stocking',
        urgency: pct === 0 ? 'urgent' : pct < 0.5 ? 'warning' : 'normal',
      })
    })

    packingLists?.forEach(pl => {
      const lines = pl.packing_list_lines as any[] ?? []
      const total = lines.reduce((s: number, l: any) => s + l.ordered_units, 0)
      const packed = lines.reduce((s: number, l: any) => s + l.packed_units, 0)
      built.push({
        id: pl.id, section: 'packing',
        docNumber: pl.pl_number,
        title: (pl.sales_orders as any)?.customers?.name,
        subtitle: (pl.sales_orders as any)?.so_number,
        status: pl.status,
        totalQty: total,
        processedQty: packed,
        pendingQty: total - packed,
        docDate: pl.created_at,
        href: `/sales/packing/${pl.id}`,
        urgency: pl.status === 'pending' ? 'urgent' : 'normal',
      })
    })

    readyInvoices?.forEach(inv => {
      built.push({
        id: inv.id, section: 'ready_dispatch',
        docNumber: inv.invoice_number,
        title: (inv.customers as any)?.name,
        subtitle: (inv.sales_orders as any)?.so_number,
        status: 'ready',
        docDate: inv.created_at,
        href: `/sales/invoices/${inv.id}`,
        urgency: 'normal',
      })
    })

    setCards(built)
    setMismatches(mmLines ?? [])
    setLastRefresh(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000) // auto-refresh every 30s
    return () => clearInterval(interval)
  }, [load])

  // Real-time subscription
  useEffect(() => {
    const channel = supabase.channel('ops-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'packing_lists' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grn_stocking_queue' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="page-title">Operations Board</h1>
              <p className="text-sm text-slate-500 mt-0.5 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Last updated: {formatDateTime(lastRefresh)} · Auto-refreshes every 30s
              </p>
            </div>
            <button onClick={load} disabled={loading} className="btn-secondary btn-sm">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          {/* Mismatch alerts */}
          {mismatches.length > 0 && (
            <div className="alert-danger">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold mb-1">⚠ Stock Mismatch Alerts ({mismatches.length})</p>
                  <div className="space-y-1">
                    {mismatches.map(m => (
                      <p key={m.id} className="text-sm">
                        <strong>{(m.skus as any)?.display_name}</strong> — marked unavailable on packing list{' '}
                        <strong>{(m.packing_lists as any)?.pl_number}</strong> but system shows stock available.
                        {m.mismatch_notes && <span className="text-red-700"> Note: {m.mismatch_notes}</span>}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Three column board */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {SECTIONS.map(section => {
              const sectionCards = cards.filter(c => c.section === section.key)
              return (
                <div key={section.key}>
                  {/* Column header */}
                  <div className={`flex items-center justify-between mb-3 pb-2 border-b-2 ${section.color}`}>
                    <div className="flex items-center gap-2">
                      <section.icon className="w-4 h-4 text-slate-600" />
                      <span className="font-semibold text-sm text-slate-800">{section.label}</span>
                      <span className="badge bg-slate-100 text-slate-600">{sectionCards.length}</span>
                    </div>
                    <Link href={section.href} className="text-xs text-brand-600 hover:underline">View all</Link>
                  </div>

                  {/* Cards */}
                  <div className="space-y-3">
                    {sectionCards.length === 0 ? (
                      <div className="text-center py-10 text-slate-400">
                        <section.icon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">{section.emptyMsg}</p>
                      </div>
                    ) : sectionCards.map(card => (
                      <Link key={card.id} href={card.href} className={`ops-token block ${card.status} hover:shadow-md transition-all`}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <p className="text-xs font-mono text-slate-500">{card.docNumber}</p>
                            <p className="text-sm font-semibold text-slate-900 truncate">{card.title}</p>
                            {card.subtitle && <p className="text-xs text-slate-500">{card.subtitle}</p>}
                          </div>
                          <StatusBadge status={card.status} />
                        </div>

                        {/* Progress bar for qty-based cards */}
                        {card.totalQty !== undefined && card.totalQty > 0 && (
                          <div className="mt-2">
                            <div className="flex justify-between text-xs text-slate-500 mb-1">
                              <span>{card.processedQty} / {card.totalQty} units</span>
                              <span>{Math.round(((card.processedQty ?? 0) / card.totalQty) * 100)}%</span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-brand-500 rounded-full transition-all"
                                style={{ width: `${Math.min(100, ((card.processedQty ?? 0) / card.totalQty) * 100)}%` }}
                              />
                            </div>
                          </div>
                        )}

                        <p className="text-xs text-slate-400 mt-2">{formatDateTime(card.docDate)}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </PageGuard>
    </AppLayout>
  )
}

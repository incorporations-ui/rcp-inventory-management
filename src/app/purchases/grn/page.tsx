'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, StatusBadge, PageLoader, SearchInput, Modal, FormField } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { Eye, PackageCheck, ChevronDown, ChevronRight, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'

export default function GRNPage() {
  const [grns, setGrns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedGrn, setExpandedGrn] = useState<string | null>(null)
  const [grnLines, setGrnLines] = useState<Record<string, any[]>>({})
  const [finalizing, setFinalizing] = useState<string | null>(null)
  const { profile } = useAuth()
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data } = await supabase.from('grns')
      .select('*, purchase_orders(po_number, suppliers(name)), grn_lines(id, status)')
      .order('created_at', { ascending: false })
    setGrns(data ?? [])
    setLoading(false)
  }

  async function loadLines(grnId: string) {
    const { data } = await supabase.from('grn_lines')
      .select('*, skus(display_name, sku_code, units_per_box)').eq('grn_id', grnId).order('sort_order')
    setGrnLines(prev => ({ ...prev, [grnId]: data ?? [] }))
  }

  async function toggleExpand(grnId: string) {
    if (expandedGrn === grnId) { setExpandedGrn(null); return }
    setExpandedGrn(grnId)
    if (!grnLines[grnId]) await loadLines(grnId)
  }

  async function updateLine(grnId: string, lineId: string, updates: Record<string, any>) {
    const { error } = await supabase.from('grn_lines').update(updates).eq('id', lineId)
    if (error) toast.error(error.message)
    else await loadLines(grnId)
  }

  async function markReceived(grnId: string, lineId: string, line: any) {
    await updateLine(grnId, lineId, {
      status: 'received',
      received_boxes: line.expected_boxes,
      received_units: line.expected_units,
    })
  }

  async function markNotReceived(grnId: string, lineId: string) {
    await updateLine(grnId, lineId, { status: 'not_received', received_units: 0, received_boxes: 0 })
  }

  async function markDamaged(grnId: string, lineId: string, line: any) {
    const notes = prompt('Describe the damage:')
    await updateLine(grnId, lineId, {
      status: 'damaged', damaged_units: line.expected_units, damage_notes: notes,
    })
  }

  async function finalizeGRN(grnId: string) {
    const lines = grnLines[grnId] ?? []
    const allDone = lines.every(l => l.status !== 'pending')
    if (!allDone) { toast.error('All lines must be processed before finalizing'); return }
    setFinalizing(grnId)

    const receivedLines = lines.filter(l => l.status === 'received')

    // Create lots and update stock for received lines
    for (const line of receivedLines) {
      const { data: lotNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'LOT' })
      const { data: lot } = await supabase.from('lots').insert({
        lot_number: lotNum, grn_id: grnId, grn_line_id: line.id,
        sku_id: line.sku_id, received_date: new Date().toISOString().split('T')[0],
        received_units: line.received_units, remaining_units: line.received_units,
        unit_cost: line.unit_price,
      }).select().single()

      if (lot) {
        // Update stock master
        await supabase.rpc('update_stock_master', { p_sku_id: line.sku_id, p_delta: line.received_units })

        // Add to stocking queue
        await supabase.from('grn_stocking_queue').insert({
          lot_id: lot.id, sku_id: line.sku_id, grn_id: grnId,
          total_units: line.received_units, stocked_units: 0, status: 'pending',
        })

        // Log movement
        await supabase.from('stock_movements').insert({
          sku_id: line.sku_id, lot_id: lot.id, movement_type: 'grn_in',
          reference_type: 'grn', reference_id: grnId,
          units_in: line.received_units, balance_after: 0, created_by: profile?.id,
        })
      }
    }

    await supabase.from('grns').update({ status: 'finalized', finalized_by: profile?.id, finalized_at: new Date().toISOString() }).eq('id', grnId)
    await supabase.from('purchase_orders').update({ status: 'completed' }).eq('po_id',
      grns.find(g => g.id === grnId)?.po_id ?? ''
    )

    toast.success(`GRN finalized. ${receivedLines.length} lots created and added to stocking queue.`)
    setFinalizing(null)
    loadData()
  }

  const filtered = grns.filter(g =>
    g.grn_number?.toLowerCase().includes(search.toLowerCase()) ||
    g.purchase_orders?.po_number?.toLowerCase().includes(search.toLowerCase()) ||
    g.purchase_orders?.suppliers?.name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-4">
          <div className="page-header">
            <div><h1 className="page-title">GRN — Goods Receipt</h1><p className="text-sm text-slate-500 mt-0.5">{filtered.length} records</p></div>
            <SearchInput value={search} onChange={setSearch} />
          </div>
          <p className="text-sm text-slate-500 -mt-2">GRNs are auto-created when a PO is moved to "Start GRN" from the Purchase Orders page.</p>

          {loading ? <PageLoader /> : (
            <div className="space-y-3">
              {filtered.map(grn => {
                const lines = grn.grn_lines as any[] ?? []
                const received = lines.filter((l: any) => l.status === 'received').length
                const notReceived = lines.filter((l: any) => l.status === 'not_received').length
                const damaged = lines.filter((l: any) => l.status === 'damaged').length
                const pending = lines.filter((l: any) => l.status === 'pending').length
                const expanded = expandedGrn === grn.id
                const detailLines = grnLines[grn.id] ?? []
                return (
                  <div key={grn.id} className="card">
                    <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50" onClick={() => toggleExpand(grn.id)}>
                      <div className="flex items-center gap-4">
                        {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-brand-700">{grn.grn_number}</span>
                            <StatusBadge status={grn.status} />
                          </div>
                          <p className="text-sm text-slate-500 mt-0.5">{grn.purchase_orders?.suppliers?.name} · PO: {grn.purchase_orders?.po_number} · {formatDate(grn.grn_date)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        {received > 0 && <span className="badge bg-emerald-100 text-emerald-700">✓ {received} received</span>}
                        {notReceived > 0 && <span className="badge bg-red-100 text-red-700">✗ {notReceived} not received</span>}
                        {damaged > 0 && <span className="badge bg-orange-100 text-orange-700">⚠ {damaged} damaged</span>}
                        {pending > 0 && <span className="badge bg-slate-100 text-slate-600">{pending} pending</span>}
                        {grn.status === 'in_progress' && lines.length > 0 && pending === 0 && (
                          <button
                            onClick={e => { e.stopPropagation(); finalizeGRN(grn.id) }}
                            disabled={finalizing === grn.id}
                            className="btn-primary btn-sm"
                          >
                            <PackageCheck className="w-3.5 h-3.5" />
                            {finalizing === grn.id ? 'Finalizing...' : 'Finalize GRN'}
                          </button>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div className="border-t border-slate-100">
                        {detailLines.length === 0 ? (
                          <p className="text-center text-slate-400 py-6">Loading lines...</p>
                        ) : detailLines.map(line => (
                          <div key={line.id} className={`flex items-center justify-between px-5 py-3 border-b border-slate-50 last:border-0 ${line.status !== 'pending' ? 'opacity-75' : ''}`}>
                            <div>
                              <p className="text-sm font-medium">{line.skus?.display_name}</p>
                              <p className="text-xs text-slate-500">Expected: {line.expected_boxes} boxes / {line.expected_units} units · ₹{line.unit_price}/unit</p>
                              {line.damage_notes && <p className="text-xs text-orange-600 mt-0.5">Damage: {line.damage_notes}</p>}
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusBadge status={line.status} />
                              {grn.status === 'in_progress' && line.status === 'pending' && (
                                <>
                                  <button onClick={() => markReceived(grn.id, line.id, line)} className="btn-primary btn-sm"><CheckCircle className="w-3.5 h-3.5" /> Received</button>
                                  <button onClick={() => markDamaged(grn.id, line.id, line)} className="btn-secondary btn-sm text-orange-600"><AlertTriangle className="w-3.5 h-3.5" /> Damaged</button>
                                  <button onClick={() => markNotReceived(grn.id, line.id)} className="btn-secondary btn-sm text-red-600"><XCircle className="w-3.5 h-3.5" /> Not Received</button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </PageGuard>
    </AppLayout>
  )
}

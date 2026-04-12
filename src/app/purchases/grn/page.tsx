'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, StatusBadge, PageLoader, SearchInput, Modal, FormField } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { PackageCheck, ChevronDown, ChevronRight, CheckCircle, XCircle, AlertTriangle, Edit2, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'

export default function GRNPage() {
  const [grns, setGrns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedGrn, setExpandedGrn] = useState<string | null>(null)
  const [grnLines, setGrnLines] = useState<Record<string, any[]>>({})
  const [linesLoading, setLinesLoading] = useState<Record<string, boolean>>({})
  const [finalizing, setFinalizing] = useState<string | null>(null)
  const [partialModal, setPartialModal] = useState<{ grnId: string; line: any } | null>(null)
  const [partialBoxes, setPartialBoxes] = useState(0)
  const [partialUnits, setPartialUnits] = useState(0)
  const [damageModal, setDamageModal] = useState<{ grnId: string; line: any } | null>(null)
  const [damageNotes, setDamageNotes] = useState('')
  const [damagedUnits, setDamagedUnits] = useState(0)
  const [cancelGrnItem, setCancelGrnItem] = useState<any>(null)
  const [cancellingGrn, setCancellingGrn] = useState(false)
  const [grnNotes, setGrnNotes] = useState<Record<string, string>>({})
  const [savingGrnNotes, setSavingGrnNotes] = useState<string | null>(null)
  const { profile } = useAuth()
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data, error } = await supabase
      .from('grns')
      .select('id, grn_number, grn_date, status, po_id, purchase_orders ( po_number, suppliers ( name ) ), grn_lines ( id, status )')
      .order('created_at', { ascending: false })
    if (error) toast.error('Failed to load GRNs: ' + error.message)
    setGrns(data ?? [])
    setLoading(false)
  }

  const loadLines = useCallback(async (grnId: string) => {
    setLinesLoading(prev => ({ ...prev, [grnId]: true }))
    const { data, error } = await supabase
      .from('grn_lines')
      .select('id, grn_id, po_line_id, sku_id, expected_boxes, expected_units, received_boxes, received_units, damaged_units, not_received_units, status, damage_notes, unit_price, gst_rate, sort_order, skus ( display_name, sku_code, units_per_box )')
      .eq('grn_id', grnId)
      .order('sort_order')
    if (error) {
      toast.error('Failed to load lines: ' + error.message)
    } else {
      setGrnLines(prev => ({ ...prev, [grnId]: data ?? [] }))
    }
    setLinesLoading(prev => ({ ...prev, [grnId]: false }))
  }, [])

  async function toggleExpand(grnId: string) {
    if (expandedGrn === grnId) { setExpandedGrn(null); return }
    setExpandedGrn(grnId)
    await loadLines(grnId)
    const grn = grns.find(g => g.id === grnId)
    if (grn && grnNotes[grnId] === undefined) {
      setGrnNotes(prev => ({ ...prev, [grnId]: grn.notes ?? '' }))
    }
  }

  async function saveGrnNotes(grnId: string) {
    setSavingGrnNotes(grnId)
    const { error } = await supabase.from('grns').update({ notes: grnNotes[grnId] || null }).eq('id', grnId)
    if (error) toast.error(error.message)
    else toast.success('Notes saved')
    setSavingGrnNotes(null)
  }

  async function updateLine(grnId: string, lineId: string, updates: Record<string, any>) {
    const { error } = await supabase.from('grn_lines').update(updates).eq('id', lineId)
    if (error) { toast.error('Update failed: ' + error.message); return false }
    await loadLines(grnId)
    await loadData()
    return true
  }

  async function markReceived(grnId: string, lineId: string, line: any) {
    const ok = await updateLine(grnId, lineId, { status: 'received', received_boxes: line.expected_boxes, received_units: line.expected_units })
    if (ok) toast.success('Marked as fully received')
  }

  async function markNotReceived(grnId: string, lineId: string) {
    const ok = await updateLine(grnId, lineId, { status: 'not_received', received_units: 0, received_boxes: 0 })
    if (ok) toast.success('Marked as not received')
  }

  async function resetLine(grnId: string, lineId: string) {
    await updateLine(grnId, lineId, { status: 'pending', received_units: 0, received_boxes: 0, damaged_units: 0, damage_notes: null })
  }

  function openDamageModal(grnId: string, line: any) {
    setDamageModal({ grnId, line })
    setDamagedUnits(line.expected_units)
    setDamageNotes('')
  }

  async function confirmDamage() {
    if (!damageModal) return
    const ok = await updateLine(damageModal.grnId, damageModal.line.id, { status: 'damaged', damaged_units: damagedUnits, damage_notes: damageNotes || null })
    if (ok) { toast.success('Marked as damaged'); setDamageModal(null) }
  }

  function openPartialModal(grnId: string, line: any) {
    setPartialModal({ grnId, line })
    setPartialBoxes(line.expected_boxes)
    setPartialUnits(line.expected_units)
  }

  async function confirmPartial() {
    if (!partialModal) return
    const ok = await updateLine(partialModal.grnId, partialModal.line.id, { status: 'received', received_boxes: partialBoxes, received_units: partialUnits, not_received_units: partialModal.line.expected_units - partialUnits })
    if (ok) { toast.success('Partial receive saved'); setPartialModal(null) }
  }

  async function cancelGRN(grn: any) {
    if (grn.status === 'finalized') { toast.error('Cannot cancel a finalized GRN.'); setCancelGrnItem(null); return }
    setCancellingGrn(true)
    await supabase.from('grns').update({ status: 'cancelled' }).eq('id', grn.id)
    // Reset PO status back to approved
    if (grn.po_id) await supabase.from('purchase_orders').update({ status: 'approved' }).eq('id', grn.po_id)
    toast.success(`GRN ${grn.grn_number} cancelled. PO reset to Approved.`)
    setCancelGrnItem(null); setCancellingGrn(false); loadData()
  }

  async function finalizeGRN(grnId: string) {
    const lines = grnLines[grnId] ?? []
    if (!lines.every(l => l.status !== 'pending')) { toast.error('All lines must be processed before finalizing'); return }
    setFinalizing(grnId)
    const receivedLines = lines.filter(l => l.status === 'received')
    for (const line of receivedLines) {
      const { data: lotNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'LOT' })
      const { data: lot, error: lotErr } = await supabase.from('lots').insert({
        lot_number: lotNum, grn_id: grnId, grn_line_id: line.id, sku_id: line.sku_id,
        received_date: new Date().toISOString().split('T')[0],
        received_units: line.received_units, remaining_units: line.received_units, unit_cost: line.unit_price,
      }).select().single()
      if (lotErr || !lot) { toast.error('Failed to create lot: ' + (lotErr?.message ?? 'unknown')); setFinalizing(null); return }
      await supabase.rpc('update_stock_master', { p_sku_id: line.sku_id, p_delta: line.received_units })
      await supabase.from('grn_stocking_queue').insert({ lot_id: lot.id, sku_id: line.sku_id, grn_id: grnId, total_units: line.received_units, stocked_units: 0, status: 'pending' })
      await supabase.from('stock_movements').insert({ sku_id: line.sku_id, lot_id: lot.id, movement_type: 'grn_in', reference_type: 'grn', reference_id: grnId, units_in: line.received_units, balance_after: 0, created_by: profile?.id })
    }
    await supabase.from('grns').update({ status: 'finalized', finalized_by: profile?.id, finalized_at: new Date().toISOString() }).eq('id', grnId)
    const grn = grns.find(g => g.id === grnId)
    if (grn?.po_id) await supabase.from('purchase_orders').update({ status: 'completed' }).eq('id', grn.po_id)
    toast.success(`GRN finalized. ${receivedLines.length} lot${receivedLines.length !== 1 ? 's' : ''} created and added to stocking queue.`)
    setFinalizing(null)
    loadData()
  }

  const filtered = grns.filter(g =>
    g.grn_number?.toLowerCase().includes(search.toLowerCase()) ||
    (g.purchase_orders as any)?.po_number?.toLowerCase().includes(search.toLowerCase()) ||
    (g.purchase_orders as any)?.suppliers?.name?.toLowerCase().includes(search.toLowerCase())
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

          {loading ? <PageLoader /> : filtered.length === 0 ? (
            <div className="card"><p className="text-center text-slate-400 py-12">No GRNs yet. Create a Purchase Order and click "Start GRN".</p></div>
          ) : (
            <div className="space-y-3">
              {filtered.map(grn => {
                const summaryLines = (grn.grn_lines as any[]) ?? []
                const received = summaryLines.filter(l => l.status === 'received').length
                const notReceived = summaryLines.filter(l => l.status === 'not_received').length
                const damaged = summaryLines.filter(l => l.status === 'damaged').length
                const pending = summaryLines.filter(l => l.status === 'pending').length
                const expanded = expandedGrn === grn.id
                const detailLines = grnLines[grn.id] ?? []
                const isLinesLoading = linesLoading[grn.id] ?? false

                return (
                  <div key={grn.id} className="card overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => toggleExpand(grn.id)}>
                      <div className="flex items-center gap-4">
                        {expanded ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-brand-700">{grn.grn_number}</span>
                            <StatusBadge status={grn.status} />
                          </div>
                          <p className="text-sm text-slate-500 mt-0.5">
                            {(grn.purchase_orders as any)?.suppliers?.name} · PO: {(grn.purchase_orders as any)?.po_number} · {formatDate(grn.grn_date)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap justify-end" onClick={e => e.stopPropagation()}>
                        {received > 0 && <span className="badge bg-emerald-100 text-emerald-700">✓ {received} received</span>}
                        {notReceived > 0 && <span className="badge bg-red-100 text-red-700">✗ {notReceived} not received</span>}
                        {damaged > 0 && <span className="badge bg-orange-100 text-orange-700">⚠ {damaged} damaged</span>}
                        {pending > 0 && <span className="badge bg-slate-100 text-slate-600">{pending} pending</span>}
                        {grn.status === 'in_progress' && summaryLines.length > 0 && pending === 0 && (
                          <button onClick={() => finalizeGRN(grn.id)} disabled={finalizing === grn.id} className="btn-primary btn-sm">
                            <PackageCheck className="w-3.5 h-3.5" />
                            {finalizing === grn.id ? 'Finalizing...' : 'Finalize GRN'}
                          </button>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div className="border-t border-slate-100">
                        {isLinesLoading ? (
                          <div className="flex items-center justify-center gap-3 py-10 text-slate-400">
                            <svg className="w-5 h-5 animate-spin text-brand-500" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                            </svg>
                            <span className="text-sm">Loading lines...</span>
                          </div>
                        ) : detailLines.length === 0 ? (
                          <div className="py-8 text-center">
                            <p className="text-slate-400 text-sm">No line items found for this GRN.</p>
                            <p className="text-slate-300 text-xs mt-1">Ensure the PO had line items before "Start GRN" was clicked.</p>
                          </div>
                        ) : (
                          detailLines.map((line, idx) => (
                            <div key={line.id} className={`px-5 py-4 border-b border-slate-50 last:border-0 transition-colors ${line.status === 'received' ? 'bg-emerald-50/30' : line.status === 'damaged' ? 'bg-orange-50/30' : line.status === 'not_received' ? 'bg-red-50/30' : ''}`}>
                              <div className="flex items-start justify-between gap-4 flex-wrap">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs text-slate-400 font-mono">#{idx + 1}</span>
                                    <p className="text-sm font-semibold text-slate-900">{(line.skus as any)?.display_name}</p>
                                    <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{(line.skus as any)?.sku_code}</code>
                                  </div>
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-500">
                                    <span>Expected: <strong>{line.expected_boxes} boxes / {line.expected_units} units</strong></span>
                                    {line.received_units > 0 && <span className="text-emerald-600">Received: <strong>{line.received_boxes}b / {line.received_units}u</strong></span>}
                                    {line.damaged_units > 0 && <span className="text-orange-600">Damaged: <strong>{line.damaged_units}u</strong></span>}
                                    <span>₹{line.unit_price}/unit · GST {line.gst_rate}%</span>
                                  </div>
                                  {line.damage_notes && <p className="text-xs text-orange-600 mt-1.5 bg-orange-50 border border-orange-100 px-2 py-1 rounded">⚠ {line.damage_notes}</p>}
                                </div>

                                <div className="flex items-center gap-2 flex-wrap justify-end">
                                  <StatusBadge status={line.status} />
                                  {grn.status === 'in_progress' && line.status === 'pending' && (
                                    <>
                                      <button onClick={() => markReceived(grn.id, line.id, line)} className="btn-primary btn-sm"><CheckCircle className="w-3.5 h-3.5" /> Full Receive</button>
                                      <button onClick={() => openPartialModal(grn.id, line)} className="btn-secondary btn-sm text-brand-600"><Edit2 className="w-3.5 h-3.5" /> Partial</button>
                                      <button onClick={() => openDamageModal(grn.id, line)} className="btn-secondary btn-sm text-orange-600"><AlertTriangle className="w-3.5 h-3.5" /> Damaged</button>
                                      <button onClick={() => markNotReceived(grn.id, line.id)} className="btn-secondary btn-sm text-red-600"><XCircle className="w-3.5 h-3.5" /> Not Received</button>
                                    </>
                                  )}
                                  {grn.status === 'in_progress' && line.status !== 'pending' && (
                                    <button onClick={() => resetLine(grn.id, line.id)} className="btn-ghost btn-sm text-slate-400 text-xs" title="Reset this line"><RotateCcw className="w-3.5 h-3.5" /></button>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* GRN-level notes */}
                      <div className="px-5 py-4 border-t border-slate-100 bg-slate-50">
                        <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wider">GRN Notes</p>
                        <textarea
                          value={grnNotes[grn.id] ?? ''}
                          onChange={e => setGrnNotes(prev => ({ ...prev, [grn.id]: e.target.value }))}
                          rows={2}
                          className="input w-full text-sm"
                          placeholder="Vehicle number, driver name, any discrepancies observed..."
                          disabled={grn.status === 'finalized'}
                        />
                        {grn.status !== 'finalized' && (
                          <div className="flex justify-end mt-2">
                            <button
                              onClick={() => saveGrnNotes(grn.id)}
                              disabled={savingGrnNotes === grn.id}
                              className="btn-secondary btn-sm"
                            >
                              {savingGrnNotes === grn.id ? 'Saving...' : 'Save Notes'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Damage modal */}
        <Modal open={!!damageModal} onClose={() => setDamageModal(null)} title="Mark as Damaged" size="sm">
          {damageModal && (
            <div className="space-y-4">
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800">
                <p className="font-semibold">{(damageModal.line.skus as any)?.display_name}</p>
                <p className="text-xs mt-0.5">Expected: {damageModal.line.expected_units} units</p>
              </div>
              <FormField label="Number of damaged units"><input type="number" value={damagedUnits} onChange={e => setDamagedUnits(Number(e.target.value))} className="input" min={1} max={damageModal.line.expected_units} /></FormField>
              <FormField label="Damage description" required><textarea value={damageNotes} onChange={e => setDamageNotes(e.target.value)} className="input" rows={3} placeholder="Describe the damage (e.g. packaging torn, unit cracked...)" /></FormField>
              <div className="flex justify-end gap-2">
                <button onClick={() => setDamageModal(null)} className="btn-secondary btn-sm">Cancel</button>
                <button onClick={confirmDamage} disabled={!damageNotes.trim()} className="btn-danger btn-sm"><AlertTriangle className="w-3.5 h-3.5" /> Confirm Damage</button>
              </div>
            </div>
          )}
        </Modal>

        {/* Partial receive modal */}
        <Modal open={!!partialModal} onClose={() => setPartialModal(null)} title="Partial Receive" size="sm">
          {partialModal && (
            <div className="space-y-4">
              <div className="bg-brand-50 border border-brand-200 rounded-lg p-3 text-sm">
                <p className="font-semibold">{(partialModal.line.skus as any)?.display_name}</p>
                <p className="text-xs text-slate-500 mt-0.5">Expected: {partialModal.line.expected_boxes} boxes / {partialModal.line.expected_units} units</p>
              </div>
              <FormField label="Boxes actually received"><input type="number" value={partialBoxes} onChange={e => setPartialBoxes(Number(e.target.value))} className="input" min={0} max={partialModal.line.expected_boxes} /></FormField>
              <FormField label="Units actually received"><input type="number" value={partialUnits} onChange={e => setPartialUnits(Number(e.target.value))} className="input" min={1} max={partialModal.line.expected_units} /></FormField>
              {partialUnits < partialModal.line.expected_units && (
                <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded">{partialModal.line.expected_units - partialUnits} units will be marked as not received.</p>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={() => setPartialModal(null)} className="btn-secondary btn-sm">Cancel</button>
                <button onClick={confirmPartial} disabled={partialUnits <= 0} className="btn-primary btn-sm"><CheckCircle className="w-3.5 h-3.5" /> Confirm Partial Receive</button>
              </div>
            </div>
          )}
        </Modal>
      </PageGuard>
    </AppLayout>
  )
}

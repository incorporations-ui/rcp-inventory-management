'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, StatusBadge, PageLoader, SearchInput, Modal, FormField, ConfirmDialog } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { formatDate, canEdit } from '@/lib/utils'
import { Plus, Trash2, ChevronDown, ChevronRight, CheckCircle, PackagePlus, PackageMinus, AlertTriangle, Info } from 'lucide-react'
import toast from 'react-hot-toast'

const ADJ_TYPES = [
  { value: 'opening_stock',   label: 'Opening Stock',     icon: PackagePlus,  color: 'text-emerald-600', desc: 'Add existing stock to the system for the first time' },
  { value: 'damage_writeoff', label: 'Damage Write-off',  icon: AlertTriangle,color: 'text-orange-600',  desc: 'Write off damaged or unsaleable stock' },
  { value: 'correction_in',   label: 'Stock Correction +',icon: PackagePlus,  color: 'text-blue-600',    desc: 'Add units after a physical count mismatch' },
  { value: 'correction_out',  label: 'Stock Correction −',icon: PackageMinus, color: 'text-red-600',     desc: 'Remove units after a physical count mismatch' },
]

export default function StockAdjustmentsPage() {
  const [adjustments, setAdjustments] = useState<any[]>([])
  const [skus, setSkus] = useState<any[]>([])
  const [racks, setRacks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [adjLines, setAdjLines] = useState<Record<string, any[]>>({})
  const [modalOpen, setModalOpen] = useState(false)
  const [approveTarget, setApproveTarget] = useState<any>(null)
  const [approving, setApproving] = useState(false)
  const [saving, setSaving] = useState(false)
  // Form state
  const [adjType, setAdjType] = useState('opening_stock')
  const [adjNotes, setAdjNotes] = useState('')
  const [lines, setLines] = useState<any[]>([{ sku_id: '', units: 1, unit_cost: '', rack_id: '', damage_notes: '' }])
  const { profile } = useAuth()
  const supabase = createClient()
  const canWrite = canEdit(profile?.role ?? '', 'sales') // admin + sales_manager

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [{ data: adjs }, { data: skuList }, { data: rackList }] = await Promise.all([
      supabase.from('stock_adjustments').select('*, user_profiles(full_name), approver:approved_by(full_name)').order('created_at', { ascending: false }),
      supabase.from('skus').select('id, sku_code, display_name, gst_rate').eq('status', 'active').order('display_name'),
      supabase.from('racks').select('id, rack_id_display').eq('status', 'active').order('rack_id_display'),
    ])
    setAdjustments(adjs ?? [])
    setSkus(skuList ?? [])
    setRacks(rackList ?? [])
    setLoading(false)
  }

  async function loadLines(adjId: string) {
    const { data } = await supabase.from('stock_adjustment_lines')
      .select('*, skus(display_name, sku_code), racks(rack_id_display), lots(lot_number)')
      .eq('adjustment_id', adjId).order('sort_order')
    setAdjLines(prev => ({ ...prev, [adjId]: data ?? [] }))
  }

  async function toggleExpand(adjId: string) {
    if (expanded === adjId) { setExpanded(null); return }
    setExpanded(adjId)
    if (!adjLines[adjId]) await loadLines(adjId)
  }

  function addLine() {
    setLines(l => [...l, { sku_id: '', units: 1, unit_cost: '', rack_id: '', damage_notes: '' }])
  }
  function removeLine(i: number) { setLines(l => l.filter((_, idx) => idx !== i)) }
  function updateLine(i: number, f: string, v: any) { setLines(l => l.map((line, idx) => idx === i ? { ...line, [f]: v } : line)) }

  async function saveAdjustment() {
    if (lines.some(l => !l.sku_id || l.units <= 0)) { toast.error('All lines need a SKU and quantity'); return }
    setSaving(true)
    const { data: adjNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'ADJ' })
    const { data: adj, error } = await supabase.from('stock_adjustments').insert({
      adj_number: adjNum, adj_type: adjType, notes: adjNotes || null,
      status: 'draft', created_by: profile?.id,
    }).select().single()
    if (error || !adj) { toast.error(error?.message ?? 'Failed'); setSaving(false); return }

    await supabase.from('stock_adjustment_lines').insert(
      lines.map((l, i) => ({
        adjustment_id: adj.id, sku_id: l.sku_id, units: Number(l.units),
        unit_cost: l.unit_cost ? Number(l.unit_cost) : null,
        rack_id: l.rack_id || null, damage_notes: l.damage_notes || null, sort_order: i,
      }))
    )
    toast.success(`${adjNum} created. Pending admin approval.`)
    setModalOpen(false); setAdjNotes(''); setLines([{ sku_id: '', units: 1, unit_cost: '', rack_id: '', damage_notes: '' }])
    loadData(); setSaving(false)
  }

  async function approveAdjustment(adj: any) {
    setApproving(true)
    const { error } = await supabase.rpc('apply_stock_adjustment', { p_adj_id: adj.id, p_approved_by: profile?.id })
    if (error) toast.error('Approval failed: ' + error.message)
    else toast.success(`${adj.adj_number} approved and stock updated`)
    setApproveTarget(null); setApproving(false); loadData()
  }

  const filtered = adjustments.filter(a =>
    a.adj_number?.toLowerCase().includes(search.toLowerCase()) ||
    a.adj_type?.toLowerCase().includes(search.toLowerCase()) ||
    a.notes?.toLowerCase().includes(search.toLowerCase())
  )

  const typeConfig = (type: string) => ADJ_TYPES.find(t => t.value === type) ?? ADJ_TYPES[0]

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-4">
          <div className="page-header">
            <div>
              <h1 className="page-title">Stock Adjustments</h1>
              <p className="text-sm text-slate-500 mt-0.5">Opening stock, damage write-offs, and corrections</p>
            </div>
            <div className="flex gap-2">
              <SearchInput value={search} onChange={setSearch} />
              {canWrite && (
                <button onClick={() => { setAdjType('opening_stock'); setAdjNotes(''); setLines([{ sku_id:'', units:1, unit_cost:'', rack_id:'', damage_notes:'' }]); setModalOpen(true) }} className="btn-primary">
                  <Plus className="w-4 h-4" /> New Adjustment
                </button>
              )}
            </div>
          </div>

          {/* Type legend */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {ADJ_TYPES.map(t => (
              <div key={t.value} className="card p-3 flex items-start gap-3">
                <t.icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${t.color}`} />
                <div>
                  <p className="text-xs font-semibold text-slate-800">{t.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-tight">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {loading ? <PageLoader /> : filtered.length === 0 ? (
            <div className="card"><p className="text-center text-slate-400 py-12">No adjustments yet.</p></div>
          ) : (
            <div className="space-y-3">
              {filtered.map(adj => {
                const tc = typeConfig(adj.adj_type)
                const isExpanded = expanded === adj.id
                const detail = adjLines[adj.id] ?? []
                return (
                  <div key={adj.id} className="card overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50" onClick={() => toggleExpand(adj.id)}>
                      <div className="flex items-center gap-4">
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                        <tc.icon className={`w-4 h-4 flex-shrink-0 ${tc.color}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-brand-700">{adj.adj_number}</span>
                            <span className="badge bg-slate-100 text-slate-700 text-xs">{tc.label}</span>
                            <StatusBadge status={adj.status} />
                          </div>
                          <p className="text-sm text-slate-500 mt-0.5">
                            {formatDate(adj.adj_date)} · By {adj.user_profiles?.full_name ?? '—'}
                            {adj.notes && ` · ${adj.notes}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        {adj.status === 'draft' && profile?.role === 'admin' && (
                          <button onClick={() => setApproveTarget(adj)} className="btn-primary btn-sm">
                            <CheckCircle className="w-3.5 h-3.5" /> Approve & Apply
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-slate-100">
                        {detail.length === 0 ? (
                          <p className="text-center text-slate-400 py-6 text-sm">Loading...</p>
                        ) : detail.map((line, idx) => (
                          <div key={line.id} className="flex items-center justify-between px-5 py-3 border-b border-slate-50 last:border-0">
                            <div>
                              <p className="text-sm font-medium">{line.skus?.display_name}</p>
                              <div className="flex gap-4 text-xs text-slate-500 mt-0.5">
                                <span>SKU: {line.skus?.sku_code}</span>
                                {line.racks && <span>Rack: {line.racks.rack_id_display}</span>}
                                {line.lots && <span>Lot: {line.lots.lot_number}</span>}
                                {line.unit_cost && <span>Cost: ₹{line.unit_cost}/unit</span>}
                                {line.damage_notes && <span className="text-orange-600">⚠ {line.damage_notes}</span>}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`font-bold text-base ${adj.adj_type.includes('out') || adj.adj_type === 'damage_writeoff' ? 'text-red-600' : 'text-emerald-600'}`}>
                                {adj.adj_type.includes('out') || adj.adj_type === 'damage_writeoff' ? '−' : '+'}{line.units} units
                              </p>
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

        {/* Create modal */}
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Stock Adjustment" size="xl">
          <div className="space-y-4">
            {/* Type selector */}
            <div>
              <label className="label">Adjustment Type <span className="text-red-500">*</span></label>
              <div className="grid grid-cols-2 gap-2">
                {ADJ_TYPES.map(t => (
                  <button key={t.value} type="button" onClick={() => setAdjType(t.value)}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${adjType === t.value ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300'}`}>
                    <t.icon className={`w-5 h-5 flex-shrink-0 ${t.color}`} />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{t.label}</p>
                      <p className="text-xs text-slate-400 leading-tight">{t.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {adjType === 'opening_stock' && (
              <div className="alert-info text-xs flex gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p>Opening stock creates new lots and adds them to the stock master. Specify the rack location so the system knows where to find them.</p>
              </div>
            )}
            {adjType === 'damage_writeoff' && (
              <div className="alert-warning text-xs flex gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p>Damage write-offs permanently reduce stock. Describe the damage clearly in the notes. Cannot be reversed after approval.</p>
              </div>
            )}

            <FormField label="Notes / Reason">
              <input value={adjNotes} onChange={e => setAdjNotes(e.target.value)} className="input" placeholder={adjType === 'opening_stock' ? 'e.g. Initial stock entry — April 2026' : adjType === 'damage_writeoff' ? 'e.g. Water damage in godown, Row 03' : 'e.g. Physical count correction'} />
            </FormField>

            {/* Lines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-slate-700">Items</h4>
                <button onClick={addLine} className="btn-ghost btn-sm text-brand-600"><Plus className="w-4 h-4" /> Add Line</button>
              </div>
              <div className="space-y-2">
                {lines.map((line, i) => (
                  <div key={i} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div className="grid grid-cols-12 gap-2 items-start">
                      <div className="col-span-5">
                        <label className="label">SKU *</label>
                        <select value={line.sku_id} onChange={e => updateLine(i, 'sku_id', e.target.value)} className="select text-xs">
                          <option value="">Select SKU...</option>
                          {skus.map(s => <option key={s.id} value={s.id}>{s.display_name}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="label">Units *</label>
                        <input type="number" value={line.units} onChange={e => updateLine(i, 'units', e.target.value)} className="input text-xs" min={1} />
                      </div>
                      {adjType === 'opening_stock' && (
                        <div className="col-span-2">
                          <label className="label">Unit Cost ₹</label>
                          <input type="number" value={line.unit_cost} onChange={e => updateLine(i, 'unit_cost', e.target.value)} className="input text-xs" min={0} step="0.01" placeholder="0.00" />
                        </div>
                      )}
                      <div className={adjType === 'opening_stock' ? 'col-span-2' : 'col-span-4'}>
                        <label className="label">Rack</label>
                        <select value={line.rack_id} onChange={e => updateLine(i, 'rack_id', e.target.value)} className="select text-xs">
                          <option value="">No rack</option>
                          {racks.map(r => <option key={r.id} value={r.id}>{r.rack_id_display}</option>)}
                        </select>
                      </div>
                      <div className="col-span-1 flex justify-end items-end pb-1">
                        {lines.length > 1 && <button onClick={() => removeLine(i)} className="btn-ghost btn-sm text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                    </div>
                    {(adjType === 'damage_writeoff') && (
                      <div>
                        <label className="label">Damage Description *</label>
                        <input value={line.damage_notes} onChange={e => updateLine(i, 'damage_notes', e.target.value)} className="input text-xs" placeholder="Describe the damage..." />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-700 flex gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              Adjustments are saved as draft first. An Admin must approve and apply them — stock only changes after approval.
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={saveAdjustment} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save Draft'}</button>
            </div>
          </div>
        </Modal>

        <ConfirmDialog
          open={!!approveTarget}
          onClose={() => setApproveTarget(null)}
          onConfirm={() => approveTarget && approveAdjustment(approveTarget)}
          title="Approve & Apply Adjustment"
          message={`Approving ${approveTarget?.adj_number} will immediately update the stock master. This cannot be undone. Proceed?`}
          confirmLabel="Approve & Apply"
          loading={approving}
        />
      </PageGuard>
    </AppLayout>
  )
}

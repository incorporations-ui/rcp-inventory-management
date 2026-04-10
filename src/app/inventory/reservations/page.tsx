'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, StatusBadge, PageLoader, SearchInput, Modal, FormField, ConfirmDialog } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { formatDate, canEdit } from '@/lib/utils'
import { Plus, Trash2, Lock, Unlock, ShoppingCart, CheckSquare, Square, AlertTriangle, Calendar, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'

export default function ReservationsPage() {
  const [reservations, setReservations] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [skus, setSkus] = useState<any[]>([])
  const [lots, setLots] = useState<any[]>([])
  const [racks, setRacks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [modalOpen, setModalOpen] = useState(false)
  const [releaseTarget, setReleaseTarget] = useState<any>(null)
  const [releasing, setReleasing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [converting, setConverting] = useState(false)
  // Multi-select state
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Form
  const [customerId, setCustomerId] = useState('')
  const [skuId, setSkuId] = useState('')
  const [lotId, setLotId] = useState('')
  const [rackId, setRackId] = useState('')
  const [reservedUnits, setReservedUnits] = useState(1)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [reservedUntil, setReservedUntil] = useState('')
  const [availableForSku, setAvailableForSku] = useState<number | null>(null)
  const { profile } = useAuth()
  const supabase = createClient()
  const router = useRouter()
  const canWrite = canEdit(profile?.role ?? '', 'sales')

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    if (!skuId) { setAvailableForSku(null); setLots([]); return }
    loadSkuAvailability(skuId)
  }, [skuId])

  async function loadData() {
    setLoading(true)
    const [{ data: res }, { data: custs }, { data: skuList }, { data: rackList }] = await Promise.all([
      supabase.from('manual_reservations')
        .select('*, customers(name, customer_type), skus(display_name, sku_code), racks(rack_id_display), lots(lot_number), reserver:reserved_by(full_name)')
        .order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name, customer_type').eq('status', 'active').order('name'),
      supabase.from('skus').select('id, sku_code, display_name').eq('status', 'active').order('display_name'),
      supabase.from('racks').select('id, rack_id_display').eq('status', 'active').order('rack_id_display'),
    ])
    setReservations(res ?? [])
    setCustomers(custs ?? [])
    setSkus(skuList ?? [])
    setRacks(rackList ?? [])
    setLoading(false)
  }

  async function loadSkuAvailability(sku: string) {
    const { data: sm } = await supabase.from('stock_master').select('available_units').eq('sku_id', sku).single()
    setAvailableForSku(sm?.available_units ?? 0)
    // Load lots for this SKU
    const { data: lotList } = await supabase.from('lots').select('id, lot_number, remaining_units').eq('sku_id', sku).gt('remaining_units', 0).order('received_date')
    setLots(lotList ?? [])
  }

  async function saveReservation() {
    if (!customerId || !skuId || reservedUnits <= 0) { toast.error('Customer, SKU and units are required'); return }
    if (availableForSku !== null && reservedUnits > availableForSku) { toast.error(`Only ${availableForSku} units available`); return }
    setSaving(true)
    const { error } = await supabase.rpc('create_manual_reservation', {
      p_customer_id: customerId, p_sku_id: skuId,
      p_units: reservedUnits, p_lot_id: lotId || null,
      p_rack_id: rackId || null, p_reason: reason || null,
      p_notes: notes || null,
      p_reserved_until: reservedUntil || null,
      p_user_id: profile?.id,
    })
    if (error) toast.error(error.message)
    else { toast.success('Reservation created'); setModalOpen(false); resetForm(); loadData() }
    setSaving(false)
  }

  function resetForm() {
    setCustomerId(''); setSkuId(''); setLotId(''); setRackId('')
    setReservedUnits(1); setReason(''); setNotes(''); setReservedUntil('')
    setAvailableForSku(null); setLots([])
  }

  async function releaseReservation(res: any) {
    setReleasing(true)
    const { error } = await supabase.from('manual_reservations')
      .update({ status: 'released', released_by: profile?.id, released_at: new Date().toISOString() })
      .eq('id', res.id)
    if (error) toast.error(error.message)
    else {
      // Un-reserve from stock master
      const { data: sm } = await supabase.from('stock_master').select('reserved_units').eq('sku_id', res.sku_id).single()
      if (sm) await supabase.from('stock_master').update({ reserved_units: Math.max(0, (sm.reserved_units || 0) - res.reserved_units) }).eq('sku_id', res.sku_id)
      toast.success('Reservation released')
    }
    setReleaseTarget(null); setReleasing(false); loadData()
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const activeIds = filtered.filter(r => r.status === 'active').map(r => r.id)
    if (activeIds.every(id => selected.has(id))) setSelected(new Set())
    else setSelected(new Set(activeIds))
  }

  async function convertSelectedToSO() {
    const selectedRes = reservations.filter(r => selected.has(r.id) && r.status === 'active')
    if (selectedRes.length === 0) return

    // Group by customer — all selected must be the same customer
    const customerIds = Array.from(new Set(selectedRes.map(r => r.customer_id)))
    if (customerIds.length > 1) {
      toast.error('All selected reservations must be for the same customer')
      return
    }

    setConverting(true)
    const { data: soNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'SO' })
    const { data: piNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'PI' })

    const subtotal = 0 // Sales manager fills pricing
    const { data: so, error: soErr } = await supabase.from('sales_orders').insert({
      so_number: soNum, proforma_number: piNum,
      proforma_date: new Date().toISOString().split('T')[0],
      customer_id: customerIds[0],
      notes: `Created from reservations: ${selectedRes.map(r => r.reservation_no).join(', ')}`,
      total_amount: 0, total_gst: 0, grand_total: 0, status: 'draft',
      created_by: profile?.id,
    }).select().single()

    if (soErr || !so) { toast.error('Failed to create SO'); setConverting(false); return }

    const { error: linesErr } = await supabase.from('so_lines').insert(selectedRes.map((r, i) => ({
      so_id: so.id, sku_id: r.sku_id, ordered_boxes: 0,
      ordered_units: r.reserved_units, unit_price: 0, gst_rate: 18, sort_order: i,
    })))

    if (linesErr) { toast.error('SO created but lines failed to save — please check'); setConverting(false); return }

    // Mark reservations as converted
    const { error: convErr } = await supabase.from('manual_reservations')
      .update({ status: 'converted_to_so', converted_so_id: so.id })
      .in('id', selectedRes.map(r => r.id))

    if (convErr) { toast.error('SO created but reservations not marked converted — please update manually') }

    toast.success(`SO ${soNum} created from ${selectedRes.length} reservation${selectedRes.length !== 1 ? 's' : ''}`)
    setSelected(new Set())
    setConverting(false)
    loadData()
    router.push('/sales/orders')
  }

  const filtered = reservations.filter(r => {
    const matchSearch = !search ||
      r.reservation_no?.toLowerCase().includes(search.toLowerCase()) ||
      r.customers?.name?.toLowerCase().includes(search.toLowerCase()) ||
      r.skus?.display_name?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || r.status === statusFilter
    return matchSearch && matchStatus
  })

  const selectedActive = Array.from(selected).filter(id => reservations.find(r => r.id === id)?.status === 'active')
  const allActiveSelected = filtered.filter(r => r.status === 'active').every(r => selected.has(r.id))
    && filtered.filter(r => r.status === 'active').length > 0

  const statusColors: Record<string, string> = {
    active: 'border-l-brand-500',
    converted_to_so: 'border-l-emerald-500',
    released: 'border-l-slate-300',
    expired: 'border-l-red-400',
  }

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-4">
          <div className="page-header">
            <div>
              <h1 className="page-title">Stock Reservations</h1>
              <p className="text-sm text-slate-500 mt-0.5">Reserve stock for specific customers before raising a Sales Order</p>
            </div>
            <div className="flex items-center gap-2">
              <SearchInput value={search} onChange={setSearch} />
              {canWrite && (
                <button onClick={() => { resetForm(); setModalOpen(true) }} className="btn-primary">
                  <Lock className="w-4 h-4" /> New Reservation
                </button>
              )}
            </div>
          </div>

          {/* Multi-select action bar */}
          {selectedActive.length > 0 && (
            <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 flex items-center justify-between">
              <p className="text-sm font-medium text-brand-800">
                {selectedActive.length} reservation{selectedActive.length !== 1 ? 's' : ''} selected
              </p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-brand-600">All must be same customer to convert</p>
                <button onClick={convertSelectedToSO} disabled={converting} className="btn-primary btn-sm">
                  <ShoppingCart className="w-3.5 h-3.5" />
                  {converting ? 'Creating SO...' : 'Convert to Sales Order'}
                </button>
                <button onClick={() => setSelected(new Set())} className="btn-secondary btn-sm">Clear</button>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {['', 'active', 'converted_to_so', 'released', 'expired'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}>
                {s === '' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </button>
            ))}
          </div>

          {loading ? <PageLoader /> : filtered.length === 0 ? (
            <div className="card"><p className="text-center text-slate-400 py-12">No reservations found.</p></div>
          ) : (
            <div className="card overflow-hidden">
              {/* Table header with select all */}
              <div className="flex items-center gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100">
                <button onClick={toggleSelectAll} className="p-1 text-slate-400 hover:text-brand-600">
                  {allActiveSelected ? <CheckSquare className="w-4 h-4 text-brand-600" /> : <Square className="w-4 h-4" />}
                </button>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {filtered.length} reservation{filtered.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {filtered.map(res => {
                  const isSelected = selected.has(res.id)
                  const isExpired = res.reserved_until && new Date(res.reserved_until) < new Date() && res.status === 'active'
                  return (
                    <div key={res.id} className={`flex items-start gap-4 px-5 py-4 transition-colors border-l-4 ${statusColors[res.status] ?? 'border-l-slate-200'} ${isSelected ? 'bg-brand-50/40' : 'hover:bg-slate-50/50'}`}>
                      {/* Checkbox */}
                      <button
                        onClick={() => res.status === 'active' && toggleSelect(res.id)}
                        className={`mt-1 p-0.5 flex-shrink-0 ${res.status !== 'active' ? 'opacity-30 cursor-not-allowed' : 'hover:text-brand-600'}`}
                        disabled={res.status !== 'active'}
                      >
                        {isSelected ? <CheckSquare className="w-4 h-4 text-brand-600" /> : <Square className="w-4 h-4 text-slate-400" />}
                      </button>

                      {/* Main content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-brand-700">{res.reservation_no}</span>
                          <StatusBadge status={res.status} />
                          {isExpired && <span className="badge bg-red-100 text-red-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Expired</span>}
                        </div>
                        <p className="text-sm font-semibold text-slate-900 mt-1">{res.skus?.display_name}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
                          <span className="flex items-center gap-1"><User className="w-3 h-3" /> {res.customers?.name} <span className="capitalize text-slate-400">({res.customers?.customer_type})</span></span>
                          {res.racks && <span>📍 Rack {res.racks.rack_id_display}</span>}
                          {res.lots && <span>Lot: {res.lots.lot_number}</span>}
                          {res.reserved_until && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Until {formatDate(res.reserved_until)}</span>}
                          <span>By {res.reserver?.full_name}</span>
                        </div>
                        {res.reason && <p className="text-xs text-slate-600 mt-1 italic">"{res.reason}"</p>}
                        {res.converted_so_id && <p className="text-xs text-emerald-600 mt-1">→ Converted to SO</p>}
                      </div>

                      {/* Units */}
                      <div className="text-right flex-shrink-0">
                        <p className="text-xl font-bold text-slate-900">{res.reserved_units}</p>
                        <p className="text-xs text-slate-400">units</p>
                      </div>

                      {/* Actions */}
                      {res.status === 'active' && canWrite && (
                        <button onClick={() => setReleaseTarget(res)} className="btn-secondary btn-sm flex-shrink-0 text-amber-600" title="Release reservation">
                          <Unlock className="w-3.5 h-3.5" /> Release
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Create reservation modal */}
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Stock Reservation" size="md">
          <div className="space-y-4">
            <div className="alert-info text-xs">
              Reserving stock will reduce the available quantity. The stock remains in the godown but is tagged for this customer.
            </div>

            <div className="form-grid">
              <FormField label="Customer" required>
                <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="select">
                  <option value="">Select customer...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.customer_type})</option>)}
                </select>
              </FormField>
              <FormField label="SKU" required>
                <select value={skuId} onChange={e => setSkuId(e.target.value)} className="select">
                  <option value="">Select SKU...</option>
                  {skus.map(s => <option key={s.id} value={s.id}>{s.display_name}</option>)}
                </select>
              </FormField>
            </div>

            {availableForSku !== null && (
              <div className={`text-xs px-3 py-2 rounded-lg border ${availableForSku > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                {availableForSku > 0 ? `✓ ${availableForSku} units available` : '✗ No stock available for this SKU'}
              </div>
            )}

            <div className="form-grid">
              <FormField label="Units to Reserve" required>
                <input type="number" value={reservedUnits} onChange={e => setReservedUnits(Number(e.target.value))} className="input" min={1} max={availableForSku ?? 99999} />
              </FormField>
              <FormField label="Reserve Until" hint="Optional expiry date">
                <input type="date" value={reservedUntil} onChange={e => setReservedUntil(e.target.value)} className="input" min={new Date().toISOString().split('T')[0]} />
              </FormField>
            </div>

            <div className="form-grid">
              {lots.length > 0 && (
                <FormField label="Specific Lot" hint="Optional — link to a lot">
                  <select value={lotId} onChange={e => setLotId(e.target.value)} className="select">
                    <option value="">Any lot</option>
                    {lots.map(l => <option key={l.id} value={l.id}>{l.lot_number} ({l.remaining_units}u)</option>)}
                  </select>
                </FormField>
              )}
              <FormField label="Rack Location" hint="Optional — where to find it">
                <select value={rackId} onChange={e => setRackId(e.target.value)} className="select">
                  <option value="">Any rack</option>
                  {racks.map(r => <option key={r.id} value={r.id}>{r.rack_id_display}</option>)}
                </select>
              </FormField>
            </div>

            <FormField label="Reason / Notes" hint="e.g. Verbal commitment pending PI confirmation">
              <input value={reason} onChange={e => setReason(e.target.value)} className="input" placeholder="e.g. Customer confirmed verbally, PI to follow" />
            </FormField>

            <div className="flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={saveReservation} disabled={saving || !customerId || !skuId || reservedUnits <= 0 || (availableForSku !== null && availableForSku <= 0)} className="btn-primary">
                <Lock className="w-4 h-4" />
                {saving ? 'Reserving...' : 'Reserve Stock'}
              </button>
            </div>
          </div>
        </Modal>

        <ConfirmDialog
          open={!!releaseTarget}
          onClose={() => setReleaseTarget(null)}
          onConfirm={() => releaseTarget && releaseReservation(releaseTarget)}
          title="Release Reservation"
          message={`Release reservation ${releaseTarget?.reservation_no} for ${releaseTarget?.customers?.name}? The ${releaseTarget?.reserved_units} units will become available again.`}
          confirmLabel="Release"
          danger
          loading={releasing}
        />
      </PageGuard>
    </AppLayout>
  )
}

'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, StatusBadge, PageLoader, SearchInput, FormField, Modal } from '@/components/ui'
import { QRScanner } from '@/components/ui/QRComponents'
import { useAuth } from '@/hooks/useAuth'
import { formatDate, parseQRData } from '@/lib/utils'
import { Warehouse, CheckCircle2, Plus } from 'lucide-react'
import toast from 'react-hot-toast'

export default function StockingQueuePage() {
  const [queue, setQueue] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stockingItem, setStockingItem] = useState<any>(null)
  const [rackId, setRackId] = useState('')
  const [unitsToStock, setUnitsToStock] = useState(0)
  const [boxesToStock, setBoxesToStock] = useState(0)
  const [racks, setRacks] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const { profile } = useAuth()
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [{ data: q }, { data: r }] = await Promise.all([
      supabase.from('grn_stocking_queue')
        .select('*, skus(display_name, sku_code, units_per_box), grns(grn_number), lots(lot_number, unit_cost)')
        .in('status', ['pending', 'partial'])
        .order('created_at', { ascending: true }),
      supabase.from('racks').select('*').eq('status', 'active').order('rack_id_display'),
    ])
    setQueue(q ?? [])
    setRacks(r ?? [])
    setLoading(false)
  }

  function openStocking(item: any) {
    setStockingItem(item)
    setUnitsToStock(item.total_units - item.stocked_units)
    setBoxesToStock(0)
    setRackId('')
  }

  function handleRackScan(qrData: string) {
    const parsed = parseQRData(qrData)
    if (!parsed || parsed.entityType !== 'rack') {
      toast.error('Invalid QR — expected a Rack QR code')
      return
    }
    const rack = racks.find(r => r.id === parsed.entityId)
    if (rack) {
      setRackId(rack.id)
      toast.success(`Rack ${rack.rack_id_display} scanned`)
    } else {
      toast.error('Rack not found in system')
    }
  }

  async function stockItem() {
    if (!rackId) { toast.error('Please select or scan a rack'); return }
    if (unitsToStock <= 0) { toast.error('Enter units to stock'); return }
    setSaving(true)

    const selectedRack = racks.find(r => r.id === rackId)

    // Update or insert rack_stock
    const { data: existing } = await supabase.from('rack_stock')
      .select('id, units_count, boxes_count')
      .eq('rack_id', rackId).eq('sku_id', stockingItem.sku_id).eq('lot_id', stockingItem.lot_id)
      .maybeSingle()

    if (existing) {
      await supabase.from('rack_stock').update({
        units_count: existing.units_count + unitsToStock,
        boxes_count: existing.boxes_count + boxesToStock,
        last_updated: new Date().toISOString(),
      }).eq('id', existing.id)
    } else {
      await supabase.from('rack_stock').insert({
        rack_id: rackId, lot_id: stockingItem.lot_id,
        sku_id: stockingItem.sku_id,
        units_count: unitsToStock, boxes_count: boxesToStock,
        stocked_by: profile?.id,
      })
    }

    // Update stocking queue
    const newStocked = stockingItem.stocked_units + unitsToStock
    const newStatus = newStocked >= stockingItem.total_units ? 'complete' : 'partial'
    await supabase.from('grn_stocking_queue').update({
      stocked_units: newStocked, status: newStatus,
    }).eq('id', stockingItem.id)

    // Log movement
    await supabase.from('stock_movements').insert({
      sku_id: stockingItem.sku_id, lot_id: stockingItem.lot_id,
      movement_type: 'rack_assign',
      reference_type: 'stocking_queue', reference_id: stockingItem.id,
      units_in: unitsToStock, balance_after: 0,
      rack_id: rackId, created_by: profile?.id,
    })

    toast.success(`${unitsToStock} units stocked to Rack ${selectedRack?.rack_id_display}`)
    setStockingItem(null)
    setSaving(false)
    loadData()
  }

  const filtered = queue.filter(q =>
    q.skus?.display_name?.toLowerCase().includes(search.toLowerCase()) ||
    q.grns?.grn_number?.toLowerCase().includes(search.toLowerCase()) ||
    q.lots?.lot_number?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <AppLayout>
      <PageGuard roles={['admin', 'packing_executive', 'sales_manager']}>
        <div className="space-y-4">
          <div className="page-header">
            <div>
              <h1 className="page-title">Stocking Queue</h1>
              <p className="text-sm text-slate-500 mt-0.5">Lots received from GRN awaiting rack placement</p>
            </div>
            <SearchInput value={search} onChange={setSearch} />
          </div>

          {loading ? <PageLoader /> : filtered.length === 0 ? (
            <div className="card">
              <div className="flex flex-col items-center py-16 text-slate-400">
                <Warehouse className="w-12 h-12 mb-3 opacity-30" />
                <p className="font-medium">All lots are stocked</p>
                <p className="text-sm mt-1">When GRNs are finalized, new lots appear here</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(item => {
                const pct = item.total_units > 0 ? (item.stocked_units / item.total_units) * 100 : 0
                return (
                  <div key={item.id} className={`card p-4 border-l-4 ${item.status === 'pending' ? 'border-amber-400' : 'border-orange-400'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-900">{item.skus?.display_name}</p>
                          <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{item.skus?.sku_code}</code>
                          <StatusBadge status={item.status} />
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          GRN: <strong>{item.grns?.grn_number}</strong> · Lot: <strong>{item.lots?.lot_number}</strong> · Cost: ₹{item.lots?.unit_cost}/unit
                        </p>
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-slate-500 mb-1">
                            <span>Stocked: {item.stocked_units} / {item.total_units} units</span>
                            <span>{Math.round(pct)}%</span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                      <button onClick={() => openStocking(item)} className="btn-primary btn-sm flex-shrink-0">
                        <Warehouse className="w-3.5 h-3.5" /> Stock to Rack
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Stock to rack modal */}
        <Modal open={!!stockingItem} onClose={() => setStockingItem(null)} title="Stock to Rack" size="md">
          {stockingItem && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="font-semibold">{stockingItem.skus?.display_name}</p>
                <p className="text-sm text-slate-500 mt-1">
                  Lot: {stockingItem.lots?.lot_number} · Remaining to stock: <strong>{stockingItem.total_units - stockingItem.stocked_units} units</strong>
                </p>
              </div>

              {/* Rack selection */}
              <div>
                <label className="label">Rack Position <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <select value={rackId} onChange={e => setRackId(e.target.value)} className="select flex-1">
                    <option value="">Select rack...</option>
                    {racks.map(r => <option key={r.id} value={r.id}>{r.rack_id_display}{r.description ? ` — ${r.description}` : ''}</option>)}
                  </select>
                  <QRScanner label="Scan Rack" onScan={handleRackScan} />
                </div>
                {rackId && (
                  <p className="text-xs text-emerald-600 mt-1.5">
                    ✓ Selected: <strong className="font-mono">{racks.find(r => r.id === rackId)?.rack_id_display}</strong>
                  </p>
                )}
              </div>

              <div className="form-grid">
                <FormField label="Units to stock">
                  <input type="number" value={unitsToStock} onChange={e => setUnitsToStock(Number(e.target.value))} className="input" min={1} max={stockingItem.total_units - stockingItem.stocked_units} />
                </FormField>
                <FormField label="Boxes (optional)">
                  <input type="number" value={boxesToStock} onChange={e => setBoxesToStock(Number(e.target.value))} className="input" min={0} />
                </FormField>
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={() => setStockingItem(null)} className="btn-secondary">Cancel</button>
                <button onClick={stockItem} disabled={saving || !rackId} className="btn-primary">
                  <CheckCircle2 className="w-4 h-4" />
                  {saving ? 'Stocking...' : 'Confirm Stock Placement'}
                </button>
              </div>
            </div>
          )}
        </Modal>
      </PageGuard>
    </AppLayout>
  )
}

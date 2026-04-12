'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, PageLoader, SearchInput, Modal, FormField } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { formatDate } from '@/lib/utils'
import { Warehouse, ArrowRightLeft, Search, Package, ChevronDown, ChevronRight, QrCode } from 'lucide-react'
import { QRScanner } from '@/components/ui/QRComponents'
import toast from 'react-hot-toast'

// ─── Types ──────────────────────────────────────────────────────────────────
interface RackStockRow {
  id: string
  rack_id: string
  sku_id: string
  lot_id: string
  units_count: number
  boxes_count: number
  racks: { rack_id_display: string; rack_no: string; column_no: string; row_no: string }
  skus: { display_name: string; sku_code: string; units_per_box?: number }
  lots: { lot_number: string; received_date: string; unit_cost: number }
}

interface MoveForm {
  rackStockId: string
  sku: string
  lot: string
  fromRack: string
  maxUnits: number
  unitsToMove: number
  toRackId: string
  toRackDisplay: string
}

export default function RacksStockPage() {
  const supabase = createClient()
  const { profile } = useAuth()
  const [data, setData] = useState<RackStockRow[]>([])
  const [racks, setRacks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [viewBySku, setViewBySku] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [moveModal, setMoveModal] = useState(false)
  const [moveForm, setMoveForm] = useState<MoveForm | null>(null)
  const [moving, setMoving] = useState(false)
  const [scanMode, setScanMode] = useState(false)
  const [scanTarget, setScanTarget] = useState<string>('') // 'from' or 'to'

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [{ data: rs }, { data: rackList }] = await Promise.all([
      supabase
        .from('rack_stock')
        .select('*, racks(rack_id_display, rack_no, column_no, row_no), skus(display_name, sku_code, units_per_box), lots(lot_number, received_date, unit_cost)')
        .gt('units_count', 0)
        .order('racks(rack_id_display)'),
      supabase.from('racks').select('id, rack_id_display').eq('status', 'active').order('rack_id_display'),
    ])
    setData((rs ?? []) as RackStockRow[])
    setRacks(rackList ?? [])
    setLoading(false)
  }

  // ── Move stock between racks ─────────────────────────────────────────────
  function openMove(row: RackStockRow) {
    setMoveForm({
      rackStockId: row.id,
      sku: row.skus?.display_name,
      lot: row.lots?.lot_number,
      fromRack: row.racks?.rack_id_display,
      maxUnits: row.units_count,
      unitsToMove: row.units_count,
      toRackId: '',
      toRackDisplay: '',
    })
    setMoveModal(true)
  }

  async function executeMove() {
    if (!moveForm || !moveForm.toRackId) { toast.error('Select a destination rack'); return }
    if (moveForm.unitsToMove <= 0 || moveForm.unitsToMove > moveForm.maxUnits) {
      toast.error(`Units must be between 1 and ${moveForm.maxUnits}`); return
    }
    setMoving(true)
    try {
      const row = data.find(d => d.id === moveForm.rackStockId)
      if (!row) throw new Error('Source row not found')

      if (moveForm.unitsToMove === moveForm.maxUnits) {
        // Move entire quantity — just update the rack_id in place
        const { error } = await supabase
          .from('rack_stock')
          .update({ rack_id: moveForm.toRackId })
          .eq('id', moveForm.rackStockId)
        if (error) throw error
      } else {
        // Partial move — reduce source, upsert destination
        const { error: reduceErr } = await supabase
          .from('rack_stock')
          .update({ units_count: row.units_count - moveForm.unitsToMove })
          .eq('id', moveForm.rackStockId)
        if (reduceErr) throw reduceErr

        // Check if there's already a rack_stock entry for same SKU+lot+destination rack
        const { data: existing } = await supabase
          .from('rack_stock')
          .select('id, units_count')
          .eq('rack_id', moveForm.toRackId)
          .eq('sku_id', row.sku_id)
          .eq('lot_id', row.lot_id)
          .maybeSingle()

        if (existing) {
          // Merge into existing entry
          await supabase
            .from('rack_stock')
            .update({ units_count: existing.units_count + moveForm.unitsToMove })
            .eq('id', existing.id)
        } else {
          // Create new rack_stock entry at destination
          await supabase.from('rack_stock').insert({
            rack_id: moveForm.toRackId,
            sku_id: row.sku_id,
            lot_id: row.lot_id,
            units_count: moveForm.unitsToMove,
            boxes_count: 0,
            stocked_by: profile?.id,
            stocked_at: new Date().toISOString(),
          })
        }
      }

      // Log as a stock_movement for audit trail
      await supabase.from('stock_movements').insert({
        sku_id: row.sku_id,
        lot_id: row.lot_id,
        movement_type: 'rack_move',
        units: moveForm.unitsToMove,
        from_rack_id: row.rack_id,
        to_rack_id: moveForm.toRackId,
        notes: `Moved ${moveForm.unitsToMove} units from ${moveForm.fromRack} to ${moveForm.toRackDisplay}`,
        created_by: profile?.id,
      }).then(({ error }) => { if (error) console.warn('Movement log warning:', error.message) })

      toast.success(`✓ Moved ${moveForm.unitsToMove} units of ${moveForm.sku} from ${moveForm.fromRack} → ${moveForm.toRackDisplay}`)
      setMoveModal(false)
      setMoveForm(null)
      loadData()
    } catch (e: any) {
      toast.error(e.message || 'Move failed')
    } finally {
      setMoving(false)
    }
  }

  async function handleQRScan(qrData: string) {
    try {
      const parsed = JSON.parse(qrData)
      if (parsed.entityType !== 'rack') { toast.error('Not a rack QR code'); return }
      const { data: rack } = await supabase.from('racks').select('id, rack_id_display').eq('id', parsed.entityId).single()
      if (!rack) { toast.error('Rack not found'); return }
      if (moveForm) {
        setMoveForm(prev => prev ? { ...prev, toRackId: rack.id, toRackDisplay: rack.rack_id_display } : prev)
        setScanMode(false)
        toast.success(`Destination set: ${rack.rack_id_display}`)
      }
    } catch {
      // Not JSON — try matching rack_id_display directly
      const { data: rack } = await supabase.from('racks').select('id, rack_id_display').eq('rack_id_display', qrData.toUpperCase()).maybeSingle()
      if (rack && moveForm) {
        setMoveForm(prev => prev ? { ...prev, toRackId: rack.id, toRackDisplay: rack.rack_id_display } : prev)
        setScanMode(false)
        toast.success(`Destination set: ${rack.rack_id_display}`)
      } else {
        toast.error('Could not identify rack from QR')
      }
    }
  }

  // ── Filter & group ────────────────────────────────────────────────────────
  const filtered = data.filter(r =>
    r.racks?.rack_id_display?.toLowerCase().includes(search.toLowerCase()) ||
    r.skus?.display_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.skus?.sku_code?.toLowerCase().includes(search.toLowerCase()) ||
    r.lots?.lot_number?.toLowerCase().includes(search.toLowerCase())
  )

  // Group by rack
  const byRack: Record<string, RackStockRow[]> = {}
  filtered.forEach(r => {
    const key = r.racks?.rack_id_display ?? 'Unknown'
    if (!byRack[key]) byRack[key] = []
    byRack[key].push(r)
  })

  // Group by SKU
  const bySku: Record<string, { name: string; sku_code: string; totalUnits: number; rows: RackStockRow[] }> = {}
  filtered.forEach(r => {
    const key = r.skus?.sku_code ?? 'unknown'
    if (!bySku[key]) bySku[key] = { name: r.skus?.display_name, sku_code: r.skus?.sku_code, totalUnits: 0, rows: [] }
    bySku[key].totalUnits += r.units_count
    bySku[key].rows.push(r)
  })

  const totalUnits = data.reduce((s, r) => s + r.units_count, 0)
  const totalRacks = Object.keys(byRack).length
  const totalSkus = Object.keys(bySku).length

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-4">

          {/* Header */}
          <div className="page-header">
            <div>
              <h1 className="page-title">Rack Locations</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {totalRacks} racks · {totalSkus} SKUs · {totalUnits.toLocaleString('en-IN')} units
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SearchInput value={search} onChange={setSearch} placeholder="Search rack, SKU, lot..." />
              {/* View toggle */}
              <div className="flex bg-white border border-slate-200 rounded-lg overflow-hidden text-xs font-semibold">
                <button
                  onClick={() => setViewBySku(false)}
                  className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${!viewBySku ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <Warehouse className="w-3.5 h-3.5" /> By Rack
                </button>
                <button
                  onClick={() => setViewBySku(true)}
                  className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${viewBySku ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <Package className="w-3.5 h-3.5" /> By SKU
                </button>
              </div>
            </div>
          </div>

          {loading ? <PageLoader /> : filtered.length === 0 ? (
            <div className="card flex flex-col items-center py-16 text-slate-400">
              <Warehouse className="w-12 h-12 mb-3 opacity-30" />
              <p className="font-medium">No items stocked yet</p>
              <p className="text-sm mt-1">Items appear here after GRN lots are assigned to racks</p>
            </div>
          ) : (
            <>
              {/* ── BY RACK view ─────────────────────────────────────────── */}
              {!viewBySku && (
                <div className="space-y-3">
                  {Object.entries(byRack).sort(([a], [b]) => a.localeCompare(b)).map(([rackId, items]) => (
                    <div key={rackId} className="card overflow-hidden">
                      <div className="flex items-center gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100">
                        <Warehouse className="w-4 h-4 text-brand-600 flex-shrink-0" />
                        <span className="font-mono font-bold text-brand-700 text-base">{rackId}</span>
                        <span className="text-sm text-slate-500">
                          {items.length} SKU{items.length !== 1 ? 's' : ''} · {items.reduce((s, i) => s + i.units_count, 0).toLocaleString('en-IN')} units
                        </span>
                      </div>
                      <div className="divide-y divide-slate-50">
                        {items.map(item => (
                          <div key={item.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 group">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{item.skus?.display_name}</p>
                              <div className="flex flex-wrap items-center gap-3 mt-0.5">
                                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">{item.skus?.sku_code}</code>
                                <span className="text-xs text-slate-400">Lot: {item.lots?.lot_number}</span>
                                <span className="text-xs text-slate-400">Rcvd: {formatDate(item.lots?.received_date)}</span>
                                {item.lots?.unit_cost > 0 && <span className="text-xs text-slate-400">₹{item.lots.unit_cost}/unit</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <div className="text-right">
                                <p className="font-bold text-slate-900">{item.units_count.toLocaleString('en-IN')} <span className="text-xs font-normal text-slate-500">units</span></p>
                                {item.boxes_count > 0 && <p className="text-xs text-slate-400">{item.boxes_count} boxes</p>}
                              </div>
                              <button
                                onClick={() => openMove(item)}
                                className="btn-secondary btn-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
                                title="Move stock to another rack"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5" />
                                Move
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── BY SKU view ───────────────────────────────────────────── */}
              {viewBySku && (
                <div className="space-y-3">
                  {Object.entries(bySku).sort(([, a], [, b]) => b.totalUnits - a.totalUnits).map(([skuCode, group]) => {
                    const isOpen = expanded === skuCode
                    return (
                      <div key={skuCode} className="card overflow-hidden">
                        <button
                          className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 text-left"
                          onClick={() => setExpanded(isOpen ? null : skuCode)}
                        >
                          {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                          <Package className="w-4 h-4 text-brand-600 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-900 text-sm truncate">{group.name}</p>
                            <code className="text-xs text-slate-400 font-mono">{skuCode}</code>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-bold text-slate-900">{group.totalUnits.toLocaleString('en-IN')} units total</p>
                            <p className="text-xs text-slate-400">{group.rows.length} rack location{group.rows.length !== 1 ? 's' : ''}</p>
                          </div>
                        </button>

                        {isOpen && (
                          <div className="border-t border-slate-100 divide-y divide-slate-50">
                            {/* Rack breakdown table */}
                            <div className="px-5 py-2 bg-slate-50 grid grid-cols-5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                              <span className="col-span-1">Rack</span>
                              <span className="col-span-1">Lot</span>
                              <span className="col-span-1">Received</span>
                              <span className="col-span-1 text-right">Units</span>
                              <span className="col-span-1 text-right">Action</span>
                            </div>
                            {group.rows.map(row => (
                              <div key={row.id} className="px-5 py-3 grid grid-cols-5 items-center hover:bg-slate-50 group">
                                <span className="col-span-1 font-mono font-bold text-brand-700 text-sm">{row.racks?.rack_id_display}</span>
                                <span className="col-span-1 text-xs text-slate-500">{row.lots?.lot_number}</span>
                                <span className="col-span-1 text-xs text-slate-400">{formatDate(row.lots?.received_date)}</span>
                                <span className="col-span-1 text-right font-bold text-slate-900">{row.units_count.toLocaleString('en-IN')}</span>
                                <div className="col-span-1 flex justify-end">
                                  <button
                                    onClick={() => openMove(row)}
                                    className="btn-secondary btn-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
                                  >
                                    <ArrowRightLeft className="w-3 h-3" /> Move
                                  </button>
                                </div>
                              </div>
                            ))}
                            {/* Total row */}
                            <div className="px-5 py-2 flex justify-between bg-slate-100 text-xs font-semibold text-slate-600">
                              <span>{group.rows.length} locations</span>
                              <span>{group.totalUnits.toLocaleString('en-IN')} units total</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── MOVE STOCK MODAL ─────────────────────────────────────────────── */}
        <Modal
          open={moveModal}
          onClose={() => { setMoveModal(false); setMoveForm(null); setScanMode(false) }}
          title="Move Stock Between Racks"
          size="md"
        >
          {moveForm && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Product</span>
                  <span className="font-semibold text-slate-800">{moveForm.sku}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Lot</span>
                  <span className="font-mono text-xs text-slate-600">{moveForm.lot}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Currently at</span>
                  <span className="font-mono font-bold text-brand-700">{moveForm.fromRack}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Available units</span>
                  <span className="font-bold text-slate-900">{moveForm.maxUnits}</span>
                </div>
              </div>

              {/* Units to move */}
              <FormField label={`Units to move (max ${moveForm.maxUnits})`}>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={moveForm.maxUnits}
                    value={moveForm.unitsToMove}
                    onChange={e => setMoveForm(f => f ? { ...f, unitsToMove: Math.min(Number(e.target.value), f.maxUnits) } : f)}
                    className="input w-32"
                  />
                  <button
                    onClick={() => setMoveForm(f => f ? { ...f, unitsToMove: f.maxUnits } : f)}
                    className="btn-ghost btn-sm text-brand-600"
                  >
                    Move all
                  </button>
                </div>
              </FormField>

              {/* Destination rack */}
              <FormField label="Destination Rack">
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={moveForm.toRackId}
                      onChange={e => {
                        const rack = racks.find(r => r.id === e.target.value)
                        setMoveForm(f => f ? { ...f, toRackId: e.target.value, toRackDisplay: rack?.rack_id_display ?? '' } : f)
                      }}
                      className="select flex-1"
                    >
                      <option value="">Select destination rack...</option>
                      {racks.filter(r => r.rack_id_display !== moveForm.fromRack).map(r => (
                        <option key={r.id} value={r.id}>{r.rack_id_display}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setScanMode(!scanMode)}
                      className={`btn-secondary btn-sm flex items-center gap-1.5 ${scanMode ? 'bg-brand-50 border-brand-300' : ''}`}
                      title="Scan rack QR code"
                    >
                      <QrCode className="w-4 h-4" />
                      Scan
                    </button>
                  </div>

                  {/* QR scanner */}
                  {scanMode && (
                    <div className="p-3 border border-brand-200 bg-brand-50 rounded-xl">
                      <p className="text-xs text-brand-700 font-semibold mb-2">Point camera at destination rack QR code</p>
                      <QRScanner label="Scan destination rack" onScan={handleQRScan} />
                      <p className="text-xs text-slate-500 mt-2 text-center">Or enter rack ID manually:</p>
                      <input
                        className="input text-xs mt-1 font-mono uppercase"
                        placeholder="e.g. 02/B/04"
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value.trim().toUpperCase()
                            const rack = racks.find(r => r.rack_id_display === val)
                            if (rack) {
                              setMoveForm(f => f ? { ...f, toRackId: rack.id, toRackDisplay: rack.rack_id_display } : f)
                              setScanMode(false)
                              toast.success(`Destination set: ${rack.rack_id_display}`)
                            } else {
                              toast.error(`Rack ${val} not found`)
                            }
                          }
                        }}
                      />
                    </div>
                  )}

                  {/* Confirmation arrow */}
                  {moveForm.toRackDisplay && !scanMode && (
                    <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                      <span className="font-mono font-bold text-brand-700">{moveForm.fromRack}</span>
                      <ArrowRightLeft className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <span className="font-mono font-bold text-emerald-700">{moveForm.toRackDisplay}</span>
                      <span className="text-sm text-emerald-700 ml-auto">{moveForm.unitsToMove} units</span>
                    </div>
                  )}
                </div>
              </FormField>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => { setMoveModal(false); setMoveForm(null); setScanMode(false) }} className="btn-secondary">Cancel</button>
                <button
                  onClick={executeMove}
                  disabled={moving || !moveForm.toRackId}
                  className="btn-primary"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  {moving ? 'Moving...' : `Move ${moveForm.unitsToMove} Units`}
                </button>
              </div>
            </div>
          )}
        </Modal>
      </PageGuard>
    </AppLayout>
  )
}

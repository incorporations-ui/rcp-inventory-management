'use client'
import { useState, useEffect, use } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, StatusBadge, PageLoader, Modal, ConfirmDialog } from '@/components/ui'
import { QRScanner } from '@/components/ui/QRComponents'
import { useAuth } from '@/hooks/useAuth'
import { formatDate, formatCurrency, parseQRData } from '@/lib/utils'
import { CheckCircle, XCircle, AlertTriangle, PackageCheck, Printer, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import toast from 'react-hot-toast'

export default function PackingListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [pl, setPL] = useState<any>(null)
  const [lines, setLines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [finalizing, setFinalizing] = useState(false)
  const [mismatchLine, setMismatchLine] = useState<any>(null)
  const [mismatchNotes, setMismatchNotes] = useState('')
  const [scanningLineId, setScanningLineId] = useState<string | null>(null)
  const { profile } = useAuth()
  const supabase = createClient()

  useEffect(() => { loadData() }, [id])

  async function loadData() {
    setLoading(true)
    const [{ data: plData }, { data: lineData }] = await Promise.all([
      supabase.from('packing_lists').select('*, sales_orders(*, customers(name, gstin, address_line1, city, state))').eq('id', id).single(),
      supabase.from('packing_list_lines').select('*, skus(display_name, sku_code, gst_rate), racks(rack_id_display)').eq('packing_list_id', id).order('id'),
    ])
    // Enrich lines with rack location hints from stock_master
    const enrichedLines = await Promise.all((lineData ?? []).map(async (line) => {
      const { data: rackLoc } = await supabase
        .from('rack_stock')
        .select('units_count, racks(rack_id_display, id)')
        .eq('sku_id', line.sku_id)
        .gt('units_count', 0)
        .order('stocked_at', { ascending: true })
        .limit(3)
      return { ...line, rack_locations: rackLoc ?? [] }
    }))
    setPL(plData)
    setLines(enrichedLines)
    setLoading(false)
  }

  async function markLine(lineId: string, status: 'packed' | 'unavailable', units?: number) {
    const line = lines.find(l => l.id === lineId)
    if (!line) return

    if (status === 'unavailable') {
      setMismatchLine(line)
      return
    }

    const { error } = await supabase.from('packing_list_lines').update({
      status: 'packed',
      packed_units: units ?? line.ordered_units,
      packed_by: profile?.id,
      packed_at: new Date().toISOString(),
    }).eq('id', lineId)

    if (error) toast.error(error.message)
    else { toast.success('Line marked as packed'); loadData() }
  }

  async function confirmMismatch() {
    if (!mismatchLine) return
    const { error } = await supabase.from('packing_list_lines').update({
      status: 'unavailable',
      unavailable_units: mismatchLine.ordered_units,
      mismatch_flagged: true,
      mismatch_notes: mismatchNotes,
      packed_by: profile?.id,
      packed_at: new Date().toISOString(),
    }).eq('id', mismatchLine.id)
    if (error) toast.error(error.message)
    else {
      toast.error(`Stock mismatch flagged for ${mismatchLine.skus?.display_name}`)
      setMismatchLine(null)
      setMismatchNotes('')
      loadData()
    }
  }

  async function handleRackScan(qrData: string, lineId: string) {
    const parsed = parseQRData(qrData)
    if (!parsed || parsed.entityType !== 'rack') {
      toast.error('Invalid QR — expected a Rack QR code')
      return
    }
    const { error } = await supabase.from('packing_list_lines')
      .update({ scanned_rack_id: parsed.entityId }).eq('id', lineId)
    if (error) toast.error(error.message)
    else { toast.success('Rack scan recorded'); setScanningLineId(null); loadData() }
  }

  async function finalizePL() {
    const pending = lines.filter(l => l.status === 'pending')
    if (pending.length > 0) {
      toast.error('All lines must be marked as packed or unavailable before finalizing')
      return
    }
    setFinalizing(true)

    const packedLines = lines.filter(l => l.status === 'packed')
    const unavailableLines = lines.filter(l => l.status === 'unavailable')

    // Update stock master - deduct packed items
    for (const line of packedLines) {
      await supabase.rpc('update_stock_master', { p_sku_id: line.sku_id, p_delta: -line.packed_units })
      // Release reservation logic updated to avoid syntax error
      await supabase.from('stock_master').update({ reserved_units: 0 }).eq('sku_id', line.sku_id)

      // Log movement
      await supabase.from('stock_movements').insert({
        sku_id: line.sku_id, movement_type: 'so_out',
        reference_type: 'packing_list', reference_id: pl.id,
        units_out: line.packed_units, balance_after: 0,
        created_by: profile?.id, rack_id: line.scanned_rack_id,
      })

      // Deduct from rack_stock if rack was scanned
      if (line.scanned_rack_id) {
        const { data: rs } = await supabase.from('rack_stock')
          .select('id, units_count').eq('rack_id', line.scanned_rack_id).eq('sku_id', line.sku_id).single()
        if (rs) {
          await supabase.from('rack_stock').update({ units_count: Math.max(0, rs.units_count - line.packed_units) }).eq('id', rs.id)
        }
      }
    }

    // Release reservations for unavailable items
    for (const line of unavailableLines) {
      await supabase.from('stock_master').update({ reserved_units: 0 }).eq('sku_id', line.sku_id)
    }

    // Finalize packing list
    await supabase.from('packing_lists').update({ status: 'finalized', finalized_at: new Date().toISOString() }).eq('id', pl.id)
    await supabase.from('sales_orders').update({ status: packedLines.length > 0 ? 'packed' : 'cancelled' }).eq('id', pl.so_id)

    // Create invoice if there are packed items
    if (packedLines.length > 0) {
      const soData = pl.sales_orders
      const subtotal = packedLines.reduce((s: number, l: any) => s + (l.packed_units * l.unit_price ?? 0), 0)
      const totalGST = packedLines.reduce((s: number, l: any) => s + (l.packed_units * (l.unit_price ?? 0) * (l.skus?.gst_rate ?? 0) / 100), 0)
      const { data: invNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'INV' })
      const { data: inv } = await supabase.from('invoices').insert({
        invoice_number: invNum, so_id: pl.so_id, packing_list_id: pl.id,
        customer_id: soData.customer_id,
        subtotal, total_gst: totalGST, grand_total: subtotal + totalGST,
        created_by: profile?.id,
      }).select().single()

      if (inv) {
        const invLines = packedLines.map((l: any) => ({
          invoice_id: inv.id, sku_id: l.sku_id,
          units: l.packed_units, unit_price: l.unit_price ?? 0,
          gst_rate: l.skus?.gst_rate ?? 0, hsn_code: l.skus?.hsn_code,
        }))
        await supabase.from('invoice_lines').insert(invLines)
        await supabase.from('sales_orders').update({ status: 'invoiced' }).eq('id', pl.so_id)
        toast.success(`Packing complete! Invoice ${invNum} created.`)
      }
    } else {
      toast.success('Packing list finalized. All items unavailable.')
    }

    setFinalizing(false)
    loadData()
  }

  if (loading) return <AppLayout><PageGuard><PageLoader /></PageGuard></AppLayout>
  if (!pl) return <AppLayout><PageGuard><p className="text-slate-500">Packing list not found.</p></PageGuard></AppLayout>

  const so = pl.sales_orders
  const allDone = lines.every(l => l.status !== 'pending')
  const packedCount = lines.filter(l => l.status === 'packed').length
  const unavailableCount = lines.filter(l => l.status === 'unavailable').length

  return (
    <AppLayout>
      <PageGuard roles={['admin', 'sales_manager', 'packing_executive']}>
        <div className="space-y-5 max-w-4xl">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <Link href="/sales/packing" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Packing Lists
              </Link>
              <h1 className="page-title">{pl.pl_number}</h1>
              <div className="flex items-center gap-3 mt-1">
                <StatusBadge status={pl.status} />
                <span className="text-sm text-slate-500">SO: {so?.so_number}</span>
                <span className="text-sm text-slate-500">Customer: {so?.customers?.name}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pl.status === 'finalized' && (
                <button onClick={() => window.print()} className="btn-secondary btn-sm no-print"><Printer className="w-4 h-4" /> Print</button>
              )}
              {pl.status !== 'finalized' && allDone && (
                <button onClick={finalizePL} disabled={finalizing} className="btn-primary">
                  <PackageCheck className="w-4 h-4" /> {finalizing ? 'Finalizing...' : 'Finalize Packing List'}
                </button>
              )}
            </div>
          </div>

          {/* Progress */}
          <div className="card p-4">
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-slate-200" />
                <span className="text-slate-500">Pending: <strong>{lines.filter(l => l.status === 'pending').length}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
                <span className="text-slate-500">Packed: <strong className="text-emerald-700">{packedCount}</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-slate-500">Unavailable: <strong className="text-red-700">{unavailableCount}</strong></span>
              </div>
            </div>
            {lines.length > 0 && (
              <div className="h-2 bg-slate-100 rounded-full mt-3 overflow-hidden">
                <div className="h-full flex">
                  <div className="bg-emerald-500 h-full transition-all" style={{ width: `${(packedCount / lines.length) * 100}%` }} />
                  <div className="bg-red-400 h-full transition-all" style={{ width: `${(unavailableCount / lines.length) * 100}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* Line items */}
          <div className="space-y-3">
            {lines.map(line => (
              <div key={line.id} className={`card p-4 border-l-4 ${line.status === 'packed' ? 'border-emerald-500' : line.status === 'unavailable' ? 'border-red-400' : 'border-slate-300'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900">{line.skus?.display_name}</p>
                      <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{line.skus?.sku_code}</code>
                      {line.mismatch_flagged && (
                        <span className="badge bg-red-100 text-red-700 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Mismatch
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 mt-1">Ordered: <strong>{line.ordered_units} units</strong></p>

                    {/* Rack location hints */}
                    {line.rack_locations?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="text-xs text-slate-400">Find at:</span>
                        {line.rack_locations.map((rl: any) => (
                          <span key={rl.racks?.id} className="badge bg-brand-50 text-brand-700 font-mono">
                            📍 {rl.racks?.rack_id_display} ({rl.units_count} units)
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Scanned rack */}
                    {line.scanned_rack_id && (
                      <p className="text-xs text-emerald-600 mt-1">✓ Rack scanned: {line.racks?.rack_id_display}</p>
                    )}
                    {line.mismatch_notes && <p className="text-xs text-red-600 mt-1">Note: {line.mismatch_notes}</p>}
                  </div>

                  {/* Actions */}
                  {pl.status !== 'finalized' && line.status === 'pending' && (
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <QRScanner
                        label="Scan Rack"
                        onScan={qr => handleRackScan(qr, line.id)}
                      />
                      <button onClick={() => markLine(line.id, 'packed')} className="btn-primary btn-sm">
                        <CheckCircle className="w-3.5 h-3.5" /> Mark Packed
                      </button>
                      <button onClick={() => markLine(line.id, 'unavailable')} className="btn-secondary btn-sm text-red-600">
                        <XCircle className="w-3.5 h-3.5" /> Unavailable
                      </button>
                    </div>
                  )}

                  {line.status !== 'pending' && (
                    <div className="flex-shrink-0">
                      <StatusBadge status={line.status} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Mismatch modal */}
        <Modal open={!!mismatchLine} onClose={() => setMismatchLine(null)} title="Flag Stock Mismatch" size="sm">
          <div className="space-y-4">
            <div className="alert-warning">
              <p className="font-semibold">System shows stock available, but you cannot find it physically.</p>
              <p className="text-sm mt-1">This mismatch will be flagged for the sales manager and admin to investigate.</p>
            </div>
            <p className="text-sm"><strong>Item:</strong> {mismatchLine?.skus?.display_name}</p>
            <div>
              <label className="label">Notes (optional)</label>
              <textarea value={mismatchNotes} onChange={e => setMismatchNotes(e.target.value)} className="input" rows={3} placeholder="Describe what you found..." />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setMismatchLine(null)} className="btn-secondary btn-sm">Cancel</button>
              <button onClick={confirmMismatch} className="btn-danger btn-sm">
                <AlertTriangle className="w-3.5 h-3.5" /> Confirm Mismatch
              </button>
            </div>
          </div>
        </Modal>
      </PageGuard>
    </AppLayout>
  )
}

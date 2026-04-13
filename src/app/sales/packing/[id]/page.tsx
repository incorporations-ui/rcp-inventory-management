'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, StatusBadge, PageLoader, Modal } from '@/components/ui'
import { QRScanner } from '@/components/ui/QRComponents'
import { parseQRData, formatCurrency } from '@/lib/utils'
import {
  CheckCircle, XCircle, PackageCheck, Printer,
  ArrowLeft, AlertTriangle, FileText, ExternalLink,
  Plus, Trash2, MapPin, ArrowRightLeft
} from 'lucide-react'
import Link from 'next/link'
import toast from 'react-hot-toast'

// ── Rack pick entry for a single packing line ─────────────────────────────
interface RackPick {
  rack_id: string
  rack_display: string
  units: number
}

export default function PackingListDetailPage({ params }: { params: { id: string } }) {
  const { id } = params
  const supabase = createClient()

  const [pl, setPL] = useState<any>(null)
  const [lines, setLines] = useState<any[]>([])
  const [invoice, setInvoice] = useState<any>(null)
  const [allRacks, setAllRacks] = useState<any[]>([])
  const [rackStockBySku, setRackStockBySku] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)
  const [finalizing, setFinalizing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  // Per-line rack picks state: lineId → RackPick[]
  const [rackPicks, setRackPicks] = useState<Record<string, RackPick[]>>({})

  // Mismatch modal
  const [mismatchLine, setMismatchLine] = useState<any>(null)
  const [mismatchNotes, setMismatchNotes] = useState('')

  // Scan mode: which line + which pick index is being scanned
  const [scanning, setScanning] = useState<{ lineId: string; pickIdx: number } | null>(null)

  // PL-level notes
  const [plNotes, setPlNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  useEffect(() => { loadData() }, [id])

  async function loadData() {
    setLoading(true)
    try {
      const [{ data: plData, error: plError }, { data: lineData, error: lineError }, { data: rackData }] =
        await Promise.all([
          supabase.from('packing_lists')
            .select('*, sales_orders(*, customers(name, gstin, address_line1, city, state))')
            .eq('id', id).single(),
          supabase.from('packing_list_lines')
            .select(`
              *,
              skus(display_name, sku_code, gst_rate, hsn_code),
              so_lines!packing_list_lines_so_line_id_fkey(unit_price, gst_rate),
              rack:racks!packing_list_lines_rack_id_fkey(rack_id_display),
              scanned_rack:racks!packing_list_lines_scanned_rack_id_fkey(rack_id_display),
              stock_master(total_units, reserved_units, available_units)
            `)
            .eq('packing_list_id', id).order('id'),
          supabase.from('racks').select('id, rack_id_display').eq('status', 'active').order('rack_id_display'),  // kept for QR scan lookup
        ])

      if (plError) throw plError
      if (lineError) throw lineError

      setPL(plData)
      setPlNotes(plData?.notes ?? '')
      setLines(lineData || [])
      setAllRacks(rackData ?? [])

      // Load rack_stock for each unique SKU in pending lines
      const pendingSkuIds = [...new Set((lineData ?? [])
        .filter((l: any) => l.status === 'pending')
        .map((l: any) => l.sku_id))]
      if (pendingSkuIds.length > 0) {
        const { data: rsData } = await supabase
          .from('rack_stock')
          .select('rack_id, sku_id, units_count, racks(rack_id_display)')
          .in('sku_id', pendingSkuIds)
          .gt('units_count', 0)
          .order('racks(rack_id_display)')
        const bySkuId: Record<string, any[]> = {}
        ;(rsData ?? []).forEach((rs: any) => {
          if (!bySkuId[rs.sku_id]) bySkuId[rs.sku_id] = []
          bySkuId[rs.sku_id].push({
            rack_id: rs.rack_id,
            rack_display: rs.racks?.rack_id_display ?? '',
            units_count: rs.units_count,
          })
        })
        setRackStockBySku(bySkuId)
      }

      // Initialise rack picks for pending lines
      const picks: Record<string, RackPick[]> = {}
      ;(lineData ?? []).forEach((line: any) => {
        if (line.status === 'pending') {
          // Pre-fill with suggested rack if available, otherwise leave blank
          picks[line.id] = line.rack
            ? [{ rack_id: line.rack_id ?? '', rack_display: line.rack?.rack_id_display ?? '', units: line.ordered_units }]
            : [{ rack_id: '', rack_display: '', units: line.ordered_units }]
        }
      })
      setRackPicks(prev => ({ ...picks, ...prev }))

      if (plData?.status === 'finalized') {
        const { data: invData } = await supabase
          .from('invoices').select('id, invoice_number, grand_total, payment_status, dispatch_status')
          .eq('packing_list_id', id).maybeSingle()
        setInvoice(invData ?? null)
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to load packing list')
    } finally {
      setLoading(false)
    }
  }

  // ── Rack picks helpers ──────────────────────────────────────────────────
  function addRackPick(lineId: string) {
    setRackPicks(prev => ({
      ...prev,
      [lineId]: [...(prev[lineId] ?? []), { rack_id: '', rack_display: '', units: 1 }]
    }))
  }

  function removeRackPick(lineId: string, idx: number) {
    setRackPicks(prev => ({
      ...prev,
      [lineId]: (prev[lineId] ?? []).filter((_, i) => i !== idx)
    }))
  }

  function updateRackPick(lineId: string, idx: number, field: keyof RackPick, value: string | number, skuId?: string) {
    setRackPicks(prev => {
      const picks = [...(prev[lineId] ?? [])]
      if (field === 'rack_id') {
        // Look up from rackStockBySku first (has units_count), fall back to allRacks for QR scan
        const rackFromStock = skuId ? (rackStockBySku[skuId] ?? []).find(r => r.rack_id === value) : null
        const rackFromAll = allRacks.find(r => r.id === value)
        const display = rackFromStock?.rack_display ?? rackFromAll?.rack_id_display ?? ''
        picks[idx] = { ...picks[idx], rack_id: value as string, rack_display: display }
      } else {
        picks[idx] = { ...picks[idx], [field]: value }
      }
      return { ...prev, [lineId]: picks }
    })
  }

  function totalPickedUnits(lineId: string): number {
    return (rackPicks[lineId] ?? []).reduce((s, p) => s + (Number(p.units) || 0), 0)
  }

  // ── Mark packed (with rack-level picks) ────────────────────────────────
  async function markPacked(line: any) {
    const picks = rackPicks[line.id] ?? []
    const total = totalPickedUnits(line.id)

    if (picks.length === 0 || picks.some(p => !p.rack_id)) {
      toast.error('Assign at least one rack location for this item')
      return
    }
    if (total <= 0) {
      toast.error('Packed quantity must be greater than zero')
      return
    }
    if (total > (line.stock_master?.available_units ?? 0)) {
      toast.error(`Total packed (${total}) exceeds available stock (${line.stock_master?.available_units ?? 0})`)
      return
    }

    // Primary rack = first pick's rack
    const primaryRack = picks[0]

    const { error } = await supabase.from('packing_list_lines').update({
      status: 'packed',
      packed_units: total,
      scanned_rack_id: primaryRack.rack_id || null,
      // Store multi-rack picks as JSON in a notes-like field
      rack_picks_json: JSON.stringify(picks),
      packed_at: new Date().toISOString(),
    }).eq('id', line.id)

    if (error) { toast.error(error.message); return }
    toast.success(`Packed ${total} units across ${picks.length} rack location${picks.length > 1 ? 's' : ''}`)
    loadData()
  }

  // ── Mismatch (unavailable) ──────────────────────────────────────────────
  async function confirmMismatch() {
    if (!mismatchLine) return
    const { error } = await supabase.from('packing_list_lines').update({
      status: 'unavailable',
      unavailable_units: mismatchLine.ordered_units,
      mismatch_flagged: true,
      mismatch_notes: mismatchNotes,
      packed_at: new Date().toISOString(),
    }).eq('id', mismatchLine.id)

    if (error) { toast.error(error.message); return }

    await supabase.from('system_alerts').insert({
      alert_type: 'stock_mismatch',
      severity: 'critical',
      title: `Stock mismatch: ${mismatchLine.skus?.sku_code}`,
      message: `System shows stock but item not found physically. PL: ${pl?.pl_number}. Notes: ${mismatchNotes}`,
      reference_id: mismatchLine.id,
    }).then(({ error: e }) => { if (e) console.warn('Alert insert warning:', e.message) })

    toast.error('⚠ Mismatch flagged — alert raised for admin review')
    setMismatchLine(null); setMismatchNotes(''); loadData()
  }

  // ── QR scan handler ─────────────────────────────────────────────────────
  async function handleQRScan(qrData: string) {
    if (!scanning) return
    try {
      const parsed = parseQRData(qrData)
      if (!parsed || parsed.entityType !== 'rack') { toast.error('Not a rack QR code'); return }
      const rack = allRacks.find(r => r.id === parsed.entityId)
      if (!rack) { toast.error('Rack not found'); return }
      updateRackPick(scanning.lineId, scanning.pickIdx, 'rack_id', rack.id)
      toast.success(`Rack ${rack.rack_id_display} scanned`)
      setScanning(null)
    } catch {
      // Maybe it's just the rack_id_display as plain text
      const rack = allRacks.find(r => r.rack_id_display === qrData.trim().toUpperCase())
      if (rack && scanning) {
        updateRackPick(scanning.lineId, scanning.pickIdx, 'rack_id', rack.id)
        toast.success(`Rack ${rack.rack_id_display} set`)
        setScanning(null)
      } else {
        toast.error('Could not identify rack from QR')
      }
    }
  }

  // ── Save PL-level notes ─────────────────────────────────────────────────
  async function savePlNotes() {
    setSavingNotes(true)
    const { error } = await supabase.from('packing_lists').update({ notes: plNotes || null }).eq('id', pl.id)
    if (error) toast.error(error.message)
    else toast.success('Notes saved')
    setSavingNotes(false)
  }

  // ── Cancel PL ───────────────────────────────────────────────────────────
  async function cancelPL() {
    if (pl.status === 'finalized') { toast.error('Cannot cancel a finalized packing list. Void the invoice instead.'); return }
    setCancelling(true)
    try {
      for (const line of lines) {
        await supabase.rpc('update_stock_master', { p_sku_id: line.sku_id, p_delta: line.ordered_units })
          .then(({ error }) => { if (error) console.warn('Unreserve warning:', error.message) })
      }
      await supabase.from('packing_lists').update({ status: 'cancelled' }).eq('id', pl.id)
      await supabase.from('sales_orders').update({ status: 'approved' }).eq('id', pl.so_id)
      toast.success('Packing list cancelled. SO reset to Approved.')
      setShowCancelConfirm(false)
      loadData()
    } catch (e: any) { toast.error(e.message) }
    finally { setCancelling(false) }
  }

  // ── Invoice generation ──────────────────────────────────────────────────
  async function generateInvoiceFromLines(packedLines: any[]) {
    // Get user directly from auth — avoids React closure stale-profile bug
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) throw new Error('Not authenticated — please refresh and try again')

    const { data: invNum, error: invNumErr } = await supabase.rpc('next_doc_number', { p_doc_type: 'INV' })
    if (invNumErr) throw new Error('Invoice number error: ' + invNumErr.message)

    const subtotal = packedLines.reduce((s, l) => s + l.packed_units * Number(l.so_lines?.unit_price ?? 0), 0)
    const totalGst = packedLines.reduce((s, l) => {
      const price = Number(l.so_lines?.unit_price ?? 0)
      const gst = Number(l.so_lines?.gst_rate ?? l.skus?.gst_rate ?? 0)
      return s + l.packed_units * price * gst / 100
    }, 0)

    const so = pl.sales_orders
    const { data: inv, error: invErr } = await supabase.from('invoices').insert({
      invoice_number: invNum,
      so_id: pl.so_id,
      packing_list_id: pl.id,
      customer_id: so.customer_id,
      invoice_date: new Date().toISOString().split('T')[0],
      subtotal: +subtotal.toFixed(2),
      total_gst: +totalGst.toFixed(2),
      grand_total: +(subtotal + totalGst).toFixed(2),
      payment_status: 'unpaid',
      dispatch_status: 'ready',
      created_by: user.id,   // ← direct from auth, never null
      notes: pl.notes ?? null,
    }).select().single()
    if (invErr || !inv) throw new Error(invErr?.message ?? 'Failed to create invoice')

    const invLines = packedLines.map((l) => {
      const price = Number(l.so_lines?.unit_price ?? 0)
      const gstRate = Number(l.so_lines?.gst_rate ?? l.skus?.gst_rate ?? 0)
      const lineAmt = +(l.packed_units * price).toFixed(2)
      return {
        invoice_id: inv.id, sku_id: l.sku_id, units: l.packed_units,
        unit_price: price, gst_rate: gstRate,
        hsn_code: l.skus?.hsn_code ?? null,
      }
    })
    const { error: lErr } = await supabase.from('invoice_lines').insert(invLines)
    if (lErr) throw new Error(lErr.message)
    await supabase.from('sales_orders').update({ status: 'invoiced' }).eq('id', pl.so_id)
    return invNum
  }

  async function finalizePL() {
    const pending = lines.filter(l => l.status === 'pending')
    if (pending.length > 0) { toast.error('Mark all lines as Packed or Unavailable first'); return }
    const packedLines = lines.filter(l => l.status === 'packed')
    if (packedLines.length === 0) { toast.error('No packed lines — cannot generate invoice'); return }

    setFinalizing(true)
    try {
      for (const line of packedLines) {
        // 1. Deduct from aggregate stock master
        const { error: stockErr } = await supabase.rpc('update_stock_master', { p_sku_id: line.sku_id, p_delta: -line.packed_units })
        if (stockErr) console.warn('Stock deduction warning:', stockErr.message)

        // 2. Deduct from rack_stock using the rack picks stored on the line
        let picks: { rack_id: string; units: number }[] = []
        try { picks = JSON.parse(line.rack_picks_json ?? '[]') } catch {}
        for (const pick of picks) {
          if (!pick.rack_id || !pick.units) continue
          const { data: rs } = await supabase
            .from('rack_stock')
            .select('id, units_count')
            .eq('rack_id', pick.rack_id)
            .eq('sku_id', line.sku_id)
            .maybeSingle()
          if (rs) {
            const newCount = Math.max(0, rs.units_count - pick.units)
            if (newCount === 0) {
              await supabase.from('rack_stock').delete().eq('id', rs.id)
            } else {
              await supabase.from('rack_stock').update({ units_count: newCount }).eq('id', rs.id)
            }
          }
        }

        // 3. Log outbound stock movement
        await supabase.from('stock_movements').insert({
          sku_id: line.sku_id,
          movement_type: 'so_out',
          reference_type: 'packing_list',
          reference_id: pl.id,
          units_out: line.packed_units,
          balance_after: 0,
        }).then(({ error: e }) => { if (e) console.warn('Movement log warning:', e.message) })
      }
      const { error: plErr } = await supabase.from('packing_lists')
        .update({ status: 'finalized', finalized_at: new Date().toISOString() }).eq('id', pl.id)
      if (plErr) throw new Error(plErr.message)

      await generateInvoiceFromLines(packedLines)
      toast.success('Packing list finalized & invoice generated!')
      loadData()
    } catch (error: any) {
      toast.error(error.message || 'Finalization failed')
    } finally {
      setFinalizing(false)
    }
  }

  async function retryGenerateInvoice() {
    setFinalizing(true)
    try {
      const packedLines = lines.filter(l => l.status === 'packed')
      if (packedLines.length === 0) throw new Error('No packed lines found')
      const invNum = await generateInvoiceFromLines(packedLines)
      toast.success(`Invoice ${invNum} generated!`)
      loadData()
    } catch (err: any) { toast.error(err.message) }
    finally { setFinalizing(false) }
  }

  // ── Derived ─────────────────────────────────────────────────────────────
  if (loading) return <AppLayout><PageGuard><PageLoader /></PageGuard></AppLayout>
  if (!pl) return <AppLayout><PageGuard><p className="text-slate-500">Packing list not found.</p></PageGuard></AppLayout>

  const so = pl.sales_orders
  const allDone = lines.every(l => l.status !== 'pending')
  const packed = lines.filter(l => l.status === 'packed')
  const unavail = lines.filter(l => l.status === 'unavailable')

  return (
    <AppLayout>
      <PageGuard roles={['admin', 'sales_manager', 'packing_executive']}>
        <div className="space-y-5 max-w-4xl">

          {/* ── Header ─────────────────────────────────────────────────── */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <Link href="/sales/packing" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Packing Lists
              </Link>
              <h1 className="page-title">{pl.pl_number}</h1>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <StatusBadge status={pl.status} />
                <span className="text-sm text-slate-500">SO: {so?.so_number}</span>
                <span className="text-sm text-slate-500">Customer: {so?.customers?.name}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Cancel */}
              {pl.status === 'pending' && (
                <button onClick={() => setShowCancelConfirm(true)} className="btn-ghost btn-sm text-red-500 hover:bg-red-50">
                  <XCircle className="w-4 h-4" /> Cancel PL
                </button>
              )}
              {/* Print */}
              <button onClick={() => window.print()} className="btn-secondary btn-sm no-print">
                <Printer className="w-4 h-4" /> Print
              </button>
              {/* Finalized — show invoice link */}
              {pl.status === 'finalized' && invoice && (
                <Link href="/sales/invoices" className="btn-primary flex items-center gap-1.5">
                  <FileText className="w-4 h-4" />
                  View Invoice {invoice.invoice_number}
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              )}
              {/* Finalized but no invoice — retry */}
              {pl.status === 'finalized' && !invoice && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">⚠ Invoice not generated</span>
                  <button onClick={retryGenerateInvoice} disabled={finalizing} className="btn-primary btn-sm">
                    <FileText className="w-4 h-4" />
                    {finalizing ? 'Generating...' : 'Generate Invoice Now'}
                  </button>
                </div>
              )}
              {/* Ready to finalize */}
              {pl.status !== 'finalized' && pl.status !== 'cancelled' && allDone && (
                <button onClick={finalizePL} disabled={finalizing} className="btn-primary">
                  <PackageCheck className="w-4 h-4" />
                  {finalizing ? 'Finalizing & Generating Invoice...' : 'Finalize & Generate Invoice'}
                </button>
              )}
            </div>
          </div>

          {/* ── FPPL / FUPL summary (finalized only) ─────────────────── */}
          {pl.status === 'finalized' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-semibold text-emerald-800 text-sm">Final Packed Product List (FPPL)</h3>
                  <span className="ml-auto badge bg-emerald-100 text-emerald-700">{packed.length} lines</span>
                </div>
                {packed.length === 0 ? <p className="text-xs text-emerald-600">No items were packed.</p> : (
                  <div className="space-y-2">
                    {packed.map(l => {
                      let picks: RackPick[] = []
                      try { picks = JSON.parse(l.rack_picks_json ?? '[]') } catch {}
                      return (
                        <div key={l.id}>
                          <div className="flex justify-between text-xs">
                            <span className="text-emerald-800 font-medium">{l.skus?.display_name ?? l.skus?.sku_code}</span>
                            <span className="text-emerald-700 font-bold">{l.packed_units} units</span>
                          </div>
                          {picks.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {picks.map((p, i) => (
                                <span key={i} className="text-xs bg-white text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5 font-mono">
                                  {p.rack_display}: {p.units}u
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    <div className="pt-2 border-t border-emerald-200 flex justify-between text-xs font-bold text-emerald-900">
                      <span>Invoice Value</span>
                      <span>{invoice ? formatCurrency(invoice.grand_total) : '—'}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className={`rounded-xl border p-4 ${unavail.length > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-center gap-2 mb-3">
                  <XCircle className={`w-5 h-5 ${unavail.length > 0 ? 'text-red-500' : 'text-slate-400'}`} />
                  <h3 className={`font-semibold text-sm ${unavail.length > 0 ? 'text-red-800' : 'text-slate-600'}`}>Final Unavailable Product List (FUPL)</h3>
                  <span className={`ml-auto badge ${unavail.length > 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{unavail.length} lines</span>
                </div>
                {unavail.length === 0
                  ? <p className="text-xs text-slate-500">All items packed. ✓</p>
                  : unavail.map(l => (
                    <div key={l.id} className="flex justify-between text-xs mb-1.5">
                      <span className="text-red-800 font-medium">{l.skus?.display_name ?? l.skus?.sku_code}</span>
                      <span className="text-red-700 font-bold">{l.unavailable_units ?? l.ordered_units} units</span>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {/* ── Line Items ───────────────────────────────────────────── */}
          <div className="space-y-3">
            {lines.map((line) => {
              const picks = rackPicks[line.id] ?? [{ rack_id: '', rack_display: '', units: line.ordered_units }]
              const totalPicked = totalPickedUnits(line.id)
              const isMismatch = line.mismatch_flagged
              let savedPicks: RackPick[] = []
              try { savedPicks = JSON.parse(line.rack_picks_json ?? '[]') } catch {}

              return (
                <div key={line.id} className={`card p-4 border-l-4 ${
                  line.status === 'packed' ? 'border-emerald-500' :
                  line.status === 'unavailable' ? 'border-red-500' : 'border-slate-300'
                }`}>
                  {/* Line header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900">{line.skus?.display_name}</p>
                      <div className="flex flex-wrap gap-3 text-xs text-slate-500 mt-0.5">
                        <span>SKU: <code className="bg-slate-100 px-1 rounded">{line.skus?.sku_code}</code></span>
                        <span>Ordered: <strong className="text-slate-700">{line.ordered_units}</strong></span>
                        <span className="text-emerald-600">Available: <strong>{line.stock_master?.available_units ?? 0}</strong></span>
                        {line.rack && <span className="text-blue-600 font-mono">Suggested: {line.rack.rack_id_display}</span>}
                      </div>
                    </div>
                    <StatusBadge status={line.status !== 'pending' ? line.status : ''} />
                  </div>

                  {/* Packed: show which racks it came from */}
                  {line.status === 'packed' && savedPicks.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="text-xs text-slate-500 mr-1">Picked from:</span>
                      {savedPicks.map((p, i) => (
                        <span key={i} className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono text-xs">
                          <MapPin className="w-3 h-3 mr-1 inline" />{p.rack_display}: {p.units}u
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Unavailable: show mismatch note */}
                  {isMismatch && (
                    <div className="mt-2 alert alert-error text-xs py-2">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>Mismatch flagged{line.mismatch_notes ? ` — ${line.mismatch_notes}` : ''}</span>
                    </div>
                  )}

                  {/* Pending: rack picking UI */}
                  {line.status === 'pending' && pl.status !== 'finalized' && pl.status !== 'cancelled' && (
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5" /> Pick from rack(s)
                        </span>
                        <button onClick={() => addRackPick(line.id)} className="btn-ghost btn-sm text-brand-600 text-xs">
                          <Plus className="w-3.5 h-3.5" /> Add another rack
                        </button>
                      </div>

                      {picks.map((pick, pidx) => (
                        <div key={pidx} className="flex items-center gap-2 flex-wrap p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                          {/* Rack selector */}
                          <select
                            value={pick.rack_id}
                            onChange={e => updateRackPick(line.id, pidx, 'rack_id', e.target.value, line.sku_id)}
                            className="select text-xs flex-1 min-w-32"
                          >
                            <option value="">Select rack...</option>
                            {(rackStockBySku[line.sku_id] ?? []).length === 0
                              ? <option disabled value="">No stock in any rack</option>
                              : (rackStockBySku[line.sku_id] ?? []).map(r => (
                                <option key={r.rack_id} value={r.rack_id}>
                                  {r.rack_display} — {r.units_count} units available
                                </option>
                              ))
                            }
                          </select>

                          {/* Units */}
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={1}
                              max={line.ordered_units}
                              value={pick.units}
                              onChange={e => updateRackPick(line.id, pidx, 'units', Number(e.target.value))}
                              className="input w-20 text-xs"
                            />
                            <span className="text-xs text-slate-400">units</span>
                          </div>

                          {/* QR scan */}
                          <button
                            onClick={() => setScanning(scanning?.lineId === line.id && scanning?.pickIdx === pidx ? null : { lineId: line.id, pickIdx: pidx })}
                            className={`btn-secondary btn-sm text-xs ${scanning?.lineId === line.id && scanning?.pickIdx === pidx ? 'bg-brand-50 border-brand-300' : ''}`}
                            title="Scan rack QR"
                          >
                            Scan QR
                          </button>

                          {/* Remove pick */}
                          {picks.length > 1 && (
                            <button onClick={() => removeRackPick(line.id, pidx)} className="btn-ghost btn-sm text-red-400 p-1">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Inline QR scanner */}
                          {scanning?.lineId === line.id && scanning?.pickIdx === pidx && (
                            <div className="w-full mt-2 p-3 border border-brand-200 bg-brand-50 rounded-lg">
                              <QRScanner label="Point at rack QR code" onScan={handleQRScan} />
                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-xs text-slate-500">Or type rack ID:</span>
                                <input
                                  className="input text-xs font-mono w-28 uppercase"
                                  placeholder="01/A/03"
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      const val = (e.target as HTMLInputElement).value.trim().toUpperCase()
                                      const rack = allRacks.find(r => r.rack_id_display === val)
                                      if (rack) { updateRackPick(line.id, pidx, 'rack_id', rack.id); setScanning(null); toast.success(`Rack ${val} set`) }
                                      else toast.error(`Rack ${val} not found`)
                                    }
                                  }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Pick total vs ordered */}
                      <div className={`text-xs font-semibold ${totalPicked === line.ordered_units ? 'text-emerald-600' : totalPicked > line.ordered_units ? 'text-red-600' : 'text-amber-600'}`}>
                        Total picked: {totalPicked} / {line.ordered_units} ordered
                        {totalPicked > line.ordered_units && ' — exceeds order quantity!'}
                        {totalPicked < line.ordered_units && totalPicked > 0 && ' — partial (confirm to proceed)'}
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => markPacked(line)} className="btn-primary btn-sm flex items-center gap-1.5">
                          <CheckCircle className="w-3.5 h-3.5" /> Mark Packed ({totalPicked} units)
                        </button>
                        <button onClick={() => setMismatchLine(line)} className="btn-secondary btn-sm text-red-600 flex items-center gap-1.5">
                          <XCircle className="w-3.5 h-3.5" /> Mark Unavailable
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── PL-level Notes ──────────────────────────────────────── */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Packing List Notes</h3>
            <textarea
              value={plNotes}
              onChange={e => setPlNotes(e.target.value)}
              rows={3}
              className="input w-full text-sm"
              placeholder="Any special packing instructions, fragile items, driver notes..."
              disabled={pl.status === 'finalized'}
            />
            {pl.status !== 'finalized' && (
              <div className="flex justify-end mt-2">
                <button onClick={savePlNotes} disabled={savingNotes} className="btn-secondary btn-sm">
                  {savingNotes ? 'Saving...' : 'Save Notes'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Mismatch Modal ───────────────────────────────────────── */}
        <Modal open={!!mismatchLine} onClose={() => setMismatchLine(null)} title="Flag Stock Mismatch" size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-2 text-amber-600 bg-amber-50 p-3 rounded-lg">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm">System shows stock is available but item cannot be found physically at any rack location.</p>
            </div>
            <div>
              <label className="label">Remarks / what you observed</label>
              <textarea value={mismatchNotes} onChange={e => setMismatchNotes(e.target.value)} className="input" rows={3} placeholder="e.g. Rack 03/D/05 checked, no units found. Last seen rack also checked." />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setMismatchLine(null)} className="btn-secondary btn-sm">Cancel</button>
              <button onClick={confirmMismatch} className="btn-danger btn-sm">Confirm Mismatch</button>
            </div>
          </div>
        </Modal>

        {/* ── Cancel PL Modal ──────────────────────────────────────── */}
        {showCancelConfirm && (
          <Modal open title="Cancel Packing List" size="sm" onClose={() => setShowCancelConfirm(false)}>
            <div className="space-y-4">
              <p className="text-sm text-slate-700">Cancel this packing list? Stock reservations will be released and the SO will revert to <strong>Approved</strong> so a new packing list can be generated.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCancelConfirm(false)} className="btn-secondary btn-sm">Keep It</button>
                <button onClick={cancelPL} disabled={cancelling} className="btn-danger btn-sm">
                  {cancelling ? 'Cancelling...' : 'Cancel Packing List'}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </PageGuard>
    </AppLayout>
  )
}

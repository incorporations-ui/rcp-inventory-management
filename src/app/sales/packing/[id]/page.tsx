'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import {
  PageGuard,
  StatusBadge,
  PageLoader,
  Modal
} from '@/components/ui'
import { QRScanner } from '@/components/ui/QRComponents'
import { useAuth } from '@/hooks/useAuth'
import { parseQRData, formatCurrency } from '@/lib/utils'
import {
  CheckCircle,
  XCircle,
  PackageCheck,
  Printer,
  ArrowLeft,
  AlertTriangle,
  FileText,
  ExternalLink
} from 'lucide-react'
import Link from 'next/link'
import toast from 'react-hot-toast'

export default function PackingListDetailPage({
  params
}: {
  params: { id: string }
}) {
  const { id } = params
  const supabase = createClient()
  const { profile } = useAuth()

  const [pl, setPL] = useState<any>(null)
  const [lines, setLines] = useState<any[]>([])
  const [invoice, setInvoice] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [finalizing, setFinalizing] = useState(false)
  const [mismatchLine, setMismatchLine] = useState<any>(null)
  const [mismatchNotes, setMismatchNotes] = useState('')

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    setLoading(true)
    try {
      const [{ data: plData, error: plError }, { data: lineData, error: lineError }] =
        await Promise.all([
          supabase
            .from('packing_lists')
            .select(`
              *,
              sales_orders(
                *,
                customers(name, gstin, address_line1, city, state)
              )
            `)
            .eq('id', id)
            .single(),

          supabase
            .from('packing_list_lines')
            .select(`
              *,
              skus(display_name, sku_code, gst_rate),
              rack:racks!packing_list_lines_rack_id_fkey(rack_id_display),
              scanned_rack:racks!packing_list_lines_scanned_rack_id_fkey(rack_id_display),
              stock_master(
                total_units,
                reserved_units,
                available_units
              )
            `)
            .eq('packing_list_id', id)
            .order('id')
        ])

      if (plError) throw plError
      if (lineError) throw lineError

      setPL(plData)
      setLines(lineData || [])

      // If already finalized, fetch the generated invoice
      if (plData?.status === 'finalized') {
        const { data: invData } = await supabase
          .from('invoices')
          .select('id, invoice_number, grand_total, payment_status, dispatch_status')
          .eq('packing_list_id', id)
          .maybeSingle()
        setInvoice(invData ?? null)
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to load packing list')
    } finally {
      setLoading(false)
    }
  }

  async function markLine(
    lineId: string,
    status: 'packed' | 'unavailable',
    units?: number
  ) {
    const line = lines.find((l) => l.id === lineId)
    if (!line) return

    if (status === 'unavailable') {
      setMismatchLine(line)
      return
    }

    const qty = units ?? line.ordered_units

    if (qty <= 0) {
      toast.error('Packed quantity must be greater than zero')
      return
    }

    if (qty > line.stock_master?.available_units) {
      toast.error('Packed quantity exceeds available stock')
      return
    }

    const { error } = await supabase
      .from('packing_list_lines')
      .update({
        status: 'packed',
        packed_units: qty,
        packed_by: profile?.id,
        packed_at: new Date().toISOString()
      })
      .eq('id', lineId)

    if (error) toast.error(error.message)
    else {
      toast.success('Line marked as packed')
      loadData()
    }
  }

  async function confirmMismatch() {
    if (!mismatchLine) return

    const { error } = await supabase
      .from('packing_list_lines')
      .update({
        status: 'unavailable',
        unavailable_units: mismatchLine.ordered_units,
        mismatch_flagged: true,
        mismatch_notes: mismatchNotes,
        packed_by: profile?.id,
        packed_at: new Date().toISOString()
      })
      .eq('id', mismatchLine.id)

    if (error) toast.error(error.message)
    else {
      toast.error('Stock mismatch flagged')
      setMismatchLine(null)
      setMismatchNotes('')
      loadData()
    }
  }

  async function handleRackScan(qrData: string, lineId: string) {
    const parsed = parseQRData(qrData)
    if (!parsed || parsed.entityType !== 'rack') {
      toast.error('Invalid Rack QR Code')
      return
    }

    const { error } = await supabase
      .from('packing_list_lines')
      .update({ scanned_rack_id: parsed.entityId })
      .eq('id', lineId)

    if (error) toast.error(error.message)
    else {
      toast.success('Rack scanned successfully')
      loadData()
    }
  }

  async function finalizePL() {
    const pending = lines.filter((l) => l.status === 'pending')
    if (pending.length > 0) {
      toast.error('Complete all lines before finalizing — mark each as Packed or Unavailable')
      return
    }

    const packedLines = lines.filter((l) => l.status === 'packed')
    if (packedLines.length === 0) {
      toast.error('No packed lines — cannot generate invoice')
      return
    }

    setFinalizing(true)
    try {
      // 1. Deduct stock for packed lines (FIFO via RPC)
      for (const line of packedLines) {
        await supabase.rpc('update_stock_master', {
          p_sku_id: line.sku_id,
          p_delta: -line.packed_units
        })
      }

      // 2. Mark packing list as finalized
      await supabase
        .from('packing_lists')
        .update({ status: 'finalized', finalized_at: new Date().toISOString() })
        .eq('id', pl.id)

      // 3. Generate invoice number
      const { data: invNum, error: invNumErr } = await supabase
        .rpc('next_doc_number', { p_doc_type: 'INV' })
      if (invNumErr) throw new Error('Could not generate invoice number: ' + invNumErr.message)

      // 4. Calculate invoice totals from packed lines only
      const subtotal = packedLines.reduce(
        (s, l) => s + l.packed_units * l.unit_price, 0
      )
      const totalGst = packedLines.reduce(
        (s, l) => s + l.packed_units * l.unit_price * (l.skus?.gst_rate ?? 0) / 100, 0
      )
      const grandTotal = subtotal + totalGst
      const so = pl.sales_orders

      // 5. Create invoice record
      const { data: inv, error: invErr } = await supabase
        .from('invoices')
        .insert({
          invoice_number: invNum,
          so_id: pl.so_id,
          packing_list_id: pl.id,
          customer_id: so.customer_id,
          invoice_date: new Date().toISOString().split('T')[0],
          subtotal,
          total_gst: totalGst,
          grand_total: grandTotal,
          payment_status: 'unpaid',
          dispatch_status: 'ready',
        })
        .select()
        .single()

      if (invErr || !inv) throw new Error(invErr?.message ?? 'Failed to create invoice')

      // 6. Create invoice lines (packed lines only)
      const invLines = packedLines.map((l) => ({
        invoice_id: inv.id,
        sku_id: l.sku_id,
        units: l.packed_units,
        unit_price: l.unit_price,
        gst_rate: l.skus?.gst_rate ?? 0,
      }))
      const { error: invLinesErr } = await supabase.from('invoice_lines').insert(invLines)
      if (invLinesErr) throw new Error(invLinesErr.message)

      // 7. Update SO status to invoiced
      await supabase
        .from('sales_orders')
        .update({ status: 'invoiced' })
        .eq('id', pl.so_id)

      toast.success(`Packing list finalized! Invoice ${invNum} generated.`)
      loadData()
    } catch (error: any) {
      toast.error(error.message || 'Finalization failed')
    } finally {
      setFinalizing(false)
    }
  }

  if (loading) {
    return (
      <AppLayout>
        <PageGuard>
          <PageLoader />
        </PageGuard>
      </AppLayout>
    )
  }

  if (!pl) {
    return (
      <AppLayout>
        <PageGuard>
          <p className="text-slate-500">Packing list not found.</p>
        </PageGuard>
      </AppLayout>
    )
  }

  const so = pl.sales_orders
  const allDone = lines.every((l) => l.status !== 'pending')

  return (
    <AppLayout>
      <PageGuard roles={['admin', 'sales_manager', 'packing_executive']}>
        <div className="space-y-5 max-w-4xl">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <Link
                href="/sales/packing"
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Packing Lists
              </Link>
              <h1 className="page-title">{pl.pl_number}</h1>
              <div className="flex items-center gap-3 mt-1">
                <StatusBadge status={pl.status} />
                <span className="text-sm text-slate-500">
                  SO: {so?.so_number}
                </span>
                <span className="text-sm text-slate-500">
                  Customer: {so?.customers?.name}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => window.print()}
                className="btn-secondary btn-sm no-print"
              >
                <Printer className="w-4 h-4" /> Print
              </button>

              {/* ── FINALIZED: show invoice link ── */}
              {pl.status === 'finalized' && invoice && (
                <Link
                  href="/sales/invoices"
                  className="btn-primary flex items-center gap-1.5"
                >
                  <FileText className="w-4 h-4" />
                  View Invoice {invoice.invoice_number}
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              )}

              {/* ── FINALIZED but invoice not found yet ── */}
              {pl.status === 'finalized' && !invoice && (
                <Link href="/sales/invoices" className="btn-secondary btn-sm">
                  <FileText className="w-4 h-4" /> Go to Invoices
                </Link>
              )}

              {/* ── READY TO FINALIZE ── */}
              {pl.status !== 'finalized' && allDone && (
                <button
                  onClick={finalizePL}
                  disabled={finalizing}
                  className="btn-primary"
                >
                  <PackageCheck className="w-4 h-4" />
                  {finalizing ? 'Finalizing & Generating Invoice...' : 'Finalize & Generate Invoice'}
                </button>
              )}
            </div>
          </div>

          {/* ── POST-FINALIZATION SUMMARY ── */}
          {pl.status === 'finalized' && (() => {
            const packed = lines.filter(l => l.status === 'packed')
            const unavail = lines.filter(l => l.status === 'unavailable')
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* FPPL */}
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="w-5 h-5 text-emerald-600" />
                    <h3 className="font-semibold text-emerald-800 text-sm">
                      Final Packed Product List (FPPL)
                    </h3>
                    <span className="ml-auto badge bg-emerald-100 text-emerald-700">{packed.length} lines</span>
                  </div>
                  {packed.length === 0 ? (
                    <p className="text-xs text-emerald-600">No items were packed.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {packed.map(l => (
                        <div key={l.id} className="flex justify-between text-xs">
                          <span className="text-emerald-800 font-medium">{l.skus?.display_name ?? l.skus?.sku_code}</span>
                          <span className="text-emerald-700 font-semibold">{l.packed_units} units</span>
                        </div>
                      ))}
                      <div className="pt-2 border-t border-emerald-200 flex justify-between text-xs font-bold text-emerald-900">
                        <span>Invoice Value</span>
                        <span>{invoice ? formatCurrency(invoice.grand_total) : '—'}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* FUPL */}
                <div className={`rounded-xl border p-4 ${unavail.length > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <XCircle className={`w-5 h-5 ${unavail.length > 0 ? 'text-red-500' : 'text-slate-400'}`} />
                    <h3 className={`font-semibold text-sm ${unavail.length > 0 ? 'text-red-800' : 'text-slate-600'}`}>
                      Final Unavailable Product List (FUPL)
                    </h3>
                    <span className={`ml-auto badge ${unavail.length > 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{unavail.length} lines</span>
                  </div>
                  {unavail.length === 0 ? (
                    <p className="text-xs text-slate-500">All items were packed. ✓</p>
                  ) : (
                    <div className="space-y-1.5">
                      {unavail.map(l => (
                        <div key={l.id} className="flex justify-between text-xs">
                          <span className="text-red-800 font-medium">{l.skus?.display_name ?? l.skus?.sku_code}</span>
                          <span className="text-red-700 font-semibold">{l.unavailable_units ?? l.ordered_units} units</span>
                        </div>
                      ))}
                      {unavail.some(l => l.mismatch_notes) && (
                        <div className="pt-2 border-t border-red-200 text-xs text-red-600 italic">
                          ⚠ Stock mismatches flagged — review with godown manager.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Line Items */}
          <div className="space-y-3">
            {lines.map((line) => (
              <div
                key={line.id}
                className={`card p-4 border-l-4 ${
                  line.status === 'packed'
                    ? 'border-emerald-500'
                    : line.status === 'unavailable'
                    ? 'border-red-500'
                    : 'border-slate-300'
                }`}
              >
                <div className="flex justify-between gap-4">
                  <div className="flex-1">
                    <p className="font-semibold">
                      {line.skus?.display_name}
                    </p>
                    <p className="text-sm text-slate-500">
                      SKU: {line.skus?.sku_code}
                    </p>
                    <p className="text-sm">
                      Ordered: <strong>{line.ordered_units}</strong>
                    </p>
                    <p className="text-sm text-emerald-600">
                      Available:{' '}
                      <strong>
                        {line.stock_master?.available_units ?? 0}
                      </strong>
                    </p>

                    {line.status === 'pending' && (
                      <input
                        type="number"
                        min={1}
                        max={line.ordered_units}
                        defaultValue={line.ordered_units}
                        className="input mt-2 w-32"
                        onChange={(e) =>
                          (line._packQty = Number(e.target.value))
                        }
                      />
                    )}
                  </div>

                  {pl.status !== 'finalized' &&
                    line.status === 'pending' && (
                      <div className="flex flex-col gap-2">
                        <QRScanner
                          label="Scan Rack"
                          onScan={(qr) =>
                            handleRackScan(qr, line.id)
                          }
                        />

                        <button
                          onClick={() =>
                            markLine(
                              line.id,
                              'packed',
                              line._packQty || line.ordered_units
                            )
                          }
                          className="btn-primary btn-sm flex items-center gap-1"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Mark Packed
                        </button>

                        <button
                          onClick={() =>
                            markLine(line.id, 'unavailable')
                          }
                          className="btn-secondary btn-sm text-red-600 flex items-center gap-1"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Unavailable
                        </button>
                      </div>
                    )}

                  {line.status !== 'pending' && (
                    <StatusBadge status={line.status} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Mismatch Modal */}
        <Modal
          open={!!mismatchLine}
          onClose={() => setMismatchLine(null)}
          title="Flag Stock Mismatch"
          size="sm"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-2 text-amber-600">
              <AlertTriangle className="w-5 h-5" />
              <p className="text-sm">
                Stock is shown as available but not found physically.
              </p>
            </div>
            <textarea
              value={mismatchNotes}
              onChange={(e) =>
                setMismatchNotes(e.target.value)
              }
              className="input"
              rows={3}
              placeholder="Enter remarks"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMismatchLine(null)}
                className="btn-secondary btn-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmMismatch}
                className="btn-danger btn-sm"
              >
                Confirm
              </button>
            </div>
          </div>
        </Modal>
      </PageGuard>
    </AppLayout>
  )
}

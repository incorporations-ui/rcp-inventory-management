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
import { parseQRData } from '@/lib/utils'
import {
  CheckCircle,
  XCircle,
  PackageCheck,
  Printer,
  ArrowLeft,
  AlertTriangle
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
      toast.error('Complete packing before finalizing')
      return
    }

    setFinalizing(true)
    try {
      for (const line of lines.filter((l) => l.status === 'packed')) {
        await supabase.rpc('update_stock_master', {
          p_sku_id: line.sku_id,
          p_delta: -line.packed_units
        })
      }

      await supabase
        .from('packing_lists')
        .update({
          status: 'finalized',
          finalized_at: new Date().toISOString()
        })
        .eq('id', pl.id)

      toast.success('Packing list finalized successfully!')
      loadData()
    } catch (error: any) {
      toast.error(error.message)
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
              {pl.status === 'finalized' && (
                <button
                  onClick={() => window.print()}
                  className="btn-secondary btn-sm no-print"
                >
                  <Printer className="w-4 h-4" /> Print
                </button>
              )}

              {pl.status !== 'finalized' && allDone && (
                <button
                  onClick={finalizePL}
                  disabled={finalizing}
                  className="btn-primary"
                >
                  <PackageCheck className="w-4 h-4" />
                  {finalizing ? 'Finalizing...' : 'Finalize Packing List'}
                </button>
              )}
            </div>
          </div>

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

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
  AlertTriangle,
  PackageCheck,
  Printer,
  ArrowLeft
} from 'lucide-react'
import Link from 'next/link'
import toast from 'react-hot-toast'

export default function PackingListDetailPage({
  params
}: {
  params: { id: string }
}) {
  const { id } = params
  const [pl, setPL] = useState<any>(null)
  const [lines, setLines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [finalizing, setFinalizing] = useState(false)
  const [mismatchLine, setMismatchLine] = useState<any>(null)
  const [mismatchNotes, setMismatchNotes] = useState('')
  const { profile } = useAuth()
  const supabase = createClient()

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
              racks(rack_id_display),
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

      // Enrich lines with rack location hints
      const enrichedLines = await Promise.all(
        (lineData ?? []).map(async (line) => {
          const { data: rackLoc } = await supabase
            .from('rack_stock')
            .select('units_count, racks(rack_id_display, id)')
            .eq('sku_id', line.sku_id)
            .gt('units_count', 0)
            .order('stocked_at', { ascending: true })
            .limit(3)

          return {
            ...line,
            rack_locations: rackLoc ?? [],
            available_units: line.stock_master?.available_units ?? 0
          }
        })
      )

      setPL(plData)
      setLines(enrichedLines)
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

    const { error } = await supabase
      .from('packing_list_lines')
      .update({
        status: 'packed',
        packed_units: units ?? line.ordered_units,
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
      toast.error(
        `Stock mismatch flagged for ${mismatchLine.skus?.display_name}`
      )
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

    const { error } = await supabase
      .from('packing_list_lines')
      .update({ scanned_rack_id: parsed.entityId })
      .eq('id', lineId)

    if (error) toast.error(error.message)
    else {
      toast.success('Rack scan recorded')
      loadData()
    }
  }

  async function finalizePL() {
    const pending = lines.filter((l) => l.status === 'pending')
    if (pending.length > 0) {
      toast.error(
        'All lines must be marked as packed or unavailable before finalizing'
      )
      return
    }

    setFinalizing(true)

    try {
      const packedLines = lines.filter((l) => l.status === 'packed')
      const unavailableLines = lines.filter(
        (l) => l.status === 'unavailable'
      )

      for (const line of packedLines) {
        await supabase.rpc('update_stock_master', {
          p_sku_id: line.sku_id,
          p_delta: -line.packed_units
        })

        await supabase
          .from('stock_master')
          .update({ reserved_units: 0 })
          .eq('sku_id', line.sku_id)

        await supabase.from('stock_movements').insert({
          sku_id: line.sku_id,
          movement_type: 'so_out',
          reference_type: 'packing_list',
          reference_id: pl.id,
          units_out: line.packed_units,
          balance_after: 0,
          created_by: profile?.id,
          rack_id: line.scanned_rack_id
        })

        if (line.scanned_rack_id) {
          const { data: rs } = await supabase
            .from('rack_stock')
            .select('id, units_count')
            .eq('rack_id', line.scanned_rack_id)
            .eq('sku_id', line.sku_id)
            .single()

          if (rs) {
            await supabase
              .from('rack_stock')
              .update({
                units_count: Math.max(
                  0,
                  rs.units_count - line.packed_units
                )
              })
              .eq('id', rs.id)
          }
        }
      }

      for (const line of unavailableLines) {
        await supabase
          .from('stock_master')
          .update({ reserved_units: 0 })
          .eq('sku_id', line.sku_id)
      }

      await supabase
        .from('packing_lists')
        .update({
          status: 'finalized',
          finalized_at: new Date().toISOString()
        })
        .eq('id', pl.id)

      await supabase
        .from('sales_orders')
        .update({
          status: packedLines.length > 0 ? 'packed' : 'cancelled'
        })
        .eq('id', pl.so_id)

      toast.success('Packing list finalized successfully!')
      loadData()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setFinalizing(false)
    }
  }

  if (loading)
    return (
      <AppLayout>
        <PageGuard>
          <PageLoader />
        </PageGuard>
      </AppLayout>
    )

  if (!pl)
    return (
      <AppLayout>
        <PageGuard>
          <p className="text-slate-500">
            Packing list not found.
          </p>
        </PageGuard>
      </AppLayout>
    )

  const so = pl.sales_orders
  const allDone = lines.every((l) => l.status !== 'pending')
  const packedCount = lines.filter(
    (l) => l.status === 'packed'
  ).length
  const unavailableCount = lines.filter(
    (l) => l.status === 'unavailable'
  ).length

  return (
    <AppLayout>
      <PageGuard
        roles={[
          'admin',
          'sales_manager',
          'packing_executive'
        ]}
      >
        <div className="space-y-5 max-w-4xl">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <Link
                href="/inventory/packing"
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
                  <Printer className="w-4 h-4" />
                  Print
                </button>
              )}

              {pl.status !== 'finalized' && allDone && (
                <button
                  onClick={finalizePL}
                  disabled={finalizing}
                  className="btn-primary"
                >
                  <PackageCheck className="w-4 h-4" />
                  {finalizing
                    ? 'Finalizing...'
                    : 'Finalize Packing List'}
                </button>
              )}
            </div>
          </div>

          {/* Line Items */}
          <div className="space-y-3">
            {lines.map((line) => (
              <div
                key={line.id}
                className="card p-4 border-l-4 border-slate-300"
              >
                <p className="font-semibold">
                  {line.skus?.display_name}
                </p>
                <p className="text-sm text-slate-500">
                  Ordered: {line.ordered_units}
                </p>
                <p className="text-sm text-emerald-600">
                  Available:{' '}
                  <strong>
                    {line.stock_master?.available_units ?? 0}
                  </strong>
                </p>
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
            <p className="text-sm">
              System shows stock available, but it cannot be
              found physically.
            </p>
            <textarea
              value={mismatchNotes}
              onChange={(e) =>
                setMismatchNotes(e.target.value)
              }
              className="input"
              rows={3}
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
                Confirm Mismatch
              </button>
            </div>
          </div>
        </Modal>
      </PageGuard>
    </AppLayout>
  )
}

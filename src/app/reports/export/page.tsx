'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard } from '@/components/ui'
import { exportToCSV } from '@/lib/utils'
import { Download, FileSpreadsheet, CheckCircle, Calendar } from 'lucide-react'
import { format, subDays, subMonths, startOfYear } from 'date-fns'
import toast from 'react-hot-toast'

const TODAY = format(new Date(), 'yyyy-MM-dd')

const DATE_PRESETS = [
  { label: 'Today',        from: () => TODAY,                                        to: () => TODAY },
  { label: 'Last 7 days',  from: () => format(subDays(new Date(), 7),  'yyyy-MM-dd'), to: () => TODAY },
  { label: 'Last 30 days', from: () => format(subDays(new Date(), 30), 'yyyy-MM-dd'), to: () => TODAY },
  { label: 'Last 90 days', from: () => format(subDays(new Date(), 90), 'yyyy-MM-dd'), to: () => TODAY },
  { label: 'This year',    from: () => format(startOfYear(new Date()), 'yyyy-MM-dd'), to: () => TODAY },
  { label: 'All time',     from: () => '2000-01-01',                                  to: () => TODAY },
]

export default function ExportPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(TODAY)
  const [activePreset, setActivePreset] = useState('Last 30 days')

  function applyPreset(p: typeof DATE_PRESETS[0]) {
    setDateFrom(p.from())
    setDateTo(p.to())
    setActivePreset(p.label)
  }

  async function run(key: string, fn: () => Promise<void>) {
    setLoading(key); setDone(null)
    try { await fn(); setDone(key) }
    catch (e: any) { toast.error(e.message) }
    finally { setLoading(null) }
  }

  // Date range applies to date-based exports; stock exports are point-in-time
  const dateFilter = { from: dateFrom, to: dateTo }

  const exports = [
    {
      label: 'Invoices / Sales', icon: '🧾',
      color: 'border-indigo-200 bg-indigo-50',
      desc: 'Invoices with customer, GST, dispatch and payment — filtered by invoice date.',
      dateFiltered: true,
      fn: async () => {
        const { data } = await supabase.from('invoices')
          .select('invoice_number, invoice_date, customers(name,gstin,customer_type), sales_orders(so_number,proforma_number), subtotal, total_gst, grand_total, payment_status, dispatch_status, notes')
          .gte('invoice_date', dateFilter.from).lte('invoice_date', dateFilter.to)
          .order('invoice_date', { ascending: false })
        exportToCSV((data ?? []).map((i: any) => ({
          Invoice_No: i.invoice_number, Date: i.invoice_date,
          SO_No: i.sales_orders?.so_number, Proforma: i.sales_orders?.proforma_number ?? '',
          Customer: i.customers?.name, Type: i.customers?.customer_type ?? '',
          GSTIN: i.customers?.gstin ?? '', Subtotal: i.subtotal,
          GST: i.total_gst, Grand_Total: i.grand_total,
          Payment: i.payment_status, Dispatch: i.dispatch_status,
          Notes: i.notes ?? '',
        })), `invoices_${dateFilter.from}_${dateFilter.to}`)
      }
    },
    {
      label: 'GST Report (GSTR-1)', icon: '📊',
      color: 'border-emerald-200 bg-emerald-50',
      desc: 'Line-level detail with HSN codes and GST amounts for tax filing.',
      dateFiltered: true,
      fn: async () => {
        const { data } = await supabase.from('invoice_lines')
          .select('*, invoices!inner(invoice_number, invoice_date, customers(name,gstin))')
          .gte('invoices.invoice_date', dateFilter.from).lte('invoices.invoice_date', dateFilter.to)
          .select('*, invoices(invoice_number, invoice_date, customers(name,gstin)), skus(sku_code,display_name,hsn_code)')
        exportToCSV((data ?? []).map((l: any) => ({
          Invoice_No: l.invoices?.invoice_number, Invoice_Date: l.invoices?.invoice_date,
          Customer: l.invoices?.customers?.name, Customer_GSTIN: l.invoices?.customers?.gstin ?? '',
          SKU_Code: l.skus?.sku_code, Product: l.skus?.display_name,
          HSN_Code: l.skus?.hsn_code ?? '', Units: l.units, Unit_Price: l.unit_price,
          Taxable_Value: l.line_amount, GST_Rate_Pct: l.gst_rate, GST_Amount: l.line_gst,
          Total: +(Number(l.line_amount) + Number(l.line_gst)).toFixed(2),
        })), `gst_report_${dateFilter.from}_${dateFilter.to}`)
      }
    },
    {
      label: 'Purchase Orders', icon: '🛒',
      color: 'border-blue-200 bg-blue-50',
      desc: 'All POs with supplier, amounts and status — filtered by order date.',
      dateFiltered: true,
      fn: async () => {
        const { data } = await supabase.from('purchase_orders')
          .select('po_number, order_date, suppliers(name,gstin), total_amount, total_gst, grand_total, status, notes')
          .gte('order_date', dateFilter.from).lte('order_date', dateFilter.to)
          .order('order_date', { ascending: false })
        exportToCSV((data ?? []).map((p: any) => ({
          PO_No: p.po_number, Date: p.order_date,
          Supplier: p.suppliers?.name, Supplier_GSTIN: p.suppliers?.gstin ?? '',
          Subtotal: p.total_amount, GST: p.total_gst, Grand_Total: p.grand_total,
          Status: p.status, Notes: p.notes ?? '',
        })), `purchase_orders_${dateFilter.from}_${dateFilter.to}`)
      }
    },
    {
      label: 'GRN Report', icon: '📦',
      color: 'border-purple-200 bg-purple-50',
      desc: 'Goods received with quantities, damages and status — filtered by received date.',
      dateFiltered: true,
      fn: async () => {
        const { data } = await supabase.from('grn_lines')
          .select('*, grns!inner(grn_number, received_date, status, notes, suppliers(name))')
          .gte('grns.received_date', dateFilter.from).lte('grns.received_date', dateFilter.to)
          .select('*, grns(grn_number, received_date, status, notes, suppliers(name)), skus(sku_code, display_name)')
        exportToCSV((data ?? []).map((l: any) => ({
          GRN_No: l.grns?.grn_number, Date: l.grns?.received_date,
          Supplier: l.grns?.suppliers?.name, SKU_Code: l.skus?.sku_code,
          Product: l.skus?.display_name, Expected_Units: l.expected_units,
          Received_Units: l.received_units, Damaged_Units: l.damaged_units ?? 0,
          Status: l.status, GRN_Notes: l.grns?.notes ?? '',
        })), `grn_report_${dateFilter.from}_${dateFilter.to}`)
      }
    },
    {
      label: 'Packing Lists', icon: '📋',
      color: 'border-rose-200 bg-rose-50',
      desc: 'Packing lists with packed vs unavailable count and fill rate.',
      dateFiltered: true,
      fn: async () => {
        const { data } = await supabase.from('packing_lists')
          .select('pl_number, created_at, status, notes, sales_orders(so_number, customers(name)), packing_list_lines(status)')
          .gte('created_at', dateFilter.from).lte('created_at', dateFilter.to + 'T23:59:59')
          .order('created_at', { ascending: false })
        exportToCSV((data ?? []).map((pl: any) => {
          const lns = pl.packing_list_lines ?? []
          const packed = lns.filter((l: any) => l.status === 'packed').length
          const unavail = lns.filter((l: any) => l.status === 'unavailable').length
          return {
            PL_No: pl.pl_number, Date: pl.created_at?.split('T')[0],
            SO_No: pl.sales_orders?.so_number, Customer: pl.sales_orders?.customers?.name,
            Total_Lines: lns.length, Packed: packed, Unavailable: unavail,
            Fill_Rate_Pct: lns.length > 0 ? Math.round(packed / lns.length * 100) : 0,
            Status: pl.status, Notes: pl.notes ?? '',
          }
        }), `packing_lists_${dateFilter.from}_${dateFilter.to}`)
      }
    },
    {
      label: 'Stock Ageing', icon: '⏳',
      color: 'border-amber-200 bg-amber-50',
      desc: 'Current stock lots with age in days, bucket and value — point-in-time snapshot.',
      dateFiltered: false,
      fn: async () => {
        const { data } = await supabase.from('stock_ageing').select('*').order('age_days', { ascending: false })
        exportToCSV((data ?? []).map((r: any) => ({
          Lot_No: r.lot_number, SKU_Code: r.sku_code, Product: r.display_name,
          Brand: r.brand_name, Category: r.item_category, Received_Date: r.received_date,
          Age_Days: r.age_days, Bucket: r.age_bucket, Remaining_Units: r.remaining_units,
          Unit_Cost: r.unit_cost, Stock_Value: r.stock_value,
        })), `stock_ageing_${TODAY}`)
      }
    },
    {
      label: 'Stock Master Snapshot', icon: '📉',
      color: 'border-teal-200 bg-teal-50',
      desc: 'Current stock levels — total, reserved, available and reorder alert.',
      dateFiltered: false,
      fn: async () => {
        const { data } = await supabase.from('stock_master')
          .select('*, skus(sku_code, display_name, reorder_level, brands(name, item_categories(name)))')
          .order('total_units', { ascending: false })
        exportToCSV((data ?? []).map((s: any) => ({
          SKU_Code: s.skus?.sku_code, Product: s.skus?.display_name,
          Brand: s.skus?.brands?.name, Category: s.skus?.brands?.item_categories?.name,
          Total_Units: s.total_units, Reserved: s.reserved_units, Available: s.available_units,
          Reorder_Level: s.skus?.reorder_level ?? 0,
          Alert: s.available_units <= (s.skus?.reorder_level ?? 0) ? 'LOW STOCK' : 'OK',
        })), `stock_snapshot_${TODAY}`)
      }
    },
    {
      label: 'Returns Report', icon: '↩️',
      color: 'border-orange-200 bg-orange-50',
      desc: 'Sales and purchase returns with quantities and reasons.',
      dateFiltered: true,
      fn: async () => {
        const { data } = await supabase.from('returns')
          .select('return_number, return_type, return_date, reason, status, notes, customers(name), suppliers(name), return_lines(units, condition, skus(sku_code, display_name))')
          .gte('return_date', dateFilter.from).lte('return_date', dateFilter.to)
          .order('return_date', { ascending: false })
        const rows: any[] = []
        ;(data ?? []).forEach((r: any) => {
          ;(r.return_lines?.length ? r.return_lines : [{ units: 0, skus: {} }]).forEach((l: any) => {
            rows.push({
              Return_No: r.return_number, Type: r.return_type, Date: r.return_date,
              Party: r.customers?.name ?? r.suppliers?.name ?? '—',
              SKU_Code: l.skus?.sku_code ?? '', Product: l.skus?.display_name ?? '',
              Units: l.units, Condition: l.condition ?? '',
              Reason: r.reason ?? '', Notes: r.notes ?? '', Status: r.status,
            })
          })
        })
        exportToCSV(rows, `returns_${dateFilter.from}_${dateFilter.to}`)
      }
    },
  ]

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-6">
          <div className="page-header">
            <div>
              <h1 className="page-title">Export Data</h1>
              <p className="text-sm text-slate-500 mt-0.5">Download any report as CSV — open in Excel or Google Sheets</p>
            </div>
          </div>

          {/* ── Date range filter ─────────────────────────────────── */}
          <div className="card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span className="text-sm font-semibold text-slate-600">Date Range:</span>

              {/* Preset pills */}
              <div className="flex flex-wrap gap-1.5">
                {DATE_PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                      activePreset === p.label
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Custom range inputs */}
              <div className="flex items-center gap-2 ml-auto">
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo}
                  onChange={e => { setDateFrom(e.target.value); setActivePreset('') }}
                  className="input text-xs w-36"
                />
                <span className="text-slate-400 text-xs">to</span>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom}
                  max={TODAY}
                  onChange={e => { setDateTo(e.target.value); setActivePreset('') }}
                  className="input text-xs w-36"
                />
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Date-filtered exports use this range. Stock snapshots always export current values.
            </p>
          </div>

          {/* ── Export cards ──────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {exports.map((e) => {
              const isLoading = loading === e.label
              const isDone = done === e.label
              return (
                <div key={e.label} className={`card border-2 ${e.color} p-5 flex flex-col gap-3`}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl leading-none mt-0.5">{e.icon}</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 text-sm">{e.label}</p>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{e.desc}</p>
                      {e.dateFiltered && (
                        <p className="text-xs text-brand-600 font-medium mt-1.5">
                          📅 {dateFrom} → {dateTo}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => run(e.label, e.fn)}
                    disabled={!!loading}
                    className={`btn-sm w-full justify-center mt-auto ${isDone ? 'btn-success' : 'btn-secondary'}`}
                  >
                    {isLoading
                      ? <><span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> Exporting…</>
                      : isDone
                      ? <><CheckCircle className="w-3.5 h-3.5" /> Downloaded!</>
                      : <><Download className="w-3.5 h-3.5" /> Export CSV</>
                    }
                  </button>
                </div>
              )
            })}
          </div>

          <div className="card p-4 bg-slate-50 border border-slate-200 flex items-start gap-3">
            <FileSpreadsheet className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-slate-600">
              <strong className="text-slate-700">Opening in Excel:</strong> File → Open → select the downloaded .csv file.
              In Google Sheets: File → Import → Upload. Amounts are in ₹ INR. Dates are YYYY-MM-DD for easy filtering.
            </p>
          </div>
        </div>
      </PageGuard>
    </AppLayout>
  )
}

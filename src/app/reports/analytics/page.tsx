'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, PageLoader } from '@/components/ui'
import { formatCurrency, exportToCSV } from '@/lib/utils'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts'
import { Download, TrendingUp, TrendingDown } from 'lucide-react'

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true)
  const [salesByMonth, setSalesByMonth] = useState<any[]>([])
  const [topSkus, setTopSkus] = useState<any[]>([])
  const [slowMovers, setSlowMovers] = useState<any[]>([])
  const [customerSplit, setCustomerSplit] = useState<any[]>([])
  const [fillRate, setFillRate] = useState({ fulfilled: 0, backordered: 0, cancelled: 0 })
  const supabase = createClient()

  useEffect(() => { loadAnalytics() }, [])

  async function loadAnalytics() {
    setLoading(true)

    // Sales by month (last 6 months)
    const { data: invoiceData } = await supabase
      .from('invoices')
      .select('invoice_date, grand_total, subtotal, total_gst')
      .order('invoice_date', { ascending: true })

    if (invoiceData) {
      const byMonth: Record<string, { revenue: number; gst: number; count: number }> = {}
      invoiceData.forEach(inv => {
        const month = inv.invoice_date?.substring(0, 7) ?? ''
        if (!byMonth[month]) byMonth[month] = { revenue: 0, gst: 0, count: 0 }
        byMonth[month].revenue += Number(inv.grand_total)
        byMonth[month].gst += Number(inv.total_gst)
        byMonth[month].count++
      })
      setSalesByMonth(Object.entries(byMonth).slice(-6).map(([month, d]) => ({
        month: new Date(month + '-01').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        revenue: Math.round(d.revenue),
        gst: Math.round(d.gst),
        orders: d.count,
      })))
    }

    // Top SKUs by units sold
    const { data: invLines } = await supabase
      .from('invoice_lines')
      .select('sku_id, units, line_amount, skus(display_name, sku_code)')
    if (invLines) {
      const bySkuSold: Record<string, any> = {}
      invLines.forEach(l => {
        if (!bySkuSold[l.sku_id]) bySkuSold[l.sku_id] = { name: (l.skus as any)?.display_name, sku_code: (l.skus as any)?.sku_code, units: 0, revenue: 0 }
        bySkuSold[l.sku_id].units += l.units
        bySkuSold[l.sku_id].revenue += Number(l.line_amount)
      })
      const sorted = Object.values(bySkuSold).sort((a, b) => b.units - a.units)
      setTopSkus(sorted.slice(0, 8))
      setSlowMovers(sorted.slice(-5).reverse())
    }

    // Customer type split from invoices
    const { data: invCustomers } = await supabase
      .from('invoices')
      .select('grand_total, customers(customer_type)')
    if (invCustomers) {
      const split: Record<string, number> = {}
      invCustomers.forEach(i => {
        const type = (i.customers as any)?.customer_type ?? 'unknown'
        split[type] = (split[type] ?? 0) + Number(i.grand_total)
      })
      setCustomerSplit(Object.entries(split).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value: Math.round(value) })))
    }

    // Fill rate
    const { data: plLines } = await supabase.from('packing_list_lines').select('status')
    if (plLines) {
      const packed = plLines.filter(l => l.status === 'packed').length
      const unavail = plLines.filter(l => l.status === 'unavailable').length
      const total = plLines.length
      setFillRate({ fulfilled: packed, backordered: unavail, cancelled: total - packed - unavail })
    }

    setLoading(false)
  }

  async function exportSalesReport() {
    const { data } = await supabase
      .from('invoices')
      .select('invoice_number, invoice_date, customers(name, customer_type, gstin), sales_orders(so_number), subtotal, total_gst, grand_total, payment_status, dispatch_status')
      .order('invoice_date', { ascending: false })
    exportToCSV((data ?? []).map((i: any) => ({
      Invoice_No: i.invoice_number, Date: i.invoice_date, SO_No: i.sales_orders?.so_number,
      Customer: i.customers?.name, Customer_Type: i.customers?.customer_type,
      GSTIN: i.customers?.gstin ?? '', Subtotal: i.subtotal, GST: i.total_gst,
      Grand_Total: i.grand_total, Payment: i.payment_status, Dispatch: i.dispatch_status,
    })), 'sales_report')
  }

  async function exportGSTReport() {
    const { data } = await supabase
      .from('invoice_lines')
      .select('*, invoices(invoice_number, invoice_date, customers(name, gstin)), skus(sku_code, display_name, hsn_code)')
      .order('id')
    exportToCSV((data ?? []).map((l: any) => ({
      Invoice_No: l.invoices?.invoice_number, Invoice_Date: l.invoices?.invoice_date,
      Customer: l.invoices?.customers?.name, Customer_GSTIN: l.invoices?.customers?.gstin ?? '',
      SKU_Code: l.skus?.sku_code, Product: l.skus?.display_name,
      HSN_Code: l.skus?.hsn_code ?? '', Units: l.units, Unit_Price: l.unit_price,
      Taxable_Value: l.line_amount, GST_Rate: l.gst_rate, GST_Amount: l.line_gst,
      Total: Number(l.line_amount) + Number(l.line_gst),
    })), 'gst_report')
  }

  async function exportStockReport() {
    const { data } = await supabase.from('stock_ageing').select('*').order('age_days', { ascending: false })
    exportToCSV((data ?? []).map((r: any) => ({
      Lot_No: r.lot_number, SKU_Code: r.sku_code, Product: r.display_name,
      Brand: r.brand_name, Category: r.item_category, Received_Date: r.received_date,
      Age_Days: r.age_days, Bucket: r.age_bucket, Remaining_Units: r.remaining_units,
      Unit_Cost: r.unit_cost, Stock_Value: r.stock_value,
    })), 'stock_ageing_report')
  }

  const fillTotal = fillRate.fulfilled + fillRate.backordered + fillRate.cancelled
  const fillPct = fillTotal > 0 ? Math.round((fillRate.fulfilled / fillTotal) * 100) : 0

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-6">
          <div className="page-header">
            <h1 className="page-title">Analytics & Reports</h1>
          </div>

          {loading ? <PageLoader /> : (
            <>
              {/* Export cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { label: 'Sales Report', desc: 'All invoices with customer & dispatch details', fn: exportSalesReport, color: 'bg-brand-50 text-brand-700' },
                  { label: 'GST Report', desc: 'Line-level detail with HSN codes for filing', fn: exportGSTReport, color: 'bg-emerald-50 text-emerald-700' },
                  { label: 'Stock Ageing Report', desc: 'All lots with age buckets and values', fn: exportStockReport, color: 'bg-amber-50 text-amber-700' },
                ].map(e => (
                  <div key={e.label} className="card p-5">
                    <p className="font-semibold text-slate-900">{e.label}</p>
                    <p className="text-sm text-slate-500 mt-1 mb-4">{e.desc}</p>
                    <button onClick={e.fn} className="btn-secondary btn-sm w-full justify-center">
                      <Download className="w-4 h-4" /> Export CSV
                    </button>
                  </div>
                ))}
              </div>

              {/* Revenue chart */}
              {salesByMonth.length > 0 && (
                <div className="card">
                  <div className="card-header"><h3>Monthly Revenue (last 6 months)</h3></div>
                  <div className="card-body">
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={salesByMonth}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                        <Tooltip formatter={(v: any) => formatCurrency(v)} />
                        <Bar dataKey="revenue" fill="#6366f1" radius={[4,4,0,0]} name="Revenue (incl. GST)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top movers */}
                {topSkus.length > 0 && (
                  <div className="card">
                    <div className="card-header">
                      <h3 className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-500" /> Top 8 SKUs by Units Sold</h3>
                    </div>
                    <div className="card-body pt-0">
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={topSkus} layout="vertical">
                          <XAxis type="number" tick={{ fontSize: 11 }} />
                          <YAxis type="category" dataKey="sku_code" tick={{ fontSize: 10 }} width={90} />
                          <Tooltip formatter={(v: any) => [`${v} units`, 'Sold']} />
                          <Bar dataKey="units" fill="#10b981" radius={[0,4,4,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Customer split + fill rate */}
                <div className="space-y-4">
                  {customerSplit.length > 0 && (
                    <div className="card">
                      <div className="card-header"><h3>Revenue by Customer Type</h3></div>
                      <div className="card-body">
                        <ResponsiveContainer width="100%" height={140}>
                          <PieChart>
                            <Pie data={customerSplit} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={55} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                              {customerSplit.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                            </Pie>
                            <Tooltip formatter={(v: any) => formatCurrency(v)} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  <div className="card p-5">
                    <h3 className="mb-3">Order Fill Rate</h3>
                    <div className="flex items-center gap-4">
                      <div className="text-3xl font-bold text-emerald-600">{fillPct}%</div>
                      <div className="flex-1">
                        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${fillPct}%` }} />
                        </div>
                        <div className="flex justify-between text-xs text-slate-500 mt-1.5">
                          <span>✓ {fillRate.fulfilled} packed</span>
                          <span>✗ {fillRate.backordered} unavailable</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Slow movers */}
              {slowMovers.length > 0 && (
                <div className="card">
                  <div className="card-header">
                    <h3 className="flex items-center gap-2"><TrendingDown className="w-4 h-4 text-red-500" /> Slow Movers (least units sold)</h3>
                  </div>
                  <div className="table-wrapper">
                    <table>
                      <thead><tr><th>SKU Code</th><th>Product Name</th><th className="text-right">Units Sold</th><th className="text-right">Revenue</th></tr></thead>
                      <tbody>
                        {slowMovers.map((s, i) => (
                          <tr key={i}>
                            <td><code className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">{s.sku_code}</code></td>
                            <td className="font-medium">{s.name}</td>
                            <td className="text-right font-mono text-red-600">{s.units}</td>
                            <td className="text-right font-semibold">{formatCurrency(s.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </PageGuard>
    </AppLayout>
  )
}

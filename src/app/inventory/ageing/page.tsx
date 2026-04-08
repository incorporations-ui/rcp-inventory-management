'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, PageLoader, SearchInput } from '@/components/ui'
import { formatCurrency, formatDate, exportToCSV } from '@/lib/utils'
import { Download, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const BUCKET_COLORS: Record<string, string> = {
  '0-30 days': '#10b981',
  '31-60 days': '#f59e0b',
  '61-90 days': '#f97316',
  '90+ days': '#ef4444',
}

export default function AgeingPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterBucket, setFilterBucket] = useState('')
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data } = await supabase.from('stock_ageing').select('*').order('age_days', { ascending: false })
    setData(data ?? [])
    setLoading(false)
  }

  const filtered = data.filter(r =>
    (filterBucket === '' || r.age_bucket === filterBucket) &&
    (r.display_name?.toLowerCase().includes(search.toLowerCase()) ||
     r.brand_name?.toLowerCase().includes(search.toLowerCase()) ||
     r.item_category?.toLowerCase().includes(search.toLowerCase()))
  )

  // Chart data
  const buckets = ['0-30 days', '31-60 days', '61-90 days', '90+ days']
  const chartData = buckets.map(b => ({
    name: b,
    units: data.filter(r => r.age_bucket === b).reduce((s, r) => s + r.remaining_units, 0),
    value: data.filter(r => r.age_bucket === b).reduce((s, r) => s + Number(r.stock_value), 0),
  }))

  const totalValue = filtered.reduce((s, r) => s + Number(r.stock_value), 0)

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-6">
          <div className="page-header">
            <div>
              <h1 className="page-title">Stock Ageing Report</h1>
              <p className="text-sm text-slate-500 mt-0.5">Track how long inventory has been sitting</p>
            </div>
            <button onClick={() => exportToCSV(filtered.map(r => ({
              Lot: r.lot_number, SKU: r.sku_code, Product: r.display_name,
              Brand: r.brand_name, Category: r.item_category,
              Received: r.received_date, Age_Days: r.age_days, Bucket: r.age_bucket,
              Units: r.remaining_units, Unit_Cost: r.unit_cost, Stock_Value: r.stock_value
            })), 'ageing_report')} className="btn-secondary btn-sm">
              <Download className="w-4 h-4" /> Export
            </button>
          </div>

          {/* Summary chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card card-body">
              <h3 className="mb-4">Units by Age Bucket</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="units" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, i) => <Cell key={i} fill={BUCKET_COLORS[entry.name]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card card-body">
              <h3 className="mb-4">Stock Value by Age Bucket</h3>
              <div className="space-y-3">
                {chartData.map(b => (
                  <div key={b.name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BUCKET_COLORS[b.name] }} />
                        {b.name}
                      </span>
                      <span className="font-semibold">{formatCurrency(b.value)}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full" style={{
                        width: `${totalValue > 0 ? (b.value / chartData.reduce((s, x) => s + x.value, 0)) * 100 : 0}%`,
                        backgroundColor: BUCKET_COLORS[b.name]
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <SearchInput value={search} onChange={setSearch} placeholder="Search product..." />
            <div className="flex gap-2">
              {['', ...buckets].map(b => (
                <button key={b} onClick={() => setFilterBucket(b)}
                  className={`btn-sm ${filterBucket === b ? 'btn-primary' : 'btn-secondary'}`}>
                  {b || 'All'}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          {loading ? <PageLoader /> : (
            <div className="card">
              <div className="table-wrapper">
                <table>
                  <thead><tr>
                    <th>Lot #</th><th>Product</th><th>Brand</th><th>Received</th>
                    <th className="text-right">Age (days)</th><th>Bucket</th>
                    <th className="text-right">Units</th><th className="text-right">Value</th>
                  </tr></thead>
                  <tbody>
                    {filtered.map(r => (
                      <tr key={r.lot_id}>
                        <td><code className="font-mono text-xs">{r.lot_number}</code></td>
                        <td className="font-medium max-w-xs truncate">{r.display_name}</td>
                        <td className="text-sm text-slate-500">{r.brand_name}</td>
                        <td className="text-sm">{formatDate(r.received_date)}</td>
                        <td className="text-right">
                          <span className={`font-bold ${r.age_days > 90 ? 'text-red-600' : r.age_days > 60 ? 'text-orange-600' : r.age_days > 30 ? 'text-amber-600' : 'text-slate-700'}`}>
                            {r.age_days}
                          </span>
                        </td>
                        <td>
                          <span className="badge" style={{ backgroundColor: BUCKET_COLORS[r.age_bucket] + '20', color: BUCKET_COLORS[r.age_bucket] }}>
                            {r.age_bucket}
                          </span>
                        </td>
                        <td className="text-right font-mono">{r.remaining_units}</td>
                        <td className="text-right font-semibold">{formatCurrency(r.stock_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50">
                      <td colSpan={6} className="text-right font-semibold text-slate-600 px-4 py-3">Total:</td>
                      <td className="text-right font-bold px-4 py-3">{filtered.reduce((s, r) => s + r.remaining_units, 0)}</td>
                      <td className="text-right font-bold px-4 py-3">{formatCurrency(totalValue)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      </PageGuard>
    </AppLayout>
  )
}

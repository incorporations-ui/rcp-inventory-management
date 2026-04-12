'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, PageLoader } from '@/components/ui'
import { formatCurrency } from '@/lib/utils'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend, AreaChart, Area,
  FunnelChart, Funnel, LabelList, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis
} from 'recharts'
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react'
import { subDays, format } from 'date-fns'

const C = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16']

const TOOLTIP_STYLE = {
  contentStyle: { borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 },
  itemStyle: { color: '#334155' },
}

export default function ChartsPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(180)

  // Data states
  const [revenueArea, setRevenueArea] = useState<any[]>([])
  const [topSkuBar, setTopSkuBar] = useState<any[]>([])
  const [slowSkuBar, setSlowSkuBar] = useState<any[]>([])
  const [categoryPie, setCategoryPie] = useState<any[]>([])
  const [customerTypePie, setCustomerTypePie] = useState<any[]>([])
  const [soFunnel, setSoFunnel] = useState<any[]>([])
  const [fillRateGauge, setFillRateGauge] = useState({ pct: 0, packed: 0, unavail: 0 })
  const [ageBuckets, setAgeBuckets] = useState<any[]>([])
  const [radarData, setRadarData] = useState<any[]>([])
  const [kpis, setKpis] = useState({ revenue: 0, invoices: 0, avgOrder: 0, fillRate: 0 })

  useEffect(() => { load() }, [days])

  async function load() {
    setLoading(true)
    const from = days === 0 ? '2000-01-01' : format(subDays(new Date(), days), 'yyyy-MM-dd')
    const to = format(new Date(), 'yyyy-MM-dd')

    const [invRes, invLinesRes, plLinesRes, stockRes, soRes] = await Promise.all([
      supabase.from('invoices').select('invoice_date,grand_total,subtotal,total_gst,customers(customer_type)').gte('invoice_date', from).lte('invoice_date', to).order('invoice_date'),
      supabase.from('invoice_lines').select('sku_id,units,line_amount,skus(display_name,sku_code,brands(name,item_categories(name)))').order('id'),
      supabase.from('packing_list_lines').select('status'),
      supabase.from('stock_ageing').select('age_bucket,remaining_units,stock_value'),
      supabase.from('sales_orders').select('status'),
    ])

    const invoices = invRes.data ?? []
    const invLines = invLinesRes.data ?? []
    const plLines = plLinesRes.data ?? []
    const ageRows = stockRes.data ?? []
    const soRows = soRes.data ?? []

    // ── Revenue area chart by week
    const byWeek: Record<string, { revenue: number; gst: number; orders: number }> = {}
    invoices.forEach(inv => {
      const d = new Date(inv.invoice_date)
      // round to Monday
      const day = d.getDay()
      const monday = new Date(d); monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
      const key = format(monday, 'dd MMM')
      if (!byWeek[key]) byWeek[key] = { revenue: 0, gst: 0, orders: 0 }
      byWeek[key].revenue += Number(inv.grand_total)
      byWeek[key].gst += Number(inv.total_gst)
      byWeek[key].orders++
    })
    setRevenueArea(Object.entries(byWeek).map(([week, d]) => ({
      week, revenue: Math.round(d.revenue), gst: Math.round(d.gst), orders: d.orders,
    })))

    // ── KPIs
    const totalRevenue = invoices.reduce((s, i) => s + Number(i.grand_total), 0)
    const packed = plLines.filter(l => l.status === 'packed').length
    const unavail = plLines.filter(l => l.status === 'unavailable').length
    const fillPct = plLines.length > 0 ? Math.round(packed / plLines.length * 100) : 0
    setKpis({
      revenue: totalRevenue,
      invoices: invoices.length,
      avgOrder: invoices.length > 0 ? Math.round(totalRevenue / invoices.length) : 0,
      fillRate: fillPct,
    })
    setFillRateGauge({ pct: fillPct, packed, unavail })

    // ── Top / slow SKUs
    const bySkuId: Record<string, { name: string; sku: string; units: number; revenue: number; cat: string }> = {}
    invLines.forEach((l: any) => {
      if (!bySkuId[l.sku_id]) bySkuId[l.sku_id] = {
        name: l.skus?.display_name ?? l.skus?.sku_code ?? l.sku_id,
        sku: l.skus?.sku_code ?? '',
        units: 0, revenue: 0,
        cat: l.skus?.brands?.item_categories?.name ?? 'Other',
      }
      bySkuId[l.sku_id].units += l.units
      bySkuId[l.sku_id].revenue += Number(l.line_amount)
    })
    const skuArr = Object.values(bySkuId).sort((a, b) => b.units - a.units)
    setTopSkuBar(skuArr.slice(0, 8).map(s => ({ name: s.sku || s.name.slice(0, 20), units: s.units, revenue: Math.round(s.revenue) })))
    setSlowSkuBar([...skuArr].sort((a, b) => a.units - b.units).slice(0, 8).map(s => ({ name: s.sku || s.name.slice(0, 20), units: s.units })))

    // ── Category revenue pie
    const byCat: Record<string, number> = {}
    invLines.forEach((l: any) => {
      const cat = (l.skus as any)?.brands?.item_categories?.name ?? 'Other'
      byCat[cat] = (byCat[cat] ?? 0) + Number(l.line_amount)
    })
    setCategoryPie(Object.entries(byCat).map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value))

    // ── Customer type pie
    const byType: Record<string, number> = {}
    invoices.forEach((i: any) => {
      const t = i.customers?.customer_type ?? 'unknown'
      byType[t] = (byType[t] ?? 0) + Number(i.grand_total)
    })
    setCustomerTypePie(Object.entries(byType).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1), value: Math.round(value)
    })))

    // ── SO status funnel
    const statusOrder = ['proforma_sent','approved','packing_in_progress','packed','invoiced','dispatched']
    const statusCount: Record<string, number> = {}
    soRows.forEach((s: any) => { statusCount[s.status] = (statusCount[s.status] ?? 0) + 1 })
    const funnelData = statusOrder
      .filter(s => (statusCount[s] ?? 0) > 0)
      .map((s, i) => ({
        name: s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        value: statusCount[s] ?? 0,
        fill: C[i % C.length],
      }))
    setSoFunnel(funnelData)

    // ── Age buckets bar
    const bucketMap: Record<string, { units: number; value: number }> = {}
    ageRows.forEach((r: any) => {
      const b = r.age_bucket ?? 'Unknown'
      if (!bucketMap[b]) bucketMap[b] = { units: 0, value: 0 }
      bucketMap[b].units += r.remaining_units
      bucketMap[b].value += Number(r.stock_value)
    })
    const bucketOrder = ['0–30 days', '31–60 days', '61–90 days', '90+ days']
    setAgeBuckets(bucketOrder.filter(b => bucketMap[b]).map(b => ({
      bucket: b, units: bucketMap[b].units, value: Math.round(bucketMap[b].value)
    })))

    // ── Radar: category performance (units, revenue normalised)
    const cats = Object.entries(byCat).slice(0, 6)
    const maxRev = Math.max(...cats.map(([,v]) => v), 1)
    setRadarData(cats.map(([cat, rev]) => {
      const catUnits = skuArr.filter(s => s.cat === cat).reduce((s, x) => s + x.units, 0)
      return { cat: cat.slice(0, 12), revenue: Math.round(rev / maxRev * 100), units: Math.min(100, catUnits) }
    }))

    setLoading(false)
  }

  const PRESET = [
    { label: '30d', days: 30 }, { label: '90d', days: 90 },
    { label: '6m', days: 180 }, { label: '1y', days: 365 }, { label: 'All', days: 0 },
  ]

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-6">

          {/* Header */}
          <div className="page-header">
            <div>
              <h1 className="page-title">Charts & Visualisations</h1>
              <p className="text-sm text-slate-500 mt-0.5">Visual overview of your business performance</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex bg-white border border-slate-200 rounded-lg overflow-hidden text-xs font-semibold">
                {PRESET.map(p => (
                  <button key={p.label} onClick={() => setDays(p.days)}
                    className={`px-3 py-1.5 transition-colors ${days === p.days ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <button onClick={load} disabled={loading} className="btn-secondary btn-sm">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {loading ? <PageLoader /> : (
            <>
              {/* KPI row */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Revenue', value: formatCurrency(kpis.revenue), color: 'text-indigo-700', bg: 'bg-indigo-50', icon: '₹' },
                  { label: 'Invoices Generated', value: kpis.invoices.toString(), color: 'text-emerald-700', bg: 'bg-emerald-50', icon: '🧾' },
                  { label: 'Avg Order Value', value: formatCurrency(kpis.avgOrder), color: 'text-amber-700', bg: 'bg-amber-50', icon: '📊' },
                  { label: 'Order Fill Rate', value: `${kpis.fillRate}%`, color: kpis.fillRate >= 90 ? 'text-emerald-700' : 'text-orange-600', bg: 'bg-slate-50', icon: '📦' },
                ].map(k => (
                  <div key={k.label} className={`card p-5 ${k.bg}`}>
                    <div className="text-2xl mb-1">{k.icon}</div>
                    <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
                    <div className="text-xs text-slate-500 mt-1 font-medium">{k.label}</div>
                  </div>
                ))}
              </div>

              {/* Revenue area chart */}
              {revenueArea.length > 0 && (
                <div className="card">
                  <div className="card-header">
                    <h3 className="font-semibold text-slate-800">Revenue Over Time (weekly)</h3>
                    <span className="text-xs text-slate-400">{revenueArea.length} weeks</span>
                  </div>
                  <div className="card-body">
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={revenueArea}>
                        <defs>
                          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                        <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => formatCurrency(v)} />
                        <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} fill="url(#revGrad)" name="Revenue" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Top movers + Slow movers */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {topSkuBar.length > 0 && (
                  <div className="card">
                    <div className="card-header">
                      <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-emerald-500" /> Top 8 SKUs by Units Sold
                      </h3>
                    </div>
                    <div className="card-body">
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={topSkuBar} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 11 }} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                          <Tooltip {...TOOLTIP_STYLE} />
                          <Bar dataKey="units" name="Units Sold" radius={[0,4,4,0]}>
                            {topSkuBar.map((_, i) => <Cell key={i} fill={C[i % C.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {slowSkuBar.length > 0 && (
                  <div className="card">
                    <div className="card-header">
                      <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <TrendingDown className="w-4 h-4 text-red-500" /> Slow Movers (least units)
                      </h3>
                    </div>
                    <div className="card-body">
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={slowSkuBar} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 11 }} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                          <Tooltip {...TOOLTIP_STYLE} />
                          <Bar dataKey="units" name="Units Sold" fill="#ef4444" radius={[0,4,4,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>

              {/* Pies row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {categoryPie.length > 0 && (
                  <div className="card lg:col-span-2">
                    <div className="card-header"><h3 className="font-semibold text-slate-800">Revenue by Product Category</h3></div>
                    <div className="card-body flex items-center gap-6">
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={categoryPie} dataKey="value" nameKey="name" cx="50%" cy="50%"
                            outerRadius={80} innerRadius={40}
                            label={({ name, percent }) => `${name.slice(0,12)} ${(percent*100).toFixed(0)}%`}
                            labelLine={false}>
                            {categoryPie.map((_, i) => <Cell key={i} fill={C[i % C.length]} />)}
                          </Pie>
                          <Tooltip {...TOOLTIP_STYLE} formatter={(v: any) => formatCurrency(v)} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Fill rate donut */}
                <div className="card">
                  <div className="card-header"><h3 className="font-semibold text-slate-800">Order Fill Rate</h3></div>
                  <div className="card-body flex flex-col items-center justify-center gap-3">
                    <div className="relative flex items-center justify-center">
                      <ResponsiveContainer width={160} height={160}>
                        <PieChart>
                          <Pie dataKey="value" startAngle={90} endAngle={-270}
                            data={[
                              { name: 'Packed', value: fillRateGauge.packed },
                              { name: 'Unavailable', value: fillRateGauge.unavail },
                            ]}
                            cx="50%" cy="50%" innerRadius={52} outerRadius={72}>
                            <Cell fill="#10b981" />
                            <Cell fill="#fee2e2" />
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute text-center">
                        <div className="text-2xl font-bold text-emerald-600">{fillRateGauge.pct}%</div>
                        <div className="text-xs text-slate-500">filled</div>
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 text-center space-y-1">
                      <div><span className="text-emerald-600 font-semibold">{fillRateGauge.packed}</span> packed</div>
                      <div><span className="text-red-500 font-semibold">{fillRateGauge.unavail}</span> unavailable</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* SO Funnel */}
              {soFunnel.length > 0 && (
                <div className="card">
                  <div className="card-header">
                    <h3 className="font-semibold text-slate-800">Sales Order Flow (All time)</h3>
                    <span className="text-xs text-slate-400">Count of SOs at each stage</span>
                  </div>
                  <div className="card-body">
                    <ResponsiveContainer width="100%" height={200}>
                      <FunnelChart>
                        <Tooltip {...TOOLTIP_STYLE} />
                        <Funnel dataKey="value" data={soFunnel} isAnimationActive>
                          <LabelList position="center" fill="#fff" stroke="none" fontSize={11} fontWeight={600}
                            formatter={(v: any, entry: any) => `${entry?.name ?? ''}: ${v}`} />
                        </Funnel>
                      </FunnelChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Stock ageing bar */}
              {ageBuckets.length > 0 && (
                <div className="card">
                  <div className="card-header">
                    <h3 className="font-semibold text-slate-800">Stock Ageing (units by age bucket)</h3>
                    <span className="text-xs text-slate-400">Older stock = higher risk</span>
                  </div>
                  <div className="card-body">
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={ageBuckets}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip {...TOOLTIP_STYLE} />
                        <Bar dataKey="units" name="Units in Stock" radius={[4,4,0,0]}>
                          {ageBuckets.map((b, i) => {
                            const colors = ['#10b981','#f59e0b','#f97316','#ef4444']
                            return <Cell key={i} fill={colors[i] ?? '#6366f1'} />
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Radar chart — category performance */}
              {radarData.length > 2 && (
                <div className="card">
                  <div className="card-header">
                    <h3 className="font-semibold text-slate-800">Category Performance Radar</h3>
                    <span className="text-xs text-slate-400">Revenue & units — normalised to 100</span>
                  </div>
                  <div className="card-body flex justify-center">
                    <ResponsiveContainer width="100%" height={280}>
                      <RadarChart data={radarData}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="cat" tick={{ fontSize: 11 }} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                        <Radar name="Revenue" dataKey="revenue" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
                        <Radar name="Units" dataKey="units" stroke="#10b981" fill="#10b981" fillOpacity={0.25} />
                        <Legend />
                        <Tooltip {...TOOLTIP_STYLE} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {revenueArea.length === 0 && topSkuBar.length === 0 && (
                <div className="card p-16 text-center text-slate-400">
                  <p className="text-lg mb-1">No data yet</p>
                  <p className="text-sm">Charts will appear once you have invoices in the system.</p>
                </div>
              )}
            </>
          )}
        </div>
      </PageGuard>
    </AppLayout>
  )
}

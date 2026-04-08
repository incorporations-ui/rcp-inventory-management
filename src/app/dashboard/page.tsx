'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, StatusBadge, PageLoader } from '@/components/ui'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import {
  Package2, ShoppingCart, FileText, AlertTriangle,
  TrendingUp, Boxes, Clock, CheckCircle2, ArrowRight
} from 'lucide-react'
import Link from 'next/link'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface DashStats {
  totalSKUs: number
  totalStock: number
  pendingPOs: number
  pendingSOs: number
  pendingPacking: number
  lowStockItems: number
  todaySOs: number
  pendingStocking: number
}

export default function DashboardPage() {
  const { profile } = useAuth()
  const [stats, setStats] = useState<DashStats | null>(null)
  const [recentSOs, setRecentSOs] = useState<any[]>([])
  const [recentGRNs, setRecentGRNs] = useState<any[]>([])
  const [ageingData, setAgeingData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => { loadDashboard() }, [])

  async function loadDashboard() {
    setLoading(true)
    const [
      { count: skuCount },
      { data: stockData },
      { count: pendingPOs },
      { count: pendingSOs },
      { count: pendingPacking },
      { count: pendingStocking },
      { data: soData },
      { data: grnData },
    ] = await Promise.all([
      supabase.from('skus').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('stock_master').select('total_units, available_units'),
      supabase.from('purchase_orders').select('*', { count: 'exact', head: true }).in('status', ['draft', 'approved']),
      supabase.from('sales_orders').select('*', { count: 'exact', head: true }).in('status', ['draft', 'approved', 'proforma_sent']),
      supabase.from('packing_lists').select('*', { count: 'exact', head: true }).in('status', ['pending', 'in_progress']),
      supabase.from('grn_stocking_queue').select('*', { count: 'exact', head: true }).in('status', ['pending', 'partial']),
      supabase.from('sales_orders').select('id, so_number, status, grand_total, created_at, customers(name)').order('created_at', { ascending: false }).limit(5),
      supabase.from('grns').select('id, grn_number, status, created_at, purchase_orders(po_number, suppliers(name))').order('created_at', { ascending: false }).limit(5),
    ])

    const totalStock = stockData?.reduce((s, r) => s + (r.total_units || 0), 0) ?? 0
    const lowStock = stockData?.filter(r => (r.available_units ?? 0) < 5).length ?? 0

    setStats({
      totalSKUs: skuCount ?? 0,
      totalStock,
      pendingPOs: pendingPOs ?? 0,
      pendingSOs: pendingSOs ?? 0,
      pendingPacking: pendingPacking ?? 0,
      lowStockItems: lowStock,
      todaySOs: soData?.filter(s => s.created_at?.startsWith(new Date().toISOString().split('T')[0])).length ?? 0,
      pendingStocking: pendingStocking ?? 0,
    })
    setRecentSOs(soData ?? [])
    setRecentGRNs(grnData ?? [])

    // Ageing buckets from view
    const { data: ageing } = await supabase.from('stock_ageing').select('age_bucket, remaining_units, stock_value')
    if (ageing) {
      const buckets: Record<string, { units: number; value: number }> = {}
      ageing.forEach(r => {
        if (!buckets[r.age_bucket]) buckets[r.age_bucket] = { units: 0, value: 0 }
        buckets[r.age_bucket].units += r.remaining_units
        buckets[r.age_bucket].value += Number(r.stock_value)
      })
      setAgeingData(Object.entries(buckets).map(([name, d]) => ({ name, ...d })))
    }

    setLoading(false)
  }

  if (loading) return <AppLayout><PageGuard><PageLoader /></PageGuard></AppLayout>

  const statCards = [
    { label: 'Active SKUs', value: stats?.totalSKUs ?? 0, icon: Package2, color: 'bg-brand-50 text-brand-600', href: '/masters/skus' },
    { label: 'Total Stock Units', value: stats?.totalStock?.toLocaleString('en-IN') ?? 0, icon: Boxes, color: 'bg-emerald-50 text-emerald-600', href: '/inventory/stock' },
    { label: 'Pending SOs', value: stats?.pendingSOs ?? 0, icon: FileText, color: 'bg-amber-50 text-amber-600', href: '/sales/orders' },
    { label: 'Pending POs', value: stats?.pendingPOs ?? 0, icon: ShoppingCart, color: 'bg-blue-50 text-blue-600', href: '/purchases/orders' },
    { label: 'Packing Pending', value: stats?.pendingPacking ?? 0, icon: Clock, color: 'bg-orange-50 text-orange-600', href: '/sales/packing' },
    { label: 'Stocking Queue', value: stats?.pendingStocking ?? 0, icon: TrendingUp, color: 'bg-purple-50 text-purple-600', href: '/purchases/stocking' },
    { label: 'Low Stock Items', value: stats?.lowStockItems ?? 0, icon: AlertTriangle, color: 'bg-red-50 text-red-600', href: '/inventory/stock' },
    { label: "Today's SOs", value: stats?.todaySOs ?? 0, icon: CheckCircle2, color: 'bg-teal-50 text-teal-600', href: '/sales/orders' },
  ]

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-6">
          {/* Header */}
          <div>
            <h1 className="page-title">Good {getGreeting()}, {profile?.full_name?.split(' ')[0]}</h1>
            <p className="text-sm text-slate-500 mt-0.5">Here's what's happening at RCP today</p>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {statCards.map(card => (
              <Link key={card.label} href={card.href} className="stat-card hover:shadow-md transition-shadow group">
                <div className="flex items-start justify-between">
                  <div className={`w-9 h-9 rounded-lg ${card.color} flex items-center justify-center`}>
                    <card.icon className="w-4.5 h-4.5" />
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </div>
                <div className="stat-value">{card.value}</div>
                <div className="stat-label">{card.label}</div>
              </Link>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Sales Orders */}
            <div className="card">
              <div className="card-header">
                <h3>Recent Sales Orders</h3>
                <Link href="/sales/orders" className="text-xs text-brand-600 hover:underline">View all →</Link>
              </div>
              <div className="divide-y divide-slate-100">
                {recentSOs.length === 0 ? (
                  <p className="text-center text-slate-400 text-sm py-8">No sales orders yet</p>
                ) : recentSOs.map(so => (
                  <div key={so.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{so.so_number}</p>
                      <p className="text-xs text-slate-500">{(so.customers as any)?.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{formatCurrency(so.grand_total)}</p>
                      <StatusBadge status={so.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent GRNs */}
            <div className="card">
              <div className="card-header">
                <h3>Recent GRNs</h3>
                <Link href="/purchases/grn" className="text-xs text-brand-600 hover:underline">View all →</Link>
              </div>
              <div className="divide-y divide-slate-100">
                {recentGRNs.length === 0 ? (
                  <p className="text-center text-slate-400 text-sm py-8">No GRNs yet</p>
                ) : recentGRNs.map(grn => (
                  <div key={grn.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{grn.grn_number}</p>
                      <p className="text-xs text-slate-500">{(grn.purchase_orders as any)?.suppliers?.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">{(grn.purchase_orders as any)?.po_number}</p>
                      <StatusBadge status={grn.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Stock ageing chart */}
          {ageingData.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3>Stock Ageing Overview</h3>
                <Link href="/inventory/ageing" className="text-xs text-brand-600 hover:underline">Full report →</Link>
              </div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={ageingData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v: any, name: string) => [
                      name === 'value' ? formatCurrency(v) : v,
                      name === 'value' ? 'Stock Value' : 'Units'
                    ]} />
                    <Bar dataKey="units" fill="#6366f1" radius={[4, 4, 0, 0]} name="units" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </PageGuard>
    </AppLayout>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

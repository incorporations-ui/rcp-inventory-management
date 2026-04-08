'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, StatusBadge, PageLoader, SearchInput } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { Eye, PackageSearch } from 'lucide-react'

export default function PackingListsPage() {
  const [lists, setLists] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data } = await supabase
      .from('packing_lists')
      .select('*, sales_orders(so_number, customers(name)), packing_list_lines(status)')
      .order('created_at', { ascending: false })
    setLists(data ?? [])
    setLoading(false)
  }

  const filtered = lists.filter(pl =>
    pl.pl_number?.toLowerCase().includes(search.toLowerCase()) ||
    pl.sales_orders?.so_number?.toLowerCase().includes(search.toLowerCase()) ||
    pl.sales_orders?.customers?.name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-4">
          <div className="page-header">
            <div>
              <h1 className="page-title">Packing Lists</h1>
              <p className="text-sm text-slate-500 mt-0.5">{filtered.length} lists</p>
            </div>
            <SearchInput value={search} onChange={setSearch} />
          </div>

          {loading ? <PageLoader /> : (
            <div className="card">
              <div className="table-wrapper">
                <table>
                  <thead><tr>
                    <th>PL #</th><th>SO #</th><th>Customer</th><th>Date</th>
                    <th>Lines</th><th>Packed</th><th>Unavailable</th><th>Status</th><th className="text-right">Actions</th>
                  </tr></thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={9} className="text-center py-12 text-slate-400">No packing lists found</td></tr>
                    ) : filtered.map(pl => {
                      const lineArr = pl.packing_list_lines as any[] ?? []
                      const packed = lineArr.filter(l => l.status === 'packed').length
                      const unavail = lineArr.filter(l => l.status === 'unavailable').length
                      return (
                        <tr key={pl.id}>
                          <td><span className="font-mono text-sm font-medium text-brand-700">{pl.pl_number}</span></td>
                          <td><span className="font-mono text-xs text-slate-500">{pl.sales_orders?.so_number}</span></td>
                          <td className="font-medium">{pl.sales_orders?.customers?.name}</td>
                          <td className="text-sm">{formatDate(pl.created_at)}</td>
                          <td className="text-center">{lineArr.length}</td>
                          <td className="text-center text-emerald-700 font-medium">{packed}</td>
                          <td className="text-center text-red-600 font-medium">{unavail}</td>
                          <td><StatusBadge status={pl.status} /></td>
                          <td><div className="flex justify-end"><Link href={`/sales/packing/${pl.id}`} className="btn-ghost btn-sm"><Eye className="w-4 h-4" /></Link></div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </PageGuard>
    </AppLayout>
  )
}

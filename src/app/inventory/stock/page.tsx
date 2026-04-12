'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, PageLoader, SearchInput } from '@/components/ui'
import { formatCurrency, exportToCSV } from '@/lib/utils'
import { Download, MapPin } from 'lucide-react'

export default function StockMasterPage() {
  const [stock, setStock] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data } = await supabase
      .from('sku_stock_locations')
      .select('*')
      .order('display_name')
    setStock(data ?? [])
    setLoading(false)
  }

  function handleExport() {
    exportToCSV(stock.map(s => ({
      SKU_Code: s.sku_code, Name: s.display_name,
      Total_Units: s.total_units ?? 0, Reserved: s.reserved_units ?? 0,
      Available: s.available_units ?? 0,
    })), 'stock_master')
  }

  const filtered = stock.filter(s =>
    s.sku_code?.toLowerCase().includes(search.toLowerCase()) ||
    s.display_name?.toLowerCase().includes(search.toLowerCase())
  )

  const totalAvailable = stock.reduce((s, r) => s + (r.available_units ?? 0), 0)

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-4">
          <div className="page-header">
            <div>
              <h1 className="page-title">Stock Master</h1>
              <p className="text-sm text-slate-500 mt-0.5">{filtered.length} SKUs · {stock.reduce((s, r) => s + (r.available_units ?? 0), 0).toLocaleString('en-IN')} units available</p>
            </div>
            <div className="flex items-center gap-2">
              <SearchInput value={search} onChange={setSearch} />
              <button onClick={handleExport} className="btn-secondary btn-sm"><Download className="w-4 h-4" /> Export</button>
            </div>
          </div>

          {loading ? <PageLoader /> : (
            <div className="card">
              <div className="table-wrapper">
                <table>
                  <thead><tr>
                    <th>SKU Code</th><th>Product Name</th><th className="text-right">Total</th>
                    <th className="text-right">Reserved</th><th className="text-right">Available</th>
                    <th>Rack Locations</th>
                  </tr></thead>
                  <tbody>
                    {filtered.map(s => (
                      <tr key={s.sku_id} className={(s.available_units ?? 0) === 0 ? 'bg-red-50/40' : (s.available_units ?? 0) < 5 ? 'bg-amber-50/40' : ''}>
                        <td><code className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">{s.sku_code}</code></td>
                        <td className="font-medium max-w-xs truncate">{s.display_name}</td>
                        <td className="text-right font-mono">{(s.total_units ?? 0).toLocaleString('en-IN')}</td>
                        <td className="text-right font-mono text-amber-600">{(s.reserved_units ?? 0).toLocaleString('en-IN')}</td>
                        <td className={`text-right font-mono font-bold ${(s.available_units ?? 0) === 0 ? 'text-red-600' : (s.available_units ?? 0) < 5 ? 'text-amber-600' : 'text-emerald-700'}`}>
                          {(s.available_units ?? 0).toLocaleString('en-IN')}
                        </td>
                        <td>
                          {s.rack_locations ? (
                            <div className="flex flex-wrap gap-1">
                              {JSON.parse(JSON.stringify(s.rack_locations)).slice(0, 3).map((rl: any) => (
                                <span key={rl.rack_id} className="badge bg-brand-50 text-brand-700 font-mono text-xs flex items-center gap-1">
                                  <MapPin className="w-2.5 h-2.5" />{rl.rack_display} ({rl.units}u)
                                </span>
                              ))}
                            </div>
                          ) : <span className="text-slate-300 text-xs">Not stocked</span>}
                        </td>
                      </tr>
                    ))}
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

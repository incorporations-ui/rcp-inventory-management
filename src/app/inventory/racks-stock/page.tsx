'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, PageLoader, SearchInput } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { Warehouse } from 'lucide-react'

export default function RacksStockPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: rs } = await supabase
      .from('rack_stock')
      .select('*, racks(rack_id_display, rack_no, column_no, row_no), skus(display_name, sku_code), lots(lot_number, received_date, unit_cost)')
      .gt('units_count', 0)
      .order('racks(rack_id_display)')
    setData(rs ?? [])
    setLoading(false)
  }

  const filtered = data.filter(r =>
    r.racks?.rack_id_display?.toLowerCase().includes(search.toLowerCase()) ||
    r.skus?.display_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.skus?.sku_code?.toLowerCase().includes(search.toLowerCase()) ||
    r.lots?.lot_number?.toLowerCase().includes(search.toLowerCase())
  )

  // Group by rack
  const byRack: Record<string, any[]> = {}
  filtered.forEach(r => {
    const key = r.racks?.rack_id_display ?? 'Unknown'
    if (!byRack[key]) byRack[key] = []
    byRack[key].push(r)
  })

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-4">
          <div className="page-header">
            <div>
              <h1 className="page-title">Rack Locations</h1>
              <p className="text-sm text-slate-500 mt-0.5">What is stored where in the godown</p>
            </div>
            <SearchInput value={search} onChange={setSearch} placeholder="Search rack, SKU, lot..." />
          </div>

          {loading ? <PageLoader /> : Object.keys(byRack).length === 0 ? (
            <div className="card">
              <div className="flex flex-col items-center py-16 text-slate-400">
                <Warehouse className="w-12 h-12 mb-3 opacity-30" />
                <p className="font-medium">No items stocked yet</p>
                <p className="text-sm mt-1">Items appear here after GRNs are finalized and lots are stocked to racks</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(byRack).map(([rackId, items]) => (
                <div key={rackId} className="card">
                  <div className="flex items-center gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100">
                    <Warehouse className="w-4 h-4 text-brand-600" />
                    <span className="font-mono font-bold text-brand-700 text-base">{rackId}</span>
                    <span className="text-sm text-slate-500">{items.length} SKU{items.length !== 1 ? 's' : ''} · {items.reduce((s, i) => s + i.units_count, 0)} total units</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {items.map(item => (
                      <div key={item.id} className="flex items-center justify-between px-5 py-3">
                        <div>
                          <p className="font-medium text-sm">{item.skus?.display_name}</p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{item.skus?.sku_code}</code>
                            <span className="text-xs text-slate-400">Lot: {item.lots?.lot_number}</span>
                            <span className="text-xs text-slate-400">Received: {formatDate(item.lots?.received_date)}</span>
                            <span className="text-xs text-slate-400">Cost: ₹{item.lots?.unit_cost}/unit</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-slate-900">{item.units_count} <span className="text-xs font-normal text-slate-500">units</span></p>
                          {item.boxes_count > 0 && <p className="text-xs text-slate-400">{item.boxes_count} boxes</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PageGuard>
    </AppLayout>
  )
}

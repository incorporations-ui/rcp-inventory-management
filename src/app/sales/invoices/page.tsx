'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, PageLoader, SearchInput, StatusBadge, ConfirmDialog } from '@/components/ui'
import { formatCurrency, formatDate, exportToCSV } from '@/lib/utils'
import { Truck, Download, Eye, Printer } from 'lucide-react'
import toast from 'react-hot-toast'

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dispatchItem, setDispatchItem] = useState<any>(null)
  const [dispatching, setDispatching] = useState(false)
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data } = await supabase
      .from('invoices')
      .select('*, customers(name, customer_type), sales_orders(so_number)')
      .order('created_at', { ascending: false })
    setInvoices(data ?? [])
    setLoading(false)
  }

  async function markDispatched(inv: any) {
    setDispatching(true)
    await supabase.from('invoices').update({
      dispatch_status: 'dispatched', dispatched_at: new Date().toISOString()
    }).eq('id', inv.id)
    await supabase.from('sales_orders').update({ status: 'dispatched' }).eq('id', inv.so_id)
    toast.success(`Invoice ${inv.invoice_number} marked as dispatched`)
    setDispatchItem(null); setDispatching(false); loadData()
  }

  function handleExport() {
    exportToCSV(invoices.map(i => ({
      Invoice_No: i.invoice_number, SO_No: i.sales_orders?.so_number,
      Customer: i.customers?.name, Date: i.invoice_date,
      Subtotal: i.subtotal, GST: i.total_gst, Grand_Total: i.grand_total,
      Payment: i.payment_status, Dispatch: i.dispatch_status,
    })), 'invoices')
  }

  const filtered = invoices.filter(i =>
    i.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
    i.customers?.name?.toLowerCase().includes(search.toLowerCase()) ||
    i.sales_orders?.so_number?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-4">
          <div className="page-header">
            <div>
              <h1 className="page-title">Invoices</h1>
              <p className="text-sm text-slate-500 mt-0.5">{filtered.length} invoices · Total: {formatCurrency(filtered.reduce((s, i) => s + Number(i.grand_total), 0))}</p>
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
                    <th>Invoice #</th><th>SO #</th><th>Customer</th><th>Date</th>
                    <th className="text-right">Subtotal</th><th className="text-right">GST</th>
                    <th className="text-right">Total</th><th>Payment</th><th>Dispatch</th>
                    <th className="text-right">Actions</th>
                  </tr></thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={10} className="text-center py-12 text-slate-400">No invoices yet</td></tr>
                    ) : filtered.map(inv => (
                      <tr key={inv.id}>
                        <td><span className="font-mono text-sm font-bold text-brand-700">{inv.invoice_number}</span></td>
                        <td><span className="font-mono text-xs text-slate-500">{inv.sales_orders?.so_number}</span></td>
                        <td>
                          <div>
                            <p className="font-medium text-sm">{inv.customers?.name}</p>
                            <p className="text-xs text-slate-400 capitalize">{inv.customers?.customer_type}</p>
                          </div>
                        </td>
                        <td className="text-sm">{formatDate(inv.invoice_date)}</td>
                        <td className="text-right font-mono text-sm">{formatCurrency(inv.subtotal)}</td>
                        <td className="text-right font-mono text-sm text-slate-500">{formatCurrency(inv.total_gst)}</td>
                        <td className="text-right font-bold">{formatCurrency(inv.grand_total)}</td>
                        <td><StatusBadge status={inv.payment_status} /></td>
                        <td><StatusBadge status={inv.dispatch_status} /></td>
                        <td>
                          <div className="flex justify-end gap-1">
                            {inv.dispatch_status === 'ready' && (
                              <button onClick={() => setDispatchItem(inv)} className="btn-primary btn-sm">
                                <Truck className="w-3.5 h-3.5" /> Dispatch
                              </button>
                            )}
                            <button onClick={() => window.print()} className="btn-ghost btn-sm"><Printer className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <ConfirmDialog
          open={!!dispatchItem}
          onClose={() => setDispatchItem(null)}
          onConfirm={() => dispatchItem && markDispatched(dispatchItem)}
          title="Mark as Dispatched"
          message={`Confirm that Invoice ${dispatchItem?.invoice_number} has been physically dispatched to ${dispatchItem?.customers?.name}?`}
          confirmLabel="Confirm Dispatch"
          loading={dispatching}
        />
      </PageGuard>
    </AppLayout>
  )
}

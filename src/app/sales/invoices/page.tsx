'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, PageLoader, SearchInput, StatusBadge, ConfirmDialog, Modal } from '@/components/ui'
import { formatCurrency, formatDate, exportToCSV } from '@/lib/utils'
import { generateAndPrintPDF } from '@/lib/pdfGen'
import { Truck, Download, Printer, XCircle, FileText, StickyNote } from 'lucide-react'
import toast from 'react-hot-toast'

export default function InvoicesPage() {
  const supabase = createClient()
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dispatchItem, setDispatchItem] = useState<any>(null)
  const [dispatching, setDispatching] = useState(false)
  const [voidItem, setVoidItem] = useState<any>(null)
  const [voiding, setVoiding] = useState(false)
  const [printing, setPrinting] = useState<string | null>(null)
  // Notes modal
  const [notesModal, setNotesModal] = useState<any>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data } = await supabase
      .from('invoices')
      .select('*, customers(name, customer_type, gstin, address_line1, city, state), sales_orders(so_number, proforma_number)')
      .order('created_at', { ascending: false })
    setInvoices(data ?? [])
    setLoading(false)
  }

  async function markDispatched(inv: any) {
    setDispatching(true)
    await supabase.from('invoices').update({ dispatch_status: 'dispatched', dispatched_at: new Date().toISOString() }).eq('id', inv.id)
    await supabase.from('sales_orders').update({ status: 'dispatched' }).eq('id', inv.so_id)
    toast.success(`Invoice ${inv.invoice_number} marked as dispatched`)
    setDispatchItem(null); setDispatching(false); loadData()
  }

  async function voidInvoice(inv: any) {
    if (inv.dispatch_status === 'dispatched') { toast.error('Cannot void a dispatched invoice. Raise a Sales Return instead.'); setVoidItem(null); return }
    setVoiding(true)
    try {
      const { data: lines } = await supabase.from('invoice_lines').select('sku_id, units').eq('invoice_id', inv.id)
      for (const line of lines ?? []) {
        await supabase.rpc('update_stock_master', { p_sku_id: line.sku_id, p_delta: line.units })
          .then(({ error }) => { if (error) console.warn('Stock restore warning:', error.message) })
      }
      await supabase.from('invoices').update({ dispatch_status: 'voided', payment_status: 'voided' }).eq('id', inv.id)
      if (inv.packing_list_id) await supabase.from('packing_lists').update({ status: 'finalized' }).eq('id', inv.packing_list_id)
      await supabase.from('sales_orders').update({ status: 'approved' }).eq('id', inv.so_id)
      toast.success(`Invoice ${inv.invoice_number} voided. Regenerate from the Packing List.`)
      setVoidItem(null); loadData()
    } catch (e: any) { toast.error(e.message) }
    finally { setVoiding(false) }
  }

  async function saveNotes() {
    if (!notesModal) return
    setSavingNotes(true)
    const { error } = await supabase.from('invoices').update({ notes: notesDraft || null }).eq('id', notesModal.id)
    if (error) toast.error(error.message)
    else { toast.success('Notes saved'); loadData() }
    setNotesModal(null); setSavingNotes(false)
  }

  async function printInvoice(inv: any) {
    setPrinting(inv.id)
    try {
      const { data: lines } = await supabase.from('invoice_lines').select('*, skus(display_name, sku_code, hsn_code)').eq('invoice_id', inv.id).order('id')
      generateAndPrintPDF({
        docType: 'TAX_INVOICE', docNumber: inv.invoice_number,
        docDate: formatDate(inv.invoice_date), soNumber: inv.sales_orders?.so_number,
        customer: { name: inv.customers?.name, address_line1: inv.customers?.address_line1, city: inv.customers?.city, state: inv.customers?.state, gstin: inv.customers?.gstin },
        lines: (lines ?? []).map((l: any) => {
          const unitPrice = Number(l.unit_price)
          const gstRate = Number(l.gst_rate)
          const lineAmt = +(l.units * unitPrice).toFixed(2)
          const lineGst = +(lineAmt * gstRate / 100).toFixed(2)
          return {
            description: l.skus?.display_name ?? l.skus?.sku_code ?? '—', sku_code: l.skus?.sku_code,
            hsn_code: l.skus?.hsn_code ?? '', qty: l.units, unit_price: unitPrice,
            gst_rate: gstRate, line_amount: lineAmt, line_gst: lineGst,
          }
        }),
        subtotal: Number(inv.subtotal), totalGst: Number(inv.total_gst), grandTotal: Number(inv.grand_total),
        notes: inv.notes,
      })
    } catch (e: any) { toast.error('PDF error: ' + e.message) }
    finally { setPrinting(null) }
  }

  function handleExport() {
    exportToCSV(invoices.map(i => ({
      Invoice_No: i.invoice_number, SO_No: i.sales_orders?.so_number, Customer: i.customers?.name,
      Date: i.invoice_date, Subtotal: i.subtotal, GST: i.total_gst, Grand_Total: i.grand_total,
      Payment: i.payment_status, Dispatch: i.dispatch_status, Notes: i.notes ?? '',
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
                      <tr key={inv.id} className={inv.dispatch_status === 'voided' ? 'opacity-50' : ''}>
                        <td>
                          <div>
                            <span className="font-mono text-sm font-bold text-brand-700">{inv.invoice_number}</span>
                            {inv.notes && <p className="text-xs text-slate-400 mt-0.5 truncate max-w-32" title={inv.notes}>📝 {inv.notes}</p>}
                          </div>
                        </td>
                        <td><span className="font-mono text-xs text-slate-500">{inv.sales_orders?.so_number}</span></td>
                        <td>
                          <p className="font-medium text-sm">{inv.customers?.name}</p>
                          <p className="text-xs text-slate-400 capitalize">{inv.customers?.customer_type}</p>
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
                            <button onClick={() => { setNotesModal(inv); setNotesDraft(inv.notes ?? '') }} className="btn-ghost btn-sm" title="Add / Edit Notes">
                              <StickyNote className="w-4 h-4 text-slate-400" />
                            </button>
                            {!['dispatched', 'voided'].includes(inv.dispatch_status) && (
                              <button onClick={() => setVoidItem(inv)} className="btn-ghost btn-sm text-red-500 hover:bg-red-50" title="Void Invoice">
                                <XCircle className="w-4 h-4" />
                              </button>
                            )}
                            {inv.dispatch_status !== 'voided' && (
                              <button onClick={() => printInvoice(inv)} disabled={printing === inv.id} className="btn-ghost btn-sm" title="Print / Save PDF">
                                <Printer className={`w-4 h-4 ${printing === inv.id ? 'animate-pulse' : ''}`} />
                              </button>
                            )}
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

        <ConfirmDialog open={!!dispatchItem} onClose={() => setDispatchItem(null)} onConfirm={() => dispatchItem && markDispatched(dispatchItem)} title="Mark as Dispatched" message={`Confirm dispatch of Invoice ${dispatchItem?.invoice_number} to ${dispatchItem?.customers?.name}?`} confirmLabel="Confirm Dispatch" loading={dispatching} />
        <ConfirmDialog open={!!voidItem} onClose={() => setVoidItem(null)} onConfirm={() => voidItem && voidInvoice(voidItem)} title="Void Invoice" message={`Void Invoice ${voidItem?.invoice_number}? Stock will be restored and SO reverted to Approved.`} confirmLabel="Void Invoice" danger loading={voiding} />

        {/* Notes modal */}
        <Modal open={!!notesModal} onClose={() => setNotesModal(null)} title={`Notes — ${notesModal?.invoice_number}`} size="sm">
          <div className="space-y-3">
            <textarea value={notesDraft} onChange={e => setNotesDraft(e.target.value)} rows={4} className="input w-full" placeholder="Add notes, payment terms, special instructions..." />
            <div className="flex justify-end gap-2">
              <button onClick={() => setNotesModal(null)} className="btn-secondary btn-sm">Cancel</button>
              <button onClick={saveNotes} disabled={savingNotes} className="btn-primary btn-sm">{savingNotes ? 'Saving...' : 'Save Notes'}</button>
            </div>
          </div>
        </Modal>
      </PageGuard>
    </AppLayout>
  )
}

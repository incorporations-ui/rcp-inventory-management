'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, Modal, FormField, StatusBadge, PageLoader, EmptyState, SearchInput, ConfirmDialog } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { formatCurrency, formatDate, canEdit } from '@/lib/utils'
import type { SalesOrder, Customer, SKU } from '@/types'
import { Plus, Trash2, Eye, CheckCircle, FileText, Printer } from 'lucide-react'
import toast from 'react-hot-toast'

interface SOLine { sku_id: string; ordered_boxes: number; ordered_units: number; unit_price: number; gst_rate: number; sku?: SKU }

export default function SalesOrdersPage() {
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [skus, setSkus] = useState<SKU[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [viewOrder, setViewOrder] = useState<SalesOrder | null>(null)
  const [approveItem, setApproveItem] = useState<SalesOrder | null>(null)
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  // Form state
  const [customerId, setCustomerId] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<SOLine[]>([{ sku_id: '', ordered_boxes: 0, ordered_units: 0, unit_price: 0, gst_rate: 18 }])
  const { profile } = useAuth()
  const supabase = createClient()
  const canWrite = canEdit(profile?.role ?? '', 'sales')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [{ data: sos }, { data: custs }, { data: skuList }] = await Promise.all([
      supabase.from('sales_orders').select('*, customers(name, customer_type)').order('created_at', { ascending: false }),
      supabase.from('customers').select('*').eq('status', 'active').order('name'),
      supabase.from('skus').select('*, brands(name)').eq('status', 'active').order('display_name'),
    ])
    setOrders(sos ?? [])
    setCustomers(custs ?? [])
    setSkus(skuList ?? [])
    setLoading(false)
  }

  function addLine() {
    setLines(l => [...l, { sku_id: '', ordered_boxes: 0, ordered_units: 0, unit_price: 0, gst_rate: 18 }])
  }

  function removeLine(i: number) {
    setLines(l => l.filter((_, idx) => idx !== i))
  }

  function updateLine(i: number, field: keyof SOLine, value: any) {
    setLines(l => l.map((line, idx) => {
      if (idx !== i) return line
      const updated = { ...line, [field]: value }
      if (field === 'sku_id') {
        const sku = skus.find(s => s.id === value)
        updated.gst_rate = sku?.gst_rate ?? 18
        updated.sku = sku
      }
      if (field === 'ordered_boxes') {
        const sku = skus.find(s => s.id === updated.sku_id)
        updated.ordered_units = Number(value) * (sku?.units_per_box ?? 1)
      }
      return updated
    }))
  }

  const subtotal = lines.reduce((s, l) => s + (l.ordered_units * l.unit_price), 0)
  const totalGST = lines.reduce((s, l) => s + (l.ordered_units * l.unit_price * l.gst_rate / 100), 0)
  const grandTotal = subtotal + totalGST

  async function saveSO() {
    if (!customerId) { toast.error('Select a customer'); return }
    if (lines.some(l => !l.sku_id)) { toast.error('All lines must have a SKU selected'); return }
    setSaving(true)

    // Get next SO and PI numbers
    const { data: soNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'SO' })
    const { data: piNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'PI' })

    const { data: so, error } = await supabase.from('sales_orders').insert({
      so_number: soNum, proforma_number: piNum, proforma_date: new Date().toISOString().split('T')[0],
      customer_id: customerId, delivery_address: deliveryAddress || null, notes: notes || null,
      total_amount: subtotal, total_gst: totalGST, grand_total: grandTotal,
      status: 'proforma_sent', created_by: profile?.id,
    }).select().single()

    if (error || !so) { toast.error(error?.message ?? 'Failed to create SO'); setSaving(false); return }

    const lineRows = lines.map((l, i) => ({
      so_id: so.id, sku_id: l.sku_id,
      ordered_boxes: l.ordered_boxes, ordered_units: l.ordered_units,
      unit_price: l.unit_price, gst_rate: l.gst_rate, sort_order: i,
    }))

    await supabase.from('so_lines').insert(lineRows)
    toast.success(`Sales Order ${soNum} created with Proforma ${piNum}`)
    setModalOpen(false)
    resetForm()
    loadData()
    setSaving(false)
  }

  function resetForm() {
    setCustomerId(''); setDeliveryAddress(''); setNotes('')
    setLines([{ sku_id: '', ordered_boxes: 0, ordered_units: 0, unit_price: 0, gst_rate: 18 }])
  }

  async function approveSO(so: SalesOrder) {
    setApproving(true)
    // Reserve stock for each line
    const { data: soLines } = await supabase.from('so_lines').select('*').eq('so_id', so.id)

    for (const line of soLines ?? []) {
      // Check available stock
      const { data: sm } = await supabase.from('stock_master').select('available_units').eq('sku_id', line.sku_id).single()
      if ((sm?.available_units ?? 0) < line.ordered_units) {
        const sku = skus.find(s => s.id === line.sku_id)
        toast.error(`Insufficient stock for ${sku?.display_name}. Available: ${sm?.available_units ?? 0}`)
        setApproving(false); return
      }
      await supabase.rpc('reserve_stock', { p_sku_id: line.sku_id, p_units: line.ordered_units })
    }

    // Create packing list
    const { data: plNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'PL' })
    const { data: pl } = await supabase.from('packing_lists').insert({
      pl_number: plNum, so_id: so.id, status: 'pending'
    }).select().single()

    if (pl) {
      const plLines = (soLines ?? []).map(l => ({
        packing_list_id: pl.id, so_line_id: l.id, sku_id: l.sku_id,
        ordered_units: l.ordered_units, status: 'pending'
      }))
      await supabase.from('packing_list_lines').insert(plLines)
    }

    await supabase.from('sales_orders').update({
      status: 'approved', approved_by: profile?.id, approved_at: new Date().toISOString()
    }).eq('id', so.id)

    toast.success(`SO approved. Packing List ${plNum} created.`)
    setApproveItem(null)
    setApproving(false)
    loadData()
  }

  const filtered = orders.filter(o =>
    o.so_number.toLowerCase().includes(search.toLowerCase()) ||
    (o.customer as any)?.name?.toLowerCase().includes(search.toLowerCase()) ||
    (o.customers as any)?.name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-4">
          <div className="page-header">
            <div>
              <h1 className="page-title">Sales Orders</h1>
              <p className="text-sm text-slate-500 mt-0.5">{filtered.length} orders</p>
            </div>
            <div className="flex items-center gap-2">
              <SearchInput value={search} onChange={setSearch} />
              {canWrite && <button onClick={() => { resetForm(); setModalOpen(true) }} className="btn-primary"><Plus className="w-4 h-4" /> New SO</button>}
            </div>
          </div>

          {loading ? <PageLoader /> : (
            <div className="card">
              <div className="table-wrapper">
                <table>
                  <thead><tr>
                    <th>SO #</th><th>Proforma #</th><th>Customer</th><th>Date</th>
                    <th>Amount</th><th>Status</th><th className="text-right">Actions</th>
                  </tr></thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-12 text-slate-400">No sales orders found</td></tr>
                    ) : filtered.map(so => (
                      <tr key={so.id}>
                        <td><span className="font-mono text-sm font-medium text-brand-700">{so.so_number}</span></td>
                        <td><span className="font-mono text-xs text-slate-500">{so.proforma_number ?? '—'}</span></td>
                        <td>
                          <div>
                            <p className="font-medium text-sm">{(so.customers as any)?.name}</p>
                            <p className="text-xs text-slate-400 capitalize">{(so.customers as any)?.customer_type}</p>
                          </div>
                        </td>
                        <td className="text-sm">{formatDate(so.so_date)}</td>
                        <td className="font-semibold">{formatCurrency(so.grand_total)}</td>
                        <td><StatusBadge status={so.status} /></td>
                        <td>
                          <div className="flex justify-end gap-1">
                            <button onClick={() => setViewOrder(so)} className="btn-ghost btn-sm" title="View"><Eye className="w-4 h-4" /></button>
                            {so.status === 'proforma_sent' && canWrite && (
                              <button onClick={() => setApproveItem(so)} className="btn-primary btn-sm">
                                <CheckCircle className="w-3.5 h-3.5" /> Approve
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

        {/* Create SO modal */}
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Sales Order" size="xl">
          <div className="space-y-4">
            <div className="form-grid">
              <FormField label="Customer" required>
                <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="select">
                  <option value="">Select customer...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.customer_type})</option>)}
                </select>
              </FormField>
              <FormField label="Delivery Address">
                <input value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} className="input" placeholder="Optional delivery address" />
              </FormField>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-slate-700">Line Items</h4>
                <button type="button" onClick={addLine} className="btn-ghost btn-sm text-brand-600"><Plus className="w-4 h-4" /> Add Line</button>
              </div>
              <div className="space-y-2">
                {lines.map((line, i) => {
                  const lineAmt = line.ordered_units * line.unit_price
                  const lineGST = lineAmt * line.gst_rate / 100
                  return (
                    <div key={i} className="grid grid-cols-12 gap-2 items-start p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="col-span-4">
                        <select value={line.sku_id} onChange={e => updateLine(i, 'sku_id', e.target.value)} className="select text-xs">
                          <option value="">Select SKU...</option>
                          {skus.map(s => <option key={s.id} value={s.id}>{s.display_name}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <input type="number" value={line.ordered_boxes || ''} onChange={e => updateLine(i, 'ordered_boxes', Number(e.target.value))} className="input text-xs" placeholder="Boxes" min={0} />
                      </div>
                      <div className="col-span-2">
                        <input type="number" value={line.ordered_units || ''} onChange={e => updateLine(i, 'ordered_units', Number(e.target.value))} className="input text-xs" placeholder="Units" min={0} />
                      </div>
                      <div className="col-span-2">
                        <input type="number" value={line.unit_price || ''} onChange={e => updateLine(i, 'unit_price', Number(e.target.value))} className="input text-xs" placeholder="Unit price ₹" min={0} step="0.01" />
                      </div>
                      <div className="col-span-1 text-right pt-2">
                        <p className="text-xs font-medium">{formatCurrency(lineAmt + lineGST)}</p>
                        <p className="text-xs text-slate-400">GST: {line.gst_rate}%</p>
                      </div>
                      <div className="col-span-1 flex justify-end pt-1">
                        {lines.length > 1 && <button type="button" onClick={() => removeLine(i)} className="btn-ghost btn-sm text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Totals */}
            <div className="bg-slate-50 rounded-xl p-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-medium">{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Total GST</span><span className="font-medium">{formatCurrency(totalGST)}</span></div>
              <div className="flex justify-between pt-1.5 border-t border-slate-200"><span className="font-semibold">Grand Total</span><span className="font-bold text-base">{formatCurrency(grandTotal)}</span></div>
            </div>

            <FormField label="Notes">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input" rows={2} placeholder="Optional notes for this order" />
            </FormField>

            <div className="flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={saveSO} className="btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create SO & Generate Proforma'}</button>
            </div>
          </div>
        </Modal>

        {/* Approve confirm */}
        <ConfirmDialog
          open={!!approveItem}
          onClose={() => setApproveItem(null)}
          onConfirm={() => approveItem && approveSO(approveItem)}
          title="Approve Sales Order"
          message={`Approving ${approveItem?.so_number} will reserve stock and auto-generate a Packing List. Are you sure?`}
          confirmLabel="Approve & Create Packing List"
          loading={approving}
        />
      </PageGuard>
    </AppLayout>
  )
}

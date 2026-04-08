'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, Modal, FormField, StatusBadge, PageLoader, SearchInput, ConfirmDialog } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { formatCurrency, formatDate, canEdit } from '@/lib/utils'
import type { PurchaseOrder, Supplier, SKU } from '@/types'
import { Plus, Trash2, Eye, CheckCircle, PackageCheck } from 'lucide-react'
import Link from 'next/link'
import toast from 'react-hot-toast'

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [skus, setSkus] = useState<SKU[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [approveItem, setApproveItem] = useState<PurchaseOrder | null>(null)
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<any[]>([{ sku_id: '', ordered_boxes: 0, ordered_units: 0, unit_price: 0, gst_rate: 18 }])
  const { profile } = useAuth()
  const supabase = createClient()
  const canWrite = canEdit(profile?.role ?? '', 'purchase')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [{ data: pos }, { data: sups }, { data: skuList }] = await Promise.all([
      supabase.from('purchase_orders').select('*, suppliers(name)').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').eq('status', 'active').order('name'),
      supabase.from('skus').select('*, brands(name)').eq('status', 'active').order('display_name'),
    ])
    setOrders(pos ?? [])
    setSuppliers(sups ?? [])
    setSkus(skuList ?? [])
    setLoading(false)
  }

  function addLine() { setLines(l => [...l, { sku_id: '', ordered_boxes: 0, ordered_units: 0, unit_price: 0, gst_rate: 18 }]) }
  function removeLine(i: number) { setLines(l => l.filter((_, idx) => idx !== i)) }
  function updateLine(i: number, field: string, value: any) {
    setLines(l => l.map((line, idx) => {
      if (idx !== i) return line
      const u = { ...line, [field]: value }
      if (field === 'sku_id') { const s = skus.find(s => s.id === value); u.gst_rate = s?.gst_rate ?? 18 }
      if (field === 'ordered_boxes') { const s = skus.find(s => s.id === u.sku_id); u.ordered_units = Number(value) * (s?.units_per_box ?? 1) }
      return u
    }))
  }

  const subtotal = lines.reduce((s, l) => s + (l.ordered_units * l.unit_price), 0)
  const totalGST = lines.reduce((s, l) => s + (l.ordered_units * l.unit_price * l.gst_rate / 100), 0)
  const grandTotal = subtotal + totalGST

  async function savePO() {
    if (!supplierId) { toast.error('Select a supplier'); return }
    if (lines.some(l => !l.sku_id)) { toast.error('All lines need a SKU'); return }
    setSaving(true)
    const { data: poNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'PO' })
    const { data: po, error } = await supabase.from('purchase_orders').insert({
      po_number: poNum, supplier_id: supplierId, notes: notes || null,
      total_amount: subtotal, total_gst: totalGST, grand_total: grandTotal,
      status: 'draft', created_by: profile?.id,
    }).select().single()
    if (error || !po) { toast.error(error?.message ?? 'Failed'); setSaving(false); return }
    await supabase.from('po_lines').insert(lines.map((l, i) => ({
      po_id: po.id, sku_id: l.sku_id, ordered_boxes: l.ordered_boxes,
      ordered_units: l.ordered_units, unit_price: l.unit_price, gst_rate: l.gst_rate, sort_order: i,
    })))
    toast.success(`Purchase Order ${poNum} created`)
    setModalOpen(false); setSupplierId(''); setNotes(''); setLines([{ sku_id: '', ordered_boxes: 0, ordered_units: 0, unit_price: 0, gst_rate: 18 }])
    loadData(); setSaving(false)
  }

  async function approvePO(po: PurchaseOrder) {
    setApproving(true)
    await supabase.from('purchase_orders').update({ status: 'approved', approved_by: profile?.id, approved_at: new Date().toISOString() }).eq('id', po.id)
    toast.success('PO approved')
    setApproveItem(null); setApproving(false); loadData()
  }

  async function startGRN(po: PurchaseOrder) {
    const { data: grnNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'GRN' })
    const { data: grn, error } = await supabase.from('grns').insert({
      grn_number: grnNum, po_id: po.id, status: 'in_progress', created_by: profile?.id,
    }).select().single()
    if (error || !grn) { toast.error('Failed to create GRN'); return }
    const { data: poLines } = await supabase.from('po_lines').select('*').eq('po_id', po.id)
    await supabase.from('grn_lines').insert((poLines ?? []).map((l, i) => ({
      grn_id: grn.id, po_line_id: l.id, sku_id: l.sku_id,
      expected_boxes: l.ordered_boxes, expected_units: l.ordered_units,
      unit_price: l.unit_price, gst_rate: l.gst_rate, status: 'pending', sort_order: i,
    })))
    await supabase.from('purchase_orders').update({ status: 'grn_in_progress' }).eq('id', po.id)
    toast.success(`GRN ${grnNum} created`)
    loadData()
  }

  const filtered = orders.filter(o =>
    o.po_number?.toLowerCase().includes(search.toLowerCase()) ||
    (o.supplier as any)?.name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-4">
          <div className="page-header">
            <div><h1 className="page-title">Purchase Orders</h1><p className="text-sm text-slate-500 mt-0.5">{filtered.length} orders</p></div>
            <div className="flex items-center gap-2">
              <SearchInput value={search} onChange={setSearch} />
              {canWrite && <button onClick={() => { setSupplierId(''); setNotes(''); setLines([{ sku_id: '', ordered_boxes: 0, ordered_units: 0, unit_price: 0, gst_rate: 18 }]); setModalOpen(true) }} className="btn-primary"><Plus className="w-4 h-4" /> New PO</button>}
            </div>
          </div>

          {loading ? <PageLoader /> : (
            <div className="card">
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>PO #</th><th>Supplier</th><th>Date</th><th>Amount</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
                  <tbody>
                    {filtered.length === 0 ? <tr><td colSpan={6} className="text-center py-12 text-slate-400">No purchase orders found</td></tr>
                    : filtered.map(po => (
                      <tr key={po.id}>
                        <td><span className="font-mono text-sm font-medium text-brand-700">{po.po_number}</span></td>
                        <td className="font-medium">{(po.supplier as any)?.name}</td>
                        <td className="text-sm">{formatDate(po.po_date)}</td>
                        <td className="font-semibold">{formatCurrency(po.grand_total)}</td>
                        <td><StatusBadge status={po.status} /></td>
                        <td>
                          <div className="flex justify-end gap-1">
                            {po.status === 'draft' && canWrite && (
                              <button onClick={() => setApproveItem(po)} className="btn-primary btn-sm"><CheckCircle className="w-3.5 h-3.5" /> Approve</button>
                            )}
                            {po.status === 'approved' && canWrite && (
                              <button onClick={() => startGRN(po)} className="btn-secondary btn-sm"><PackageCheck className="w-3.5 h-3.5" /> Start GRN</button>
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

        {/* Create PO modal */}
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Purchase Order" size="xl">
          <div className="space-y-4">
            <FormField label="Supplier" required>
              <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className="select">
                <option value="">Select supplier...</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </FormField>
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold">Line Items</h4>
                <button onClick={addLine} className="btn-ghost btn-sm text-brand-600"><Plus className="w-4 h-4" /> Add Line</button>
              </div>
              <div className="space-y-2">
                {lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="col-span-4">
                      <select value={line.sku_id} onChange={e => updateLine(i, 'sku_id', e.target.value)} className="select text-xs">
                        <option value="">Select SKU...</option>
                        {skus.map(s => <option key={s.id} value={s.id}>{s.display_name}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2"><input type="number" value={line.ordered_boxes || ''} onChange={e => updateLine(i, 'ordered_boxes', e.target.value)} className="input text-xs" placeholder="Boxes" min={0} /></div>
                    <div className="col-span-2"><input type="number" value={line.ordered_units || ''} onChange={e => updateLine(i, 'ordered_units', e.target.value)} className="input text-xs" placeholder="Units" min={0} /></div>
                    <div className="col-span-2"><input type="number" value={line.unit_price || ''} onChange={e => updateLine(i, 'unit_price', e.target.value)} className="input text-xs" placeholder="Unit price ₹" min={0} step="0.01" /></div>
                    <div className="col-span-1 text-xs text-right font-medium">{formatCurrency(line.ordered_units * line.unit_price)}</div>
                    <div className="col-span-1 flex justify-end">
                      {lines.length > 1 && <button onClick={() => removeLine(i)} className="btn-ghost btn-sm text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Total GST</span><span>{formatCurrency(totalGST)}</span></div>
              <div className="flex justify-between pt-1.5 border-t border-slate-200 font-bold"><span>Grand Total</span><span>{formatCurrency(grandTotal)}</span></div>
            </div>
            <FormField label="Notes">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input" rows={2} placeholder="Optional notes" />
            </FormField>
            <div className="flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={savePO} className="btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create Purchase Order'}</button>
            </div>
          </div>
        </Modal>

        <ConfirmDialog open={!!approveItem} onClose={() => setApproveItem(null)} onConfirm={() => approveItem && approvePO(approveItem)} title="Approve Purchase Order" message={`Approve ${approveItem?.po_number}?`} confirmLabel="Approve" loading={approving} />
      </PageGuard>
    </AppLayout>
  )
}

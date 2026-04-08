'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, Modal, FormField, StatusBadge, PageLoader, SearchInput } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { formatDate, formatCurrency, canEdit } from '@/lib/utils'
import { Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ReturnsPage() {
  const [returns, setReturns] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [skus, setSkus] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [returnType, setReturnType] = useState<string>('sales_return')
  const [refPartyId, setRefPartyId] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<any[]>([{ sku_id: '', units: 0, unit_price: 0, condition: 'good', notes: '' }])
  const { profile } = useAuth()
  const supabase = createClient()
  const canWrite = canEdit(profile?.role ?? '', 'returns')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [{ data: rets }, { data: custs }, { data: sups }, { data: skuList }] = await Promise.all([
      supabase.from('returns').select('*, customers(name), suppliers(name)').order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name').eq('status', 'active').order('name'),
      supabase.from('suppliers').select('id, name').eq('status', 'active').order('name'),
      supabase.from('skus').select('id, display_name, sku_code').eq('status', 'active').order('display_name'),
    ])
    setReturns(rets ?? [])
    setCustomers(custs ?? [])
    setSuppliers(sups ?? [])
    setSkus(skuList ?? [])
    setLoading(false)
  }

  function addLine() { setLines(l => [...l, { sku_id: '', units: 0, unit_price: 0, condition: 'good', notes: '' }]) }
  function removeLine(i: number) { setLines(l => l.filter((_, idx) => idx !== i)) }
  function updateLine(i: number, f: string, v: any) { setLines(l => l.map((line, idx) => idx === i ? { ...line, [f]: v } : line)) }

  const totalAmount = lines.reduce((s, l) => s + (l.units * l.unit_price), 0)

  async function saveReturn() {
    if (!returnType) return
    if (returnType !== 'godown_damage' && !refPartyId) { toast.error('Select customer or supplier'); return }
    if (lines.some(l => !l.sku_id)) { toast.error('All lines need a SKU'); return }
    setSaving(true)

    const { data: retNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'RTN' })
    const payload: any = {
      return_number: retNum, return_type: returnType,
      reason: reason || null, notes: notes || null,
      total_amount: totalAmount, status: 'draft', created_by: profile?.id,
    }
    if (returnType === 'sales_return') payload.customer_id = refPartyId
    else if (returnType === 'purchase_return') payload.supplier_id = refPartyId

    const { data: ret, error } = await supabase.from('returns').insert(payload).select().single()
    if (error || !ret) { toast.error(error?.message ?? 'Failed'); setSaving(false); return }

    await supabase.from('return_lines').insert(lines.map(l => ({
      return_id: ret.id, sku_id: l.sku_id, units: l.units,
      unit_price: l.unit_price, condition: l.condition, notes: l.notes || null,
    })))

    toast.success(`Return ${retNum} created`)
    setModalOpen(false); resetForm(); loadData(); setSaving(false)
  }

  function resetForm() {
    setReturnType('sales_return'); setRefPartyId(''); setReason(''); setNotes('')
    setLines([{ sku_id: '', units: 0, unit_price: 0, condition: 'good', notes: '' }])
  }

  const returnTypeLabel: Record<string, string> = {
    sales_return: 'Sales Return (from customer)',
    purchase_return: 'Purchase Return (to supplier)',
    godown_damage: 'Godown Damage Write-off',
  }

  const filtered = returns.filter(r =>
    r.return_number?.toLowerCase().includes(search.toLowerCase()) ||
    r.customers?.name?.toLowerCase().includes(search.toLowerCase()) ||
    r.suppliers?.name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-4">
          <div className="page-header">
            <div><h1 className="page-title">Returns</h1><p className="text-sm text-slate-500 mt-0.5">{filtered.length} records</p></div>
            <div className="flex items-center gap-2">
              <SearchInput value={search} onChange={setSearch} />
              {canWrite && <button onClick={() => { resetForm(); setModalOpen(true) }} className="btn-primary"><Plus className="w-4 h-4" /> New Return</button>}
            </div>
          </div>

          {loading ? <PageLoader /> : (
            <div className="card">
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Return #</th><th>Type</th><th>Party</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-12 text-slate-400">No returns found</td></tr>
                    ) : filtered.map(r => (
                      <tr key={r.id}>
                        <td><span className="font-mono font-bold text-brand-700 text-sm">{r.return_number}</span></td>
                        <td><span className="badge bg-slate-100 text-slate-700">{returnTypeLabel[r.return_type] ?? r.return_type}</span></td>
                        <td className="font-medium">{r.customers?.name ?? r.suppliers?.name ?? 'Godown'}</td>
                        <td className="text-sm">{formatDate(r.return_date)}</td>
                        <td className="font-semibold">{formatCurrency(r.total_amount)}</td>
                        <td><StatusBadge status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Return" size="xl">
          <div className="space-y-4">
            <FormField label="Return Type" required>
              <select value={returnType} onChange={e => { setReturnType(e.target.value); setRefPartyId('') }} className="select">
                <option value="sales_return">Sales Return (from customer)</option>
                <option value="purchase_return">Purchase Return (to supplier)</option>
                <option value="godown_damage">Godown Damage Write-off</option>
              </select>
            </FormField>

            {returnType === 'sales_return' && (
              <FormField label="Customer" required>
                <select value={refPartyId} onChange={e => setRefPartyId(e.target.value)} className="select">
                  <option value="">Select customer...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormField>
            )}
            {returnType === 'purchase_return' && (
              <FormField label="Supplier" required>
                <select value={refPartyId} onChange={e => setRefPartyId(e.target.value)} className="select">
                  <option value="">Select supplier...</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </FormField>
            )}

            <FormField label="Reason">
              <input value={reason} onChange={e => setReason(e.target.value)} className="input" placeholder="e.g. Dead on arrival, Physical damage..." />
            </FormField>

            <div>
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-sm font-semibold">Items</h4>
                <button onClick={addLine} className="btn-ghost btn-sm text-brand-600"><Plus className="w-4 h-4" /> Add</button>
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
                    <div className="col-span-2"><input type="number" value={line.units || ''} onChange={e => updateLine(i, 'units', Number(e.target.value))} className="input text-xs" placeholder="Units" min={1} /></div>
                    <div className="col-span-2"><input type="number" value={line.unit_price || ''} onChange={e => updateLine(i, 'unit_price', Number(e.target.value))} className="input text-xs" placeholder="Price ₹" min={0} step="0.01" /></div>
                    <div className="col-span-2">
                      <select value={line.condition} onChange={e => updateLine(i, 'condition', e.target.value)} className="select text-xs">
                        <option value="good">Good</option>
                        <option value="damaged">Damaged</option>
                        <option value="scrap">Scrap</option>
                      </select>
                    </div>
                    <div className="col-span-1 text-right text-xs font-medium">{formatCurrency(line.units * line.unit_price)}</div>
                    <div className="col-span-1 flex justify-end">
                      {lines.length > 1 && <button onClick={() => removeLine(i)} className="btn-ghost btn-sm text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between items-center bg-slate-50 rounded-xl px-4 py-3">
              <span className="font-semibold text-sm">Total Amount</span>
              <span className="font-bold text-lg">{formatCurrency(totalAmount)}</span>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={saveReturn} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Create Return'}</button>
            </div>
          </div>
        </Modal>
      </PageGuard>
    </AppLayout>
  )
}

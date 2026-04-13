'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, Modal, FormField, StatusBadge, PageLoader, SearchInput, ConfirmDialog } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { formatDate, formatCurrency, canEdit } from '@/lib/utils'
import { Plus, Trash2, CheckCircle, Eye, ChevronDown, ChevronRight, PackageCheck, MapPin } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_COLORS: Record<string, string> = {
  draft:    'bg-slate-100 text-slate-600',
  approved: 'bg-blue-50 text-blue-700',
  received: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-600',
}

export default function ReturnsPage() {
  const supabase = createClient()
  const { profile } = useAuth()
  const canWrite = canEdit(profile?.role ?? '', 'returns')
  const isAdmin = profile?.role === 'admin'

  const [returns, setReturns] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [skus, setSkus] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [racks, setRacks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [returnLines, setReturnLines] = useState<Record<string, any[]>>({})

  // Create modal
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [returnType, setReturnType] = useState('sales_return')
  const [refPartyId, setRefPartyId] = useState('')
  const [linkedInvoiceId, setLinkedInvoiceId] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<any[]>([{ sku_id: '', units: 0, unit_price: 0, condition: 'good', notes: '' }])

  // Receive modal
  const [receiveTarget, setReceiveTarget] = useState<any>(null)
  const [receiveRackId, setReceiveRackId] = useState('')
  const [receiving, setReceiving] = useState(false)

  // Approve confirm
  const [approveTarget, setApproveTarget] = useState<any>(null)
  const [approving, setApproving] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [{ data: rets }, { data: custs }, { data: sups }, { data: skuList }, { data: invList }, { data: rackList }] = await Promise.all([
      supabase.from('returns').select('*, customers(name), suppliers(name), invoices(invoice_number), racks(rack_id_display)').order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name').eq('status', 'active').order('name'),
      supabase.from('suppliers').select('id, name').eq('status', 'active').order('name'),
      supabase.from('skus').select('id, display_name, sku_code').eq('status', 'active').order('display_name'),
      supabase.from('invoices').select('id, invoice_number, so_id, customers(name)').eq('dispatch_status', 'dispatched').order('invoice_number'),
      supabase.from('racks').select('id, rack_id_display').eq('status', 'active').order('rack_id_display'),
    ])
    setReturns(rets ?? [])
    setCustomers(custs ?? [])
    setSuppliers(sups ?? [])
    setSkus(skuList ?? [])
    setInvoices(invList ?? [])
    setRacks(rackList ?? [])
    setLoading(false)
  }

  async function loadLines(retId: string) {
    const { data } = await supabase.from('return_lines')
      .select('*, skus(display_name, sku_code)')
      .eq('return_id', retId)
    setReturnLines(prev => ({ ...prev, [retId]: data ?? [] }))
  }

  async function toggleExpand(retId: string) {
    if (expanded === retId) { setExpanded(null); return }
    setExpanded(retId)
    if (!returnLines[retId]) await loadLines(retId)
  }

  function addLine() { setLines(l => [...l, { sku_id: '', units: 0, unit_price: 0, condition: 'good', notes: '' }]) }
  function removeLine(i: number) { setLines(l => l.filter((_, idx) => idx !== i)) }
  function updateLine(i: number, f: string, v: any) { setLines(l => l.map((line, idx) => idx === i ? { ...line, [f]: v } : line)) }
  const totalAmount = lines.reduce((s, l) => s + (l.units * l.unit_price), 0)

  // When invoice is selected, auto-fill customer
  function handleInvoiceSelect(invId: string) {
    setLinkedInvoiceId(invId)
    const inv = invoices.find(i => i.id === invId)
    if (inv) {
      // Try to find customer match
      const cust = customers.find(c => c.name === inv.customers?.name)
      if (cust) setRefPartyId(cust.id)
    }
  }

  async function saveReturn() {
    if (returnType !== 'godown_damage' && !refPartyId) { toast.error('Select customer or supplier'); return }
    if (lines.some(l => !l.sku_id || l.units <= 0)) { toast.error('All lines need a SKU and quantity'); return }
    setSaving(true)
    const { data: retNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'RTN' })
    const payload: any = {
      return_number: retNum, return_type: returnType,
      reason: reason || null, notes: notes || null,
      total_amount: totalAmount, status: 'draft', created_by: profile?.id,
      invoice_id: linkedInvoiceId || null,
    }
    if (returnType === 'sales_return') payload.customer_id = refPartyId
    else if (returnType === 'purchase_return') payload.supplier_id = refPartyId

    const { data: ret, error } = await supabase.from('returns').insert(payload).select().single()
    if (error || !ret) { toast.error(error?.message ?? 'Failed'); setSaving(false); return }

    await supabase.from('return_lines').insert(lines.map(l => ({
      return_id: ret.id, sku_id: l.sku_id, units: l.units,
      unit_price: l.unit_price, condition: l.condition, notes: l.notes || null,
    })))

    toast.success(`Return ${retNum} created. Pending admin approval.`)
    setModalOpen(false); resetForm(); loadData(); setSaving(false)
  }

  async function approveReturn(ret: any) {
    setApproving(true)
    await supabase.from('returns').update({ status: 'approved' }).eq('id', ret.id)
    toast.success(`Return ${ret.return_number} approved — now ready to receive stock.`)
    setApproveTarget(null); setApproving(false); loadData()
  }

  async function receiveReturn() {
    if (!receiveTarget) return
    if (!receiveRackId) { toast.error('Select a rack to stock the returned items'); return }
    setReceiving(true)
    try {
      const lines = returnLines[receiveTarget.id] ?? []
      for (const line of lines) {
        if (line.condition === 'good' || line.condition === 'good') {
          // Create a new lot for returned stock
          const { data: lotNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'LOT' })
          const { data: lot } = await supabase.from('lots').insert({
            lot_number: lotNum, sku_id: line.sku_id,
            received_date: new Date().toISOString().split('T')[0],
            received_units: line.units, remaining_units: line.units,
            unit_cost: line.unit_price,
          }).select().single()

          if (lot) {
            // Add to rack stock
            await supabase.from('rack_stock').insert({
              rack_id: receiveRackId, sku_id: line.sku_id,
              lot_id: lot.id, units_count: line.units, boxes_count: 0,
              stocked_by: profile?.id, stocked_at: new Date().toISOString(),
            })
            // Update stock master
            await supabase.rpc('update_stock_master', { p_sku_id: line.sku_id, p_delta: line.units })
          }
          // Mark line as restocked
          await supabase.from('return_lines').update({ restocked: true, rack_id: receiveRackId }).eq('id', line.id)
        }
      }

      // Mark invoice as credit pending if linked
      if (receiveTarget.invoice_id) {
        await supabase.from('invoices').update({ payment_status: 'credit_pending' }).eq('id', receiveTarget.invoice_id)
      }

      // Mark return as received
      await supabase.from('returns').update({
        status: 'received', received_at: new Date().toISOString(),
        received_by: profile?.id, rack_id: receiveRackId,
      }).eq('id', receiveTarget.id)

      toast.success(`Return received and ${lines.filter(l => l.condition === 'good').length} item(s) restocked.`)
      setReceiveTarget(null); setReceiveRackId(''); loadData()
    } catch (e: any) { toast.error(e.message) }
    finally { setReceiving(false) }
  }

  function resetForm() {
    setReturnType('sales_return'); setRefPartyId(''); setLinkedInvoiceId('')
    setReason(''); setNotes('')
    setLines([{ sku_id: '', units: 0, unit_price: 0, condition: 'good', notes: '' }])
  }

  const filtered = returns.filter(r =>
    r.return_number?.toLowerCase().includes(search.toLowerCase()) ||
    r.customers?.name?.toLowerCase().includes(search.toLowerCase()) ||
    r.suppliers?.name?.toLowerCase().includes(search.toLowerCase())
  )

  const typeLabel: Record<string, string> = {
    sales_return: 'Sales Return', purchase_return: 'Purchase Return', godown_damage: 'Godown Damage'
  }

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-4">
          <div className="page-header">
            <div>
              <h1 className="page-title">Returns</h1>
              <p className="text-sm text-slate-500 mt-0.5">{filtered.length} records</p>
            </div>
            <div className="flex items-center gap-2">
              <SearchInput value={search} onChange={setSearch} />
              {canWrite && (
                <button onClick={() => { resetForm(); setModalOpen(true) }} className="btn-primary">
                  <Plus className="w-4 h-4" /> New Return
                </button>
              )}
            </div>
          </div>

          {/* Status explanation for non-admins */}
          <div className="card p-4 bg-blue-50 border border-blue-200 text-sm text-blue-800">
            <strong>How returns work:</strong> Create return → Admin approves → Packing executive receives items & scans rack → Stock updated automatically.
            {!isAdmin && <span className="ml-1 text-blue-600">Admin must approve before items can be received.</span>}
          </div>

          {loading ? <PageLoader /> : (
            <div className="space-y-3">
              {filtered.length === 0 ? (
                <div className="card p-12 text-center text-slate-400">No returns found</div>
              ) : filtered.map(r => {
                const lines = returnLines[r.id] ?? []
                const isExp = expanded === r.id
                return (
                  <div key={r.id} className="card overflow-hidden">
                    <div
                      className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50"
                      onClick={() => toggleExpand(r.id)}
                    >
                      <div className="flex items-center gap-4">
                        {isExp ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-brand-700">{r.return_number}</span>
                            <span className="badge bg-slate-100 text-slate-700 text-xs">{typeLabel[r.return_type]}</span>
                            <span className={`badge text-xs ${STATUS_COLORS[r.status] ?? 'bg-slate-100 text-slate-600'}`}>{r.status}</span>
                            {r.invoices && (
                              <span className="text-xs text-slate-400 font-mono">Against: {r.invoices.invoice_number}</span>
                            )}
                          </div>
                          <p className="text-sm text-slate-500 mt-0.5">
                            {r.customers?.name ?? r.suppliers?.name ?? 'Godown'} · {formatDate(r.return_date ?? r.created_at)} · {formatCurrency(r.total_amount)}
                          </p>
                          {r.racks && <p className="text-xs text-brand-600 font-mono mt-0.5">📍 Restocked to: {r.racks.rack_id_display}</p>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        {/* Admin: approve draft */}
                        {r.status === 'draft' && isAdmin && (
                          <button onClick={() => setApproveTarget(r)} className="btn-primary btn-sm">
                            <CheckCircle className="w-3.5 h-3.5" /> Approve
                          </button>
                        )}
                        {/* Packing exec: receive approved return */}
                        {r.status === 'approved' && (profile?.role === 'admin' || profile?.role === 'packing_executive') && (
                          <button
                            onClick={() => { setReceiveTarget(r); loadLines(r.id) }}
                            className="btn-success btn-sm"
                          >
                            <PackageCheck className="w-3.5 h-3.5" /> Receive Stock
                          </button>
                        )}
                        {r.status === 'draft' && !isAdmin && (
                          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                            Awaiting admin approval
                          </span>
                        )}
                      </div>
                    </div>

                    {isExp && (
                      <div className="border-t border-slate-100">
                        {lines.length === 0 ? (
                          <p className="text-center text-slate-400 py-6 text-sm">Loading lines...</p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50">
                              <tr>
                                <th className="px-5 py-2 text-left text-xs font-semibold text-slate-500">Product</th>
                                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500">Units</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Unit Price</th>
                                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500">Condition</th>
                                <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500">Restocked</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {lines.map((l: any) => (
                                <tr key={l.id}>
                                  <td className="px-5 py-3">
                                    <p className="font-medium">{l.skus?.display_name}</p>
                                    <code className="text-xs text-slate-400">{l.skus?.sku_code}</code>
                                  </td>
                                  <td className="px-3 py-3 text-center font-semibold">{l.units}</td>
                                  <td className="px-3 py-3 text-right font-mono">{formatCurrency(l.unit_price)}</td>
                                  <td className="px-3 py-3 text-center">
                                    <span className={`badge text-xs ${l.condition === 'good' ? 'bg-emerald-50 text-emerald-700' : l.condition === 'damaged' ? 'bg-orange-50 text-orange-700' : 'bg-red-50 text-red-600'}`}>
                                      {l.condition}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    {l.restocked
                                      ? <span className="text-emerald-600 text-xs font-semibold">✓ Restocked</span>
                                      : <span className="text-slate-400 text-xs">Pending</span>
                                    }
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {r.reason && <p className="px-5 py-3 text-sm text-slate-500 border-t border-slate-100">Reason: {r.reason}</p>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Create Return Modal */}
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Return" size="xl">
          <div className="space-y-4">
            <FormField label="Return Type" required>
              <select value={returnType} onChange={e => { setReturnType(e.target.value); setRefPartyId(''); setLinkedInvoiceId('') }} className="select">
                <option value="sales_return">Sales Return (from customer)</option>
                <option value="purchase_return">Purchase Return (to supplier)</option>
                <option value="godown_damage">Godown Damage Write-off</option>
              </select>
            </FormField>

            {returnType === 'sales_return' && (
              <>
                <FormField label="Against Invoice (optional but recommended)">
                  <select value={linkedInvoiceId} onChange={e => handleInvoiceSelect(e.target.value)} className="select">
                    <option value="">No specific invoice</option>
                    {invoices.map(i => (
                      <option key={i.id} value={i.id}>{i.invoice_number} — {i.customers?.name}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Customer" required>
                  <select value={refPartyId} onChange={e => setRefPartyId(e.target.value)} className="select">
                    <option value="">Select customer...</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </FormField>
              </>
            )}

            {returnType === 'purchase_return' && (
              <FormField label="Supplier" required>
                <select value={refPartyId} onChange={e => setRefPartyId(e.target.value)} className="select">
                  <option value="">Select supplier...</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </FormField>
            )}

            <FormField label="Reason"><input value={reason} onChange={e => setReason(e.target.value)} className="input" placeholder="e.g. Dead on arrival, Physical damage..." /></FormField>

            <div>
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-sm font-semibold">Items Being Returned</h4>
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
                        <option value="good">Good — will restock</option>
                        <option value="damaged">Damaged — no restock</option>
                        <option value="scrap">Scrap — write off</option>
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

            <FormField label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} className="input" rows={2} placeholder="Any additional notes..." /></FormField>

            <div className="flex justify-between items-center bg-slate-50 rounded-xl px-4 py-3">
              <span className="font-semibold text-sm">Total Return Value</span>
              <span className="font-bold text-lg">{formatCurrency(totalAmount)}</span>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={saveReturn} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Create Return'}</button>
            </div>
          </div>
        </Modal>

        {/* Receive Stock Modal */}
        <Modal open={!!receiveTarget} onClose={() => { setReceiveTarget(null); setReceiveRackId('') }} title="Receive Returned Stock" size="md">
          {receiveTarget && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm">
                <p className="font-semibold text-blue-800">Return: {receiveTarget.return_number}</p>
                <p className="text-blue-600 mt-1">Items in good condition will be restocked. Damaged/scrap items will be written off.</p>
                {receiveTarget.invoice_id && (
                  <p className="text-blue-600 mt-1">📋 Invoice {receiveTarget.invoices?.invoice_number} will be marked as credit pending.</p>
                )}
              </div>

              {/* Show lines */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50"><tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Product</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500">Units</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500">Condition</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500">Action</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {(returnLines[receiveTarget.id] ?? []).map((l: any) => (
                      <tr key={l.id}>
                        <td className="px-4 py-3 font-medium">{l.skus?.display_name}</td>
                        <td className="px-3 py-3 text-center font-semibold">{l.units}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`badge text-xs ${l.condition === 'good' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{l.condition}</span>
                        </td>
                        <td className="px-3 py-3 text-center text-xs">
                          {l.condition === 'good' ? '✓ Will restock' : '✗ Write off'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <FormField label="Assign to Rack (for items to be restocked)" required>
                <div className="flex gap-2">
                  <select value={receiveRackId} onChange={e => setReceiveRackId(e.target.value)} className="select flex-1">
                    <option value="">Select rack...</option>
                    {racks.map(r => <option key={r.id} value={r.id}>{r.rack_id_display}</option>)}
                  </select>
                </div>
                <p className="text-xs text-slate-400 mt-1">All good-condition items will be assigned to this rack. You can move them later from Rack Locations.</p>
              </FormField>

              <div className="flex justify-end gap-2">
                <button onClick={() => { setReceiveTarget(null); setReceiveRackId('') }} className="btn-secondary">Cancel</button>
                <button onClick={receiveReturn} disabled={receiving || !receiveRackId} className="btn-success">
                  <PackageCheck className="w-4 h-4" />
                  {receiving ? 'Processing...' : 'Confirm Receipt & Restock'}
                </button>
              </div>
            </div>
          )}
        </Modal>

        {/* Approve confirm */}
        <ConfirmDialog
          open={!!approveTarget}
          onClose={() => setApproveTarget(null)}
          onConfirm={() => approveTarget && approveReturn(approveTarget)}
          title="Approve Return"
          message={`Approve return ${approveTarget?.return_number}? This allows the packing executive to receive and restock the items.`}
          confirmLabel="Approve Return"
          loading={approving}
        />
      </PageGuard>
    </AppLayout>
  )
}

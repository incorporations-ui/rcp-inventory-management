'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { Package2, Plus, Trash2, Send, CheckCircle, Search, ShoppingCart, Info } from 'lucide-react'

interface StockItem {
  sku_id: string
  sku_code: string
  display_name: string
  available_units: number
  brand_name: string
  item_category: string
}

interface RequestLine {
  sku_id: string
  sku_code: string
  display_name: string
  ordered_boxes: number
  ordered_units: number
  notes: string
}

export default function ClientPortalPage() {
  const [step, setStep] = useState<'login' | 'request' | 'submitted'>('login')
  const [customerCode, setCustomerCode] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customer, setCustomer] = useState<any>(null)
  const [loginError, setLoginError] = useState('')
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [search, setSearch] = useState('')
  const [lines, setLines] = useState<RequestLine[]>([])
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submittedSO, setSubmittedSO] = useState('')
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoginError('')
    const { data: cust } = await supabase
      .from('customers')
      .select('id, name, code, customer_type, status')
      .eq('code', customerCode.trim().toUpperCase())
      .eq('status', 'active')
      .single()

    if (!cust) {
      setLoginError('Customer code not found. Please contact your sales manager.')
      return
    }
    setCustomer(cust)
    await loadStock()
    setStep('request')
  }

  async function loadStock() {
    const { data } = await supabase
      .from('sku_stock_locations')
      .select('sku_id, sku_code, display_name, available_units')
      .gt('available_units', 0)
      .order('display_name')
    setStockItems((data ?? []).map((s: any) => ({
      sku_id: s.sku_id,
      sku_code: s.sku_code,
      display_name: s.display_name,
      available_units: s.available_units ?? 0,
      brand_name: '',
      item_category: '',
    })))
  }

  function addItem(item: StockItem) {
    if (lines.some(l => l.sku_id === item.sku_id)) {
      return // already in list
    }
    setLines(prev => [...prev, {
      sku_id: item.sku_id,
      sku_code: item.sku_code,
      display_name: item.display_name,
      ordered_boxes: 0,
      ordered_units: 1,
      notes: '',
    }])
    setSearch('')
  }

  function updateLine(idx: number, field: keyof RequestLine, value: any) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }

  function removeLine(idx: number) {
    setLines(prev => prev.filter((_, i) => i !== idx))
  }

  async function submitRequest() {
    if (lines.length === 0) return
    if (lines.some(l => l.ordered_units <= 0)) {
      alert('Please enter a quantity for all items')
      return
    }
    setSubmitting(true)

    // Get next SO number
    const { data: soNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'SO' })
    const { data: piNum } = await supabase.rpc('next_doc_number', { p_doc_type: 'PI' })

    const { data: so, error } = await supabase.from('sales_orders').insert({
      so_number: soNum,
      proforma_number: piNum,
      proforma_date: new Date().toISOString().split('T')[0],
      customer_id: customer.id,
      notes: notes || 'Submitted via Client Portal',
      total_amount: 0, // Prices to be filled by sales manager
      total_gst: 0,
      grand_total: 0,
      status: 'draft', // Stays in draft until sales manager adds pricing & approves
    }).select().single()

    if (error || !so) {
      alert('Failed to submit request. Please try again.')
      setSubmitting(false)
      return
    }

    await supabase.from('so_lines').insert(lines.map((l, i) => ({
      so_id: so.id,
      sku_id: l.sku_id,
      ordered_boxes: l.ordered_boxes,
      ordered_units: l.ordered_units,
      unit_price: 0, // To be filled by sales manager
      gst_rate: 18,  // Default; sales manager will update
      sort_order: i,
    })))

    setSubmittedSO(soNum)
    setStep('submitted')
    setSubmitting(false)
  }

  const filteredStock = stockItems.filter(s =>
    s.display_name.toLowerCase().includes(search.toLowerCase()) ||
    s.sku_code.toLowerCase().includes(search.toLowerCase())
  )

  const totalRequestedUnits = lines.reduce((s, l) => s + Number(l.ordered_units), 0)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center">
            <Package2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-slate-900 leading-tight">RCP Inventory</p>
            <p className="text-xs text-slate-400">Client Order Request Portal</p>
          </div>
          {customer && (
            <div className="ml-auto text-right">
              <p className="text-sm font-semibold text-slate-900">{customer.name}</p>
              <p className="text-xs text-slate-400 capitalize">{customer.customer_type}</p>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* ── STEP 1: Login ── */}
        {step === 'login' && (
          <div className="max-w-sm mx-auto">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <ShoppingCart className="w-8 h-8 text-brand-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Place a Stock Request</h1>
              <p className="text-sm text-slate-500 mt-2">Enter your customer code to get started. Prices will be confirmed by our sales team.</p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Your Customer Code</label>
                  <input
                    type="text"
                    value={customerCode}
                    onChange={e => setCustomerCode(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 uppercase"
                    placeholder="e.g. CUST001"
                    required
                  />
                </div>
                {loginError && (
                  <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{loginError}</p>
                )}
                <button type="submit" className="w-full bg-brand-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-700 transition-colors">
                  Continue →
                </button>
              </form>
            </div>
            <p className="text-center text-xs text-slate-400 mt-4">
              Don't know your customer code? Contact your RCP sales manager.
            </p>
          </div>
        )}

        {/* ── STEP 2: Request form ── */}
        {step === 'request' && (
          <div className="space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-bold text-slate-900">New Stock Request</h1>
                <p className="text-sm text-slate-500 mt-0.5">Select items from available stock. Our team will confirm pricing.</p>
              </div>
              {lines.length > 0 && (
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">{lines.length} item{lines.length !== 1 ? 's' : ''}</p>
                  <p className="text-xs text-slate-500">{totalRequestedUnits} units requested</p>
                </div>
              )}
            </div>

            {/* Info banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-blue-700">
                This is a <strong>request form only</strong> — no prices are committed here. Your sales manager will add pricing and send a Proforma Invoice for your confirmation before processing.
              </p>
            </div>

            {/* Product search */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <label className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Search & Add Products</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Type product name or SKU code..."
                />
              </div>
              {search && (
                <div className="mt-2 max-h-52 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {filteredStock.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-4">No matching products in stock</p>
                  ) : filteredStock.slice(0, 10).map(item => {
                    const alreadyAdded = lines.some(l => l.sku_id === item.sku_id)
                    return (
                      <div key={item.sku_id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{item.display_name}</p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <code className="text-xs text-slate-400">{item.sku_code}</code>
                            <span className={`text-xs font-medium ${item.available_units > 10 ? 'text-emerald-600' : item.available_units > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                              {item.available_units} units available
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => addItem(item)}
                          disabled={alreadyAdded}
                          className={`ml-3 flex-shrink-0 btn-sm ${alreadyAdded ? 'btn-secondary opacity-50 cursor-not-allowed' : 'btn-primary'}`}
                        >
                          {alreadyAdded ? 'Added' : <><Plus className="w-3.5 h-3.5" /> Add</>}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Request lines */}
            {lines.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Your Request ({lines.length} items)</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {lines.map((line, idx) => {
                    const stockItem = stockItems.find(s => s.sku_id === line.sku_id)
                    const maxUnits = stockItem?.available_units ?? 9999
                    return (
                      <div key={line.sku_id} className="px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{line.display_name}</p>
                            <code className="text-xs text-slate-400">{line.sku_code}</code>
                            {stockItem && (
                              <span className={`ml-2 text-xs ${stockItem.available_units > 10 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                (max {stockItem.available_units} available)
                              </span>
                            )}
                          </div>
                          <button onClick={() => removeLine(idx)} className="text-slate-300 hover:text-red-500 transition-colors p-1">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-3 mt-3">
                          <div>
                            <label className="text-xs text-slate-500 block mb-1">Boxes</label>
                            <input
                              type="number"
                              value={line.ordered_boxes || ''}
                              onChange={e => updateLine(idx, 'ordered_boxes', Number(e.target.value))}
                              className="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                              min={0}
                              placeholder="0"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-slate-500 block mb-1">Units <span className="text-red-500">*</span></label>
                            <input
                              type="number"
                              value={line.ordered_units || ''}
                              onChange={e => updateLine(idx, 'ordered_units', Number(e.target.value))}
                              className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                              min={1}
                              max={maxUnits}
                              required
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-xs text-slate-500 block mb-1">Notes (optional)</label>
                            <input
                              type="text"
                              value={line.notes}
                              onChange={e => updateLine(idx, 'notes', e.target.value)}
                              className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                              placeholder="Any specific requirements..."
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Overall notes and submit */}
            {lines.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Additional Notes</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
                    rows={3}
                    placeholder="Delivery preferences, urgency, or any other details..."
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-500">
                    <strong>{lines.length}</strong> products · <strong>{totalRequestedUnits}</strong> units total
                  </div>
                  <button
                    onClick={submitRequest}
                    disabled={submitting || lines.some(l => l.ordered_units <= 0)}
                    className="bg-brand-600 text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    {submitting ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
              </div>
            )}

            {lines.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No items added yet</p>
                <p className="text-sm mt-1">Use the search above to find products</p>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: Submitted ── */}
        {step === 'submitted' && (
          <div className="max-w-sm mx-auto text-center py-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <CheckCircle className="w-9 h-9 text-emerald-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">Request Submitted!</h1>
            <p className="text-sm text-slate-500 mt-2 mb-5">
              Your order request <strong className="text-slate-800 font-mono">{submittedSO}</strong> has been received.
              Our sales team will review it, add pricing, and send you a Proforma Invoice for confirmation.
            </p>
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-left text-sm space-y-2 mb-6">
              <p className="font-semibold text-slate-700">What happens next:</p>
              <p className="text-slate-500">1. Sales manager reviews your request</p>
              <p className="text-slate-500">2. Proforma Invoice sent to you with pricing</p>
              <p className="text-slate-500">3. On your confirmation, order is processed</p>
              <p className="text-slate-500">4. Delivery arranged as agreed</p>
            </div>
            <button
              onClick={() => { setStep('request'); setLines([]); setNotes(''); setSubmittedSO('') }}
              className="w-full bg-brand-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-700 transition-colors"
            >
              Place Another Request
            </button>
          </div>
        )}
      </div>

      <div className="text-center pb-8">
        <p className="text-xs text-slate-300">RCP Inventory Manager · Client Portal</p>
      </div>
    </div>
  )
}

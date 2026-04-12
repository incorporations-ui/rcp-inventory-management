'use client'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard } from '@/components/ui'
import { useState } from 'react'

interface Suggestion {
  id: number
  title: string
  reason: string
  impact: string
  effort: 'Low' | 'Medium' | 'High'
  priority: 1 | 2 | 3 | 4 | 5
  category: string
  tags: string[]
}

const SUGGESTIONS: Suggestion[] = [
  {
    id: 1,
    title: 'WhatsApp / Email Proforma & Invoice Delivery',
    reason: 'Your sales managers currently have to download the PDF and then manually send it. A single "Send to Customer" button that fires the proforma/invoice directly to the customer\'s WhatsApp or email would cut the step entirely and create a delivery audit trail.',
    impact: 'Saves ~5 min per order, eliminates missed sends, customer gets a professional PDF instantly.',
    effort: 'Medium',
    priority: 5,
    category: 'Operations',
    tags: ['Sales', 'PDF', 'Communication'],
  },
  {
    id: 2,
    title: 'Payment Tracking & Outstanding Balance',
    reason: 'Invoices are currently created with "unpaid" status but there is no way to record partial payments, full payments, or see which customers owe you money. For a wholesaler doing credit sales, this is a significant gap.',
    impact: 'Know exactly who owes you and how much at any point. Avoid chasing customers manually.',
    effort: 'Medium',
    priority: 5,
    category: 'Finance',
    tags: ['Accounts', 'Invoice', 'Credit'],
  },
  {
    id: 3,
    title: 'Barcode / QR Scan on GRN Receive',
    reason: 'Currently packing executives type or manually confirm received quantities. If boxes from the National Distributor have barcodes or QR codes, scanning them during GRN would pre-fill the SKU and quantity automatically — removing data entry errors.',
    impact: 'Faster GRN process, zero typos on received quantities, links physical boxes to digital lots.',
    effort: 'Low',
    priority: 4,
    category: 'Warehouse',
    tags: ['GRN', 'QR', 'Packing'],
  },
  {
    id: 4,
    title: 'Automated Low-Stock WhatsApp / Email Alerts',
    reason: 'The system already tracks reorder levels. But today, someone has to open the Reports page to notice a low-stock situation. An automated alert pushed to the admin\'s phone when a SKU drops below reorder level would make restocking proactive instead of reactive.',
    impact: 'Never run out of fast-moving SKUs unexpectedly. Alerts go to the right person instantly.',
    effort: 'Low',
    priority: 4,
    category: 'Inventory',
    tags: ['Alerts', 'Reorder', 'Automation'],
  },
  {
    id: 5,
    title: 'Customer Portal (Read-only)',
    reason: 'Your distributors and retailers currently call or WhatsApp to check order status. A simple login for customers showing their SO status, proforma, invoice and dispatch status would eliminate those inbound calls entirely.',
    impact: 'Reduce inbound "where is my order?" queries. Customers self-serve 24/7.',
    effort: 'Medium',
    priority: 3,
    category: 'Sales',
    tags: ['Customer', 'Portal', 'Self-service'],
  },
  {
    id: 6,
    title: 'Credit Limit Enforcement on Sales Orders',
    reason: 'Some distributors buy on credit. Without a credit limit check at SO creation time, your sales managers could unknowingly create an SO for a customer who is already overdue. This leads to bad debts.',
    impact: 'Automatic warning (or hard block) when a customer\'s outstanding balance exceeds their credit limit.',
    effort: 'Low',
    priority: 4,
    category: 'Finance',
    tags: ['Credit', 'Risk', 'Sales'],
  },
  {
    id: 7,
    title: 'Delivery Challan (DC) Separate from Invoice',
    reason: 'In Indian commerce, goods are often dispatched with a Delivery Challan before the tax invoice is raised (especially for demo stock or branch transfers). Currently the system only generates a tax invoice. A DC document is required for transport compliance.',
    impact: 'GST compliance, ability to send goods before billing, required by transporters.',
    effort: 'Low',
    priority: 4,
    category: 'Compliance',
    tags: ['GST', 'Dispatch', 'Document'],
  },
  {
    id: 8,
    title: 'Supplier Performance Tracking',
    reason: 'You buy from National Distributors. Over time, some NDs will consistently deliver short quantities, damaged goods, or late. The GRN data already captures this — it just needs to be surfaced as a supplier scorecard.',
    impact: 'Data-backed negotiation with NDs. Know which supplier to trust for urgent orders.',
    effort: 'Low',
    priority: 3,
    category: 'Purchasing',
    tags: ['Supplier', 'Analytics', 'GRN'],
  },
  {
    id: 9,
    title: 'Multi-Godown / Warehouse Support',
    reason: 'Even if you have one godown today, businesses grow. The current data model links racks to a single implied location. Adding a warehouse selector to GRN and packing would future-proof you without a schema rebuild later.',
    impact: 'Supports business expansion. No rebuild needed when a second location opens.',
    effort: 'Medium',
    priority: 2,
    category: 'Infrastructure',
    tags: ['Warehouse', 'Scaling', 'Future'],
  },
  {
    id: 10,
    title: 'Mobile-First Packing Executive App (PWA)',
    reason: 'Packing executives use both desktop and mobile. The current UI is responsive but not optimised for one-handed mobile use during physical packing — large buttons, QR scanner as the default, no keyboard needed.',
    impact: 'Faster packing. Reduced errors. Executives can scan and mark without going to a desk.',
    effort: 'Medium',
    priority: 3,
    category: 'UX',
    tags: ['Mobile', 'QR', 'Packing'],
  },
  {
    id: 11,
    title: 'Tally / Busy Accounting Export',
    reason: 'Most Indian businesses sync their invoices to Tally or Busy. Currently you can export to CSV. A Tally XML export in the exact format Tally expects would let your accountant import invoices with one click instead of manual entry.',
    impact: 'Saves accountant hours every month. Eliminates double-entry errors.',
    effort: 'Medium',
    priority: 3,
    category: 'Finance',
    tags: ['Accounting', 'Tally', 'Export'],
  },
  {
    id: 12,
    title: 'Price History Log per SKU',
    reason: 'Prices fluctuate multiple times a day in your business. Currently there is no way to see what price was offered for a given SKU on a given date. This is needed for dispute resolution and margin analysis.',
    impact: 'Resolve customer disputes. Understand margin trends. See how ND pricing has changed.',
    effort: 'Low',
    priority: 3,
    category: 'Sales',
    tags: ['Pricing', 'History', 'Analytics'],
  },
]

const CATEGORY_COLORS: Record<string, string> = {
  Operations: 'bg-blue-50 text-blue-700 border-blue-200',
  Finance: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Warehouse: 'bg-amber-50 text-amber-700 border-amber-200',
  Inventory: 'bg-purple-50 text-purple-700 border-purple-200',
  Sales: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Compliance: 'bg-rose-50 text-rose-700 border-rose-200',
  Purchasing: 'bg-teal-50 text-teal-700 border-teal-200',
  Infrastructure: 'bg-slate-100 text-slate-700 border-slate-200',
  UX: 'bg-pink-50 text-pink-700 border-pink-200',
}

const EFFORT_COLORS = {
  Low: 'bg-green-100 text-green-700',
  Medium: 'bg-amber-100 text-amber-700',
  High: 'bg-red-100 text-red-700',
}

function StarRating({ n }: { n: number }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(i => (
        <svg key={i} className={`w-4 h-4 ${i <= n ? 'text-amber-400' : 'text-slate-200'}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  )
}

export default function SuggestionsPage() {
  const [filter, setFilter] = useState<string>('All')
  const categories = ['All', ...Array.from(new Set(SUGGESTIONS.map(s => s.category)))]
  const filtered = filter === 'All' ? SUGGESTIONS : SUGGESTIONS.filter(s => s.category === filter)
  const sorted = [...filtered].sort((a, b) => b.priority - a.priority)

  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-6">
          <div className="page-header">
            <div>
              <h1 className="page-title">Suggested Improvements</h1>
              <p className="text-sm text-slate-500 mt-0.5">{SUGGESTIONS.length} suggestions — sorted by priority rating</p>
            </div>
          </div>

          {/* Category filter */}
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <button key={cat} onClick={() => setFilter(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  filter === cat
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}>
                {cat}
              </button>
            ))}
          </div>

          {/* Cards */}
          <div className="space-y-4">
            {sorted.map((s, idx) => (
              <div key={s.id} className="card p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-4">
                  {/* Rank */}
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-500 flex-shrink-0 mt-0.5">
                    {idx + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <h3 className="font-bold text-slate-900 text-base leading-snug">{s.title}</h3>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <StarRating n={s.priority} />
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${EFFORT_COLORS[s.effort]}`}>
                          {s.effort} effort
                        </span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[s.category] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                          {s.category}
                        </span>
                      </div>
                    </div>

                    {/* Reason */}
                    <div className="mt-3">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Why we suggest this</p>
                      <p className="text-sm text-slate-700 leading-relaxed">{s.reason}</p>
                    </div>

                    {/* Impact */}
                    <div className="mt-3 flex items-start gap-2 bg-emerald-50 rounded-lg px-3 py-2.5">
                      <span className="text-emerald-500 text-base leading-none mt-0.5">→</span>
                      <div>
                        <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-0.5">Expected Impact</p>
                        <p className="text-sm text-emerald-800">{s.impact}</p>
                      </div>
                    </div>

                    {/* Tags */}
                    <div className="flex gap-1.5 mt-3 flex-wrap">
                      {s.tags.map(tag => (
                        <span key={tag} className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded">#{tag}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="card p-4 bg-blue-50 border border-blue-200">
            <p className="text-sm text-blue-800">
              <strong>Priority rating:</strong> ⭐⭐⭐⭐⭐ = must-have · ⭐⭐⭐⭐ = high value · ⭐⭐⭐ = nice to have.
              {' '}<strong>Effort:</strong> Low = a day or two · Medium = a week · High = multiple weeks.
              Prioritise high-priority + low-effort items first for best ROI.
            </p>
          </div>
        </div>
      </PageGuard>
    </AppLayout>
  )
}

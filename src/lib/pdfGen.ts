// PDF generation via a hidden iframe with print-optimised HTML
// No external library needed — uses the browser's built-in PDF export (Ctrl+P → Save as PDF)
// For a true server-side PDF, a library like @react-pdf/renderer or puppeteer would be needed,
// but those require server routes. This approach works 100% client-side.

export interface PDFCustomer {
  name: string
  address_line1?: string
  city?: string
  state?: string
  gstin?: string
}

export interface PDFLineItem {
  description: string
  sku_code?: string
  hsn_code?: string
  qty: number
  unit?: string
  unit_price: number
  gst_rate: number
  line_amount: number
  line_gst: number
}

export interface PDFDocumentData {
  docType: 'TAX_INVOICE' | 'PROFORMA_INVOICE' | 'PACKING_LIST' | 'PURCHASE_ORDER' | 'GRN' | 'DELIVERY_CHALLAN'
  docNumber: string
  docDate: string
  soNumber?: string
  poNumber?: string
  customer?: PDFCustomer
  supplier?: { name: string; gstin?: string; address?: string }
  lines: PDFLineItem[]
  subtotal: number
  totalGst: number
  grandTotal: number
  notes?: string
  // For packing list / GRN
  packedLines?: Array<{ sku: string; qty: number; rack?: string }>
  unpacked?: Array<{ sku: string; qty: number; reason?: string }>
}

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(n)
}

function numberToWords(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  if (n === 0) return 'Zero'
  function convert(num: number): string {
    if (num < 20) return ones[num]
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '')
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + convert(num % 100) : '')
    if (num < 100000) return convert(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + convert(num % 1000) : '')
    if (num < 10000000) return convert(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 ? ' ' + convert(num % 100000) : '')
    return convert(Math.floor(num / 10000000)) + ' Crore' + (num % 10000000 ? ' ' + convert(num % 10000000) : '')
  }
  const rupees = Math.floor(n)
  const paise = Math.round((n - rupees) * 100)
  let result = convert(rupees) + ' Rupees'
  if (paise > 0) result += ' and ' + convert(paise) + ' Paise'
  return result + ' Only'
}

export function generateAndPrintPDF(data: PDFDocumentData) {
  const DOC_LABELS: Record<string, string> = {
    TAX_INVOICE: 'TAX INVOICE',
    PROFORMA_INVOICE: 'PROFORMA INVOICE',
    PACKING_LIST: 'PACKING LIST',
    PURCHASE_ORDER: 'PURCHASE ORDER',
    GRN: 'GOODS RECEIVED NOTE',
    DELIVERY_CHALLAN: 'DELIVERY CHALLAN',
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>${DOC_LABELS[data.docType]} - ${data.docNumber}</title>
<style>
  @page { size: A4; margin: 12mm 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Arial', sans-serif; font-size: 11px; color: #1a1a1a; background: white; }
  .doc { width: 100%; }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 10px; border-bottom: 2px solid #1e3a5f; margin-bottom: 10px; }
  .company-name { font-size: 20px; font-weight: 800; color: #1e3a5f; letter-spacing: -0.5px; }
  .company-sub { font-size: 10px; color: #555; margin-top: 2px; }
  .doc-title { text-align: right; }
  .doc-type { font-size: 14px; font-weight: 700; color: #1e3a5f; text-transform: uppercase; letter-spacing: 1px; }
  .doc-number { font-size: 16px; font-weight: 800; color: #111; margin-top: 2px; font-family: 'Courier New', monospace; }
  .doc-date { font-size: 10px; color: #555; margin-top: 2px; }

  /* Info grid */
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
  .info-box { border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; }
  .info-box h4 { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 5px; }
  .info-box p { font-size: 11px; font-weight: 600; color: #111; }
  .info-box .sub { font-size: 10px; font-weight: 400; color: #444; margin-top: 1px; }
  .info-box .gstin { font-size: 10px; font-family: 'Courier New', monospace; color: #1e3a5f; margin-top: 3px; }

  /* Table */
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  thead th { background: #1e3a5f; color: white; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; padding: 6px 5px; text-align: left; }
  thead th.right { text-align: right; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tbody td { padding: 5px; font-size: 10px; border-bottom: 1px solid #e8edf2; vertical-align: top; }
  tbody td.right { text-align: right; font-family: 'Courier New', monospace; }
  tbody td .sku { font-size: 9px; color: #888; font-family: 'Courier New', monospace; }
  tfoot td { padding: 5px; font-size: 10px; border-top: 1px solid #1e3a5f; }

  /* Totals */
  .totals { float: right; width: 260px; margin-top: 4px; }
  .totals table { border: 1px solid #e2e8f0; }
  .totals td { padding: 4px 8px; font-size: 10px; }
  .totals td:last-child { text-align: right; font-family: 'Courier New', monospace; }
  .totals .grand { font-weight: 800; font-size: 12px; background: #1e3a5f; color: white; }
  .totals .grand td { color: white; }

  /* Words */
  .amount-words { clear: both; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 7px 10px; margin-top: 8px; font-size: 10px; }
  .amount-words strong { font-size: 9px; text-transform: uppercase; color: #888; display: block; margin-bottom: 2px; }

  /* Notes */
  .notes { margin-top: 8px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px; padding: 7px 10px; font-size: 10px; }
  .notes strong { font-size: 9px; text-transform: uppercase; color: #92400e; display: block; margin-bottom: 2px; }

  /* Footer */
  .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-end; }
  .footer .sig { text-align: right; }
  .footer .sig .line { width: 150px; border-top: 1px solid #555; margin: 24px 0 4px auto; }
  .footer .sig p { font-size: 9px; color: #555; }
  .footer .terms { font-size: 9px; color: #777; max-width: 260px; }

  /* Status tags for packing list */
  .packed-tag { display: inline-block; background: #d1fae5; color: #065f46; border-radius: 3px; padding: 1px 5px; font-size: 9px; font-weight: 600; }
  .unavail-tag { display: inline-block; background: #fee2e2; color: #991b1b; border-radius: 3px; padding: 1px 5px; font-size: 9px; font-weight: 600; }
</style>
</head>
<body>
<div class="doc">

  <!-- Header -->
  <div class="header">
    <div>
      <div class="company-name">RCP Technology</div>
      <div class="company-sub">Computer Components &amp; Peripherals | Mumbai, Maharashtra</div>
    </div>
    <div class="doc-title">
      <div class="doc-type">${DOC_LABELS[data.docType]}</div>
      <div class="doc-number">${data.docNumber}</div>
      <div class="doc-date">Date: ${data.docDate}</div>
      ${data.soNumber ? `<div class="doc-date">SO: ${data.soNumber}</div>` : ''}
    </div>
  </div>

  <!-- Party info -->
  <div class="info-grid">
    <div class="info-box">
      <h4>${data.docType === 'PURCHASE_ORDER' || data.docType === 'GRN' ? 'Supplier' : 'Bill To'}</h4>
      ${data.customer ? `
        <p>${data.customer.name}</p>
        ${data.customer.address_line1 ? `<div class="sub">${data.customer.address_line1}${data.customer.city ? ', ' + data.customer.city : ''}${data.customer.state ? ', ' + data.customer.state : ''}</div>` : ''}
        ${data.customer.gstin ? `<div class="gstin">GSTIN: ${data.customer.gstin}</div>` : ''}
      ` : data.supplier ? `
        <p>${data.supplier.name}</p>
        ${data.supplier.address ? `<div class="sub">${data.supplier.address}</div>` : ''}
        ${data.supplier.gstin ? `<div class="gstin">GSTIN: ${data.supplier.gstin}</div>` : ''}
      ` : '<p>—</p>'}
    </div>
    <div class="info-box">
      <h4>Document Details</h4>
      <div class="sub">Document No: <strong>${data.docNumber}</strong></div>
      <div class="sub">Date: <strong>${data.docDate}</strong></div>
      ${data.soNumber ? `<div class="sub">SO Ref: <strong>${data.soNumber}</strong></div>` : ''}
      ${data.poNumber ? `<div class="sub">PO Ref: <strong>${data.poNumber}</strong></div>` : ''}
    </div>
  </div>

  <!-- Line items table -->
  ${data.lines.length > 0 ? `
  <table>
    <thead>
      <tr>
        <th style="width:30px">#</th>
        <th>Product / Description</th>
        <th>HSN</th>
        <th class="right">Qty</th>
        <th class="right">Unit Price</th>
        <th class="right">Taxable Amt</th>
        <th class="right">GST%</th>
        <th class="right">GST Amt</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${data.lines.map((l, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>
            <strong>${l.description}</strong>
            ${l.sku_code ? `<div class="sku">${l.sku_code}</div>` : ''}
          </td>
          <td>${l.hsn_code ?? '—'}</td>
          <td class="right">${l.qty}</td>
          <td class="right">${formatINR(l.unit_price)}</td>
          <td class="right">${formatINR(l.line_amount)}</td>
          <td class="right">${l.gst_rate}%</td>
          <td class="right">${formatINR(l.line_gst)}</td>
          <td class="right"><strong>${formatINR(l.line_amount + l.line_gst)}</strong></td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  ` : ''}

  <!-- Totals -->
  ${data.lines.length > 0 ? `
  <div class="totals">
    <table>
      <tr><td>Subtotal (excl. GST)</td><td>${formatINR(data.subtotal)}</td></tr>
      <tr><td>Total GST</td><td>${formatINR(data.totalGst)}</td></tr>
      <tr class="grand"><td>Grand Total</td><td>${formatINR(data.grandTotal)}</td></tr>
    </table>
  </div>
  <div style="clear:both"></div>
  <div class="amount-words">
    <strong>Amount in Words</strong>
    ${numberToWords(data.grandTotal)}
  </div>
  ` : ''}

  <!-- Packing list sections -->
  ${data.packedLines && data.packedLines.length > 0 ? `
  <div style="margin-top:12px">
    <h4 style="font-size:11px;font-weight:700;color:#065f46;margin-bottom:5px;">✓ Packed Items (FPPL)</h4>
    <table>
      <thead><tr><th>#</th><th>Product</th><th>Rack Location</th><th class="right">Qty Packed</th><th class="right">Status</th></tr></thead>
      <tbody>
        ${data.packedLines.map((l, i) => `
          <tr><td>${i+1}</td><td>${l.sku}</td><td>${l.rack ?? '—'}</td><td class="right">${l.qty}</td><td class="right"><span class="packed-tag">PACKED</span></td></tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}
  ${data.unpacked && data.unpacked.length > 0 ? `
  <div style="margin-top:8px">
    <h4 style="font-size:11px;font-weight:700;color:#991b1b;margin-bottom:5px;">✗ Unavailable Items (FUPL)</h4>
    <table>
      <thead><tr><th>#</th><th>Product</th><th>Qty</th><th>Reason</th></tr></thead>
      <tbody>
        ${data.unpacked.map((l, i) => `
          <tr><td>${i+1}</td><td>${l.sku}</td><td>${l.qty}</td><td>${l.reason ?? 'Not found in godown'} <span class="unavail-tag">MISMATCH</span></td></tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <!-- Notes -->
  ${data.notes ? `<div class="notes"><strong>Notes / Remarks</strong>${data.notes}</div>` : ''}

  <!-- Footer -->
  <div class="footer">
    <div class="terms">
      <p>• This is a computer-generated document.</p>
      <p>• Goods once sold will not be taken back without prior authorisation.</p>
      <p>• Subject to Mumbai jurisdiction.</p>
    </div>
    <div class="sig">
      <div class="line"></div>
      <p>Authorised Signatory</p>
      <p>RCP Technology</p>
    </div>
  </div>

</div>
<script>window.addEventListener('load', () => { window.print(); })</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) {
    alert('Please allow popups for this site to generate PDFs.')
    return
  }
  win.document.write(html)
  win.document.close()
}

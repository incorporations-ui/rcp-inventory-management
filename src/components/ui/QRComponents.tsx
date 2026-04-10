'use client'
import { useState, useRef, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Download, QrCode, Camera, X, CheckCircle } from 'lucide-react'
import { Modal } from '@/components/ui'
import { generateQRData } from '@/lib/utils'
import toast from 'react-hot-toast'

interface QRViewerProps {
  entityType: string
  entityId: string
  label: string
  subLabel?: string
}

export function QRViewer({ entityType, entityId, label, subLabel }: QRViewerProps) {
  const [open, setOpen] = useState(false)
  const qrData = generateQRData(entityType, entityId)

  function downloadQR() {
    const svg = document.getElementById(`qr-${entityId}`)?.querySelector('svg')
    if (!svg) return
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `QR_${entityType}_${label.replace(/\s/g, '_')}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost btn-sm" title="View QR Code">
        <QrCode className="w-4 h-4" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="QR Code" size="sm">
        <div className="flex flex-col items-center gap-4">
          <div id={`qr-${entityId}`} className="p-4 bg-white border border-slate-200 rounded-xl">
            <QRCodeSVG value={qrData} size={200} level="M" includeMargin />
          </div>
          <div className="text-center">
            <p className="font-semibold text-slate-900">{label}</p>
            {subLabel && <p className="text-sm text-slate-500 mt-0.5">{subLabel}</p>}
            <p className="text-xs text-slate-400 font-mono mt-2 bg-slate-50 px-3 py-1.5 rounded">{qrData}</p>
          </div>
          <button onClick={downloadQR} className="btn-secondary w-full justify-center">
            <Download className="w-4 h-4" /> Download QR
          </button>
        </div>
      </Modal>
    </>
  )
}

// ── Bulk QR Print ─────────────────────────────────────────────────────────
interface BulkQRItem {
  entityType: string
  entityId: string
  label: string
  subLabel?: string
}

export function BulkQRPrint({ items }: { items: BulkQRItem[] }) {
  const [open, setOpen] = useState(false)

  function handlePrint() {
    window.print()
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-secondary btn-sm">
        <QrCode className="w-4 h-4" /> Print QR Codes
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Print ${items.length} QR Codes`} size="xl">
        <div className="grid grid-cols-3 gap-4 print:grid-cols-4">
          {items.map(item => (
            <div key={item.entityId} className="flex flex-col items-center gap-2 p-3 border border-slate-200 rounded-lg">
              <QRCodeSVG value={generateQRData(item.entityType, item.entityId)} size={100} level="M" />
              <div className="text-center">
                <p className="text-xs font-medium text-slate-900 leading-tight">{item.label}</p>
                {item.subLabel && <p className="text-xs text-slate-500">{item.subLabel}</p>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4 no-print">
          <button onClick={() => setOpen(false)} className="btn-secondary btn-sm">Close</button>
          <button onClick={handlePrint} className="btn-primary btn-sm">Print All</button>
        </div>
      </Modal>
    </>
  )
}

// ── QR Scanner (camera) ──────────────────────────────────────────────────
interface QRScannerProps {
  onScan: (data: string) => void
  label?: string
}

export function QRScanner({ onScan, label = 'Scan QR Code' }: QRScannerProps) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [manualInput, setManualInput] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanningRef = useRef(false)  // ← ref flag avoids stale closure bug

  async function startCamera() {
    setError('')
    scanningRef.current = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
      // Use BarcodeDetector if available
      if ('BarcodeDetector' in window) {
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
        const scan = async () => {
          if (!videoRef.current || !scanningRef.current) return  // ← use ref, not stale 'open'
          try {
            const barcodes = await detector.detect(videoRef.current)
            if (barcodes.length > 0) {
              handleScanned(barcodes[0].rawValue)
              return
            }
          } catch {}
          requestAnimationFrame(scan)
        }
        requestAnimationFrame(scan)
      }
    } catch (err) {
      setError('Camera access denied. Please use manual input below.')
    }
  }

  function stopCamera() {
    scanningRef.current = false  // ← stops the rAF loop immediately
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function handleScanned(data: string) {
    stopCamera()
    setOpen(false)
    onScan(data)
    toast.success('QR code scanned!')
  }

  function handleManual() {
    if (!manualInput.trim()) return
    handleScanned(manualInput.trim())
    setManualInput('')
  }

  useEffect(() => {
    if (open) startCamera()
    else stopCamera()
    return () => stopCamera()
  }, [open])

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-secondary btn-sm">
        <Camera className="w-4 h-4" /> {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={label} size="sm">
        <div className="space-y-4">
          <div className="rounded-xl overflow-hidden bg-black aspect-square">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {!('BarcodeDetector' in window) && (
            <p className="text-amber-600 text-sm">Auto-detection not supported. Use manual input below.</p>
          )}
          <div className="divider" />
          <p className="text-xs text-slate-500 font-medium">Or enter QR data manually:</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleManual()}
              className="input flex-1"
              placeholder="RCP:SKU:uuid..."
            />
            <button onClick={handleManual} className="btn-primary btn-sm flex-shrink-0">Confirm</button>
          </div>
        </div>
      </Modal>
    </>
  )
}

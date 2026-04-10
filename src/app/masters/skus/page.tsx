'use client'
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, Modal, FormField, StatusBadge } from '@/components/ui'
import { MasterList } from '@/components/masters/MasterList'
import { useAuth } from '@/hooks/useAuth'
import { canEdit } from '@/lib/utils'
import type { SKU } from '@/types'
import toast from 'react-hot-toast'
import { Wand2 } from 'lucide-react'

type FormData = {
  brand_id: string
  sku_code: string
  display_name: string
  hsn_code: string
  gst_rate: number
  units_per_box: number
}

// Build SKU code: <BRAND_FULL_CODE>-<ATTR1_VALUE>-<ATTR2_VALUE>...
// e.g. WD-STG-HDD-INT-PPL-2TB-7200RPM
function buildSKUCode(brandCode: string, attrValues: Record<string, string>, attrDefs: any[]): string {
  const parts = [brandCode]
  attrDefs
    .filter(d => attrValues[d.id]?.trim())
    .sort((a, b) => a.sort_order - b.sort_order)
    .forEach(d => {
      const val = attrValues[d.id].trim().toUpperCase().replace(/\s+/g, '')
      const unit = d.attribute_unit ? d.attribute_unit.toUpperCase() : ''
      parts.push(unit ? `${val}${unit}` : val)
    })
  return parts.join('-')
}

export default function SKUsPage() {
  const [data, setData] = useState<SKU[]>([])
  const [brands, setBrands] = useState<any[]>([])
  const [attrDefs, setAttrDefs] = useState<any[]>([])
  const [attrValues, setAttrValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<SKU | null>(null)
  const [saving, setSaving] = useState(false)
  const [skuCodePreview, setSkuCodePreview] = useState('')
  const [autoCode, setAutoCode] = useState(true)
  const { profile } = useAuth()
  const supabase = createClient()
  const canWrite = canEdit(profile?.role ?? '', 'masters')

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormData>({
    defaultValues: { gst_rate: 18, units_per_box: 1 }
  })
  const selectedBrandId = watch('brand_id')
  const manualCode = watch('sku_code')

  // Update preview whenever brand or attributes change
  useEffect(() => {
    if (!autoCode) return
    const brand = brands.find(b => b.id === selectedBrandId)
    if (brand) {
      const preview = buildSKUCode(brand.code, attrValues, attrDefs)
      setSkuCodePreview(preview)
      setValue('sku_code', preview)
    }
  }, [selectedBrandId, attrValues, attrDefs, autoCode, brands])

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    if (!selectedBrandId) { setAttrDefs([]); setAttrValues({}); return }
    const brand = brands.find(b => b.id === selectedBrandId)
    if (brand?.item_category_id) loadAttrDefs(brand.item_category_id)
  }, [selectedBrandId, brands])

  async function loadData() {
    setLoading(true)
    const [{ data: skus }, { data: brnds }] = await Promise.all([
      supabase.from('skus').select('*, brands(name, code, manufacturers(name), item_categories(name))').order('display_name'),
      supabase.from('brands').select('*, manufacturers(name, code), item_categories(name, code, product_categories(name, code))').eq('status', 'active').order('name'),
    ])
    setData(skus ?? [])
    setBrands(brnds ?? [])
    setLoading(false)
  }

  async function loadAttrDefs(itemCategoryId: string) {
    const { data } = await supabase.from('sku_attribute_definitions').select('*').eq('item_category_id', itemCategoryId).eq('status', 'active').order('sort_order')
    setAttrDefs(data ?? [])
  }

  function openAdd() {
    setEditing(null)
    setAttrValues({})
    setAttrDefs([])
    setSkuCodePreview('')
    setAutoCode(true)
    reset({ brand_id: '', sku_code: '', display_name: '', hsn_code: '', gst_rate: 18, units_per_box: 1 })
    setModalOpen(true)
  }

  async function openEdit(item: SKU) {
    setEditing(item)
    setAutoCode(false) // When editing, don't auto-overwrite code
    reset({
      brand_id: item.brand_id,
      sku_code: item.sku_code,
      display_name: item.display_name,
      hsn_code: item.hsn_code ?? '',
      gst_rate: item.gst_rate,
      units_per_box: item.units_per_box,
    })
    setSkuCodePreview(item.sku_code)
    const { data: attrs } = await supabase.from('sku_attributes').select('*, sku_attribute_definitions(*)').eq('sku_id', item.id)
    const vals: Record<string, string> = {}
    attrs?.forEach(a => { vals[a.attribute_definition_id] = a.value })
    setAttrValues(vals)
    setModalOpen(true)
  }

  function updateAttrValue(defId: string, value: string) {
    setAttrValues(v => ({ ...v, [defId]: value }))
  }

  async function onSubmit(values: FormData) {
    setSaving(true)
    const finalCode = values.sku_code.trim().toUpperCase()
    const payload = {
      brand_id: values.brand_id,
      sku_code: finalCode,
      display_name: values.display_name.trim(),
      hsn_code: values.hsn_code?.trim() || null,
      gst_rate: Number(values.gst_rate),
      units_per_box: Number(values.units_per_box),
    }

    let skuId = editing?.id
    let error: any

    if (editing) {
      ({ error } = await supabase.from('skus').update(payload).eq('id', editing.id))
    } else {
      const { data: ins, error: insErr } = await supabase.from('skus').insert({ ...payload, created_by: profile?.id }).select().single()
      error = insErr
      skuId = ins?.id
    }

    if (error) {
      toast.error(error.message.includes('unique') ? `SKU code "${finalCode}" already exists` : error.message)
      setSaving(false)
      return
    }

    // Save attributes
    if (skuId && attrDefs.length > 0) {
      await supabase.from('sku_attributes').delete().eq('sku_id', skuId)
      const attrRows = attrDefs
        .filter(d => attrValues[d.id]?.trim())
        .map(d => ({ sku_id: skuId, attribute_definition_id: d.id, value: attrValues[d.id] }))
      if (attrRows.length > 0) await supabase.from('sku_attributes').insert(attrRows)
    }

    toast.success(editing ? 'SKU updated' : 'SKU created')
    setModalOpen(false)
    loadData()
    setSaving(false)
  }

  async function toggleStatus(item: SKU) {
    await supabase.from('skus').update({ status: item.status === 'active' ? 'inactive' : 'active' }).eq('id', item.id)
    toast.success('Status updated'); loadData()
  }

  const columns = [
    { key: 'sku_code', label: 'SKU Code', render: (r: SKU) => <code className="text-xs bg-slate-100 px-2 py-0.5 rounded font-mono break-all">{r.sku_code}</code> },
    { key: 'display_name', label: 'Name', render: (r: SKU) => <span className="font-medium">{r.display_name}</span> },
    { key: 'brand', label: 'Brand', render: (r: SKU) => (r.brand as any)?.name ?? '—' },
    { key: 'manufacturer', label: 'Manufacturer', render: (r: SKU) => (r.brand as any)?.manufacturers?.name ?? '—' },
    { key: 'hsn_code', label: 'HSN', render: (r: SKU) => r.hsn_code ? <code className="text-xs">{r.hsn_code}</code> : <span className="text-slate-300">—</span> },
    { key: 'gst_rate', label: 'GST %', render: (r: SKU) => `${r.gst_rate}%` },
    { key: 'units_per_box', label: 'Units/Box' },
    { key: 'status', label: 'Status', render: (r: SKU) => <StatusBadge status={r.status} /> },
  ]

  return (
    <AppLayout>
      <PageGuard>
        <MasterList
          title="SKUs"
          entityType="sku"
          columns={columns}
          data={data}
          loading={loading}
          onAdd={openAdd}
          onEdit={openEdit}
          onToggleStatus={toggleStatus}
          searchValue={search}
          onSearchChange={setSearch}
          canEdit={canWrite}
          formModal={
            <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit SKU' : 'Add SKU'} size="lg">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="form-grid">
                  <FormField label="Brand" required error={errors.brand_id?.message}>
                    <select {...register('brand_id', { required: 'Required' })} className="select">
                      <option value="">Select brand...</option>
                      {brands.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name} — <code>{b.code}</code>
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Display Name" required error={errors.display_name?.message}>
                    <input {...register('display_name', { required: 'Required' })} className="input" placeholder="e.g. WD My Passport 2TB USB 3.0 External HDD" />
                  </FormField>
                </div>

                {/* Attributes — shown as soon as brand is selected and defs load */}
                {attrDefs.length > 0 && (
                  <div>
                    <div className="divider" />
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-slate-700">Technical Specifications</h4>
                      <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                        <input type="checkbox" checked={autoCode} onChange={e => setAutoCode(e.target.checked)} className="w-3.5 h-3.5" />
                        Auto-generate SKU code from specs
                      </label>
                    </div>
                    <div className="form-grid">
                      {attrDefs.map(def => (
                        <FormField key={def.id} label={`${def.attribute_name}${def.attribute_unit ? ` (${def.attribute_unit})` : ''}`} required={def.is_required}>
                          <input
                            value={attrValues[def.id] ?? ''}
                            onChange={e => updateAttrValue(def.id, e.target.value)}
                            className="input"
                            placeholder={`Enter ${def.attribute_name.toLowerCase()}...`}
                          />
                        </FormField>
                      ))}
                    </div>
                  </div>
                )}

                {/* SKU Code */}
                <div className="divider" />
                <FormField label="SKU Code" required error={errors.sku_code?.message} hint={autoCode ? 'Auto-generated from brand + specs — uncheck above to override' : 'Edit manually'}>
                  <div className="flex gap-2">
                    <input
                      {...register('sku_code', { required: 'Required' })}
                      className="input font-mono text-sm flex-1"
                      readOnly={autoCode}
                      placeholder="Will be auto-generated..."
                    />
                    {autoCode && skuCodePreview && (
                      <div className="flex items-center px-3 bg-brand-50 border border-brand-200 rounded-lg">
                        <Wand2 className="w-3.5 h-3.5 text-brand-500" />
                      </div>
                    )}
                  </div>
                </FormField>

                {skuCodePreview && autoCode && (
                  <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-3">
                    <p className="text-xs text-slate-500 mb-1">Generated SKU code:</p>
                    <code className="font-mono font-bold text-brand-700 text-sm break-all">{skuCodePreview}</code>
                  </div>
                )}

                <div className="form-grid-3">
                  <FormField label="HSN Code" error={errors.hsn_code?.message}>
                    <input {...register('hsn_code')} className="input" placeholder="e.g. 84717090" />
                  </FormField>
                  <FormField label="GST Rate (%)" required>
                    <input type="number" {...register('gst_rate', { required: 'Required', min: 0, max: 100 })} className="input" step="0.01" />
                  </FormField>
                  <FormField label="Units per Box" required hint="Standard box qty from ND">
                    <input type="number" {...register('units_per_box', { required: 'Required', min: 1 })} className="input" />
                  </FormField>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Update SKU' : 'Create SKU'}</button>
                </div>
              </form>
            </Modal>
          }
        />
      </PageGuard>
    </AppLayout>
  )
}

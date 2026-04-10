'use client'
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, Modal, FormField, StatusBadge } from '@/components/ui'
import { MasterList } from '@/components/masters/MasterList'
import { useAuth } from '@/hooks/useAuth'
import { canEdit } from '@/lib/utils'
import toast from 'react-hot-toast'

// Brand code = <MFG_CODE>-<IC_CODE>-<BRAND_SUFFIX>
// e.g. WD-STG-HDD-INT-PPL
function buildBrandCode(mfgCode: string, icCode: string, brandSuffix: string): string {
  const parts = [mfgCode, icCode, brandSuffix].map(s => s.trim().toUpperCase()).filter(Boolean)
  return parts.join('-')
}

type FormData = { manufacturer_id: string; item_category_id: string; name: string; code: string }

export default function BrandsPage() {
  const [data, setData] = useState<any[]>([])
  const [manufacturers, setManufacturers] = useState<any[]>([])
  const [itemCategories, setItemCategories] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [codePreview, setCodePreview] = useState('')
  const { profile } = useAuth()
  const supabase = createClient()
  const canWrite = canEdit(profile?.role ?? '', 'masters')

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormData>()
  const watchMfgId = watch('manufacturer_id')
  const watchIcId = watch('item_category_id')
  const watchCode = watch('code')

  // Live preview of final brand code
  useEffect(() => {
    const mfg = manufacturers.find(m => m.id === watchMfgId)
    const ic = itemCategories.find(i => i.id === watchIcId)
    if (mfg && ic && watchCode) {
      setCodePreview(buildBrandCode(mfg.code, ic.code, watchCode))
    } else {
      setCodePreview('')
    }
  }, [watchMfgId, watchIcId, watchCode, manufacturers, itemCategories])

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [{ data: brands }, { data: mfrs }, { data: ics }] = await Promise.all([
      supabase.from('brands').select('*, manufacturers(name, code), item_categories(name, code, product_categories(name, code))').order('name'),
      supabase.from('manufacturers').select('id, name, code').eq('status', 'active').order('name'),
      supabase.from('item_categories').select('id, name, code, product_categories(name, code)').eq('status', 'active').order('name'),
    ])
    setData(brands ?? [])
    setManufacturers(mfrs ?? [])
    setItemCategories(ics ?? [])
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    setCodePreview('')
    reset({ manufacturer_id: '', item_category_id: '', name: '', code: '' })
    setModalOpen(true)
  }

  function openEdit(item: any) {
    setEditing(item)
    // Reverse-engineer the suffix from the stored code
    const mfg = manufacturers.find(m => m.id === item.manufacturer_id)
    const ic = itemCategories.find(i => i.id === item.item_category_id)
    const prefix = buildBrandCode(mfg?.code ?? '', ic?.code ?? '', '')
    const suffix = item.code.startsWith(prefix) ? item.code.slice(prefix.length) : item.code
    setCodePreview(item.code)
    reset({ manufacturer_id: item.manufacturer_id, item_category_id: item.item_category_id, name: item.name, code: suffix })
    setModalOpen(true)
  }

  async function onSubmit(values: FormData) {
    setSaving(true)
    const mfg = manufacturers.find(m => m.id === values.manufacturer_id)
    const ic = itemCategories.find(i => i.id === values.item_category_id)
    const finalCode = buildBrandCode(mfg?.code ?? '', ic?.code ?? '', values.code)

    const payload = {
      manufacturer_id: values.manufacturer_id,
      item_category_id: values.item_category_id,
      name: values.name.trim(),
      code: finalCode,
    }
    const { error } = editing
      ? await supabase.from('brands').update(payload).eq('id', editing.id)
      : await supabase.from('brands').insert({ ...payload, created_by: profile?.id })
    if (error) toast.error(error.message.includes('unique') ? `Code "${finalCode}" already exists` : error.message)
    else { toast.success('Saved'); setModalOpen(false); loadData() }
    setSaving(false)
  }

  async function toggleStatus(item: any) {
    await supabase.from('brands').update({ status: item.status === 'active' ? 'inactive' : 'active' }).eq('id', item.id)
    toast.success('Status updated'); loadData()
  }

  const columns = [
    { key: 'name', label: 'Brand Name', render: (r: any) => <span className="font-medium">{r.name}</span> },
    { key: 'code', label: 'Full Code', render: (r: any) => <code className="text-xs bg-slate-100 px-2 py-0.5 rounded font-mono">{r.code}</code> },
    { key: 'manufacturer', label: 'Manufacturer', render: (r: any) => <span>{r.manufacturers?.name} <code className="text-xs text-slate-400">({r.manufacturers?.code})</code></span> },
    { key: 'item_category', label: 'Item Category', render: (r: any) => (
      <div>
        <p className="text-sm">{r.item_categories?.name}</p>
        <p className="text-xs text-slate-400">{r.item_categories?.product_categories?.name}</p>
      </div>
    )},
    { key: 'status', label: 'Status', render: (r: any) => <StatusBadge status={r.status} /> },
  ]

  return (
    <AppLayout>
      <PageGuard>
        <MasterList
          title="Brands"
          entityType="brand"
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
            <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Brand' : 'Add Brand'} size="md">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-500">
                  Brand code is built as: <code className="font-mono">MFG_CODE - ITEM_CATEGORY_CODE - YOUR_SUFFIX</code>
                </div>
                <FormField label="Manufacturer" required error={errors.manufacturer_id?.message}>
                  <select {...register('manufacturer_id', { required: 'Required' })} className="select">
                    <option value="">Select manufacturer...</option>
                    {manufacturers.map(m => <option key={m.id} value={m.id}>{m.name} ({m.code})</option>)}
                  </select>
                </FormField>
                <FormField label="Item Category" required error={errors.item_category_id?.message}>
                  <select {...register('item_category_id', { required: 'Required' })} className="select">
                    <option value="">Select item category...</option>
                    {itemCategories.map(ic => (
                      <option key={ic.id} value={ic.id}>
                        {ic.name} — <code>{ic.code}</code>
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Brand Name" required error={errors.name?.message} hint="e.g. WD My Passport">
                  <input {...register('name', { required: 'Required' })} className="input" placeholder="e.g. WD My Passport" />
                </FormField>
                <FormField label="Brand Suffix Code" required error={errors.code?.message} hint="Short suffix added after MFG and IC codes">
                  <input
                    {...register('code', { required: 'Required' })}
                    className="input font-mono uppercase"
                    placeholder="e.g. PPL"
                    onChange={e => setValue('code', e.target.value.toUpperCase())}
                  />
                </FormField>
                {codePreview && (
                  <div className="bg-brand-50 rounded-lg px-3 py-2.5">
                    <p className="text-xs text-slate-500 mb-0.5">Final brand code:</p>
                    <code className="font-mono font-bold text-brand-700 text-sm">{codePreview}</code>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Add Brand'}</button>
                </div>
              </form>
            </Modal>
          }
        />
      </PageGuard>
    </AppLayout>
  )
}

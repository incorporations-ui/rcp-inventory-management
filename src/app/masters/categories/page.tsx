'use client'
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, Modal, FormField, StatusBadge, PageLoader, SearchInput } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { canEdit } from '@/lib/utils'
import { Plus, Pencil, Power, PowerOff, ChevronDown, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'

export default function CategoriesPage() {
  const [productCategories, setProductCategories] = useState<any[]>([])
  const [itemCategories, setItemCategories] = useState<any[]>([])
  const [attrDefs, setAttrDefs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  // Modals
  const [pcModal, setPcModal] = useState(false)
  const [icModal, setIcModal] = useState(false)
  const [attrModal, setAttrModal] = useState(false)
  const [editingPc, setEditingPc] = useState<any>(null)
  const [editingIc, setEditingIc] = useState<any>(null)
  const [editingAttr, setEditingAttr] = useState<any>(null)
  const [selectedPcId, setSelectedPcId] = useState('')
  const [selectedIcId, setSelectedIcId] = useState('')
  const [saving, setSaving] = useState(false)
  const { profile } = useAuth()
  const supabase = createClient()
  const canWrite = canEdit(profile?.role ?? '', 'masters')

  const pcForm = useForm<{ name: string; code: string }>()
  const icForm = useForm<{ name: string; code: string; product_category_id: string }>()
  const attrForm = useForm<{ attribute_name: string; attribute_unit: string; sort_order: number; is_required: boolean }>()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [{ data: pcs }, { data: ics }, { data: attrs }] = await Promise.all([
      supabase.from('product_categories').select('*').order('name'),
      supabase.from('item_categories').select('*, product_categories(name)').order('name'),
      supabase.from('sku_attribute_definitions').select('*, item_categories(name)').order('sort_order'),
    ])
    setProductCategories(pcs ?? [])
    setItemCategories(ics ?? [])
    setAttrDefs(attrs ?? [])
    setLoading(false)
  }

  // Product Category CRUD
  async function savePc(values: any) {
    setSaving(true)
    const p = { name: values.name.trim(), code: values.code.trim().toUpperCase() }
    const { error } = editingPc
      ? await supabase.from('product_categories').update(p).eq('id', editingPc.id)
      : await supabase.from('product_categories').insert({ ...p, created_by: profile?.id })
    if (error) toast.error(error.message)
    else { toast.success('Saved'); setPcModal(false); loadData() }
    setSaving(false)
  }

  async function saveIc(values: any) {
    setSaving(true)
    const p = { name: values.name.trim(), code: values.code.trim().toUpperCase(), product_category_id: values.product_category_id }
    const { error } = editingIc
      ? await supabase.from('item_categories').update(p).eq('id', editingIc.id)
      : await supabase.from('item_categories').insert({ ...p, created_by: profile?.id })
    if (error) toast.error(error.message)
    else { toast.success('Saved'); setIcModal(false); loadData() }
    setSaving(false)
  }

  async function saveAttr(values: any) {
    setSaving(true)
    const p = {
      item_category_id: selectedIcId, attribute_name: values.attribute_name.trim(),
      attribute_unit: values.attribute_unit?.trim() || null,
      sort_order: Number(values.sort_order) || 0, is_required: !!values.is_required,
    }
    const { error } = editingAttr
      ? await supabase.from('sku_attribute_definitions').update(p).eq('id', editingAttr.id)
      : await supabase.from('sku_attribute_definitions').insert(p)
    if (error) toast.error(error.message)
    else { toast.success('Saved'); setAttrModal(false); loadData() }
    setSaving(false)
  }

  const filteredPcs = productCategories.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <AppLayout>
      <PageGuard roles={['admin', 'sales_manager', 'accounts', 'view_only']}>
        <div className="space-y-4">
          <div className="page-header">
            <div>
              <h1 className="page-title">Product & Item Categories</h1>
              <p className="text-sm text-slate-500 mt-0.5">Manage the product hierarchy and attribute definitions</p>
            </div>
            <div className="flex items-center gap-2">
              <SearchInput value={search} onChange={setSearch} />
              {canWrite && (
                <button onClick={() => { setEditingPc(null); pcForm.reset({ name: '', code: '' }); setPcModal(true) }} className="btn-primary">
                  <Plus className="w-4 h-4" /> Product Category
                </button>
              )}
            </div>
          </div>

          {loading ? <PageLoader /> : (
            <div className="space-y-3">
              {filteredPcs.map(pc => {
                const ics = itemCategories.filter(ic => ic.product_category_id === pc.id)
                const isExpanded = expanded === pc.id
                return (
                  <div key={pc.id} className="card">
                    {/* Product Category row */}
                    <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(isExpanded ? null : pc.id)}>
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                        <div>
                          <span className="font-semibold text-slate-900">{pc.name}</span>
                          <code className="ml-3 text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded">{pc.code}</code>
                        </div>
                        <StatusBadge status={pc.status} />
                        <span className="text-xs text-slate-400">{ics.length} item categories</span>
                      </div>
                      {canWrite && (
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          <button onClick={() => { setEditingPc(pc); pcForm.reset({ name: pc.name, code: pc.code }); setPcModal(true) }} className="btn-ghost btn-sm"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => { setSelectedPcId(pc.id); setEditingIc(null); icForm.reset({ name: '', code: '', product_category_id: pc.id }); setIcModal(true) }} className="btn-secondary btn-sm text-brand-600"><Plus className="w-3.5 h-3.5" /> Item Category</button>
                        </div>
                      )}
                    </div>

                    {/* Item categories */}
                    {isExpanded && ics.map(ic => {
                      const attrs = attrDefs.filter(a => a.item_category_id === ic.id)
                      return (
                        <div key={ic.id} className="border-t border-slate-100 ml-10">
                          <div className="flex items-center justify-between px-5 py-3 bg-slate-50/50">
                            <div className="flex items-center gap-3">
                              <span className="font-medium text-sm">{ic.name}</span>
                              <code className="text-xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">{ic.code}</code>
                              <StatusBadge status={ic.status} />
                              <span className="text-xs text-slate-400">{attrs.length} attributes</span>
                            </div>
                            {canWrite && (
                              <div className="flex gap-1">
                                <button onClick={() => { setEditingIc(ic); icForm.reset({ name: ic.name, code: ic.code, product_category_id: ic.product_category_id }); setIcModal(true) }} className="btn-ghost btn-sm"><Pencil className="w-3.5 h-3.5" /></button>
                                <button onClick={() => { setSelectedIcId(ic.id); setEditingAttr(null); attrForm.reset({ attribute_name: '', attribute_unit: '', sort_order: attrs.length, is_required: false }); setAttrModal(true) }} className="btn-ghost btn-sm text-purple-600"><Plus className="w-3.5 h-3.5" /> Attribute</button>
                              </div>
                            )}
                          </div>
                          {/* Attributes */}
                          {attrs.length > 0 && (
                            <div className="px-5 py-2 flex flex-wrap gap-2">
                              {attrs.map(a => (
                                <div key={a.id} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-3 py-1 text-xs">
                                  <span className="font-medium">{a.attribute_name}</span>
                                  {a.attribute_unit && <span className="text-slate-400">({a.attribute_unit})</span>}
                                  {a.is_required && <span className="text-red-500">*</span>}
                                  {canWrite && <button onClick={() => { setSelectedIcId(ic.id); setEditingAttr(a); attrForm.reset({ attribute_name: a.attribute_name, attribute_unit: a.attribute_unit ?? '', sort_order: a.sort_order, is_required: a.is_required }); setAttrModal(true) }}><Pencil className="w-2.5 h-2.5 text-slate-400 hover:text-slate-700" /></button>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Product Category modal */}
        <Modal open={pcModal} onClose={() => setPcModal(false)} title={editingPc ? 'Edit Product Category' : 'Add Product Category'} size="sm">
          <form onSubmit={pcForm.handleSubmit(savePc)} className="space-y-4">
            <FormField label="Name" required><input {...pcForm.register('name', { required: true })} className="input" placeholder="e.g. Storage" /></FormField>
            <FormField label="Code" required hint="Short uppercase code"><input {...pcForm.register('code', { required: true })} className="input" placeholder="e.g. STG" /></FormField>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setPcModal(false)} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></div>
          </form>
        </Modal>

        {/* Item Category modal */}
        <Modal open={icModal} onClose={() => setIcModal(false)} title={editingIc ? 'Edit Item Category' : 'Add Item Category'} size="sm">
          <form onSubmit={icForm.handleSubmit(saveIc)} className="space-y-4">
            <FormField label="Product Category" required>
              <select {...icForm.register('product_category_id', { required: true })} className="select">
                <option value="">Select...</option>
                {productCategories.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
            <FormField label="Name" required><input {...icForm.register('name', { required: true })} className="input" placeholder="e.g. HDD - External" /></FormField>
            <FormField label="Code" required><input {...icForm.register('code', { required: true })} className="input" placeholder="e.g. HDD-EXT" /></FormField>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setIcModal(false)} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></div>
          </form>
        </Modal>

        {/* Attribute Definition modal */}
        <Modal open={attrModal} onClose={() => setAttrModal(false)} title={editingAttr ? 'Edit Attribute' : 'Add SKU Attribute'} size="sm">
          <form onSubmit={attrForm.handleSubmit(saveAttr)} className="space-y-4">
            <FormField label="Attribute Name" required hint="e.g. Capacity, RPM, Interface"><input {...attrForm.register('attribute_name', { required: true })} className="input" /></FormField>
            <FormField label="Unit" hint="e.g. TB, GB, RPM, MHz (leave blank if none)"><input {...attrForm.register('attribute_unit')} className="input" /></FormField>
            <FormField label="Sort Order"><input type="number" {...attrForm.register('sort_order')} className="input" min={0} /></FormField>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="req" {...attrForm.register('is_required')} className="w-4 h-4" />
              <label htmlFor="req" className="text-sm text-slate-700">Required field when creating SKU</label>
            </div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setAttrModal(false)} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></div>
          </form>
        </Modal>
      </PageGuard>
    </AppLayout>
  )
}

'use client'
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, Modal, FormField, StatusBadge } from '@/components/ui'
import { MasterList } from '@/components/masters/MasterList'
import { useAuth } from '@/hooks/useAuth'
import { canEdit } from '@/lib/utils'
import type { Supplier } from '@/types'
import toast from 'react-hot-toast'

type FormData = {
  name: string; code: string; gstin: string
  address_line1: string; city: string; state: string
  contact_name: string; contact_phone: string; contact_email: string
}

const STATES = ['Andhra Pradesh','Gujarat','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Punjab','Rajasthan','Tamil Nadu','Telangana','Uttar Pradesh','West Bengal','Delhi','Others']

export default function SuppliersPage() {
  const [data, setData] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [saving, setSaving] = useState(false)
  const { profile } = useAuth()
  const supabase = createClient()
  const canWrite = canEdit(profile?.role ?? '', 'customers_suppliers')
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: rows } = await supabase.from('suppliers').select('*').order('name')
    setData(rows ?? [])
    setLoading(false)
  }

  function openAdd() { setEditing(null); reset({}); setModalOpen(true) }
  function openEdit(item: Supplier) { setEditing(item); reset(item as any); setModalOpen(true) }

  async function onSubmit(values: FormData) {
    setSaving(true)
    const payload = { ...values, code: values.code.trim().toUpperCase(), gstin: values.gstin?.trim() || null }
    const { error } = editing
      ? await supabase.from('suppliers').update(payload).eq('id', editing.id)
      : await supabase.from('suppliers').insert({ ...payload, created_by: profile?.id })
    if (error) toast.error(error.message.includes('unique') ? 'Supplier code already exists' : error.message)
    else { toast.success('Saved'); setModalOpen(false); loadData() }
    setSaving(false)
  }

  async function toggleStatus(item: Supplier) {
    await supabase.from('suppliers').update({ status: item.status === 'active' ? 'inactive' : 'active' }).eq('id', item.id)
    toast.success('Status updated'); loadData()
  }

  const columns = [
    { key: 'name', label: 'Supplier Name', render: (r: Supplier) => <span className="font-medium">{r.name}</span> },
    { key: 'code', label: 'Code', render: (r: Supplier) => <code className="text-xs bg-slate-100 px-2 py-0.5 rounded">{r.code}</code> },
    { key: 'city', label: 'Location', render: (r: Supplier) => r.city ? `${r.city}, ${r.state ?? ''}` : '—' },
    { key: 'contact_phone', label: 'Phone', render: (r: Supplier) => r.contact_phone ?? '—' },
    { key: 'gstin', label: 'GSTIN', render: (r: Supplier) => r.gstin ? <code className="text-xs">{r.gstin}</code> : <span className="text-slate-300">—</span> },
    { key: 'status', label: 'Status', render: (r: Supplier) => <StatusBadge status={r.status} /> },
  ]

  return (
    <AppLayout>
      <PageGuard>
        <MasterList
          title="Suppliers (National Distributors)"
          entityType="supplier"
          columns={columns}
          data={data}
          loading={loading}
          onAdd={openAdd}
          onEdit={openEdit}
          onToggleStatus={toggleStatus}
          searchValue={search}
          onSearchChange={setSearch}
          canEdit={canWrite}
          showQR={false}
          formModal={
            <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Supplier' : 'Add Supplier'} size="lg">
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="form-grid">
                  <FormField label="Name" required error={errors.name?.message}><input {...register('name', { required: 'Required' })} className="input" placeholder="Supplier / Company name" /></FormField>
                  <FormField label="Code" required error={errors.code?.message}><input {...register('code', { required: 'Required' })} className="input" placeholder="e.g. ND001" /></FormField>
                </div>
                <FormField label="GSTIN"><input {...register('gstin')} className="input font-mono" placeholder="22AAAAA0000A1Z5" maxLength={15} /></FormField>
                <div className="form-grid-3">
                  <FormField label="Address"><input {...register('address_line1')} className="input" /></FormField>
                  <FormField label="City"><input {...register('city')} className="input" /></FormField>
                  <FormField label="State"><select {...register('state')} className="select"><option value="">Select</option>{STATES.map(s => <option key={s}>{s}</option>)}</select></FormField>
                </div>
                <div className="form-grid-3">
                  <FormField label="Contact Person"><input {...register('contact_name')} className="input" /></FormField>
                  <FormField label="Phone"><input {...register('contact_phone')} className="input" /></FormField>
                  <FormField label="Email"><input type="email" {...register('contact_email')} className="input" /></FormField>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Add Supplier'}</button>
                </div>
              </form>
            </Modal>
          }
        />
      </PageGuard>
    </AppLayout>
  )
}

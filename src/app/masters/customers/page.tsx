'use client'
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, Modal, FormField, StatusBadge } from '@/components/ui'
import { MasterList } from '@/components/masters/MasterList'
import { useAuth } from '@/hooks/useAuth'
import { canEdit } from '@/lib/utils'
import type { Customer } from '@/types'
import toast from 'react-hot-toast'

type FormData = {
  name: string; code: string; customer_type: string; gstin: string
  address_line1: string; address_line2: string; city: string; state: string; pincode: string
  contact_name: string; contact_phone: string; contact_email: string
  credit_limit: number; payment_terms_days: number
}

const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu and Kashmir','Ladakh','Puducherry']

export default function CustomersPage() {
  const [data, setData] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [saving, setSaving] = useState(false)
  const { profile } = useAuth()
  const supabase = createClient()
  const canWrite = canEdit(profile?.role ?? '', 'customers_suppliers')
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({ defaultValues: { customer_type: 'distributor', credit_limit: 0, payment_terms_days: 30 } })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: rows } = await supabase.from('customers').select('*').order('name')
    setData(rows ?? [])
    setLoading(false)
  }

  function openAdd() { setEditing(null); reset({ customer_type: 'distributor', credit_limit: 0, payment_terms_days: 30 }); setModalOpen(true) }
  function openEdit(item: Customer) { setEditing(item); reset(item as any); setModalOpen(true) }

  async function onSubmit(values: FormData) {
    setSaving(true)
    const payload = { ...values, code: values.code.trim().toUpperCase(), gstin: values.gstin?.trim() || null, credit_limit: Number(values.credit_limit), payment_terms_days: Number(values.payment_terms_days) }
    const { error } = editing
      ? await supabase.from('customers').update(payload).eq('id', editing.id)
      : await supabase.from('customers').insert({ ...payload, created_by: profile?.id })
    if (error) toast.error(error.message.includes('unique') ? 'Customer code already exists' : error.message)
    else { toast.success('Saved'); setModalOpen(false); loadData() }
    setSaving(false)
  }

  async function toggleStatus(item: Customer) {
    await supabase.from('customers').update({ status: item.status === 'active' ? 'inactive' : 'active' }).eq('id', item.id)
    toast.success('Status updated'); loadData()
  }

  const columns = [
    { key: 'name', label: 'Name', render: (r: Customer) => <span className="font-medium">{r.name}</span> },
    { key: 'code', label: 'Code', render: (r: Customer) => <code className="text-xs bg-slate-100 px-2 py-0.5 rounded">{r.code}</code> },
    { key: 'customer_type', label: 'Type', render: (r: Customer) => <span className="badge bg-blue-50 text-blue-700 capitalize">{r.customer_type}</span> },
    { key: 'city', label: 'Location', render: (r: Customer) => r.city ? `${r.city}, ${r.state}` : '—' },
    { key: 'contact_phone', label: 'Phone', render: (r: Customer) => r.contact_phone ?? '—' },
    { key: 'gstin', label: 'GSTIN', render: (r: Customer) => r.gstin ? <code className="text-xs">{r.gstin}</code> : <span className="text-slate-300">—</span> },
    { key: 'status', label: 'Status', render: (r: Customer) => <StatusBadge status={r.status} /> },
  ]

  const formModal = (
    <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Customer' : 'Add Customer'} size="lg">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="form-grid">
          <FormField label="Name" required error={errors.name?.message}><input {...register('name', { required: 'Required' })} className="input" placeholder="Customer / Company name" /></FormField>
          <FormField label="Code" required error={errors.code?.message}><input {...register('code', { required: 'Required' })} className="input" placeholder="e.g. CUST001" /></FormField>
        </div>
        <div className="form-grid">
          <FormField label="Type" required>
            <select {...register('customer_type')} className="select">
              <option value="distributor">Distributor</option>
              <option value="retailer">Retailer</option>
            </select>
          </FormField>
          <FormField label="GSTIN"><input {...register('gstin')} className="input font-mono" placeholder="22AAAAA0000A1Z5" maxLength={15} /></FormField>
        </div>
        <div className="divider" />
        <h4 className="text-sm font-semibold text-slate-700">Address</h4>
        <FormField label="Address Line 1"><input {...register('address_line1')} className="input" /></FormField>
        <FormField label="Address Line 2"><input {...register('address_line2')} className="input" /></FormField>
        <div className="form-grid-3">
          <FormField label="City"><input {...register('city')} className="input" /></FormField>
          <FormField label="State"><select {...register('state')} className="select"><option value="">Select state</option>{STATES.map(s => <option key={s} value={s}>{s}</option>)}</select></FormField>
          <FormField label="Pincode"><input {...register('pincode')} className="input" maxLength={6} /></FormField>
        </div>
        <div className="divider" />
        <h4 className="text-sm font-semibold text-slate-700">Contact</h4>
        <div className="form-grid-3">
          <FormField label="Contact Person"><input {...register('contact_name')} className="input" /></FormField>
          <FormField label="Phone"><input {...register('contact_phone')} className="input" /></FormField>
          <FormField label="Email"><input type="email" {...register('contact_email')} className="input" /></FormField>
        </div>
        <div className="form-grid">
          <FormField label="Credit Limit (₹)"><input type="number" {...register('credit_limit')} className="input" min={0} step={1000} /></FormField>
          <FormField label="Payment Terms (days)"><input type="number" {...register('payment_terms_days')} className="input" min={0} /></FormField>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Add Customer'}</button>
        </div>
      </form>
    </Modal>
  )

  return (
    <AppLayout>
      <PageGuard>
        <MasterList title="Customers" entityType="customer" columns={columns} data={data} loading={loading} onAdd={openAdd} onEdit={openEdit} onToggleStatus={toggleStatus} searchValue={search} onSearchChange={setSearch} canEdit={canWrite} showQR={false} formModal={formModal} />
      </PageGuard>
    </AppLayout>
  )
}

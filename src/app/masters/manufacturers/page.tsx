'use client'
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, Modal, FormField, StatusBadge } from '@/components/ui'
import { MasterList } from '@/components/masters/MasterList'
import { useAuth } from '@/hooks/useAuth'
import { canEdit } from '@/lib/utils'
import type { Manufacturer } from '@/types'
import toast from 'react-hot-toast'

type FormData = { name: string; code: string }

export default function ManufacturersPage() {
  const [data, setData] = useState<Manufacturer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Manufacturer | null>(null)
  const [saving, setSaving] = useState(false)
  const { profile } = useAuth()
  const supabase = createClient()
  const canWrite = canEdit(profile?.role ?? '', 'masters')

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: rows } = await supabase.from('manufacturers').select('*').order('name')
    setData(rows ?? [])
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    reset({ name: '', code: '' })
    setModalOpen(true)
  }

  function openEdit(item: Manufacturer) {
    setEditing(item)
    reset({ name: item.name, code: item.code })
    setModalOpen(true)
  }

  async function onSubmit(values: FormData) {
    setSaving(true)
    const payload = { name: values.name.trim(), code: values.code.trim().toUpperCase() }
    let error
    if (editing) {
      ({ error } = await supabase.from('manufacturers').update(payload).eq('id', editing.id))
    } else {
      ({ error } = await supabase.from('manufacturers').insert({ ...payload, created_by: profile?.id }))
    }
    if (error) {
      toast.error(error.message.includes('unique') ? 'Code already exists' : error.message)
    } else {
      toast.success(editing ? 'Updated successfully' : 'Added successfully')
      setModalOpen(false)
      loadData()
    }
    setSaving(false)
  }

  async function toggleStatus(item: Manufacturer) {
    const { error } = await supabase.from('manufacturers')
      .update({ status: item.status === 'active' ? 'inactive' : 'active' }).eq('id', item.id)
    if (error) toast.error(error.message)
    else { toast.success('Status updated'); loadData() }
  }

  const columns = [
    { key: 'name', label: 'Name', render: (r: Manufacturer) => <span className="font-medium">{r.name}</span> },
    { key: 'code', label: 'Code', render: (r: Manufacturer) => <code className="text-xs bg-slate-100 px-2 py-0.5 rounded">{r.code}</code> },
    { key: 'status', label: 'Status', render: (r: Manufacturer) => <StatusBadge status={r.status} /> },
  ]

  return (
    <AppLayout>
      <PageGuard roles={['admin', 'sales_manager', 'accounts', 'view_only']}>
        <MasterList
          title="Manufacturers"
          entityType="manufacturer"
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
            <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Manufacturer' : 'Add Manufacturer'}>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <FormField label="Name" required error={errors.name?.message}>
                  <input {...register('name', { required: 'Required' })} className="input" placeholder="e.g. Western Digital" />
                </FormField>
                <FormField label="Code" required error={errors.code?.message} hint="Short uppercase identifier, e.g. WD">
                  <input {...register('code', { required: 'Required' })} className="input" placeholder="e.g. WD" />
                </FormField>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Add'}</button>
                </div>
              </form>
            </Modal>
          }
        />
      </PageGuard>
    </AppLayout>
  )
}

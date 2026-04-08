'use client'
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, Modal, FormField, StatusBadge } from '@/components/ui'
import { MasterList } from '@/components/masters/MasterList'
import { useAuth } from '@/hooks/useAuth'
import { canEdit } from '@/lib/utils'
import type { Rack } from '@/types'
import toast from 'react-hot-toast'

type FormData = { rack_no: string; column_no: string; row_no: string; description: string }

export default function RacksPage() {
  const [data, setData] = useState<Rack[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Rack | null>(null)
  const [saving, setSaving] = useState(false)
  const { profile } = useAuth()
  const supabase = createClient()
  const canWrite = canEdit(profile?.role ?? '', 'masters')

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data: rows } = await supabase.from('racks').select('*').order('rack_id_display')
    setData(rows ?? [])
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    reset({ rack_no: '', column_no: '', row_no: '', description: '' })
    setModalOpen(true)
  }

  function openEdit(item: Rack) {
    setEditing(item)
    reset({ rack_no: item.rack_no, column_no: item.column_no, row_no: item.row_no, description: item.description ?? '' })
    setModalOpen(true)
  }

  async function onSubmit(values: FormData) {
    setSaving(true)
    const payload = {
      rack_no: values.rack_no.trim().padStart(2, '0'),
      column_no: values.column_no.trim().toUpperCase(),
      row_no: values.row_no.trim().padStart(2, '0'),
      description: values.description?.trim() || null,
    }
    let error
    if (editing) {
      ({ error } = await supabase.from('racks').update(payload).eq('id', editing.id))
    } else {
      ({ error } = await supabase.from('racks').insert({ ...payload, created_by: profile?.id }))
    }
    if (error) {
      toast.error(error.message.includes('unique') ? 'This rack position already exists' : error.message)
    } else {
      toast.success(editing ? 'Rack updated' : 'Rack added')
      setModalOpen(false)
      loadData()
    }
    setSaving(false)
  }

  async function toggleStatus(item: Rack) {
    const { error } = await supabase.from('racks')
      .update({ status: item.status === 'active' ? 'inactive' : 'active' }).eq('id', item.id)
    if (error) toast.error(error.message)
    else { toast.success('Status updated'); loadData() }
  }

  const columns = [
    { key: 'rack_id_display', label: 'Rack ID', render: (r: Rack) => <code className="font-mono font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded">{r.rack_id_display}</code> },
    { key: 'rack_no', label: 'Rack No.', render: (r: Rack) => <span className="font-medium">Rack {r.rack_no}</span> },
    { key: 'column_no', label: 'Column', render: (r: Rack) => `Column ${r.column_no}` },
    { key: 'row_no', label: 'Row', render: (r: Rack) => `Row ${r.row_no}` },
    { key: 'description', label: 'Description', render: (r: Rack) => r.description ?? <span className="text-slate-300">—</span> },
    { key: 'status', label: 'Status', render: (r: Rack) => <StatusBadge status={r.status} /> },
  ]

  return (
    <AppLayout>
      <PageGuard roles={['admin', 'sales_manager', 'packing_executive', 'accounts', 'view_only']}>
        <MasterList
          title="Rack Positions"
          entityType="rack"
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
            <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Rack Position' : 'Add Rack Position'}>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="alert-info text-xs">
                  <strong>Rack ID format:</strong> Rack No / Column / Row — e.g. 01/A/01 means Rack 01, Column A, Row 01 (top row).
                  Columns go left to right (A, B, C…). Rows go top to bottom (01, 02, 03…).
                </div>
                <div className="form-grid-3">
                  <FormField label="Rack No." required error={errors.rack_no?.message} hint="e.g. 01">
                    <input {...register('rack_no', { required: 'Required' })} className="input font-mono" placeholder="01" maxLength={2} />
                  </FormField>
                  <FormField label="Column" required error={errors.column_no?.message} hint="e.g. A">
                    <input {...register('column_no', { required: 'Required' })} className="input font-mono" placeholder="A" maxLength={2} />
                  </FormField>
                  <FormField label="Row No." required error={errors.row_no?.message} hint="e.g. 01 (top)">
                    <input {...register('row_no', { required: 'Required' })} className="input font-mono" placeholder="01" maxLength={2} />
                  </FormField>
                </div>
                <FormField label="Description" error={errors.description?.message} hint="Optional description">
                  <input {...register('description')} className="input" placeholder="e.g. Near entrance, left wall" />
                </FormField>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Add Rack'}</button>
                </div>
              </form>
            </Modal>
          }
        />
      </PageGuard>
    </AppLayout>
  )
}

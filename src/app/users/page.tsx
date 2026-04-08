'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import AppLayout from '@/components/layout/AppLayout'
import { PageGuard, Modal, FormField, StatusBadge, PageLoader, SearchInput } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { formatDateTime, getRoleLabel } from '@/lib/utils'
import type { UserProfile } from '@/types'
import { Plus, Pencil, Shield } from 'lucide-react'
import toast from 'react-hot-toast'

const ROLES = ['admin', 'sales_manager', 'packing_executive', 'accounts', 'view_only']

export default function UsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<UserProfile | null>(null)
  const [saving, setSaving] = useState(false)
  // New user form
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('view_only')
  const { profile } = useAuth()
  const supabase = createClient()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data } = await supabase.from('user_profiles').select('*').order('full_name')
    setUsers(data ?? [])
    setLoading(false)
  }

  function openAdd() {
    setEditing(null); setEmail(''); setPassword(''); setFullName(''); setRole('view_only')
    setModalOpen(true)
  }

  function openEdit(u: UserProfile) {
    setEditing(u); setFullName(u.full_name); setRole(u.role); setEmail(''); setPassword('')
    setModalOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    if (editing) {
      const { error } = await supabase.from('user_profiles').update({ full_name: fullName, role: role as any }).eq('id', editing.id)
      if (error) toast.error(error.message)
      else { toast.success('User updated'); setModalOpen(false); loadData() }
    } else {
      // Create via Supabase Admin API (requires service role)
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, full_name: fullName, role }),
      })
      const data = await res.json()
      if (!res.ok) toast.error(data.error ?? 'Failed to create user')
      else { toast.success('User created'); setModalOpen(false); loadData() }
    }
    setSaving(false)
  }

  async function toggleActive(u: UserProfile) {
    await supabase.from('user_profiles').update({ is_active: !u.is_active }).eq('id', u.id)
    loadData()
  }

  const filtered = users.filter(u =>
    u.full_name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <AppLayout>
      <PageGuard roles={['admin']}>
        <div className="space-y-4">
          <div className="page-header">
            <div>
              <h1 className="page-title">User Management</h1>
              <p className="text-sm text-slate-500 mt-0.5">{users.length} users</p>
            </div>
            <div className="flex items-center gap-2">
              <SearchInput value={search} onChange={setSearch} />
              <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> Add User</button>
            </div>
          </div>

          {loading ? <PageLoader /> : (
            <div className="card">
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Joined</th><th className="text-right">Actions</th></tr></thead>
                  <tbody>
                    {filtered.map(u => (
                      <tr key={u.id} className={!u.is_active ? 'opacity-60' : ''}>
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-brand-700">{u.full_name?.charAt(0)}</span>
                            </div>
                            <span className="font-medium">{u.full_name}</span>
                            {u.id === profile?.id && <span className="badge bg-brand-100 text-brand-700 text-xs">You</span>}
                          </div>
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <Shield className="w-3.5 h-3.5 text-brand-600" />
                            <span className="text-sm">{getRoleLabel(u.role)}</span>
                          </div>
                        </td>
                        <td><StatusBadge status={u.is_active ? 'active' : 'inactive'} /></td>
                        <td className="text-sm text-slate-500">{formatDateTime(u.created_at)}</td>
                        <td>
                          <div className="flex justify-end gap-1">
                            <button onClick={() => openEdit(u)} className="btn-ghost btn-sm"><Pencil className="w-4 h-4" /></button>
                            {u.id !== profile?.id && (
                              <button
                                onClick={() => toggleActive(u)}
                                className={`btn-ghost btn-sm text-xs ${u.is_active ? 'text-amber-600' : 'text-emerald-600'}`}
                              >{u.is_active ? 'Deactivate' : 'Activate'}</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit User' : 'Add User'}>
          <div className="space-y-4">
            <FormField label="Full Name" required>
              <input value={fullName} onChange={e => setFullName(e.target.value)} className="input" placeholder="e.g. Rajesh Kumar" />
            </FormField>
            {!editing && (
              <>
                <FormField label="Email" required>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input" placeholder="user@company.com" />
                </FormField>
                <FormField label="Password" required hint="Minimum 6 characters">
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input" placeholder="••••••••" />
                </FormField>
              </>
            )}
            <FormField label="Role" required>
              <select value={role} onChange={e => setRole(e.target.value)} className="select">
                {ROLES.map(r => <option key={r} value={r}>{getRoleLabel(r)}</option>)}
              </select>
            </FormField>
            <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-500 space-y-1">
              <p><strong>Admin:</strong> Full access — all masters, all transactions, users</p>
              <p><strong>Sales Manager:</strong> SOs, POs, GRNs, customers, suppliers, reports</p>
              <p><strong>Packing Executive:</strong> GRN receipt, stocking queue, packing lists</p>
              <p><strong>Accounts:</strong> View all, manage invoices, export reports</p>
              <p><strong>View Only:</strong> Read-only access to all sections</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handleSave} disabled={saving || !fullName} className="btn-primary">{saving ? 'Saving...' : editing ? 'Update' : 'Create User'}</button>
            </div>
          </div>
        </Modal>
      </PageGuard>
    </AppLayout>
  )
}

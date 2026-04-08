'use client'
import { useState, useEffect, ReactNode } from 'react'
import { Plus, Pencil, Power, PowerOff } from 'lucide-react'
import { Modal, ConfirmDialog, StatusBadge, PageLoader, EmptyState, SearchInput, Pagination } from '@/components/ui'
import { QRViewer } from '@/components/ui/QRComponents'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

export interface MasterColumn<T> {
  key: keyof T | string
  label: string
  render?: (row: T) => ReactNode
  className?: string
}

interface MasterListProps<T extends { id: string; status?: string; name?: string }> {
  title: string
  entityType: string
  columns: MasterColumn<T>[]
  data: T[]
  loading: boolean
  onAdd: () => void
  onEdit: (item: T) => void
  onToggleStatus: (item: T) => Promise<void>
  formModal: ReactNode
  showQR?: boolean
  searchValue: string
  onSearchChange: (v: string) => void
  canEdit?: boolean
}

const PAGE_SIZE = 20

export function MasterList<T extends { id: string; status?: string; name?: string }>({
  title, entityType, columns, data, loading, onAdd, onEdit,
  onToggleStatus, formModal, showQR = true, searchValue,
  onSearchChange, canEdit = true,
}: MasterListProps<T>) {
  const [page, setPage] = useState(1)
  const [confirmItem, setConfirmItem] = useState<T | null>(null)
  const [toggling, setToggling] = useState(false)

  const filtered = data.filter(item =>
    JSON.stringify(item).toLowerCase().includes(searchValue.toLowerCase())
  )
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [searchValue])

  async function handleToggle() {
    if (!confirmItem) return
    setToggling(true)
    await onToggleStatus(confirmItem)
    setConfirmItem(null)
    setToggling(false)
  }

  function getCellValue(row: T, key: string): ReactNode {
    const val = (row as any)[key]
    if (val === null || val === undefined) return <span className="text-slate-300">—</span>
    return String(val)
  }

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filtered.length} records</p>
        </div>
        <div className="flex items-center gap-2">
          <SearchInput value={searchValue} onChange={onSearchChange} />
          {canEdit && (
            <button onClick={onAdd} className="btn-primary">
              <Plus className="w-4 h-4" /> Add {entityType}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <PageLoader />
      ) : paged.length === 0 ? (
        <div className="card">
          <EmptyState title={`No ${title.toLowerCase()} found`} description="Add your first record to get started." action={canEdit ? <button onClick={onAdd} className="btn-primary btn-sm"><Plus className="w-4 h-4" /> Add {entityType}</button> : undefined} />
        </div>
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  {columns.map(col => (
                    <th key={String(col.key)} className={col.className}>{col.label}</th>
                  ))}
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(row => (
                  <tr key={row.id} className={row.status === 'inactive' ? 'opacity-60' : ''}>
                    {columns.map(col => (
                      <td key={String(col.key)} className={col.className}>
                        {col.render ? col.render(row) : getCellValue(row, String(col.key))}
                      </td>
                    ))}
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {showQR && (
                          <QRViewer entityType={entityType} entityId={row.id} label={(row as any).name ?? (row as any).display_name ?? row.id} subLabel={(row as any).code ?? (row as any).sku_code} />
                        )}
                        {canEdit && (
                          <>
                            <button onClick={() => onEdit(row)} className="btn-ghost btn-sm" title="Edit">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setConfirmItem(row)}
                              className={cn('btn-ghost btn-sm', row.status === 'active' ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50')}
                              title={row.status === 'active' ? 'Deactivate' : 'Activate'}
                            >
                              {row.status === 'active' ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4">
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </div>
        </div>
      )}

      {formModal}

      <ConfirmDialog
        open={!!confirmItem}
        onClose={() => setConfirmItem(null)}
        onConfirm={handleToggle}
        title={confirmItem?.status === 'active' ? 'Deactivate record' : 'Activate record'}
        message={`Are you sure you want to ${confirmItem?.status === 'active' ? 'deactivate' : 'activate'} this record? ${confirmItem?.status === 'active' ? 'It will no longer be available for new transactions.' : 'It will be available again.'}`}
        confirmLabel={confirmItem?.status === 'active' ? 'Deactivate' : 'Activate'}
        danger={confirmItem?.status === 'active'}
        loading={toggling}
      />
    </div>
  )
}

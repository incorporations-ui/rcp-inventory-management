'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { cn, getRoleLabel } from '@/lib/utils'
import {
  LayoutDashboard, Package2, ShoppingCart, Truck, ClipboardList,
  FileText, RotateCcw, BarChart2, Settings, LogOut, Menu, X,
  Boxes, Building2, Users, Layers, Tag, Warehouse, ChevronDown, ChevronRight,
  PackageCheck, PackageSearch, Receipt, AlertTriangle, Globe, Lock, ClipboardEdit, Lightbulb
} from 'lucide-react'

interface NavItem {
  label: string
  href?: string
  icon: React.ElementType
  children?: NavItem[]
  roles?: string[]
  badge?: string
}

const navigation: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Ops Board', href: '/ops-board', icon: Layers },
  {
    label: 'Purchases', icon: Truck,
    children: [
      { label: 'Purchase Orders', href: '/purchases/orders', icon: ShoppingCart },
      { label: 'GRN', href: '/purchases/grn', icon: PackageCheck },
      { label: 'Stocking Queue', href: '/purchases/stocking', icon: Warehouse },
    ]
  },
  {
    label: 'Sales', icon: FileText,
    children: [
      { label: 'Sales Orders', href: '/sales/orders', icon: ClipboardList },
      { label: 'Packing Lists', href: '/sales/packing', icon: PackageSearch },
      { label: 'Invoices', href: '/sales/invoices', icon: Receipt },
    ]
  },
  { label: 'Returns', href: '/returns', icon: RotateCcw },
  {
    label: 'Inventory', icon: Boxes,
    children: [
      { label: 'Stock Master', href: '/inventory/stock', icon: Package2 },
      { label: 'Rack Locations', href: '/inventory/racks-stock', icon: Warehouse },
      { label: 'Reservations', href: '/inventory/reservations', icon: Lock },
      { label: 'Adjustments', href: '/inventory/adjustments', icon: ClipboardEdit },
      { label: 'Ageing Report', href: '/inventory/ageing', icon: AlertTriangle },
    ]
  },
  {
    label: 'Reports', icon: BarChart2,
    children: [
      { label: 'Analytics', href: '/reports/analytics', icon: BarChart2 },
      { label: 'Charts', href: '/reports/charts', icon: Layers },
      { label: 'Export', href: '/reports/export', icon: ClipboardEdit },
    ]
  },
  {
    label: 'Masters', icon: Settings, roles: ['admin', 'sales_manager'],
    children: [
      { label: 'Manufacturers', href: '/masters/manufacturers', icon: Building2 },
      { label: 'Categories', href: '/masters/categories', icon: Layers },
      { label: 'Brands', href: '/masters/brands', icon: Tag },
      { label: 'SKUs', href: '/masters/skus', icon: Package2 },
      { label: 'Racks', href: '/masters/racks', icon: Warehouse },
      { label: 'Customers', href: '/masters/customers', icon: Users },
      { label: 'Suppliers', href: '/masters/suppliers', icon: Building2 },
    ]
  },
  { label: 'Users', href: '/users', icon: Users, roles: ['admin'] },
  { label: 'Client Portal', href: '/client', icon: Globe, roles: ['admin', 'sales_manager'] },
  { label: 'Suggestions', href: '/suggestions', icon: Lightbulb, roles: ['admin'] },
]

function NavItemComponent({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const pathname = usePathname()
  const { profile } = useAuth()
  const [open, setOpen] = useState(() => item.children?.some(c => c.href && pathname.startsWith(c.href)) ?? false)

  if (item.roles && !item.roles.includes(profile?.role ?? '')) return null

  if (item.children) {
    const isActive = item.children.some(c => c.href && pathname.startsWith(c.href))
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={cn('sidebar-item w-full justify-between', isActive && 'text-slate-900')}
        >
          <span className="flex items-center gap-3">
            <item.icon className="w-4 h-4 flex-shrink-0" />
            {item.label}
          </span>
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        {open && (
          <div className="ml-3 mt-0.5 border-l border-slate-200 pl-3 space-y-0.5">
            {item.children.map(child => (
              <NavItemComponent key={child.href} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  const isActive = item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href ?? '')

  return (
    <Link href={item.href ?? '#'} className={cn('sidebar-item', isActive && 'active')}>
      <item.icon className="w-4 h-4 flex-shrink-0" />
      {item.label}
      {item.badge && <span className="ml-auto badge bg-brand-100 text-brand-700">{item.badge}</span>}
    </Link>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { profile, signOut } = useAuth()
  const router = useRouter()

  async function handleSignOut() {
    await signOut()
    router.replace('/auth/login')
  }

  const sidebar = (
    <aside className="flex flex-col h-full bg-white border-r border-slate-200 w-64">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <Package2 className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900 leading-tight">RCP Inventory</p>
          <p className="text-xs text-slate-400">Manager</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {navigation.map(item => (
          <NavItemComponent key={item.label} item={item} />
        ))}
      </nav>

      {/* User */}
      <div className="p-3 border-t border-slate-100">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-brand-700">
              {profile?.full_name?.charAt(0).toUpperCase() ?? '?'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-900 truncate">{profile?.full_name}</p>
            <p className="text-xs text-slate-400">{getRoleLabel(profile?.role ?? '')}</p>
          </div>
          <button onClick={handleSignOut} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Sign out">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-shrink-0">{sidebar}</div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full">{sidebar}</div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200">
          <button onClick={() => setSidebarOpen(true)} className="p-2 text-slate-500 hover:text-slate-900">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-brand-600 rounded flex items-center justify-center">
              <Package2 className="w-3 h-3 text-white" />
            </div>
            <span className="text-sm font-bold text-slate-900">RCP Inventory</span>
          </div>
        </div>

        <main className="flex-1 overflow-y-auto">
          <div className="p-6 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

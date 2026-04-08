// Core domain types for RCP Inventory Manager

export type UserRole = 'admin' | 'sales_manager' | 'packing_executive' | 'accounts' | 'view_only'
export type EntityStatus = 'active' | 'inactive'
export type POStatus = 'draft' | 'approved' | 'grn_in_progress' | 'completed' | 'cancelled'
export type SOStatus = 'draft' | 'proforma_sent' | 'approved' | 'packing_in_progress' | 'packed' | 'invoiced' | 'dispatched' | 'cancelled'
export type GRNLineStatus = 'pending' | 'received' | 'not_received' | 'damaged'
export type PackLineStatus = 'pending' | 'packed' | 'unavailable'
export type ReturnType = 'sales_return' | 'purchase_return' | 'godown_damage'
export type StockMovementType = 'grn_in' | 'so_out' | 'sales_return_in' | 'purchase_return_out' | 'damage_write_off' | 'rack_assign' | 'rack_remove'

export interface UserProfile {
  id: string
  full_name: string
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Manufacturer {
  id: string
  name: string
  code: string
  status: EntityStatus
  created_at: string
}

export interface ProductCategory {
  id: string
  name: string
  code: string
  status: EntityStatus
  created_at: string
}

export interface ItemCategory {
  id: string
  product_category_id: string
  name: string
  code: string
  status: EntityStatus
  product_category?: ProductCategory
}

export interface Brand {
  id: string
  manufacturer_id: string
  item_category_id: string
  name: string
  code: string
  status: EntityStatus
  manufacturer?: Manufacturer
  item_category?: ItemCategory
}

export interface SKU {
  id: string
  brand_id: string
  sku_code: string
  display_name: string
  hsn_code?: string
  gst_rate: number
  units_per_box: number
  status: EntityStatus
  brand?: Brand
  attributes?: SKUAttribute[]
}

export interface SKUAttribute {
  id: string
  sku_id: string
  attribute_definition_id: string
  value: string
  definition?: SKUAttributeDefinition
}

export interface SKUAttributeDefinition {
  id: string
  item_category_id: string
  attribute_name: string
  attribute_unit?: string
  sort_order: number
  is_required: boolean
}

export interface Rack {
  id: string
  rack_no: string
  column_no: string
  row_no: string
  rack_id_display: string
  description?: string
  status: EntityStatus
}

export interface Customer {
  id: string
  name: string
  code: string
  customer_type: 'distributor' | 'retailer'
  gstin?: string
  address_line1?: string
  address_line2?: string
  city?: string
  state?: string
  pincode?: string
  contact_name?: string
  contact_phone?: string
  contact_email?: string
  credit_limit: number
  payment_terms_days: number
  status: EntityStatus
}

export interface Supplier {
  id: string
  name: string
  code: string
  gstin?: string
  address_line1?: string
  city?: string
  state?: string
  contact_name?: string
  contact_phone?: string
  contact_email?: string
  status: EntityStatus
}

export interface PurchaseOrder {
  id: string
  po_number: string
  supplier_id: string
  status: POStatus
  po_date: string
  expected_delivery_date?: string
  notes?: string
  total_amount: number
  total_gst: number
  grand_total: number
  approved_by?: string
  approved_at?: string
  created_by: string
  created_at: string
  supplier?: Supplier
  lines?: POLine[]
}

export interface POLine {
  id: string
  po_id: string
  sku_id: string
  ordered_boxes: number
  ordered_units: number
  unit_price: number
  gst_rate: number
  line_amount: number
  line_gst: number
  sku?: SKU
}

export interface GRN {
  id: string
  grn_number: string
  po_id: string
  grn_date: string
  supplier_invoice_no?: string
  supplier_invoice_date?: string
  notes?: string
  status: string
  created_by: string
  created_at: string
  po?: PurchaseOrder
  lines?: GRNLine[]
}

export interface GRNLine {
  id: string
  grn_id: string
  po_line_id: string
  sku_id: string
  expected_boxes: number
  expected_units: number
  received_boxes: number
  received_units: number
  damaged_units: number
  not_received_units: number
  status: GRNLineStatus
  damage_notes?: string
  damage_photo_url?: string
  unit_price: number
  gst_rate: number
  sku?: SKU
}

export interface Lot {
  id: string
  lot_number: string
  grn_id: string
  grn_line_id: string
  sku_id: string
  received_date: string
  received_units: number
  remaining_units: number
  unit_cost: number
  sku?: SKU
}

export interface RackStock {
  id: string
  rack_id: string
  lot_id: string
  sku_id: string
  boxes_count: number
  units_count: number
  stocked_at: string
  rack?: Rack
  lot?: Lot
  sku?: SKU
}

export interface StockMaster {
  sku_id: string
  total_units: number
  reserved_units: number
  available_units: number
  last_updated: string
  sku?: SKU
}

export interface SalesOrder {
  id: string
  so_number: string
  customer_id: string
  status: SOStatus
  so_date: string
  delivery_address?: string
  notes?: string
  total_amount: number
  total_gst: number
  grand_total: number
  proforma_number?: string
  proforma_date?: string
  approved_by?: string
  approved_at?: string
  created_by: string
  created_at: string
  customer?: Customer
  lines?: SOLine[]
}

export interface SOLine {
  id: string
  so_id: string
  sku_id: string
  ordered_boxes: number
  ordered_units: number
  unit_price: number
  gst_rate: number
  line_amount: number
  line_gst: number
  sku?: SKU
}

export interface PackingList {
  id: string
  pl_number: string
  so_id: string
  status: string
  assigned_to?: string
  started_at?: string
  finalized_at?: string
  created_at: string
  so?: SalesOrder
  lines?: PackingListLine[]
}

export interface PackingListLine {
  id: string
  packing_list_id: string
  so_line_id: string
  sku_id: string
  ordered_units: number
  packed_units: number
  unavailable_units: number
  status: PackLineStatus
  rack_id?: string
  scanned_rack_id?: string
  mismatch_flagged: boolean
  mismatch_notes?: string
  sku?: SKU
  rack?: Rack
}

export interface Invoice {
  id: string
  invoice_number: string
  so_id: string
  packing_list_id: string
  customer_id: string
  invoice_date: string
  due_date?: string
  subtotal: number
  total_gst: number
  grand_total: number
  payment_status: string
  dispatch_status: string
  dispatched_at?: string
  created_at: string
  customer?: Customer
  lines?: InvoiceLine[]
}

export interface InvoiceLine {
  id: string
  invoice_id: string
  sku_id: string
  lot_id?: string
  units: number
  unit_price: number
  gst_rate: number
  hsn_code?: string
  line_amount: number
  line_gst: number
  sku?: SKU
}

export interface Return {
  id: string
  return_number: string
  return_type: ReturnType
  reference_id?: string
  customer_id?: string
  supplier_id?: string
  return_date: string
  status: string
  reason?: string
  notes?: string
  total_amount: number
  created_at: string
}

// Ops board entry
export interface OpsBoardEntry {
  board_section: string
  record_id: string
  doc_number: string
  item_name: string
  total_qty?: number
  processed_qty?: number
  pending_qty?: number
  status: string
  doc_date: string
}

// Stock ageing
export interface StockAgeingEntry {
  lot_id: string
  lot_number: string
  sku_id: string
  sku_code: string
  display_name: string
  brand_name: string
  item_category: string
  received_date: string
  age_days: number
  age_bucket: string
  remaining_units: number
  unit_cost: number
  stock_value: number
}

// Database type placeholder - expand as needed
export type Database = {
  public: {
    Tables: Record<string, any>
    Views: Record<string, any>
    Functions: Record<string, any>
  }
}

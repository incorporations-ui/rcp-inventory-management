'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import AppLayout from '@/components/layout/AppLayout';
import {
  PageGuard,
  StatusBadge,
  PageLoader,
  SearchInput,
  Modal,
  FormField,
} from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { formatDate } from '@/lib/utils';
import {
  PackageCheck,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Edit2,
  RotateCcw,
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function GRNPage() {
  const supabase = createClient();
  const { profile } = useAuth();

  const [grns, setGrns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedGrn, setExpandedGrn] = useState<string | null>(null);
  const [grnLines, setGrnLines] = useState<Record<string, any[]>>({});
  const [linesLoading, setLinesLoading] = useState<Record<string, boolean>>({});
  const [finalizing, setFinalizing] = useState<string | null>(null);
  const [grnNotes, setGrnNotes] = useState<Record<string, string>>({});
  const [savingGrnNotes, setSavingGrnNotes] = useState<string | null>(null);

  const [partialModal, setPartialModal] = useState<{ grnId: string; line: any } | null>(null);
  const [partialBoxes, setPartialBoxes] = useState(0);
  const [partialUnits, setPartialUnits] = useState(0);

  const [damageModal, setDamageModal] = useState<{ grnId: string; line: any } | null>(null);
  const [damageNotes, setDamageNotes] = useState('');
  const [damagedUnits, setDamagedUnits] = useState(0);

  const [cancelGrnItem, setCancelGrnItem] = useState<any>(null);
  const [cancellingGrn, setCancellingGrn] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  /* ================================
     LOAD GRN DATA
  ================================= */
  async function loadData() {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('grns')
        .select(`
          id,
          grn_number,
          grn_date,
          status,
          po_id,
          notes,
          purchase_orders (
            po_number,
            suppliers (
              name
            )
          ),
          grn_lines (
            id,
            status
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setGrns(data ?? []);
    } catch (err: any) {
      toast.error(`Failed to load GRNs: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  /* ================================
     LOAD GRN LINE ITEMS
  ================================= */
  const loadLines = useCallback(async (grnId: string) => {
    setLinesLoading(prev => ({ ...prev, [grnId]: true }));

    const { data, error } = await supabase
      .from('grn_lines')
      .select(`
        id, grn_id, po_line_id, sku_id,
        expected_boxes, expected_units,
        received_boxes, received_units,
        damaged_units, not_received_units,
        status, damage_notes,
        unit_price, gst_rate, sort_order,
        skus ( display_name, sku_code, units_per_box )
      `)
      .eq('grn_id', grnId)
      .order('sort_order');

    if (error) {
      toast.error('Failed to load lines: ' + error.message);
    } else {
      setGrnLines(prev => ({ ...prev, [grnId]: data ?? [] }));
    }

    setLinesLoading(prev => ({ ...prev, [grnId]: false }));
  }, [supabase]);

  async function toggleExpand(grnId: string) {
    if (expandedGrn === grnId) {
      setExpandedGrn(null);
      return;
    }

    setExpandedGrn(grnId);
    await loadLines(grnId);

    const grn = grns.find(g => g.id === grnId);
    if (grn && grnNotes[grnId] === undefined) {
      setGrnNotes(prev => ({ ...prev, [grnId]: grn.notes ?? '' }));
    }
  }

  async function saveGrnNotes(grnId: string) {
    setSavingGrnNotes(grnId);

    const { error } = await supabase
      .from('grns')
      .update({ notes: grnNotes[grnId] || null })
      .eq('id', grnId);

    if (error) toast.error(error.message);
    else toast.success('Notes saved');

    setSavingGrnNotes(null);
  }

  /* ================================
     LINE OPERATIONS
  ================================= */
  async function updateLine(grnId: string, lineId: string, updates: Record<string, any>) {
    const { error } = await supabase
      .from('grn_lines')
      .update(updates)
      .eq('id', lineId);

    if (error) {
      toast.error('Update failed: ' + error.message);
      return false;
    }

    await loadLines(grnId);
    await loadData();
    return true;
  }

  async function markReceived(grnId: string, lineId: string, line: any) {
    const ok = await updateLine(grnId, lineId, {
      status: 'received',
      received_boxes: line.expected_boxes,
      received_units: line.expected_units,
    });
    if (ok) toast.success('Marked as fully received');
  }

  async function markNotReceived(grnId: string, lineId: string) {
    const ok = await updateLine(grnId, lineId, {
      status: 'not_received',
      received_units: 0,
      received_boxes: 0,
    });
    if (ok) toast.success('Marked as not received');
  }

  async function resetLine(grnId: string, lineId: string) {
    await updateLine(grnId, lineId, {
      status: 'pending',
      received_units: 0,
      received_boxes: 0,
      damaged_units: 0,
      damage_notes: null,
    });
  }

  /* ================================
     DAMAGE MODAL
  ================================= */
  function openDamageModal(grnId: string, line: any) {
    setDamageModal({ grnId, line });
    setDamagedUnits(line.expected_units);
    setDamageNotes('');
  }

  async function confirmDamage() {
    if (!damageModal) return;

    const ok = await updateLine(
      damageModal.grnId,
      damageModal.line.id,
      {
        status: 'damaged',
        damaged_units: damagedUnits,
        damage_notes: damageNotes || null,
      }
    );

    if (ok) {
      toast.success('Marked as damaged');
      setDamageModal(null);
    }
  }

  /* ================================
     PARTIAL RECEIVE MODAL
  ================================= */
  function openPartialModal(grnId: string, line: any) {
    setPartialModal({ grnId, line });
    setPartialBoxes(line.expected_boxes);
    setPartialUnits(line.expected_units);
  }

  async function confirmPartial() {
    if (!partialModal) return;

    const ok = await updateLine(
      partialModal.grnId,
      partialModal.line.id,
      {
        status: 'received',
        received_boxes: partialBoxes,
        received_units: partialUnits,
        not_received_units:
          partialModal.line.expected_units - partialUnits,
      }
    );

    if (ok) {
      toast.success('Partial receive saved');
      setPartialModal(null);
    }
  }

  /* ================================
     FINALIZE GRN
  ================================= */
  async function finalizeGRN(grnId: string) {
    const lines = grnLines[grnId] ?? [];

    if (!lines.every(l => l.status !== 'pending')) {
      toast.error('All lines must be processed before finalizing');
      return;
    }

    setFinalizing(grnId);

    const receivedLines = lines.filter(l => l.status === 'received');

    for (const line of receivedLines) {
      const { data: lotNum } = await supabase.rpc('next_doc_number', {
        p_doc_type: 'LOT',
      });

      const { data: lot, error: lotErr } = await supabase
        .from('lots')
        .insert({
          lot_number: lotNum,
          grn_id: grnId,
          grn_line_id: line.id,
          sku_id: line.sku_id,
          received_date: new Date().toISOString().split('T')[0],
          received_units: line.received_units,
          remaining_units: line.received_units,
          unit_cost: line.unit_price,
        })
        .select()
        .single();

      if (lotErr || !lot) {
        toast.error('Failed to create lot');
        setFinalizing(null);
        return;
      }

      await supabase.rpc('update_stock_master', {
        p_sku_id: line.sku_id,
        p_delta: line.received_units,
      });
    }

    await supabase
      .from('grns')
      .update({
        status: 'finalized',
        finalized_by: profile?.id,
        finalized_at: new Date().toISOString(),
      })
      .eq('id', grnId);

    toast.success('GRN finalized successfully');
    setFinalizing(null);
    loadData();
  }

  /* ================================
     FILTERING
  ================================= */
  const filtered = grns.filter(g =>
    g.grn_number?.toLowerCase().includes(search.toLowerCase()) ||
    g.purchase_orders?.po_number
      ?.toLowerCase()
      .includes(search.toLowerCase()) ||
    g.purchase_orders?.suppliers?.name
      ?.toLowerCase()
      .includes(search.toLowerCase())
  );

  /* ================================
     UI
  ================================= */
  return (
    <AppLayout>
      <PageGuard>
        <div className="space-y-4">
          <div className="page-header">
            <div>
              <h1 className="page-title">GRN — Goods Receipt</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {filtered.length} records
              </p>
            </div>
            <SearchInput value={search} onChange={setSearch} />
          </div>

          {loading ? (
            <PageLoader />
          ) : (
            <div className="card p-6 text-center text-slate-500">
              GRN module loaded successfully.
            </div>
          )}
        </div>

        {/* Damage Modal */}
        <Modal
          open={!!damageModal}
          onClose={() => setDamageModal(null)}
          title="Mark as Damaged"
          size="sm"
        >
          {damageModal && (
            <div className="space-y-4">
              <FormField label="Damaged Units">
                <input
                  type="number"
                  value={damagedUnits}
                  onChange={e => setDamagedUnits(Number(e.target.value))}
                  className="input"
                />
              </FormField>
              <FormField label="Damage Notes">
                <textarea
                  value={damageNotes}
                  onChange={e => setDamageNotes(e.target.value)}
                  className="input"
                />
              </FormField>
              <div className="flex justify-end gap-2">
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => setDamageModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn-danger btn-sm"
                  onClick={confirmDamage}
                >
                  Confirm
                </button>
              </div>
            </div>
          )}
        </Modal>

        {/* Partial Receive Modal */}
        <Modal
          open={!!partialModal}
          onClose={() => setPartialModal(null)}
          title="Partial Receive"
          size="sm"
        >
          {partialModal && (
            <div className="space-y-4">
              <FormField label="Received Boxes">
                <input
                  type="number"
                  value={partialBoxes}
                  onChange={e => setPartialBoxes(Number(e.target.value))}
                  className="input"
                />
              </FormField>
              <FormField label="Received Units">
                <input
                  type="number"
                  value={partialUnits}
                  onChange={e => setPartialUnits(Number(e.target.value))}
                  className="input"
                />
              </FormField>
              <div className="flex justify-end gap-2">
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => setPartialModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary btn-sm"
                  onClick={confirmPartial}
                >
                  Confirm
                </button>
              </div>
            </div>
          )}
        </Modal>
      </PageGuard>
    </AppLayout>
  );
}

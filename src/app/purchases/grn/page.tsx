'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import AppLayout from '@/components/layout/AppLayout';
import { PageGuard, PageLoader, SearchInput, StatusBadge } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { formatDate } from '@/lib/utils';
import { ChevronDown, ChevronRight, PackageCheck } from 'lucide-react';
import toast from 'react-hot-toast';

export default function GRNPage() {
  const supabase = createClient();
  const { profile } = useAuth();

  const [grns, setGrns] = useState<any[]>([]);
  const [grnLines, setGrnLines] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedGrn, setExpandedGrn] = useState<string | null>(null);
  const [linesLoading, setLinesLoading] = useState<Record<string, boolean>>({});
  const [finalizing, setFinalizing] = useState<string | null>(null);

  useEffect(() => {
    loadGRNs();
  }, []);

  /* ================================
     LOAD GRNs
  ================================= */
  async function loadGRNs() {
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

      setGrns(data || []);
    } catch (error: any) {
      toast.error(`Failed to load GRNs: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  /* ================================
     LOAD GRN LINES
  ================================= */
  const loadLines = useCallback(async (grnId: string) => {
    setLinesLoading((prev) => ({ ...prev, [grnId]: true }));

    const { data, error } = await supabase
      .from('grn_lines')
      .select(`
        id,
        grn_id,
        sku_id,
        expected_boxes,
        expected_units,
        received_boxes,
        received_units,
        damaged_units,
        not_received_units,
        status,
        unit_price,
        skus (
          display_name,
          sku_code,
          units_per_box
        )
      `)
      .eq('grn_id', grnId)
      .order('id');

    if (error) {
      toast.error('Failed to load GRN lines');
    } else {
      setGrnLines((prev) => ({ ...prev, [grnId]: data || [] }));
    }

    setLinesLoading((prev) => ({ ...prev, [grnId]: false }));
  }, [supabase]);

  /* ================================
     TOGGLE EXPANSION
  ================================= */
  async function toggleExpand(grnId: string) {
    if (expandedGrn === grnId) {
      setExpandedGrn(null);
      return;
    }

    setExpandedGrn(grnId);
    if (!grnLines[grnId]) {
      await loadLines(grnId);
    }
  }

  /* ================================
     UPDATE LINE STATUS
  ================================= */
  async function updateLine(
    grnId: string,
    line: any,
    status: string
  ) {
    let updates: any = { status };

    if (status === 'received') {
      updates.received_boxes = line.expected_boxes;
      updates.received_units = line.expected_units;
    }

    if (status === 'not_received') {
      updates.received_boxes = 0;
      updates.received_units = 0;
      updates.not_received_units = line.expected_units;
    }

    if (status === 'damaged') {
      updates.damaged_units = line.expected_units;
    }

    const { error } = await supabase
      .from('grn_lines')
      .update(updates)
      .eq('id', line.id);

    if (error) {
      toast.error('Failed to update line');
      return;
    }

    toast.success('Line updated');
    await loadLines(grnId);
    await loadGRNs();
  }

  /* ================================
     FINALIZE GRN
  ================================= */
  async function finalizeGRN(grnId: string) {
    const lines = grnLines[grnId] || [];

    if (lines.some((l) => l.status === 'pending')) {
      toast.error('All lines must be processed before finalizing');
      return;
    }

    setFinalizing(grnId);

    try {
      const receivedLines = lines.filter(
        (l) => l.status === 'received'
      );

      for (const line of receivedLines) {
        // Generate Lot Number
        const { data: lotNumber } = await supabase.rpc(
          'next_doc_number',
          { p_doc_type: 'LOT' }
        );

        // Create Lot
        const { error: lotError } = await supabase
          .from('lots')
          .insert({
            lot_number: lotNumber,
            grn_id: grnId,
            grn_line_id: line.id,
            sku_id: line.sku_id,
            received_date: new Date()
              .toISOString()
              .split('T')[0],
            received_units: line.received_units,
            remaining_units: line.received_units,
            unit_cost: line.unit_price,
          });

        if (lotError) throw lotError;

        // Update Stock
        await supabase.rpc('update_stock_master', {
          p_sku_id: line.sku_id,
          p_delta: line.received_units,
        });
      }

      // Update GRN Status
      await supabase
        .from('grns')
        .update({
          status: 'finalized',
          finalized_by: profile?.id,
          finalized_at: new Date().toISOString(),
        })
        .eq('id', grnId);

      // Update PO Status
      const grn = grns.find((g) => g.id === grnId);
      if (grn?.po_id) {
        await supabase
          .from('purchase_orders')
          .update({ status: 'completed' })
          .eq('id', grn.po_id);
      }

      toast.success('GRN finalized successfully');
      setExpandedGrn(null);
      await loadGRNs();
    } catch (error: any) {
      toast.error(`Finalization failed: ${error.message}`);
    }

    setFinalizing(null);
  }

  /* ================================
     FILTERING
  ================================= */
  const filtered = grns.filter((g) =>
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
          {/* Header */}
          <div className="page-header">
            <div>
              <h1 className="page-title">GRN — Goods Receipt</h1>
              <p className="text-sm text-slate-500">
                {filtered.length} records
              </p>
            </div>
            <SearchInput value={search} onChange={setSearch} />
          </div>

          {/* Content */}
          {loading ? (
            <PageLoader />
          ) : filtered.length === 0 ? (
            <div className="card p-6 text-center text-slate-500">
              No GRNs available.
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((grn) => {
                const summaryLines = grn.grn_lines || [];
                const pending = summaryLines.filter(
                  (l: any) => l.status === 'pending'
                ).length;

                return (
                  <div key={grn.id} className="card overflow-hidden">
                    {/* GRN Header */}
                    <div
                      className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50"
                      onClick={() => toggleExpand(grn.id)}
                    >
                      <div className="flex items-center gap-4">
                        {expandedGrn === grn.id ? (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        )}

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-brand-700">
                              {grn.grn_number}
                            </span>
                            <StatusBadge status={grn.status} />
                          </div>
                          <p className="text-sm text-slate-500">
                            {grn.purchase_orders?.suppliers?.name} · PO:{' '}
                            {grn.purchase_orders?.po_number} ·{' '}
                            {formatDate(grn.grn_date)}
                          </p>
                        </div>
                      </div>

                      {grn.status === 'in_progress' &&
                        pending === 0 && (
                          <button
                            className="btn-primary btn-sm flex items-center gap-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              finalizeGRN(grn.id);
                            }}
                            disabled={finalizing === grn.id}
                          >
                            <PackageCheck className="w-4 h-4" />
                            {finalizing === grn.id
                              ? 'Finalizing...'
                              : 'Finalize GRN'}
                          </button>
                        )}
                    </div>

                    {/* GRN Lines */}
                    {expandedGrn === grn.id && (
                      <div className="border-t p-4 bg-slate-50">
                        {linesLoading[grn.id] ? (
                          <p className="text-sm text-slate-500">
                            Loading lines...
                          </p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left border-b">
                                <th className="py-2">SKU</th>
                                <th>Expected</th>
                                <th>Received</th>
                                <th>Status</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {grnLines[grn.id]?.map((line: any) => (
                                <tr key={line.id} className="border-b">
                                  <td className="py-2">
                                    {line.skus?.display_name}
                                  </td>
                                  <td>{line.expected_units}</td>
                                  <td>{line.received_units || 0}</td>
                                  <td>
                                    <StatusBadge status={line.status} />
                                  </td>
                                  <td className="space-x-2">
                                    <button
                                      className="btn-success btn-xs"
                                      onClick={() =>
                                        updateLine(
                                          grn.id,
                                          line,
                                          'received'
                                        )
                                      }
                                    >
                                      Receive
                                    </button>
                                    <button
                                      className="btn-danger btn-xs"
                                      onClick={() =>
                                        updateLine(
                                          grn.id,
                                          line,
                                          'not_received'
                                        )
                                      }
                                    >
                                      Reject
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PageGuard>
    </AppLayout>
  );
}

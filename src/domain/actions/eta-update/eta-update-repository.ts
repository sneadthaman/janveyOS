import { supabaseAdminClient } from "../../../integrations/supabase/client.js";
import type { EtaUpdateScope, EtaUpdateSourceType, EtaUpdateStatus, NormalizedEtaUpdate } from "./eta-update-types.js";

export async function createEtaUpdate(input: {
  vendorName: string;
  poNumber?: string | null;
  netsuitePoInternalId?: string | null;
  itemNumber?: string | null;
  netsuiteItemInternalId?: string | null;
  etaDate?: string | null;
  trackingNumber?: string | null;
  updateScope?: EtaUpdateScope;
  sourceType: EtaUpdateSourceType;
  sourceReference?: string | null;
  rawNotes?: string | null;
  confidence?: number | null;
  status?: EtaUpdateStatus;
  createdActionRequestId?: string | null;
}): Promise<NormalizedEtaUpdate> {
  if (!supabaseAdminClient) throw new Error("Supabase is required for ETA updates.");

  const { data, error } = await supabaseAdminClient
    .from("vendor_eta_updates")
    .insert({
      vendor_name: input.vendorName,
      po_number: input.poNumber ?? null,
      netsuite_po_internal_id: input.netsuitePoInternalId ?? null,
      item_number: input.itemNumber ?? null,
      netsuite_item_internal_id: input.netsuiteItemInternalId ?? null,
      eta_date: input.etaDate ?? null,
      tracking_number: input.trackingNumber ?? null,
      update_scope: input.updateScope ?? "unknown",
      source_type: input.sourceType,
      source_reference: input.sourceReference ?? null,
      raw_notes: input.rawNotes ?? null,
      confidence: input.confidence ?? null,
      status: input.status ?? "parsed",
      created_action_request_id: input.createdActionRequestId ?? null,
      updated_at: new Date().toISOString()
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(`Failed to create vendor_eta_updates row: ${error?.message ?? "unknown error"}`);
  return normalizeEtaUpdateRow(data as Record<string, unknown>);
}

export async function findEtaUpdatesByPoNumber(poNumber: string): Promise<NormalizedEtaUpdate[]> {
  if (!supabaseAdminClient) throw new Error("Supabase is required for ETA updates.");

  const normalizedPo = poNumber.trim().toUpperCase();
  const { data, error } = await supabaseAdminClient
    .from("vendor_eta_updates")
    .select("*")
    .ilike("po_number", normalizedPo)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`Failed to fetch vendor_eta_updates rows by po_number: ${error.message}`);
  return (data ?? []).map((row) => normalizeEtaUpdateRow(row as Record<string, unknown>));
}

export async function findRecentEtaUpdates(input?: {
  vendorName?: string;
  status?: EtaUpdateStatus;
  limit?: number;
}): Promise<NormalizedEtaUpdate[]> {
  if (!supabaseAdminClient) throw new Error("Supabase is required for ETA updates.");

  let query = supabaseAdminClient.from("vendor_eta_updates").select("*").order("updated_at", { ascending: false });
  if (input?.vendorName) query = query.ilike("vendor_name", input.vendorName.trim());
  if (input?.status) query = query.eq("status", input.status);
  query = query.limit(input?.limit ?? 20);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch recent vendor_eta_updates rows: ${error.message}`);
  return (data ?? []).map((row) => normalizeEtaUpdateRow(row as Record<string, unknown>));
}

export async function markEtaUpdateStatus(id: string, status: EtaUpdateStatus): Promise<void> {
  if (!supabaseAdminClient) throw new Error("Supabase is required for ETA updates.");

  const { error } = await supabaseAdminClient
    .from("vendor_eta_updates")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(`Failed to update vendor_eta_updates status: ${error.message}`);
}

function normalizeEtaUpdateRow(row: Record<string, unknown>): NormalizedEtaUpdate {
  return {
    id: String(row.id ?? ""),
    vendorName: String(row.vendor_name ?? ""),
    poNumber: row.po_number ? String(row.po_number) : null,
    netsuitePoInternalId: row.netsuite_po_internal_id ? String(row.netsuite_po_internal_id) : null,
    itemNumber: row.item_number ? String(row.item_number) : null,
    netsuiteItemInternalId: row.netsuite_item_internal_id ? String(row.netsuite_item_internal_id) : null,
    etaDate: row.eta_date ? String(row.eta_date) : null,
    trackingNumber: row.tracking_number ? String(row.tracking_number) : null,
    updateScope: (row.update_scope as EtaUpdateScope) ?? "unknown",
    sourceType: row.source_type as EtaUpdateSourceType,
    sourceReference: row.source_reference ? String(row.source_reference) : null,
    rawNotes: row.raw_notes ? String(row.raw_notes) : null,
    confidence: typeof row.confidence === "number" ? row.confidence : row.confidence ? Number(row.confidence) : null,
    status: (row.status as EtaUpdateStatus) ?? "parsed",
    createdActionRequestId: row.created_action_request_id ? String(row.created_action_request_id) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

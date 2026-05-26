import { supabaseAdminClient } from "../../../integrations/supabase/client.js";
import { findDocumentExtractionById, findEtaUpdateCandidateById } from "../../documents/document-extraction-repository.js";
import { findById as findIngestedDocumentById } from "../../documents/ingested-document-repository.js";

export type EtaLookupResult =
  | {
      kind: "executed";
      poNumber: string;
      etaDate: string | null;
      confidence: string | null;
      trackingNumber: string | null;
      source: string | null;
      lastUpdatedAt: string | null;
      updatedLines: number | null;
    }
  | {
      kind: "pending_review";
      poNumber: string;
      etaDate: string | null;
      confidence: string | null;
      trackingNumber: string | null;
      source: string | null;
      status: "pending" | "approved";
      lastUpdatedAt: string | null;
    }
  | {
      kind: "not_found";
      poNumber: string;
    };

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizePo(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  return `PO${digits}`;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function parseExecutedEtaRowForPo(
  normalizedPo: string,
  row: { input_json?: unknown; output_json?: unknown; source?: string | null; executed_at?: string | null; updated_at?: string | null }
): EtaLookupResult | null {
  const input = asObject(row.input_json);
  const output = asObject(row.output_json);
  const po = normalizePo(String(pickString(input.po_number, input.poNumber, output.poNumber, output.po_number) ?? ""));
  if (po !== normalizedPo) return null;
  const linesUpdatedRaw = output.linesUpdated ?? output.updatedLineCount ?? output.lines_updated;
  const updatedLines =
    typeof linesUpdatedRaw === "number" ? linesUpdatedRaw : typeof linesUpdatedRaw === "string" ? Number(linesUpdatedRaw) : null;
  return {
    kind: "executed",
    poNumber: normalizedPo,
    etaDate: pickString(output.etaDate, output.eta_date, input.eta_date, input.etaDate),
    confidence: pickString(output.etaConfidence, output.eta_confidence, input.extraction_confidence, input.eta_confidence, input.confidence_label),
    trackingNumber: pickString(output.trackingNumber, output.tracking_number, input.tracking_number, input.trackingNumber),
    source: pickString(input.eta_source, input.etaSource, input.source_type, input.source, row.source),
    lastUpdatedAt: pickString(row.executed_at, row.updated_at),
    updatedLines: Number.isFinite(updatedLines as number) ? (updatedLines as number) : null
  };
}

export async function lookupEtaByPoNumber(poNumber: string): Promise<EtaLookupResult> {
  const normalizedPo = normalizePo(poNumber);
  if (!supabaseAdminClient) return { kind: "not_found", poNumber: normalizedPo };

  const { data: actionRows } = await supabaseAdminClient
    .from("agent_action_requests")
    .select("id,status,source,input_json,output_json,executed_at,updated_at")
    .eq("action_type", "eta_update")
    .eq("status", "executed")
    .order("executed_at", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(200);

  for (const row of actionRows ?? []) {
    const parsed = parseExecutedEtaRowForPo(normalizedPo, row);
    if (parsed) return parsed;
  }

  const { data: reviewRows } = await supabaseAdminClient
    .from("eta_candidate_reviews")
    .select("id,eta_update_candidate_id,review_status,updated_at")
    .in("review_status", ["pending", "approved"])
    .order("updated_at", { ascending: false })
    .limit(200);

  for (const review of reviewRows ?? []) {
    const candidateId = String(review.eta_update_candidate_id ?? "").trim();
    if (!candidateId) continue;
    const candidate = await findEtaUpdateCandidateById(candidateId);
    if (!candidate || normalizePo(String(candidate.poNumber ?? "")) !== normalizedPo) continue;
    const extraction = await findDocumentExtractionById(candidate.documentExtractionId);
    const document = extraction ? await findIngestedDocumentById(extraction.documentId) : null;
    return {
      kind: "pending_review",
      poNumber: normalizedPo,
      etaDate: candidate.etaDate,
      confidence: pickString(candidate.etaDateSource === "ship_date" ? "HIGH" : null, "MED"),
      trackingNumber: candidate.trackingNumber,
      source: pickString(document?.fileName ?? null, extraction?.classification ?? null, "document_review"),
      status: review.review_status === "approved" ? "approved" : "pending",
      lastUpdatedAt: pickString(String(review.updated_at ?? ""))
    };
  }

  return { kind: "not_found", poNumber: normalizedPo };
}

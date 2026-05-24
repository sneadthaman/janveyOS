import { supabaseAdminClient } from "../../integrations/supabase/client.js";
import { findById } from "./ingested-document-repository.js";
import type { DocumentType, IngestedDocument } from "./ingested-document-types.js";

export interface DocumentExtraction {
  id: string;
  documentId: string;
  extractorVersion: string;
  classification: DocumentType;
  confidence: number | null;
  rawExtractionJson: Record<string, unknown>;
  createdAt: string;
}

export interface EtaUpdateCandidateRecord {
  id: string;
  documentExtractionId: string;
  poNumber: string | null;
  etaDate: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  itemNumber: string | null;
  appliesToEntirePo: boolean;
  confidence: number | null;
  rawContext: string | null;
  createdAt: string;
}

interface RepositoryDeps {
  insertDocumentExtraction: (row: Record<string, unknown>) => Promise<Record<string, unknown>>;
  insertEtaUpdateCandidates: (rows: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>;
  findExtractionByDocumentId: (documentId: string) => Promise<Record<string, unknown> | null>;
  findEtaCandidatesByExtractionId: (extractionId: string) => Promise<Record<string, unknown>[]>;
}

function normalizeExtraction(row: Record<string, unknown>): DocumentExtraction {
  return {
    id: String(row.id ?? ""),
    documentId: String(row.document_id ?? ""),
    extractorVersion: String(row.extractor_version ?? ""),
    classification: String(row.classification ?? "unknown") as DocumentType,
    confidence: typeof row.confidence === "number" ? row.confidence : row.confidence ? Number(row.confidence) : null,
    rawExtractionJson: (row.raw_extraction_json as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at ?? "")
  };
}

function normalizeCandidate(row: Record<string, unknown>): EtaUpdateCandidateRecord {
  return {
    id: String(row.id ?? ""),
    documentExtractionId: String(row.document_extraction_id ?? ""),
    poNumber: row.po_number ? String(row.po_number) : null,
    etaDate: row.eta_date ? String(row.eta_date) : null,
    trackingNumber: row.tracking_number ? String(row.tracking_number) : null,
    carrier: row.carrier ? String(row.carrier) : null,
    itemNumber: row.item_number ? String(row.item_number) : null,
    appliesToEntirePo: Boolean(row.applies_to_entire_po),
    confidence: typeof row.confidence === "number" ? row.confidence : row.confidence ? Number(row.confidence) : null,
    rawContext: row.raw_context ? String(row.raw_context) : null,
    createdAt: String(row.created_at ?? "")
  };
}

export async function createDocumentExtraction(input: {
  documentId: string;
  extractorVersion: string;
  classification: DocumentType;
  confidence?: number | null;
  rawExtractionJson: Record<string, unknown>;
}): Promise<DocumentExtraction> {
  return createDocumentExtractionWithDeps(input, defaultDeps);
}

export async function createDocumentExtractionWithDeps(
  input: {
    documentId: string;
    extractorVersion: string;
    classification: DocumentType;
    confidence?: number | null;
    rawExtractionJson: Record<string, unknown>;
  },
  deps: RepositoryDeps
): Promise<DocumentExtraction> {
  const data = await deps.insertDocumentExtraction({
    document_id: input.documentId,
    extractor_version: input.extractorVersion,
    classification: input.classification,
    confidence: input.confidence ?? null,
    raw_extraction_json: input.rawExtractionJson
  });

  return normalizeExtraction(data);
}

export async function createEtaUpdateCandidates(
  input: Array<{
    documentExtractionId: string;
    poNumber?: string | null;
    etaDate?: string | null;
    trackingNumber?: string | null;
    carrier?: string | null;
    itemNumber?: string | null;
    appliesToEntirePo?: boolean;
    confidence?: number | null;
    rawContext?: string | null;
  }>
): Promise<EtaUpdateCandidateRecord[]> {
  return createEtaUpdateCandidatesWithDeps(input, defaultDeps);
}

export async function createEtaUpdateCandidatesWithDeps(
  input: Array<{
    documentExtractionId: string;
    poNumber?: string | null;
    etaDate?: string | null;
    trackingNumber?: string | null;
    carrier?: string | null;
    itemNumber?: string | null;
    appliesToEntirePo?: boolean;
    confidence?: number | null;
    rawContext?: string | null;
  }>,
  deps: RepositoryDeps
): Promise<EtaUpdateCandidateRecord[]> {
  if (input.length === 0) return [];

  const payload = input.map((row) => ({
    document_extraction_id: row.documentExtractionId,
    po_number: row.poNumber ?? null,
    eta_date: row.etaDate ?? null,
    tracking_number: row.trackingNumber ?? null,
    carrier: row.carrier ?? null,
    item_number: row.itemNumber ?? null,
    applies_to_entire_po: row.appliesToEntirePo ?? false,
    confidence: row.confidence ?? null,
    raw_context: row.rawContext ?? null
  }));

  const data = await deps.insertEtaUpdateCandidates(payload);
  return data.map((row) => normalizeCandidate(row));
}

export async function findExtractionByDocumentId(documentId: string): Promise<DocumentExtraction | null> {
  return findExtractionByDocumentIdWithDeps(documentId, defaultDeps);
}

export async function findExtractionByDocumentIdWithDeps(
  documentId: string,
  deps: RepositoryDeps
): Promise<DocumentExtraction | null> {
  const data = await deps.findExtractionByDocumentId(documentId);
  return data ? normalizeExtraction(data) : null;
}

export async function findEtaCandidatesByExtractionId(extractionId: string): Promise<EtaUpdateCandidateRecord[]> {
  return findEtaCandidatesByExtractionIdWithDeps(extractionId, defaultDeps);
}

export async function findEtaUpdateCandidateById(candidateId: string): Promise<EtaUpdateCandidateRecord | null> {
  if (!supabaseAdminClient) throw new Error("Supabase is required for document extraction repository.");

  const { data, error } = await supabaseAdminClient
    .from("eta_update_candidates")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load eta update candidate by id: ${error.message}`);
  return data ? normalizeCandidate(data as Record<string, unknown>) : null;
}

export async function findDocumentExtractionById(extractionId: string): Promise<DocumentExtraction | null> {
  if (!supabaseAdminClient) throw new Error("Supabase is required for document extraction repository.");

  const { data, error } = await supabaseAdminClient
    .from("document_extractions")
    .select("*")
    .eq("id", extractionId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load document extraction by id: ${error.message}`);
  return data ? normalizeExtraction(data as Record<string, unknown>) : null;
}

export async function findEtaCandidatesByExtractionIdWithDeps(
  extractionId: string,
  deps: RepositoryDeps
): Promise<EtaUpdateCandidateRecord[]> {
  const data = await deps.findEtaCandidatesByExtractionId(extractionId);
  return data.map((row) => normalizeCandidate(row));
}

const defaultDeps: RepositoryDeps = {
  async insertDocumentExtraction(row) {
  if (!supabaseAdminClient) throw new Error("Supabase is required for document extraction repository.");

  const { data, error } = await supabaseAdminClient
    .from("document_extractions")
    .insert(row)
    .select("*")
    .single();

  if (error || !data) throw new Error(`Failed to create document_extractions row: ${error?.message ?? "unknown"}`);
  return data as Record<string, unknown>;
  },
  async insertEtaUpdateCandidates(rows) {
    if (!supabaseAdminClient) throw new Error("Supabase is required for document extraction repository.");
    const { data, error } = await supabaseAdminClient.from("eta_update_candidates").insert(rows).select("*");
    if (error) throw new Error(`Failed to create eta_update_candidates rows: ${error.message}`);
    return (data ?? []) as Record<string, unknown>[];
  },
  async findExtractionByDocumentId(documentId) {
    if (!supabaseAdminClient) throw new Error("Supabase is required for document extraction repository.");

  const { data, error } = await supabaseAdminClient
    .from("document_extractions")
    .select("*")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to load document extraction by document id: ${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
  },
  async findEtaCandidatesByExtractionId(extractionId) {
    if (!supabaseAdminClient) throw new Error("Supabase is required for document extraction repository.");

  const { data, error } = await supabaseAdminClient
    .from("eta_update_candidates")
    .select("*")
    .eq("document_extraction_id", extractionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to load eta update candidates: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
  }
};

export async function updateIngestedDocumentType(input: { documentId: string; documentType: DocumentType }): Promise<IngestedDocument> {
  if (!supabaseAdminClient) throw new Error("Supabase is required for ingested documents.");

  const { data, error } = await supabaseAdminClient
    .from("ingested_documents")
    .update({ document_type: input.documentType, updated_at: new Date().toISOString() })
    .eq("id", input.documentId)
    .select("*")
    .single();

  if (error || !data) throw new Error(`Failed to update ingested_documents document_type: ${error?.message ?? "unknown"}`);

  const updated = await findById(String((data as Record<string, unknown>).id));
  if (!updated) throw new Error("Updated ingested document could not be reloaded.");
  return updated;
}

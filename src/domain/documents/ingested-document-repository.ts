import { supabaseAdminClient } from "../../integrations/supabase/client.js";
import type { CreateIngestedDocumentInput, IngestedDocument } from "./ingested-document-types.js";

type IngestedDocumentRow = Record<string, unknown>;

interface IngestedDocumentRepositoryDeps {
  createRow: (input: CreateIngestedDocumentInput) => Promise<IngestedDocumentRow>;
  updateRowById: (id: string, patch: Record<string, unknown>) => Promise<IngestedDocumentRow>;
  findRowByHash: (hash: string) => Promise<IngestedDocumentRow | null>;
  findRowById: (id: string) => Promise<IngestedDocumentRow | null>;
}

const defaultDeps: IngestedDocumentRepositoryDeps = {
  async createRow(input) {
    if (!supabaseAdminClient) throw new Error("Supabase is required for ingested documents.");

    const { data, error } = await supabaseAdminClient
      .from("ingested_documents")
      .insert({
        source: input.source,
        source_message_id: input.sourceMessageId ?? null,
        source_thread_id: input.sourceThreadId ?? null,
        source_sender: input.sourceSender ?? null,
        source_subject: input.sourceSubject ?? null,
        file_name: input.fileName,
        mime_type: input.mimeType ?? "application/pdf",
        file_size_bytes: input.fileSizeBytes ?? null,
        storage_path: input.storagePath ?? null,
        sha256_hash: input.sha256Hash ?? null,
        extracted_text: input.extractedText ?? null,
        extraction_status: input.extractionStatus ?? "pending",
        extraction_error: input.extractionError ?? null,
        document_type: input.documentType ?? "unknown",
        updated_at: new Date().toISOString()
      })
      .select("*")
      .single();

    if (error || !data) throw new Error(`Failed to create ingested_documents row: ${error?.message ?? "unknown error"}`);
    return data as IngestedDocumentRow;
  },

  async updateRowById(id, patch) {
    if (!supabaseAdminClient) throw new Error("Supabase is required for ingested documents.");

    const { data, error } = await supabaseAdminClient
      .from("ingested_documents")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();

    if (error || !data) throw new Error(`Failed to update ingested_documents row: ${error?.message ?? "unknown error"}`);
    return data as IngestedDocumentRow;
  },

  async findRowByHash(hash) {
    if (!supabaseAdminClient) throw new Error("Supabase is required for ingested documents.");

    const { data, error } = await supabaseAdminClient
      .from("ingested_documents")
      .select("*")
      .eq("sha256_hash", hash)
      .maybeSingle();

    if (error) throw new Error(`Failed to find ingested_documents row by hash: ${error.message}`);
    return (data as IngestedDocumentRow | null) ?? null;
  },

  async findRowById(id) {
    if (!supabaseAdminClient) throw new Error("Supabase is required for ingested documents.");

    const { data, error } = await supabaseAdminClient
      .from("ingested_documents")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Failed to find ingested_documents row by id: ${error.message}`);
    return (data as IngestedDocumentRow | null) ?? null;
  }
};

function normalizeRow(row: IngestedDocumentRow): IngestedDocument {
  return {
    id: String(row.id ?? ""),
    source: String(row.source ?? "other") as IngestedDocument["source"],
    sourceMessageId: row.source_message_id ? String(row.source_message_id) : null,
    sourceThreadId: row.source_thread_id ? String(row.source_thread_id) : null,
    sourceSender: row.source_sender ? String(row.source_sender) : null,
    sourceSubject: row.source_subject ? String(row.source_subject) : null,
    fileName: String(row.file_name ?? ""),
    mimeType: String(row.mime_type ?? "application/pdf"),
    fileSizeBytes:
      typeof row.file_size_bytes === "number"
        ? row.file_size_bytes
        : row.file_size_bytes === null || row.file_size_bytes === undefined
          ? null
          : Number(row.file_size_bytes),
    storagePath: row.storage_path ? String(row.storage_path) : null,
    sha256Hash: row.sha256_hash ? String(row.sha256_hash) : null,
    extractedText: row.extracted_text ? String(row.extracted_text) : null,
    extractionStatus: String(row.extraction_status ?? "pending") as IngestedDocument["extractionStatus"],
    extractionError: row.extraction_error ? String(row.extraction_error) : null,
    documentType: row.document_type ? (String(row.document_type) as IngestedDocument["documentType"]) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

export async function createPendingWithDeps(
  input: CreateIngestedDocumentInput,
  deps: IngestedDocumentRepositoryDeps
): Promise<IngestedDocument> {
  const row = await deps.createRow({ ...input, extractionStatus: "pending" });
  return normalizeRow(row);
}

export async function markExtractionCompletedWithDeps(
  id: string,
  extractedText: string,
  deps: IngestedDocumentRepositoryDeps
): Promise<IngestedDocument> {
  const row = await deps.updateRowById(id, {
    extraction_status: "completed",
    extracted_text: extractedText,
    extraction_error: null
  });
  return normalizeRow(row);
}

export async function markExtractionFailedWithDeps(
  id: string,
  error: string,
  deps: IngestedDocumentRepositoryDeps
): Promise<IngestedDocument> {
  const row = await deps.updateRowById(id, {
    extraction_status: "failed",
    extraction_error: error
  });
  return normalizeRow(row);
}

export async function findByHashWithDeps(hash: string, deps: IngestedDocumentRepositoryDeps): Promise<IngestedDocument | null> {
  const row = await deps.findRowByHash(hash);
  return row ? normalizeRow(row) : null;
}

export async function findByIdWithDeps(id: string, deps: IngestedDocumentRepositoryDeps): Promise<IngestedDocument | null> {
  const row = await deps.findRowById(id);
  return row ? normalizeRow(row) : null;
}

export async function createPending(input: CreateIngestedDocumentInput): Promise<IngestedDocument> {
  return createPendingWithDeps(input, defaultDeps);
}

export async function markExtractionCompleted(id: string, extractedText: string): Promise<IngestedDocument> {
  return markExtractionCompletedWithDeps(id, extractedText, defaultDeps);
}

export async function markExtractionFailed(id: string, error: string): Promise<IngestedDocument> {
  return markExtractionFailedWithDeps(id, error, defaultDeps);
}

export async function findByHash(hash: string): Promise<IngestedDocument | null> {
  return findByHashWithDeps(hash, defaultDeps);
}

export async function findById(id: string): Promise<IngestedDocument | null> {
  return findByIdWithDeps(id, defaultDeps);
}

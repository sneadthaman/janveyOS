import { supabaseAdminClient } from "../../../integrations/supabase/client.js";

export type EtaEmailExtractionStatus = "pending" | "extracted" | "failed" | "approval_created" | "skipped";

export interface EtaEmailIngestionRow {
  id: string;
  graph_message_id: string;
  internet_message_id: string | null;
  subject: string | null;
  sender: string | null;
  received_at: string | null;
  folder_name: string;
  raw_body_text: string | null;
  raw_body_html: string | null;
  extraction_status: EtaEmailExtractionStatus;
  extracted_payload: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export async function findEtaEmailIngestionByGraphMessageId(graphMessageId: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required for ETA email ingestion.");

  const { data, error } = await supabaseAdminClient
    .from("eta_email_ingestions")
    .select("*")
    .eq("graph_message_id", graphMessageId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load eta_email_ingestions row: ${error.message}`);
  return (data as EtaEmailIngestionRow | null) ?? null;
}

export async function createEtaEmailIngestion(input: {
  graphMessageId: string;
  internetMessageId?: string | null;
  subject?: string | null;
  sender?: string | null;
  receivedAt?: string | null;
  folderName: string;
  rawBodyText?: string | null;
  rawBodyHtml?: string | null;
  extractionStatus?: EtaEmailExtractionStatus;
}) {
  if (!supabaseAdminClient) throw new Error("Supabase is required for ETA email ingestion.");

  const { data, error } = await supabaseAdminClient
    .from("eta_email_ingestions")
    .insert({
      graph_message_id: input.graphMessageId,
      internet_message_id: input.internetMessageId ?? null,
      subject: input.subject ?? null,
      sender: input.sender ?? null,
      received_at: input.receivedAt ?? null,
      folder_name: input.folderName,
      raw_body_text: input.rawBodyText ?? null,
      raw_body_html: input.rawBodyHtml ?? null,
      extraction_status: input.extractionStatus ?? "pending",
      updated_at: new Date().toISOString()
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Failed to create eta_email_ingestions row: ${error?.message ?? "unknown error"}`);
  return data as EtaEmailIngestionRow;
}

export async function updateEtaEmailIngestion(input: {
  id: string;
  extractionStatus: EtaEmailExtractionStatus;
  extractedPayload?: Record<string, unknown> | null;
  errorMessage?: string | null;
}) {
  if (!supabaseAdminClient) throw new Error("Supabase is required for ETA email ingestion.");

  const updates: Record<string, unknown> = {
    extraction_status: input.extractionStatus,
    updated_at: new Date().toISOString()
  };
  if (input.extractedPayload !== undefined) updates.extracted_payload = input.extractedPayload;
  if (input.errorMessage !== undefined) updates.error_message = input.errorMessage;

  const { data, error } = await supabaseAdminClient
    .from("eta_email_ingestions")
    .update(updates)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error || !data) throw new Error(`Failed to update eta_email_ingestions row: ${error?.message ?? "unknown error"}`);
  return data as EtaEmailIngestionRow;
}

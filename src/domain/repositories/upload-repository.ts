import { supabaseAdminClient } from "../../integrations/supabase/client.js";
import { logger } from "../../shared/logger.js";
import type { ParsedUploadRow, SkippedUploadRow } from "../types/upload-types.js";
import { computeNilfiskSchoolHealthcarePricing } from "../services/pricing-utils.js";

export async function createUploadedDocument(input: {
  originalFileName: string;
  storedFilePath: string;
  mimeType: string;
  fileExtension: string;
  vendor: "Nilfisk" | "Taski" | "Triple-S";
  documentType: string;
}) {
  if (!supabaseAdminClient) {
    throw new Error("Supabase is required for uploads.");
  }
  const { data, error } = await supabaseAdminClient
    .from("uploaded_documents")
    .insert({
      original_file_name: input.originalFileName,
      stored_file_path: input.storedFilePath,
      mime_type: input.mimeType,
      file_extension: input.fileExtension,
      vendor: input.vendor,
      document_type: input.documentType
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create uploaded document: ${error?.message ?? "unknown error"}`);
  }
  return data.id as string;
}

export async function updateUploadParseSummary(input: {
  uploadedDocumentId: string;
  parseStatus: "parsed" | "parsed_with_errors" | "not_supported" | "failed";
  parseError?: string;
  totalRows: number;
  parsedRows: number;
  skippedRows: number;
}) {
  if (!supabaseAdminClient) return;
  const { error } = await supabaseAdminClient
    .from("uploaded_documents")
    .update({
      parse_status: input.parseStatus,
      parse_error: input.parseError ?? null,
      total_rows: input.totalRows,
      parsed_rows: input.parsedRows,
      skipped_rows: input.skippedRows,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.uploadedDocumentId);
  if (error) logger.warn("Failed to update upload parse summary", error);
}

export async function listUploads() {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const client = supabaseAdminClient;
  const { data: docs, error } = await supabaseAdminClient
    .from("uploaded_documents")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Failed to list uploads: ${error.message}`);
  const uploads = docs ?? [];
  const enriched = await Promise.all(
    uploads.map(async (upload) => {
      const { data: rows } = await client
        .from("parsed_product_rows")
        .select("approved_status,skip_reason")
        .eq("uploaded_document_id", upload.id);
      const parsed = (rows ?? []).filter((r) => !r.skip_reason);
      const pendingCount = parsed.filter((r) => r.approved_status === "pending").length;
      const approvedCount = parsed.filter((r) => r.approved_status === "approved").length;
      const rejectedCount = parsed.filter((r) => r.approved_status === "rejected").length;
      const derivedStatus =
        parsed.length > 0 && approvedCount === parsed.length
          ? "approved"
          : parsed.length > 0 && rejectedCount === parsed.length
            ? "rejected"
            : "pending";
      return {
        ...upload,
        approval_status: (upload as Record<string, unknown>).approval_status ?? derivedStatus,
        pending_approval_count: pendingCount,
        approved_count: approvedCount
      };
    })
  );
  return enriched;
}

export async function insertParsedRows(input: {
  uploadedDocumentId: string;
  rows: ParsedUploadRow[];
  vendor: "Nilfisk" | "Taski" | "Triple-S";
}) {
  if (!supabaseAdminClient || input.rows.length === 0) return;
  const payload = input.rows.map((row) => {
    const calc = computeNilfiskSchoolHealthcarePricing({
      dealerNet: row.dealerNet,
      listPrice: row.listPrice
    });
    return {
      uploaded_document_id: input.uploadedDocumentId,
      row_number: row.rowNumber,
      raw_json: row.raw,
      sku: row.sku,
      product_name: row.productName,
      product_description: row.productDescription ?? null,
      list_price: row.listPrice,
      dealer_net: row.dealerNet,
      true_cost: calc.trueCost,
      ed_data_sell_price: calc.edDataSellPrice,
      gross_profit: calc.grossProfit,
      margin_percent: calc.marginPercent,
      approved_status: "pending"
    };
  });
  const { error } = await supabaseAdminClient.from("parsed_product_rows").insert(payload);
  if (error) throw new Error(`Failed to insert parsed rows: ${error.message}`);
}

export async function createDraftEntitiesFromParsedRows(input: { uploadedDocumentId: string }) {
  if (!supabaseAdminClient) return;
  const { data: rows, error } = await supabaseAdminClient
    .from("parsed_product_rows")
    .select("*")
    .eq("uploaded_document_id", input.uploadedDocumentId)
    .is("skip_reason", null);
  if (error) throw new Error(`Failed loading parsed rows for draft creation: ${error.message}`);

  for (const row of rows ?? []) {
    const sku = row.sku as string;
    const productName = row.product_name as string;
    const productDescription = (row.product_description as string | null) ?? null;

    const productUpsert = await supabaseAdminClient
      .from("products")
      .upsert(
        {
          sku,
          vendor: "Nilfisk",
          product_name: productName,
          product_description: productDescription,
          approved_status: "pending",
          updated_at: new Date().toISOString()
        },
        { onConflict: "sku" }
      )
      .select("id")
      .single();
    if (productUpsert.error) {
      logger.warn(`Failed to upsert product draft for sku=${sku}`, productUpsert.error);
      continue;
    }
    const productId = productUpsert.data?.id as string | undefined;

    const pricingUpsert = await supabaseAdminClient
      .from("product_pricing")
      .upsert(
        {
          sku,
          vendor: "Nilfisk",
          program_name: "Nilfisk school/healthcare",
          source_uploaded_document_id: input.uploadedDocumentId,
          list_price: row.list_price,
          dealer_net: row.dealer_net,
          true_cost: row.true_cost,
          ed_data_sell_price: row.ed_data_sell_price,
          gross_profit: row.gross_profit,
          margin_percent: row.margin_percent,
          approved_status: "pending",
          updated_at: new Date().toISOString()
        },
        { onConflict: "sku,program_name" }
      );
    if (pricingUpsert.error) logger.warn(`Failed to upsert pricing draft for sku=${sku}`, pricingUpsert.error);

    const body = [
      `SKU: ${sku}`,
      `Vendor: Nilfisk`,
      `Description: ${productDescription ?? productName}`,
      `List Price: ${row.list_price}`,
      `Dealer Net: ${row.dealer_net}`,
      `True Cost (dealer_net * 0.93): ${row.true_cost}`,
      `ED Data Sell Price (list * 0.79): ${row.ed_data_sell_price}`,
      `Gross Profit: ${row.gross_profit}`,
      `Margin %: ${Number(row.margin_percent) * 100}`
    ].join("\n");
    const knowledgeUpsert = await supabaseAdminClient
      .from("knowledge_entries")
      .upsert(
        {
          title: productName,
          body,
          category: "product",
          source_type: "upload",
          source_ref_id: productId ?? null,
          approved_status: "pending",
          metadata_json: {
            sku,
            vendor: "Nilfisk",
            uploaded_document_id: input.uploadedDocumentId
          },
          updated_at: new Date().toISOString()
        },
        { onConflict: "title,source_type" }
      );
    if (knowledgeUpsert.error) logger.warn(`Failed to upsert knowledge draft for sku=${sku}`, knowledgeUpsert.error);
  }
}

export async function insertSkippedRows(input: {
  uploadedDocumentId: string;
  skipped: SkippedUploadRow[];
}) {
  if (!supabaseAdminClient || input.skipped.length === 0) return;
  const payload = input.skipped.map((row) => ({
    uploaded_document_id: input.uploadedDocumentId,
    row_number: row.rowNumber,
    raw_json: row.raw,
    approved_status: "pending",
    skip_reason: row.reason
  }));
  const { error } = await supabaseAdminClient.from("parsed_product_rows").insert(payload);
  if (error) logger.warn("Failed to insert skipped rows", error);
}

export async function getUploadParsedPreview(uploadedDocumentId: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data: upload, error: uploadError } = await supabaseAdminClient
    .from("uploaded_documents")
    .select("*")
    .eq("id", uploadedDocumentId)
    .single();
  if (uploadError || !upload) throw new Error("Upload not found");

  const { data: rows, error: rowsError } = await supabaseAdminClient
    .from("parsed_product_rows")
    .select("*")
    .eq("uploaded_document_id", uploadedDocumentId)
    .order("row_number", { ascending: true });
  if (rowsError) throw new Error(`Failed to fetch parsed rows: ${rowsError.message}`);
  return { upload, rows: rows ?? [] };
}

export async function getUploadDetail(uploadedDocumentId: string) {
  const preview = await getUploadParsedPreview(uploadedDocumentId);
  return preview;
}

export async function approveUpload(uploadedDocumentId: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data: rows, error } = await supabaseAdminClient
    .from("parsed_product_rows")
    .select("*")
    .eq("uploaded_document_id", uploadedDocumentId)
    .is("skip_reason", null);
  if (error) throw new Error(`Failed to fetch rows for approval: ${error.message}`);

  const approvedRows = rows ?? [];
  for (const row of approvedRows) {
    const sku = row.sku as string;
    const productName = row.product_name as string;
    const productDescription = (row.product_description as string | null) ?? null;
    const productUpsert = await supabaseAdminClient
      .from("products")
      .upsert(
        {
          sku,
          vendor: "Nilfisk",
          product_name: productName,
          product_description: productDescription,
          approved_status: "approved",
          updated_at: new Date().toISOString()
        },
        { onConflict: "sku" }
      )
      .select("id")
      .single();
    if (productUpsert.error) {
      logger.warn(`Failed to upsert product for sku=${sku}`, productUpsert.error);
      continue;
    }
    const productId = productUpsert.data?.id as string | undefined;

    const pricingUpsert = await supabaseAdminClient
      .from("product_pricing")
      .upsert(
        {
          sku,
          vendor: "Nilfisk",
          program_name: "Nilfisk school/healthcare",
          source_uploaded_document_id: uploadedDocumentId,
          list_price: row.list_price,
          dealer_net: row.dealer_net,
          true_cost: row.true_cost,
          ed_data_sell_price: row.ed_data_sell_price,
          gross_profit: row.gross_profit,
          margin_percent: row.margin_percent,
          approved_status: "approved",
          updated_at: new Date().toISOString()
        },
        { onConflict: "sku,program_name" }
      );
    if (pricingUpsert.error) {
      logger.warn(`Failed to upsert pricing for sku=${sku}`, pricingUpsert.error);
    }

    const knowledgeUpdate = await supabaseAdminClient
      .from("knowledge_entries")
      .update({ approved_status: "approved", updated_at: new Date().toISOString(), source_ref_id: productId ?? null })
      .eq("title", productName)
      .eq("source_type", "upload");
    if (knowledgeUpdate.error) logger.warn(`Failed to approve knowledge entry for sku=${sku}`, knowledgeUpdate.error);
  }

  await supabaseAdminClient
    .from("parsed_product_rows")
    .update({ approved_status: "approved" })
    .eq("uploaded_document_id", uploadedDocumentId)
    .is("skip_reason", null);
  await supabaseAdminClient
    .from("uploaded_documents")
    .update({ updated_at: new Date().toISOString(), parse_status: "parsed" })
    .eq("id", uploadedDocumentId);
  // Backward compatible: this column may not exist in older DBs.
  await supabaseAdminClient
    .from("uploaded_documents")
    .update({ approval_status: "approved" })
    .eq("id", uploadedDocumentId);

  return { approvedCount: approvedRows.length };
}

export async function rejectUpload(uploadedDocumentId: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  await supabaseAdminClient
    .from("parsed_product_rows")
    .update({ approved_status: "rejected" })
    .eq("uploaded_document_id", uploadedDocumentId)
    .is("skip_reason", null);
  await supabaseAdminClient
    .from("product_pricing")
    .update({ approved_status: "rejected", updated_at: new Date().toISOString() })
    .eq("source_uploaded_document_id", uploadedDocumentId);
  await supabaseAdminClient
    .from("knowledge_entries")
    .update({ approved_status: "rejected", updated_at: new Date().toISOString() })
    .contains("metadata_json", { uploaded_document_id: uploadedDocumentId });
  await supabaseAdminClient
    .from("uploaded_documents")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", uploadedDocumentId);
  await supabaseAdminClient
    .from("uploaded_documents")
    .update({ approval_status: "rejected" })
    .eq("id", uploadedDocumentId);
  return { rejected: true };
}

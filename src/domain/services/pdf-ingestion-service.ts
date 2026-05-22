import fs from "node:fs/promises";
import { supabaseAdminClient } from "../../integrations/supabase/client.js";
import { runAiTask } from "../../ai/ai-client.js";
import { extractAndStoreKnowledgeCards } from "./knowledge-card-extraction-service.js";

interface PdfIngestionResult {
  chunkCount: number;
  summaryCreated: boolean;
  cardCount: number;
}

function chunkTextByWords(text: string, targetWords = 700): string[] {
  const words = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += targetWords) {
    chunks.push(words.slice(i, i + targetWords).join(" "));
  }
  return chunks.filter((c) => c.length > 0);
}

function findSkuCandidates(text: string): string[] {
  const matches = text.match(/\b[A-Z]{2,5}[- ]?\d{2,6}\b/g) ?? [];
  return matches.map((m) => m.replace(/\s+/g, "").toUpperCase());
}

function scoreProductMatch(input: {
  chunk: string;
  product: { sku: string; product_name: string; vendor: string; product_type: string };
  skuCandidates: string[];
}) {
  const lower = input.chunk.toLowerCase();
  let score = 0;
  if (input.skuCandidates.includes(input.product.sku.toUpperCase())) score += 100;
  if (lower.includes(input.product.product_name.toLowerCase())) score += 40;
  if (lower.includes(input.product.vendor.toLowerCase())) score += 10;
  const categoryTerms = ["scrubber", "autoscrubber", "floor machine", "walk-behind", "rider", "advance", "sc"];
  if (categoryTerms.some((t) => lower.includes(t))) score += 8;
  if (input.product.product_type.toLowerCase().includes("autoscrubber")) score += 5;
  return score;
}

export async function ingestPdfToKnowledge(input: {
  uploadedDocumentId: string;
  filePath: string;
  fileName: string;
  vendor: string;
}): Promise<PdfIngestionResult> {
  if (!supabaseAdminClient) throw new Error("Supabase is required for PDF ingestion.");
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = (pdfParseModule.default ?? pdfParseModule) as (dataBuffer: Buffer) => Promise<{ text: string }>;
  const pdfBuffer = await fs.readFile(input.filePath);
  const parsed = await pdfParse(pdfBuffer);
  const extracted = String(parsed.text ?? "").trim();
  if (!extracted) throw new Error("PDF text extraction produced no usable text.");

  const chunks = chunkTextByWords(extracted, 700);
  const { data: products, error: productsError } = await supabaseAdminClient
    .from("products")
    .select("id,sku,product_name,vendor,product_type")
    .in("approved_status", ["approved", "pending"]);
  if (productsError) throw new Error(`Failed loading products for PDF match: ${productsError.message}`);
  const productRows = (products ?? []) as Array<{
    id: string;
    sku: string;
    product_name: string;
    vendor: string;
    product_type: string;
  }>;

  let chunkIndex = 0;
  let cardCount = 0;
  for (const chunk of chunks) {
    chunkIndex += 1;
    const skuCandidates = findSkuCandidates(chunk);
    const scored = productRows
      .map((p) => ({ product: p, score: scoreProductMatch({ chunk, product: p, skuCandidates }) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const linkedProductId = best && best.score >= 30 ? best.product.id : null;
    const linkedProductName = best && best.score >= 30 ? best.product.product_name : null;
    const linkedProductSku = best && best.score >= 30 ? best.product.sku : null;
    const matchReason =
      best && best.score >= 30
        ? linkedProductSku && skuCandidates.includes(linkedProductSku.toUpperCase())
          ? "sku_exact"
          : "name/vendor/category_heuristic"
        : "no_confident_match";

    const { error } = await supabaseAdminClient.from("knowledge_entries").insert({
      title: `${input.fileName} Chunk ${chunkIndex} [${input.uploadedDocumentId.slice(0, 8)}]`,
      body: chunk,
      category: "product_spec",
      source_type: "upload",
      source_ref_id: linkedProductId,
      approved_status: "pending",
      metadata_json: {
        uploaded_document_id: input.uploadedDocumentId,
        vendor: input.vendor,
        chunk_index: chunkIndex,
        matched_product_name: linkedProductName,
        matched_product_sku: linkedProductSku,
        match_score: best?.score ?? 0,
        match_reason: matchReason,
        sku_candidates: skuCandidates
      }
    });
    if (error) throw new Error(`Failed writing PDF chunk knowledge: ${error.message}`);

    const cards = await extractAndStoreKnowledgeCards({
      uploadedDocumentId: input.uploadedDocumentId,
      sourceType: "upload",
      vendor: input.vendor,
      category: "product_spec",
      pageTitleOrFileName: input.fileName,
      text: chunk,
      linkedProductId,
      matchReason
    });
    cardCount += cards.cardCount;
  }

  const summaryAi = await runAiTask(
    "knowledge_summary",
    `Summarize this product brochure/spec document for sales use.\n\n${extracted.slice(0, 20000)}`,
    {
      source_feature: "pdf-spec-summary",
      upload_document_id: input.uploadedDocumentId,
      metadata: { file_name: input.fileName, vendor: input.vendor },
      fallbackText: "Summary unavailable. Please review extracted chunks manually."
    }
  );
  const { error: summaryError } = await supabaseAdminClient.from("knowledge_entries").insert({
    title: `${input.fileName} Summary [${input.uploadedDocumentId.slice(0, 8)}]`,
    body: summaryAi.text,
    category: "document_summary",
    source_type: "upload",
    approved_status: "pending",
    metadata_json: {
      uploaded_document_id: input.uploadedDocumentId,
      vendor: input.vendor,
      ai_task_type: summaryAi.task_type,
      ai_model: summaryAi.model
    }
  });
  if (summaryError) throw new Error(`Failed writing PDF summary knowledge: ${summaryError.message}`);

  return {
    chunkCount: chunks.length,
    summaryCreated: true,
    cardCount
  };
}

import { load } from "cheerio";
import { supabaseAdminClient } from "../../integrations/supabase/client.js";
import { runAiTask } from "../../ai/ai-client.js";
import { extractAndStoreKnowledgeCards } from "./knowledge-card-extraction-service.js";

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
  return chunks.filter(Boolean);
}

function extractSkuCandidates(text: string): string[] {
  return (text.match(/\b[A-Z]{2,5}[- ]?\d{2,6}\b/g) ?? []).map((m) => m.replace(/\s+/g, "").toUpperCase());
}

function scoreProductMatch(chunk: string, product: { sku: string; product_name: string; vendor: string; product_type: string }, skuCandidates: string[]) {
  const lower = chunk.toLowerCase();
  let score = 0;
  if (skuCandidates.includes(product.sku.toUpperCase())) score += 100;
  if (lower.includes(product.product_name.toLowerCase())) score += 40;
  if (lower.includes(product.vendor.toLowerCase())) score += 10;
  if (["scrubber", "autoscrubber", "floor scrubber", "walk-behind", "rider", "advance", "sc"].some((t) => lower.includes(t))) score += 8;
  if (product.product_type.toLowerCase().includes("autoscrubber")) score += 5;
  return score;
}

export async function ingestUrlToKnowledge(input: {
  uploadedDocumentId: string;
  url: string;
  vendor: string;
  category: string;
  notes?: string;
}) {
  if (!supabaseAdminClient) throw new Error("Supabase is required for URL ingestion.");

  if (!/^https?:\/\//i.test(input.url)) {
    throw new Error("Only http/https URLs are allowed.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(input.url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "JanveyOSBot/1.0 (+https://janveyos.local)"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Failed to fetch URL (${response.status}).`);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) throw new Error("URL is not an HTML page.");
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 4_000_000) throw new Error("Page too large to ingest.");

  const html = await response.text();
  if (html.length > 4_000_000) throw new Error("Page body too large to ingest.");

  const $ = load(html);
  $("script, style, nav, footer, header, noscript").remove();
  const pageTitle = $("title").first().text().trim() || new URL(input.url).hostname;
  const text = $("body").text().replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Could not extract readable text from page.");

  const chunks = chunkTextByWords(text, 700);
  const { data: products, error: productsError } = await supabaseAdminClient
    .from("products")
    .select("id,sku,product_name,vendor,product_type")
    .in("approved_status", ["approved", "pending"]);
  if (productsError) throw new Error(`Failed loading products for URL matching: ${productsError.message}`);
  const productRows = (products ?? []) as Array<{ id: string; sku: string; product_name: string; vendor: string; product_type: string }>;

  let chunkIndex = 0;
  let cardCount = 0;
  for (const chunk of chunks) {
    chunkIndex += 1;
    const skuCandidates = extractSkuCandidates(chunk);
    const scored = productRows
      .map((p) => ({ product: p, score: scoreProductMatch(chunk, p, skuCandidates) }))
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
      title: `${pageTitle} Chunk ${chunkIndex} [${input.uploadedDocumentId.slice(0, 8)}]`,
      body: chunk,
      category: "product_spec",
      source_type: "url",
      source_ref_id: linkedProductId,
      approved_status: "pending",
      metadata_json: {
        uploaded_document_id: input.uploadedDocumentId,
        source_url: input.url,
        vendor: input.vendor,
        category_hint: input.category,
        page_title: pageTitle,
        ingestion_date: new Date().toISOString(),
        chunk_index: chunkIndex,
        matched_product_name: linkedProductName,
        matched_product_sku: linkedProductSku,
        match_score: best?.score ?? 0,
        match_reason: matchReason
      }
    });
    if (error) throw new Error(`Failed creating URL chunk knowledge entry: ${error.message}`);

    const cards = await extractAndStoreKnowledgeCards({
      uploadedDocumentId: input.uploadedDocumentId,
      sourceType: "url",
      sourceUrl: input.url,
      vendor: input.vendor,
      category: input.category,
      pageTitleOrFileName: pageTitle,
      text: chunk,
      linkedProductId,
      matchReason
    });
    cardCount += cards.cardCount;
  }

  const summary = await runAiTask(
    "knowledge_summary",
    `Summarize this product page for sales use.\nURL: ${input.url}\nNotes: ${input.notes ?? ""}\n\n${text.slice(0, 20000)}`,
    {
      source_feature: "url-ingestion-summary",
      upload_document_id: input.uploadedDocumentId,
      metadata: { url: input.url, vendor: input.vendor, category: input.category },
      fallbackText: "Summary unavailable. Please review extracted URL chunks manually."
    }
  );

  const { error: summaryError } = await supabaseAdminClient.from("knowledge_entries").insert({
    title: `${pageTitle} Summary [${input.uploadedDocumentId.slice(0, 8)}]`,
    body: summary.text,
    category: "document_summary",
    source_type: "url",
    approved_status: "pending",
    metadata_json: {
      uploaded_document_id: input.uploadedDocumentId,
      source_url: input.url,
      vendor: input.vendor,
      category_hint: input.category,
      page_title: pageTitle,
      ingestion_date: new Date().toISOString(),
      ai_task_type: summary.task_type,
      ai_model: summary.model
    }
  });
  if (summaryError) throw new Error(`Failed creating URL summary knowledge entry: ${summaryError.message}`);

  return { pageTitle, chunkCount: chunks.length, cardCount, summaryCreated: true };
}

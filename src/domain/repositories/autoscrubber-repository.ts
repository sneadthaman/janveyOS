import { supabaseAdminClient } from "../../integrations/supabase/client.js";

export interface ApprovedAutoscrubberCandidate {
  sku: string;
  vendor: string;
  product_name: string;
  product_description: string | null;
  list_price: number;
  true_cost: number;
  margin_percent: number;
  knowledge: string[];
}

export async function fetchApprovedAutoscrubberCandidates(): Promise<ApprovedAutoscrubberCandidate[]> {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");

  const { data: products, error: productsError } = await supabaseAdminClient
    .from("products")
    .select("sku,vendor,product_name,product_description,product_type,approved_status")
    .eq("approved_status", "approved");
  if (productsError) throw new Error(`Failed fetching products: ${productsError.message}`);

  const productRows = (products ?? []).filter((p) => {
    const type = String(p.product_type ?? "").toLowerCase();
    const name = String(p.product_name ?? "").toLowerCase();
    const desc = String(p.product_description ?? "").toLowerCase();
    return (
      type.includes("autoscrubber") ||
      type.includes("floor scrubber") ||
      name.includes("autoscrubber") ||
      name.includes("scrubber") ||
      desc.includes("autoscrubber") ||
      desc.includes("floor scrubber")
    );
  });

  const skus = productRows.map((p) => p.sku as string);
  if (skus.length === 0) return [];

  const { data: pricingRows, error: pricingError } = await supabaseAdminClient
    .from("product_pricing")
    .select("sku,vendor,ed_data_sell_price,true_cost,margin_percent,approved_status,created_at")
    .in("sku", skus)
    .eq("approved_status", "approved")
    .order("created_at", { ascending: false });
  if (pricingError) throw new Error(`Failed fetching pricing: ${pricingError.message}`);

  const latestPricing = new Map<string, (typeof pricingRows)[number]>();
  for (const p of pricingRows ?? []) {
    const sku = p.sku as string;
    if (!latestPricing.has(sku)) latestPricing.set(sku, p);
  }

  const { data: knowledgeRows, error: knowledgeError } = await supabaseAdminClient
    .from("knowledge_entries")
    .select("title,body,approved_status,metadata_json")
    .eq("approved_status", "approved")
    .eq("category", "product")
    .eq("source_type", "upload");
  if (knowledgeError) throw new Error(`Failed fetching knowledge: ${knowledgeError.message}`);

  const knowledgeBySku = new Map<string, string[]>();
  for (const k of knowledgeRows ?? []) {
    const metadata = (k.metadata_json ?? {}) as Record<string, unknown>;
    const sku = String(metadata.sku ?? "");
    if (!sku) continue;
    const existing = knowledgeBySku.get(sku) ?? [];
    existing.push(String(k.body ?? ""));
    knowledgeBySku.set(sku, existing);
  }

  const results: ApprovedAutoscrubberCandidate[] = [];
  for (const p of productRows) {
    const sku = p.sku as string;
    const pricing = latestPricing.get(sku);
    if (!pricing) continue;
    results.push({
      sku,
      vendor: p.vendor as string,
      product_name: p.product_name as string,
      product_description: (p.product_description as string | null) ?? null,
      list_price: Number(pricing.ed_data_sell_price),
      true_cost: Number(pricing.true_cost),
      margin_percent: Number(pricing.margin_percent),
      knowledge: knowledgeBySku.get(sku) ?? []
    });
  }
  return results;
}

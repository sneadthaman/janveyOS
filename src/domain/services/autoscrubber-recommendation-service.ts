import { randomUUID } from "node:crypto";
import { fetchVendorPriority } from "../repositories/knowledge-repository.js";
import { fetchApprovedAutoscrubberCandidates } from "../repositories/autoscrubber-repository.js";
import {
  fetchApprovedManagerFeedback,
  logAutoscrubberRecommendation
} from "../repositories/autoscrubber-recommendation-repository.js";
import type { AutoscrubberDiscoveryInput, AutoscrubberRecommendationResponse } from "../types/autoscrubber.js";
import { runAiTask } from "../../ai/ai-client.js";
import { findRelevantPlaybook } from "../repositories/playbook-repository.js";

export function parseAutoscrubberOneMessage(message: string): AutoscrubberDiscoveryInput {
  const lower = message.toLowerCase();
  const sqFtMatch = lower.match(/(\d{3,7})\s*(sqft|sq ft|square feet)/);
  const budgetMatch = lower.match(/budget\s*(\$?\s*\d+[kK]?)/);
  const kBudget = budgetMatch?.[1]?.toLowerCase().includes("k");
  const budgetNumber = budgetMatch?.[1]
    ? Number(budgetMatch[1].replace(/[^0-9]/g, "")) * (kBudget ? 1000 : 1)
    : undefined;

  return {
    customer_segment: lower.includes("school")
      ? "school"
      : lower.includes("healthcare")
        ? "healthcare"
        : lower.includes("warehouse")
          ? "warehouse"
          : undefined,
    floor_type: lower.includes("vct")
      ? "VCT"
      : lower.includes("concrete")
        ? "concrete"
        : lower.includes("tile")
          ? "tile"
          : undefined,
    square_footage: sqFtMatch ? Number(sqFtMatch[1]) : undefined,
    cleaning_frequency: lower.includes("daily")
      ? "daily"
      : lower.includes("weekly")
        ? "weekly"
        : lower.includes("twice")
          ? "multiple_times_weekly"
          : undefined,
    walk_behind_or_ride_on: lower.includes("ride")
      ? "ride_on"
      : lower.includes("walk")
        ? "walk_behind"
        : undefined,
    battery_preference: lower.includes("battery")
      ? "battery"
      : lower.includes("propane")
        ? "propane"
        : undefined,
    budget: budgetNumber,
    existing_machine: undefined,
    notes: message
  };
}

function deterministicScore(input: AutoscrubberDiscoveryInput, candidate: Awaited<ReturnType<typeof fetchApprovedAutoscrubberCandidates>>[number], vendorRank: number) {
  const breakdown: Record<string, number> = {
    application_fit: 50,
    margin: 0,
    vendor_priority: 0,
    pricing_availability: 10,
    knowledge_relevance: 0
  };

  if (input.square_footage !== undefined) {
    if (input.square_footage >= 30000 && candidate.product_name.toLowerCase().includes("ride")) breakdown.application_fit += 20;
    if (input.square_footage < 30000 && candidate.product_name.toLowerCase().includes("walk")) breakdown.application_fit += 20;
  }
  if (input.battery_preference && candidate.product_name.toLowerCase().includes(input.battery_preference.toLowerCase())) {
    breakdown.application_fit += 10;
  }
  if (input.customer_segment === "school" || input.customer_segment === "healthcare") {
    breakdown.application_fit += 5;
  }
  if (input.budget !== undefined) {
    const budgetDelta = input.budget - candidate.list_price;
    if (budgetDelta >= 0) breakdown.application_fit += 10;
    else breakdown.application_fit -= 10;
  }

  breakdown.margin = Math.max(0, Math.min(20, candidate.margin_percent * 40));
  breakdown.vendor_priority = Math.max(0, 15 - vendorRank * 3);
  breakdown.knowledge_relevance = candidate.knowledge.length > 0 ? 10 : 0;

  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return { total, breakdown };
}

async function buildAiExplanation(input: AutoscrubberDiscoveryInput, result: AutoscrubberRecommendationResponse) {
  const managerFeedback = await fetchApprovedManagerFeedback({
    customerSegment: input.customer_segment,
    floorType: input.floor_type
  });
  const deterministicFallback = {
    why: [
      "Selected from approved autoscrubber products with available pricing and margin data.",
      "Ranking prioritized fit to discovery details and healthy margin."
    ],
    sell: [
      "Anchor the conversation on cleaning consistency and labor reduction.",
      "Present margin-safe pricing with clear total-value framing."
    ],
    objections: ["If budget is tight, lead with value alternative and phased rollout."],
    next: [
      "Confirm floor type and finish.",
      "Confirm operator preference and runtime expectations.",
      "Confirm service and maintenance expectations."
    ]
  };
  try {
    const ai = await runAiTask(
      "sales_recommendation",
      `Given this autoscrubber recommendation output, provide concise sales coaching JSON only.
Approved manager feedback guidance (highest priority): ${JSON.stringify(managerFeedback.map((f) => f.body))}
Input: ${JSON.stringify(input)}
Recommendation: ${JSON.stringify(result)}
Return JSON object with keys why,sell,objections,next as string arrays.`
      ,
      {
        source_feature: "autoscrubber-explanation",
        slack_user_id: input.slack_user_id,
        metadata: { customer_segment: input.customer_segment ?? null, floor_type: input.floor_type ?? null },
        fallbackText: JSON.stringify(deterministicFallback)
      }
    );
    const raw = ai.text.trim();
    const normalized = raw.startsWith("```") ? raw.replace(/```json|```/gi, "").trim() : raw;
    const parsed = JSON.parse(normalized);
    return {
      why: parsed.why ?? [],
      sell: parsed.sell ?? [],
      objections: parsed.objections ?? [],
      next: parsed.next ?? []
    };
  } catch {
    return deterministicFallback;
  }
}

export async function generateAutoscrubberRecommendation(input: {
  discovery: AutoscrubberDiscoveryInput;
  source: "api" | "slack" | "web";
  rawText?: string;
}): Promise<AutoscrubberRecommendationResponse> {
  const candidates = await fetchApprovedAutoscrubberCandidates();
  const vendorPriority = await fetchVendorPriority();
  const playbook = await findRelevantPlaybook("autoscrubber", input.discovery.customer_segment);
  const vendorRankMap = new Map<string, number>();
  for (const vp of vendorPriority) vendorRankMap.set(vp.vendor, vp.priorityRank);

  const scored = candidates.map((candidate) => {
    const vendorRank = vendorRankMap.get(candidate.vendor) ?? 10;
    const score = deterministicScore(input.discovery, candidate, vendorRank);
    const prioritize = (playbook?.products_to_prioritize as string[] | undefined) ?? [];
    const avoid = (playbook?.products_to_avoid as string[] | undefined) ?? [];
    const label = `${candidate.product_name} ${candidate.sku}`.toLowerCase();
    if (prioritize.some((p) => label.includes(p.toLowerCase()))) {
      score.breakdown.application_fit += 8;
      score.total += 8;
    }
    if (avoid.some((a) => label.includes(a.toLowerCase()))) {
      score.breakdown.application_fit -= 12;
      score.total -= 12;
    }
    return { candidate, score };
  });
  scored.sort((a, b) => b.score.total - a.score.total);

  const best = scored[0];
  const alternative = scored[1] ?? null;
  const confidence = best ? Math.max(0.2, Math.min(0.99, best.score.total / 120)) : 0.2;

  const response: AutoscrubberRecommendationResponse = {
    recommendation_id: randomUUID(),
    best_fit_product: best
      ? {
          sku: best.candidate.sku,
          product_name: best.candidate.product_name,
          vendor: best.candidate.vendor,
          price: best.candidate.list_price,
          true_cost: best.candidate.true_cost,
          margin_percent: best.candidate.margin_percent
        }
      : null,
    value_alternative: alternative
      ? {
          sku: alternative.candidate.sku,
          product_name: alternative.candidate.product_name,
          vendor: alternative.candidate.vendor,
          price: alternative.candidate.list_price,
          true_cost: alternative.candidate.true_cost,
          margin_percent: alternative.candidate.margin_percent
        }
      : null,
    why_it_fits: [],
    how_to_sell: [],
    objections: [],
    questions_to_ask_next: [],
    confidence_score: Number(confidence.toFixed(2)),
    score_details: scored.slice(0, 5).map((s) => ({
      sku: s.candidate.sku,
      total_score: Number(s.score.total.toFixed(2)),
      breakdown: s.score.breakdown
    })),
    ai_explanation: ""
  };

  const explanation = await buildAiExplanation(
    { ...input.discovery, notes: `${input.discovery.notes ?? ""}\nPlaybook:${JSON.stringify(playbook ?? {})}` },
    response
  );
  response.why_it_fits = explanation.why;
  response.how_to_sell = explanation.sell;
  response.objections = explanation.objections;
  response.questions_to_ask_next = explanation.next;
  response.ai_explanation = JSON.stringify(explanation);

  await logAutoscrubberRecommendation({
    discovery: input.discovery,
    source: input.source,
    rawText: input.rawText,
    response
  });

  return response;
}

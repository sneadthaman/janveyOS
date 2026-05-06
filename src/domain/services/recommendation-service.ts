import { randomUUID } from "node:crypto";
import { logger } from "../../shared/logger.js";
import type { RecommendationResult, RepRequestInput } from "../types.js";
import { fetchStrategyRules, fetchVendorPriority } from "../repositories/knowledge-repository.js";
import { logRecommendation } from "../repositories/recommendation-repository.js";
import { runAiTask } from "../../ai/ai-client.js";

function fallbackRecommendation(input: RepRequestInput): RecommendationResult {
  return {
    id: randomUUID(),
    summary: `Initial recommendation generated for: "${input.text}"`,
    productRecommendations: [],
    discoveryQuestions: [
      "What is the square footage and cleaning frequency?",
      "What floor types and soil conditions are most common?",
      "What run-time and charging constraints exist?"
    ],
    positioningTalkTrack: [
      "Lead with labor savings and consistency of clean.",
      "Tie machine size and battery type to daily route reality.",
      "Anchor value around uptime, serviceability, and consumable cost."
    ],
    pricingGuidance: {
      notes: ["Configure pricing matrix and contract terms in Supabase to enable margin-aware recommendations."]
    }
  };
}

export async function generateRecommendation(input: RepRequestInput): Promise<RecommendationResult> {
  const rules = await fetchStrategyRules();
  const vendorPriority = await fetchVendorPriority();

  const prompt = `
You are Janvey OS, a sales coach for autoscrubbers.
Rep request: ${input.text}
Account: ${input.accountName ?? "Unknown"}
Strategy rules: ${JSON.stringify(rules)}
Vendor priority: ${JSON.stringify(vendorPriority)}

Return strict JSON:
{
  "summary": "string",
  "productRecommendations": [{"sku":"string","productName":"string","vendor":"Nilfisk|Taski|Triple-S","confidence":0.0,"reason":"string"}],
  "discoveryQuestions": ["string"],
  "positioningTalkTrack": ["string"],
  "pricingGuidance": {"floorPrice": number|null, "targetPrice": number|null, "expectedMarginPct": number|null, "notes": ["string"]}
}
`;

  try {
    const ai = await runAiTask("sales_recommendation", prompt, {
      source_feature: "recommendation-service",
      slack_user_id: input.source === "slack" ? input.userId : undefined,
      metadata: { source: input.source, account_name: input.accountName ?? null },
      fallbackText: JSON.stringify({
        summary: `Initial recommendation generated for: "${input.text}"`,
        productRecommendations: [],
        discoveryQuestions: [
          "What is the square footage and cleaning frequency?",
          "What floor types and soil conditions are most common?",
          "What run-time and charging constraints exist?"
        ],
        positioningTalkTrack: [
          "Lead with labor savings and consistency of clean.",
          "Tie machine size and battery type to daily route reality.",
          "Anchor value around uptime, serviceability, and consumable cost."
        ],
        pricingGuidance: {
          floorPrice: null,
          targetPrice: null,
          expectedMarginPct: null,
          notes: ["AI fallback response used."]
        }
      })
    });
    const text = ai.text;
    const parsed = JSON.parse(text);
    const result: RecommendationResult = {
      id: randomUUID(),
      summary: parsed.summary,
      productRecommendations: parsed.productRecommendations ?? [],
      discoveryQuestions: parsed.discoveryQuestions ?? [],
      positioningTalkTrack: parsed.positioningTalkTrack ?? [],
      pricingGuidance: {
        floorPrice: parsed.pricingGuidance?.floorPrice ?? undefined,
        targetPrice: parsed.pricingGuidance?.targetPrice ?? undefined,
        expectedMarginPct: parsed.pricingGuidance?.expectedMarginPct ?? undefined,
        notes: parsed.pricingGuidance?.notes ?? []
      }
    };
    await logRecommendation({ request: input, recommendation: result });
    return result;
  } catch (error) {
    logger.warn("OpenAI recommendation failed, using fallback", error);
    const fallback = fallbackRecommendation(input);
    await logRecommendation({ request: input, recommendation: fallback });
    return fallback;
  }
}

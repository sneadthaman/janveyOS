import { runAiTask } from "../../ai/ai-client.js";
import { insertKnowledgeCards } from "../repositories/knowledge-card-repository.js";
import type { KnowledgeCardType } from "../types/knowledge-card.js";

const allowedCardTypes: KnowledgeCardType[] = [
  "product_insight",
  "application_fit",
  "selling_point",
  "objection",
  "competitive_note",
  "maintenance_service_note",
  "spec_fact",
  "discovery_question"
];

function parseJsonArray(text: string): Array<Record<string, unknown>> {
  const normalized = text.trim().replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(normalized);
  return Array.isArray(parsed) ? parsed : [];
}

export async function extractAndStoreKnowledgeCards(input: {
  uploadedDocumentId: string;
  sourceType: "upload" | "url";
  sourceUrl?: string;
  vendor: string;
  category: string;
  segment?: string;
  pageTitleOrFileName: string;
  text: string;
  linkedProductId?: string | null;
  matchReason?: string | null;
}) {
  const fallbackCards = [
    {
      card_type: "product_insight" as const,
      title: `${input.pageTitleOrFileName} Key Insight`,
      body: input.text.slice(0, 500),
      confidence_score: 0.55
    },
    {
      card_type: "spec_fact" as const,
      title: `${input.pageTitleOrFileName} Spec Fact`,
      body: input.text.slice(500, 1000) || input.text.slice(0, 500),
      confidence_score: 0.45
    }
  ];

  const ai = await runAiTask(
    "structured_knowledge_extraction",
    [
      "Extract concise sales knowledge cards from this source.",
      "Return JSON array only.",
      "Each item: {card_type,title,body,confidence_score,source_excerpt}",
      `Allowed card_type: ${allowedCardTypes.join(",")}`,
      "Max 15 cards. Keep each body <= 350 chars.",
      `Vendor: ${input.vendor}`,
      `Category: ${input.category}`,
      `Segment: ${input.segment ?? ""}`,
      `Source: ${input.pageTitleOrFileName}`,
      "Text:",
      input.text.slice(0, 30000)
    ].join("\n"),
    {
      source_feature: "structured-knowledge-extraction",
      upload_document_id: input.uploadedDocumentId,
      metadata: {
        source_type: input.sourceType,
        source_url: input.sourceUrl ?? null,
        vendor: input.vendor,
        category: input.category
      },
      fallbackText: JSON.stringify(fallbackCards)
    }
  );

  let cards: Array<Record<string, unknown>> = [];
  try {
    cards = parseJsonArray(ai.text);
  } catch {
    cards = fallbackCards as unknown as Array<Record<string, unknown>>;
  }

  const normalized = cards
    .map((c) => {
      const cardType = String(c.card_type ?? "").trim() as KnowledgeCardType;
      if (!allowedCardTypes.includes(cardType)) return null;
      const title = String(c.title ?? "").trim();
      const body = String(c.body ?? "").trim();
      if (!title || !body) return null;
      const confidence = Number(c.confidence_score ?? 0.5);
      return {
        uploaded_document_id: input.uploadedDocumentId,
        linked_product_id: input.linkedProductId ?? null,
        card_type: cardType,
        title: title.slice(0, 180),
        body: body.slice(0, 600),
        vendor: input.vendor,
        category: input.category,
        segment: input.segment ?? null,
        confidence_score: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
        source_type: input.sourceType,
        source_url: input.sourceUrl ?? null,
        source_excerpt: String(c.source_excerpt ?? body.slice(0, 220)).slice(0, 450),
        match_reason: input.matchReason ?? null
      };
    })
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .slice(0, 20);

  if (normalized.length === 0) {
    await insertKnowledgeCards(
      fallbackCards.map((c) => ({
        uploaded_document_id: input.uploadedDocumentId,
        linked_product_id: input.linkedProductId ?? null,
        card_type: c.card_type,
        title: c.title,
        body: c.body,
        vendor: input.vendor,
        category: input.category,
        segment: input.segment ?? null,
        confidence_score: c.confidence_score,
        source_type: input.sourceType,
        source_url: input.sourceUrl ?? null,
        source_excerpt: c.body.slice(0, 220),
        match_reason: input.matchReason ?? null
      }))
    );
    return { cardCount: fallbackCards.length };
  }

  await insertKnowledgeCards(normalized);
  return { cardCount: normalized.length };
}

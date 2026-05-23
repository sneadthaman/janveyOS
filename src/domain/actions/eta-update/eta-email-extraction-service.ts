import { runAiTask } from "../../../ai/ai-client.js";

export type EtaExtractionConfidence = "LOW" | "MED" | "HIGH";

export interface EtaEmailExtractedItem {
  item: string | null;
  itemInternalId: string | null;
  etaDate: string | null;
  trackingNumber: string | null;
  confidence: EtaExtractionConfidence;
  notes: string | null;
}

export interface EtaEmailExtractedPayload {
  poNumber: string | null;
  etaDate: string | null;
  trackingNumber: string | null;
  vendorName: string | null;
  items: EtaEmailExtractedItem[];
  confidence: EtaExtractionConfidence;
  etaSource: string;
  etaNotes: string;
}

export function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const direct = trimmed.match(/^\s*\{[\s\S]*\}\s*$/);
  if (direct) return JSON.parse(trimmed) as Record<string, unknown>;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return JSON.parse(fenced[1]) as Record<string, unknown>;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  }
  throw new Error("No JSON object in AI response");
}

function asConfidence(value: unknown): EtaExtractionConfidence {
  const upper = String(value ?? "").trim().toUpperCase();
  if (upper === "HIGH" || upper === "MED" || upper === "LOW") return upper;
  return "LOW";
}

function asNullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function normalizeEtaEmailExtractedPayload(raw: Record<string, unknown>): EtaEmailExtractedPayload {
  const items = Array.isArray(raw.items) ? raw.items : [];
  return {
    poNumber: asNullableString(raw.poNumber),
    etaDate: asNullableString(raw.etaDate),
    trackingNumber: asNullableString(raw.trackingNumber),
    vendorName: asNullableString(raw.vendorName),
    items: items
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      .map((item) => ({
        item: asNullableString(item.item),
        itemInternalId: asNullableString(item.itemInternalId),
        etaDate: asNullableString(item.etaDate),
        trackingNumber: asNullableString(item.trackingNumber),
        confidence: asConfidence(item.confidence),
        notes: asNullableString(item.notes)
      })),
    confidence: asConfidence(raw.confidence),
    etaSource: asNullableString(raw.etaSource) ?? "email",
    etaNotes: asNullableString(raw.etaNotes) ?? ""
  };
}

export function hasEnoughEtaInfo(payload: EtaEmailExtractedPayload) {
  const hasPo = Boolean(payload.poNumber);
  const hasTopEta = Boolean(payload.etaDate || payload.trackingNumber);
  const hasItemEta = payload.items.some((item) => Boolean(item.etaDate || item.trackingNumber));
  return hasPo && (hasTopEta || hasItemEta);
}

export async function extractEtaPayloadFromEmail(input: {
  subject: string;
  sender: string;
  bodyText: string;
}): Promise<EtaEmailExtractedPayload> {
  const prompt = [
    "Extract structured ETA update information from this vendor email.",
    "Return STRICT JSON only with this schema:",
    JSON.stringify(
      {
        poNumber: "string | null",
        etaDate: "string | null",
        trackingNumber: "string | null",
        vendorName: "string | null",
        items: [
          {
            item: "string | null",
            itemInternalId: "string | null",
            etaDate: "string | null",
            trackingNumber: "string | null",
            confidence: "LOW | MED | HIGH",
            notes: "string | null"
          }
        ],
        confidence: "LOW | MED | HIGH",
        etaSource: "string",
        etaNotes: "string"
      },
      null,
      2
    ),
    "Confidence rules:",
    "- HIGH if exact PO and explicit ETA date found.",
    "- HIGH for PO-wide update if clearly applies to full PO.",
    "- MED if PO exists but item matching is fuzzy.",
    "- LOW if inferred/incomplete.",
    `Sender: ${input.sender}`,
    `Subject: ${input.subject}`,
    "Body:",
    input.bodyText
  ].join("\n\n");

  const ai = await runAiTask("structured_knowledge_extraction", prompt, {
    source_feature: "eta-email-extraction",
    metadata: {
      source: "outlook",
      subject: input.subject.slice(0, 200)
    },
    fallbackText: JSON.stringify({
      poNumber: null,
      etaDate: null,
      trackingNumber: null,
      vendorName: null,
      items: [],
      confidence: "LOW",
      etaSource: "email",
      etaNotes: "Extraction fallback"
    })
  });

  const parsed = extractJsonObject(ai.text);
  return normalizeEtaEmailExtractedPayload(parsed);
}

interface EtaReviewCardInput {
  reviewId: string;
  reviewStatus?: string;
  poNumber?: string | null;
  etaDate?: string | null;
  etaDateIsEstimated?: boolean;
  etaDateSource?: string | null;
  baseDate?: string | null;
  baseDateSource?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  itemNumber?: string | null;
  appliesToEntirePo?: boolean;
  confidence?: number | string | null;
  extractionMethod?: string | null;
  ocrUsed?: boolean;
  sourceFile?: string | null;
  classification?: string | null;
  rawContext?: string | null;
  actionRequestId?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewerNotes?: string | null;
}

export function formatEtaConfidence(input: {
  confidence?: number | string | null;
  etaDateSource?: string | null;
  extractionMethod?: string | null;
  ocrUsed?: boolean;
}): "HIGH" | "MED" | "LOW" {
  const etaDateSource = String(input.etaDateSource ?? "").trim().toLowerCase();
  if (etaDateSource === "ship_date") return "HIGH";
  if (etaDateSource.includes("carrier_confirmed") || etaDateSource.includes("api_confirmed")) return "HIGH";
  if (etaDateSource.includes("plus_4_days")) return "LOW";
  if (input.ocrUsed && etaDateSource === "ship_date") return "HIGH";

  const numeric = typeof input.confidence === "number" ? input.confidence : Number(input.confidence);
  if (Number.isFinite(numeric)) {
    if (numeric >= 0.85) return "HIGH";
    if (numeric >= 0.65) return "MED";
  }
  return "LOW";
}

export function formatEtaScope(input: { appliesToEntirePo?: boolean; itemNumber?: string | null; rawContext?: string | null }): string {
  if (input.itemNumber) return "Matching item line";
  const context = String(input.rawContext ?? "").toLowerCase();
  if (context.includes("rj schinner") && !input.appliesToEntirePo) return "Listed RJ Schinner lines";
  if (input.appliesToEntirePo) return "Entire PO requested";
  return "Unknown / review carefully";
}

function truncateRawContext(value: string | null | undefined, max = 500): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function statusTitle(input: EtaReviewCardInput): string {
  if (input.reviewStatus === "approved") return "✅ ETA update review approved";
  if (input.reviewStatus === "rejected") return "🚫 ETA update review rejected";
  return "🧾 ETA update review needed";
}

function statusDetails(input: EtaReviewCardInput): string {
  if (input.reviewStatus === "approved") {
    return `• Action request ID: ${input.actionRequestId || "-"}\n• Reviewed by: ${input.reviewedBy || "-"}\n• Reviewed at: ${input.reviewedAt || "-"}\n• Notes: ${input.reviewerNotes || "-"}`;
  }
  if (input.reviewStatus === "rejected") {
    return `• Reviewed by: ${input.reviewedBy || "-"}\n• Reviewed at: ${input.reviewedAt || "-"}\n• Notes: ${input.reviewerNotes || "-"}`;
  }
  return "";
}

export function buildDocumentReviewFallbackText(input: EtaReviewCardInput): string {
  return `Document review ${input.reviewId}: PO ${input.poNumber || "-"}, ETA ${input.etaDate || "-"}`;
}

export function buildEtaCandidateReviewBlocks(input: EtaReviewCardInput): Array<Record<string, unknown>> {
  const excerpt = truncateRawContext(input.rawContext, 500);
  const body =
    `*${statusTitle(input)}*\n` +
    `• Review: ${input.reviewId}\n` +
    `• PO number: ${input.poNumber || "-"}\n` +
    `• ETA date: ${input.etaDate || "-"}\n` +
    `• ETA date source: ${input.etaDateSource || "-"}\n` +
    `• Base date: ${input.baseDate || "-"}\n` +
    `• Base date source: ${input.baseDateSource || "-"}\n` +
    `• Carrier: ${input.carrier || "-"}\n` +
    `• Tracking number: ${input.trackingNumber || "-"}\n` +
    `• Item number: ${input.itemNumber || "-"}\n` +
    `• Scope: ${formatEtaScope({ appliesToEntirePo: input.appliesToEntirePo, itemNumber: input.itemNumber, rawContext: input.rawContext })}\n` +
    `• Confidence: ${formatEtaConfidence({
      confidence: input.confidence,
      etaDateSource: input.etaDateSource,
      extractionMethod: input.extractionMethod,
      ocrUsed: input.ocrUsed
    })}\n` +
    `• Source file: ${input.sourceFile || "-"}\n` +
    `• Classification: ${input.classification || "-"}`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: body
      }
    }
  ];

  if (input.reviewStatus === "approved" || input.reviewStatus === "rejected") {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: statusDetails(input)
        }
      ]
    });
    return blocks;
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Raw context: ${excerpt}`
      }
    ]
  });

  blocks.push({
    type: "actions",
    block_id: "document_review_eta_decision",
    elements: [
      {
        type: "button",
        action_id: "document_review_eta_approve",
        text: { type: "plain_text", text: "Approve ETA" },
        style: "primary",
        value: JSON.stringify({ reviewId: input.reviewId })
      },
      {
        type: "button",
        action_id: "document_review_eta_reject",
        text: { type: "plain_text", text: "Reject" },
        style: "danger",
        value: JSON.stringify({ reviewId: input.reviewId })
      },
      {
        type: "button",
        action_id: "document_review_eta_ignore",
        text: { type: "plain_text", text: "Maybe Later" },
        value: JSON.stringify({ reviewId: input.reviewId })
      }
    ]
  });

  return blocks;
}

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
  sourceFile?: string | null;
  classification?: string | null;
  rawContext?: string | null;
  actionRequestId?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewerNotes?: string | null;
}

function formatConfidence(value: number | string | null | undefined): string {
  if (typeof value === "number") return value.toFixed(2);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "-";
}

function truncateRawContext(value: string | null | undefined, max = 500): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function statusTitle(input: EtaReviewCardInput): string {
  if (input.reviewStatus === "approved") return "✅ ETA Candidate Review Approved";
  if (input.reviewStatus === "rejected") return "🚫 ETA Candidate Review Rejected";
  return "🧾 ETA Candidate Review";
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
  return `Document review ${input.reviewId}: PO ${input.poNumber || "-"}, ETA ${input.etaDate || "-"}, estimated ${input.etaDateIsEstimated ? "yes" : "no"}`;
}

export function buildEtaCandidateReviewBlocks(input: EtaReviewCardInput): Array<Record<string, unknown>> {
  const excerpt = truncateRawContext(input.rawContext, 500);
  const body =
    `${statusTitle(input)}\n` +
    `• Review ID: ${input.reviewId}\n` +
    `• PO number: ${input.poNumber || "-"}\n` +
    `• ETA date: ${input.etaDate || "-"}\n` +
    `• ETA estimated: ${input.etaDateIsEstimated ? "true" : "false"}\n` +
    `• ETA date source: ${input.etaDateSource || "-"}\n` +
    `• Base date: ${input.baseDate || "-"}\n` +
    `• Base date source: ${input.baseDateSource || "-"}\n` +
    `• Carrier: ${input.carrier || "-"}\n` +
    `• Tracking number: ${input.trackingNumber || "-"}\n` +
    `• Item number: ${input.itemNumber || "-"}\n` +
    `• Entire PO: ${input.appliesToEntirePo ? "true" : "false"}\n` +
    `• Confidence: ${formatConfidence(input.confidence)}\n` +
    `• Source file: ${input.sourceFile || "-"}\n` +
    `• Classification: ${input.classification || "-"}\n` +
    `• Raw context: ${excerpt}`;

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

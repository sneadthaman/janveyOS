import { approveEtaReviewById, rejectEtaReviewById } from "../../documents/eta-candidate-review-service.js";
import { loadReviewWithCandidate } from "../../documents/eta-candidate-review-repository.js";
import { buildDocumentReviewFallbackText, buildEtaCandidateReviewBlocks } from "./document-review-card.js";
import { updateSlackMessage } from "./quote-to-so-notifier.js";

export type DocumentReviewActionId = "document_review_eta_approve" | "document_review_eta_reject" | "document_review_eta_ignore";

interface ActionDeps {
  approveEtaReviewById: typeof approveEtaReviewById;
  rejectEtaReviewById: typeof rejectEtaReviewById;
  loadReviewWithCandidate: typeof loadReviewWithCandidate;
  updateSlackMessage: typeof updateSlackMessage;
}

const defaultDeps: ActionDeps = {
  approveEtaReviewById,
  rejectEtaReviewById,
  loadReviewWithCandidate,
  updateSlackMessage
};

function parseReviewId(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const reviewId = String(parsed.reviewId ?? "").trim();
    return reviewId || null;
  } catch {
    return null;
  }
}

function toCardInput(joined: NonNullable<Awaited<ReturnType<typeof loadReviewWithCandidate>>>) {
  const candidate = joined.candidate;
  return {
    reviewId: joined.review.id,
    reviewStatus: joined.review.reviewStatus,
    actionRequestId: joined.review.actionRequestId,
    reviewedBy: joined.review.reviewedBy,
    reviewedAt: joined.review.reviewedAt,
    reviewerNotes: joined.review.reviewerNotes,
    poNumber: candidate?.poNumber,
    etaDate: candidate?.etaDate,
    etaDateIsEstimated: candidate?.etaDateIsEstimated,
    etaDateSource: candidate?.etaDateSource,
    baseDate: candidate?.baseDate,
    baseDateSource: candidate?.baseDateSource,
    carrier: candidate?.carrier,
    trackingNumber: candidate?.trackingNumber,
    itemNumber: candidate?.itemNumber,
    appliesToEntirePo: candidate?.appliesToEntirePo,
    confidence: candidate?.confidence,
    extractionMethod: joined.document?.extractionMethod ?? null,
    ocrUsed: joined.document?.ocrUsed ?? false,
    sourceFile: joined.document?.fileName,
    classification: joined.extraction?.classification,
    rawContext: candidate?.rawContext
  };
}

async function refreshCard(reviewId: string, deps: ActionDeps, slackChannelId?: string, slackMessageTs?: string) {
  if (!slackChannelId || !slackMessageTs) return;
  const joined = await deps.loadReviewWithCandidate(reviewId);
  if (!joined || !joined.candidate) return;
  const card = toCardInput(joined);
  await deps.updateSlackMessage({
    channel: slackChannelId,
    ts: slackMessageTs,
    text: buildDocumentReviewFallbackText(card),
    blocks: buildEtaCandidateReviewBlocks(card)
  });
}

export async function handleDocumentReviewActionWithDeps(
  input: {
    actionId: DocumentReviewActionId;
    value: string;
    actorSlackUserId: string;
    slackChannelId?: string;
    slackMessageTs?: string;
  },
  deps: ActionDeps
): Promise<{ kind: "ok"; message: string } | { kind: "error"; message: string }> {
  const reviewId = parseReviewId(input.value);
  if (!reviewId) return { kind: "error", message: "Invalid review action payload." };

  if (input.actionId === "document_review_eta_ignore") {
    return { kind: "ok", message: "No changes made." };
  }

  try {
    if (input.actionId === "document_review_eta_approve") {
      const result = await deps.approveEtaReviewById({
        reviewId,
        reviewedBy: input.actorSlackUserId,
        reviewerNotes: "Approved from Slack"
      });
      if (input.slackChannelId && input.slackMessageTs) {
        await deps.updateSlackMessage({
          channel: input.slackChannelId,
          ts: input.slackMessageTs,
          text: "Approved — queued for NetSuite ETA update",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `✅ *Approved — queued for NetSuite ETA update*\n• Action request ID: ${result.actionRequestId}`
              }
            }
          ]
        });
      }
      return { kind: "ok", message: `Approved. Action request: ${result.actionRequestId}` };
    }

    await deps.rejectEtaReviewById({
      reviewId,
      reviewedBy: input.actorSlackUserId,
      reviewerNotes: "Rejected from Slack"
    });
    await refreshCard(reviewId, deps, input.slackChannelId, input.slackMessageTs);
    return { kind: "ok", message: "Rejected." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document review action failed.";
    return { kind: "error", message };
  }
}

export async function handleDocumentReviewAction(input: {
  actionId: DocumentReviewActionId;
  value: string;
  actorSlackUserId: string;
  slackChannelId?: string;
  slackMessageTs?: string;
}) {
  return handleDocumentReviewActionWithDeps(input, defaultDeps);
}

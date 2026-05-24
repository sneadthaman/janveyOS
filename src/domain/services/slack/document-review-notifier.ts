import { config } from "../../../shared/config.js";
import { logger } from "../../../shared/logger.js";
import { findPendingReviews, loadReviewWithCandidate } from "../../documents/eta-candidate-review-repository.js";
import { buildDocumentReviewFallbackText, buildEtaCandidateReviewBlocks } from "./document-review-card.js";
import { postSlackMessage } from "./quote-to-so-notifier.js";

interface NotifierDeps {
  findPendingReviews: typeof findPendingReviews;
  loadReviewWithCandidate: typeof loadReviewWithCandidate;
  postSlackMessage: typeof postSlackMessage;
}

const defaultDeps: NotifierDeps = {
  findPendingReviews,
  loadReviewWithCandidate,
  postSlackMessage
};

const postedReviewIds = new Set<string>();

function requireChannelId() {
  const channelId = config.DOCUMENT_REVIEW_SLACK_CHANNEL_ID?.trim();
  if (!channelId) throw new Error("DOCUMENT_REVIEW_SLACK_CHANNEL_ID is required to post document reviews to Slack.");
  return channelId;
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
    sourceFile: joined.document?.fileName,
    classification: joined.extraction?.classification,
    rawContext: candidate?.rawContext
  };
}

export async function postPendingEtaReviewToSlackWithDeps(reviewId: string, deps: NotifierDeps): Promise<boolean> {
  const channel = requireChannelId();
  if (postedReviewIds.has(reviewId)) return false;

  const joined = await deps.loadReviewWithCandidate(reviewId);
  if (!joined || !joined.candidate) return false;
  if (joined.review.reviewStatus !== "pending") return false;

  const card = toCardInput(joined);
  await deps.postSlackMessage({
    channel,
    text: buildDocumentReviewFallbackText(card),
    blocks: buildEtaCandidateReviewBlocks(card)
  });

  postedReviewIds.add(reviewId);
  logger.info("document_review.slack.posted", {
    reviewId,
    candidateId: joined.candidate.id,
    classification: joined.extraction?.classification ?? null,
    channel
  });
  return true;
}

export async function postPendingEtaReviewToSlack(reviewId: string): Promise<boolean> {
  return postPendingEtaReviewToSlackWithDeps(reviewId, defaultDeps);
}

export async function postPendingEtaReviewsToSlackWithDeps(limit = 10, deps: NotifierDeps): Promise<string[]> {
  requireChannelId();
  const pending = await deps.findPendingReviews(limit);
  const unique = new Set<string>();
  const posted: string[] = [];

  for (const review of pending) {
    if (!review?.id || unique.has(review.id)) continue;
    unique.add(review.id);
    const ok = await postPendingEtaReviewToSlackWithDeps(review.id, deps);
    if (ok) posted.push(review.id);
  }

  return posted;
}

export async function postPendingEtaReviewsToSlack(limit = 10): Promise<string[]> {
  return postPendingEtaReviewsToSlackWithDeps(limit, defaultDeps);
}

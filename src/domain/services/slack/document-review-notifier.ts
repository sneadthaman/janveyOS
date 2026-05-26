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

export interface PostReviewSummary {
  reviewId: string;
  postedChannels: string[];
  failedChannels: Array<{ channel: string; error: string }>;
}

export function resolveDocumentReviewSlackChannelIds(): string[] {
  const raw = (config.DOCUMENT_REVIEW_SLACK_CHANNEL_IDS ?? config.DOCUMENT_REVIEW_SLACK_CHANNEL_ID ?? "").trim();
  if (!raw) return [];
  const ids = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}

function requireChannelIds() {
  const channelIds = resolveDocumentReviewSlackChannelIds();
  if (channelIds.length === 0) {
    throw new Error("DOCUMENT_REVIEW_SLACK_CHANNEL_IDS or DOCUMENT_REVIEW_SLACK_CHANNEL_ID is required to post document reviews to Slack.");
  }
  return channelIds;
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

export async function postPendingEtaReviewToSlackWithDeps(reviewId: string, deps: NotifierDeps): Promise<PostReviewSummary> {
  const channels = requireChannelIds();
  if (postedReviewIds.has(reviewId)) return { reviewId, postedChannels: [], failedChannels: [] };

  const joined = await deps.loadReviewWithCandidate(reviewId);
  if (!joined || !joined.candidate) return { reviewId, postedChannels: [], failedChannels: [] };
  if (joined.review.reviewStatus !== "pending") return { reviewId, postedChannels: [], failedChannels: [] };

  const card = toCardInput(joined);
  const postedChannels: string[] = [];
  const failedChannels: Array<{ channel: string; error: string }> = [];
  for (const channel of channels) {
    try {
      await deps.postSlackMessage({
        channel,
        text: buildDocumentReviewFallbackText(card),
        blocks: buildEtaCandidateReviewBlocks(card)
      });
      postedChannels.push(channel);
      logger.info("document_review.slack.posted", {
        reviewId,
        candidateId: joined.candidate.id,
        classification: joined.extraction?.classification ?? null,
        channel
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedChannels.push({ channel, error: message });
      logger.error("document_review.slack.post_failed", {
        reviewId,
        candidateId: joined.candidate.id,
        classification: joined.extraction?.classification ?? null,
        channel,
        reason: message
      });
    }
  }

  if (postedChannels.length === 0) {
    throw new Error(`Failed to post document review ${reviewId} to all configured channels.`);
  }

  postedReviewIds.add(reviewId);
  return { reviewId, postedChannels, failedChannels };
}

export async function postPendingEtaReviewToSlack(reviewId: string): Promise<PostReviewSummary> {
  return postPendingEtaReviewToSlackWithDeps(reviewId, defaultDeps);
}

export async function postPendingEtaReviewsToSlackWithDeps(limit = 10, deps: NotifierDeps): Promise<string[]> {
  requireChannelIds();
  const pending = await deps.findPendingReviews(limit);
  const unique = new Set<string>();
  const posted: string[] = [];

  for (const review of pending) {
    if (!review?.id || unique.has(review.id)) continue;
    unique.add(review.id);
    const summary = await postPendingEtaReviewToSlackWithDeps(review.id, deps);
    if (summary.postedChannels.length > 0) posted.push(review.id);
  }

  return posted;
}

export async function postPendingEtaReviewsToSlack(limit = 10): Promise<string[]> {
  return postPendingEtaReviewsToSlackWithDeps(limit, defaultDeps);
}

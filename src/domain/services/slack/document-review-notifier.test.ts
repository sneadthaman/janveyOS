import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../../shared/config.js";
import { postPendingEtaReviewsToSlackWithDeps } from "./document-review-notifier.js";

function makePending(id: string) {
  return {
    id,
    etaUpdateCandidateId: `cand-${id}`,
    reviewStatus: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reviewerNotes: null,
    actionRequestId: null,
    createdAt: "2026-05-24T00:00:00Z",
    updatedAt: "2026-05-24T00:00:00Z"
  };
}

test("notifier loads pending reviews and posts blocks", async () => {
  const prev = config.DOCUMENT_REVIEW_SLACK_CHANNEL_ID;
  config.DOCUMENT_REVIEW_SLACK_CHANNEL_ID = "C-REV";
  let postCalls = 0;

  try {
    const posted = await postPendingEtaReviewsToSlackWithDeps(10, {
      findPendingReviews: async () => [makePending("review-1")] as any,
      loadReviewWithCandidate: async () =>
        ({
          review: makePending("review-1"),
          candidate: {
            id: "cand-1",
            documentExtractionId: "ex-1",
            poNumber: "PO289731",
            etaDate: "2026-05-29",
            etaDateSource: "estimated_from_invoice_date_plus_4_days",
            etaDateIsEstimated: true,
            baseDate: "2026-05-25",
            baseDateSource: "invoice_date",
            trackingNumber: "1Z",
            carrier: "UPS",
            itemNumber: null,
            appliesToEntirePo: true,
            confidence: 0.6,
            rawContext: "ctx",
            createdAt: "2026-05-24T00:00:00Z"
          },
          extraction: { id: "ex-1", documentId: "doc-1", classification: "invoice_with_shipping_signal" },
          document: { id: "doc-1", fileName: "sample.pdf" }
        }) as any,
      postSlackMessage: async (payload: { channel: string; blocks?: Array<Record<string, unknown>> }) => {
        postCalls += 1;
        assert.equal(payload.channel, "C-REV");
        assert.ok(Array.isArray(payload.blocks));
      }
    } as any);

    assert.deepEqual(posted, ["review-1"]);
    assert.equal(postCalls, 1);
  } finally {
    config.DOCUMENT_REVIEW_SLACK_CHANNEL_ID = prev;
  }
});

test("missing Slack channel config fails clearly", async () => {
  const prev = config.DOCUMENT_REVIEW_SLACK_CHANNEL_ID;
  config.DOCUMENT_REVIEW_SLACK_CHANNEL_ID = undefined;

  try {
    await assert.rejects(
      () =>
        postPendingEtaReviewsToSlackWithDeps(10, {
          findPendingReviews: async () => [],
          loadReviewWithCandidate: async () => null,
          postSlackMessage: async () => undefined
        } as any),
      /DOCUMENT_REVIEW_SLACK_CHANNEL_ID is required/
    );
  } finally {
    config.DOCUMENT_REVIEW_SLACK_CHANNEL_ID = prev;
  }
});

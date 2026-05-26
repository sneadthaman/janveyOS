import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../../shared/config.js";
import { postPendingEtaReviewsToSlackWithDeps, postPendingEtaReviewToSlackWithDeps, resolveDocumentReviewSlackChannelIds } from "./document-review-notifier.js";

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

function withConfigValues<T>(values: Partial<typeof config>, run: () => Promise<T> | T): Promise<T> | T {
  const prevSingle = config.DOCUMENT_REVIEW_SLACK_CHANNEL_ID;
  const prevPlural = config.DOCUMENT_REVIEW_SLACK_CHANNEL_IDS;
  config.DOCUMENT_REVIEW_SLACK_CHANNEL_ID = values.DOCUMENT_REVIEW_SLACK_CHANNEL_ID;
  config.DOCUMENT_REVIEW_SLACK_CHANNEL_IDS = values.DOCUMENT_REVIEW_SLACK_CHANNEL_IDS;
  try {
    return run();
  } finally {
    config.DOCUMENT_REVIEW_SLACK_CHANNEL_ID = prevSingle;
    config.DOCUMENT_REVIEW_SLACK_CHANNEL_IDS = prevPlural;
  }
}

test("single old env var still works", () =>
  withConfigValues({ DOCUMENT_REVIEW_SLACK_CHANNEL_ID: "C123", DOCUMENT_REVIEW_SLACK_CHANNEL_IDS: undefined }, () => {
    assert.deepEqual(resolveDocumentReviewSlackChannelIds(), ["C123"]);
  }));

test("new plural env var works", () =>
  withConfigValues({ DOCUMENT_REVIEW_SLACK_CHANNEL_ID: "COLD", DOCUMENT_REVIEW_SLACK_CHANNEL_IDS: "C123,C456" }, () => {
    assert.deepEqual(resolveDocumentReviewSlackChannelIds(), ["C123", "C456"]);
  }));

test("comma-separated channels parsed, whitespace trimmed, duplicates deduped", () =>
  withConfigValues({ DOCUMENT_REVIEW_SLACK_CHANNEL_ID: undefined, DOCUMENT_REVIEW_SLACK_CHANNEL_IDS: " C1, C2 ,C1, , C3 " }, () => {
    assert.deepEqual(resolveDocumentReviewSlackChannelIds(), ["C1", "C2", "C3"]);
  }));

test("notifier posts to all channels and returns summary", async () => {
  await withConfigValues({ DOCUMENT_REVIEW_SLACK_CHANNEL_ID: undefined, DOCUMENT_REVIEW_SLACK_CHANNEL_IDS: "C1,C2" }, async () => {
    const channels: string[] = [];
    const summary = await postPendingEtaReviewToSlackWithDeps("review-1", {
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
      postSlackMessage: async (payload: { channel: string }) => {
        channels.push(payload.channel);
      }
    } as any);

    assert.deepEqual(channels, ["C1", "C2"]);
    assert.deepEqual(summary.postedChannels, ["C1", "C2"]);
    assert.deepEqual(summary.failedChannels, []);
  });
});

test("partial failure still succeeds if one channel posts", async () => {
  await withConfigValues({ DOCUMENT_REVIEW_SLACK_CHANNEL_IDS: "C1,C2", DOCUMENT_REVIEW_SLACK_CHANNEL_ID: undefined }, async () => {
    const summary = await postPendingEtaReviewToSlackWithDeps("review-2", {
      findPendingReviews: async () => [makePending("review-2")] as any,
      loadReviewWithCandidate: async () =>
        ({
          review: makePending("review-2"),
          candidate: { id: "cand-2", documentExtractionId: "ex-2", poNumber: "PO1", etaDate: "2026-05-29", etaDateSource: "ship_date", etaDateIsEstimated: false, baseDate: null, baseDateSource: null, trackingNumber: null, carrier: null, itemNumber: null, appliesToEntirePo: true, confidence: 0.8, rawContext: "ctx", createdAt: "2026-05-24T00:00:00Z" },
          extraction: { id: "ex-2", documentId: "doc-2", classification: "eta_update" },
          document: { id: "doc-2", fileName: "sample.pdf" }
        }) as any,
      postSlackMessage: async (payload: { channel: string }) => {
        if (payload.channel === "C1") throw new Error("channel_not_found");
      }
    } as any);
    assert.deepEqual(summary.postedChannels, ["C2"]);
    assert.equal(summary.failedChannels.length, 1);
    assert.equal(summary.failedChannels[0]?.channel, "C1");
  });
});

test("all failures throws", async () => {
  await withConfigValues({ DOCUMENT_REVIEW_SLACK_CHANNEL_IDS: "C1,C2", DOCUMENT_REVIEW_SLACK_CHANNEL_ID: undefined }, async () => {
    await assert.rejects(
      () =>
        postPendingEtaReviewToSlackWithDeps("review-3", {
          findPendingReviews: async () => [makePending("review-3")] as any,
          loadReviewWithCandidate: async () =>
            ({
              review: makePending("review-3"),
              candidate: { id: "cand-3", documentExtractionId: "ex-3", poNumber: "PO1", etaDate: "2026-05-29", etaDateSource: "ship_date", etaDateIsEstimated: false, baseDate: null, baseDateSource: null, trackingNumber: null, carrier: null, itemNumber: null, appliesToEntirePo: true, confidence: 0.8, rawContext: "ctx", createdAt: "2026-05-24T00:00:00Z" },
              extraction: { id: "ex-3", documentId: "doc-3", classification: "eta_update" },
              document: { id: "doc-3", fileName: "sample.pdf" }
            }) as any,
          postSlackMessage: async () => {
            throw new Error("channel_not_found");
          }
        } as any),
      /Failed to post document review review-3/
    );
  });
});

test("missing Slack channel config fails clearly", async () => {
  await withConfigValues({ DOCUMENT_REVIEW_SLACK_CHANNEL_ID: undefined, DOCUMENT_REVIEW_SLACK_CHANNEL_IDS: undefined }, async () => {
    await assert.rejects(
      () =>
        postPendingEtaReviewsToSlackWithDeps(10, {
          findPendingReviews: async () => [],
          loadReviewWithCandidate: async () => null,
          postSlackMessage: async () => undefined
        } as any),
      /DOCUMENT_REVIEW_SLACK_CHANNEL_IDS or DOCUMENT_REVIEW_SLACK_CHANNEL_ID is required/
    );
  });
});


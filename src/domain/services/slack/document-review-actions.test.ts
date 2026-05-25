import test from "node:test";
import assert from "node:assert/strict";
import { handleDocumentReviewActionWithDeps } from "./document-review-actions.js";

function makeJoined(status: "pending" | "approved" | "rejected" = "approved") {
  return {
    review: {
      id: "review-1",
      etaUpdateCandidateId: "cand-1",
      reviewStatus: status,
      reviewedBy: "U123",
      reviewedAt: "2026-05-24T00:00:00Z",
      reviewerNotes: status === "approved" ? "Approved from Slack" : "Rejected from Slack",
      actionRequestId: status === "approved" ? "req-1" : null,
      createdAt: "2026-05-24T00:00:00Z",
      updatedAt: "2026-05-24T00:00:00Z"
    },
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
      itemNumber: "123456",
      appliesToEntirePo: true,
      confidence: 0.6,
      rawContext: "ctx",
      createdAt: "2026-05-24T00:00:00Z"
    },
    extraction: { id: "ex-1", documentId: "doc-1", classification: "invoice_with_shipping_signal" },
    document: { id: "doc-1", fileName: "sample.pdf" }
  } as any;
}

test("approve action handler calls approve service and updates card", async () => {
  let approveCalls = 0;
  let rejectCalls = 0;
  let executionCalls = 0;

  const result = await handleDocumentReviewActionWithDeps(
    {
      actionId: "document_review_eta_approve",
      value: JSON.stringify({ reviewId: "review-1" }),
      actorSlackUserId: "U123",
      slackChannelId: "C1",
      slackMessageTs: "111.222"
    },
    {
      approveEtaReviewById: async () => {
        approveCalls += 1;
        return { review: { id: "review-1" }, actionRequestId: "req-1" } as any;
      },
      rejectEtaReviewById: async () => {
        rejectCalls += 1;
        return {} as any;
      },
      loadReviewWithCandidate: async () => makeJoined("approved"),
      updateSlackMessage: async () => undefined,
      handleEtaUpdateApprovalAction: async () => {
        executionCalls += 1;
        return { kind: "ok", message: "Approved. Applying ETA update…" } as any;
      }
    } as any
  );

  assert.equal(result.kind, "ok");
  assert.equal(approveCalls, 1);
  assert.equal(rejectCalls, 0);
  assert.equal(executionCalls, 1);
  assert.match(result.message, /Action request: req-1/);
});

test("approve action delegates to ETA execution pipeline", async () => {
  let executionPayload: Record<string, unknown> | null = null;
  const result = await handleDocumentReviewActionWithDeps(
    {
      actionId: "document_review_eta_approve",
      value: JSON.stringify({ reviewId: "review-1" }),
      actorSlackUserId: "U123",
      slackChannelId: "C1",
      slackMessageTs: "111.222"
    },
    {
      approveEtaReviewById: async () => ({ review: { id: "review-1" }, actionRequestId: "req-1" }) as any,
      rejectEtaReviewById: async () => ({}) as any,
      loadReviewWithCandidate: async () => makeJoined("approved"),
      updateSlackMessage: async () => undefined,
      handleEtaUpdateApprovalAction: async (payload: Record<string, unknown>) => {
        executionPayload = payload;
        return { kind: "ok", message: "" } as any;
      }
    } as any
  );

  assert.equal(result.kind, "ok");
  assert.equal(String(executionPayload?.["actionId"] ?? ""), "eta_update_approve_request");
  assert.equal(String(executionPayload?.["actorSlackUserId"] ?? ""), "U123");
});

test("reject action handler calls reject service and updates card", async () => {
  let approveCalls = 0;
  let rejectCalls = 0;
  let updateCalls = 0;

  const result = await handleDocumentReviewActionWithDeps(
    {
      actionId: "document_review_eta_reject",
      value: JSON.stringify({ reviewId: "review-1" }),
      actorSlackUserId: "U123",
      slackChannelId: "C1",
      slackMessageTs: "111.222"
    },
    {
      approveEtaReviewById: async () => {
        approveCalls += 1;
        return { review: { id: "review-1" }, actionRequestId: "req-1" } as any;
      },
      rejectEtaReviewById: async () => {
        rejectCalls += 1;
        return { id: "review-1" } as any;
      },
      loadReviewWithCandidate: async () => makeJoined("rejected"),
      updateSlackMessage: async () => {
        updateCalls += 1;
      },
      handleEtaUpdateApprovalAction: async () => ({ kind: "ok", message: "" } as any)
    } as any
  );

  assert.equal(result.kind, "ok");
  assert.equal(approveCalls, 0);
  assert.equal(rejectCalls, 1);
  assert.equal(updateCalls, 1);
});

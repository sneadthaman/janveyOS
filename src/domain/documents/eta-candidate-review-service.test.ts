import test from "node:test";
import assert from "node:assert/strict";
import {
  approveEtaCandidateWithDeps,
  approveEtaReviewByIdWithDeps,
  rejectEtaCandidateWithDeps,
  rejectEtaReviewByIdWithDeps
} from "./eta-candidate-review-service.js";

function candidate(overrides?: Record<string, unknown>) {
  return {
    id: "cand-1",
    documentExtractionId: "extract-1",
    poNumber: "PO289731",
    etaDate: "2026-05-29",
    trackingNumber: "PRO123",
    carrier: "UPS",
    itemNumber: "123456",
    appliesToEntirePo: true,
    confidence: 0.9,
    rawContext: "bring PO289731 on 5/29",
    createdAt: "2026-05-24T00:00:00Z",
    ...overrides
  };
}

function pendingReview(overrides?: Record<string, unknown>) {
  return {
    id: "review-1",
    etaUpdateCandidateId: "cand-1",
    reviewStatus: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reviewerNotes: null,
    actionRequestId: null,
    createdAt: "2026-05-24T00:00:00Z",
    updatedAt: "2026-05-24T00:00:00Z",
    ...overrides
  };
}

test("approveEtaCandidate creates eta_update action request and stores action_request_id", async () => {
  let requestPayload: Record<string, unknown> | null = null;
  const result = await approveEtaCandidateWithDeps(
    {
      candidateId: "cand-1",
      reviewedBy: "reviewer-1"
    },
    {
      findEtaUpdateCandidateById: async () => candidate() as any,
      findDocumentExtractionById: async () => ({ id: "extract-1", documentId: "doc-1" }) as any,
      createPendingReview: async () => pendingReview() as any,
      findReviewByCandidateId: async () => null,
      createAgentActionRequest: async (input: Record<string, unknown>) => {
        requestPayload = (input.inputJson ?? null) as Record<string, unknown> | null;
        return "req-123";
      },
      approveReview: async (input) => pendingReview({ reviewStatus: "approved", actionRequestId: input.actionRequestId }) as any,
      rejectReview: async () => pendingReview({ reviewStatus: "rejected" }) as any
    }
  );

  assert.equal(result.actionRequestId, "req-123");
  assert.equal(result.review.reviewStatus, "approved");
  assert.equal(result.review.actionRequestId, "req-123");
  assert.equal((requestPayload as any)?.["eta_update_id"], "cand-1");
  assert.equal((requestPayload as any)?.["etaUpdateId"], "cand-1");
  assert.equal((requestPayload as any)?.["source_type"], "document_review");
  assert.equal((requestPayload as any)?.["eta_source"], "document_review");
  assert.equal((requestPayload as any)?.["extraction_confidence"], "HIGH");
  assert.equal((requestPayload as any)?.["appliesToEntirePo"], true);
  assert.equal((requestPayload as any)?.["itemNumber"], "123456");
});

test("approveEtaCandidate whole-PO candidate sets all-open-lines payload semantics", async () => {
  let requestPayload: Record<string, unknown> | null = null;
  await approveEtaCandidateWithDeps(
    {
      candidateId: "cand-1",
      reviewedBy: "reviewer-1"
    },
    {
      findEtaUpdateCandidateById: async () => candidate({ itemNumber: null, appliesToEntirePo: true }) as any,
      findDocumentExtractionById: async () => ({ id: "extract-1", documentId: "doc-1" }) as any,
      createPendingReview: async () => pendingReview() as any,
      findReviewByCandidateId: async () => null,
      createAgentActionRequest: async (input: Record<string, unknown>) => {
        requestPayload = (input.inputJson ?? null) as Record<string, unknown> | null;
        return "req-123";
      },
      approveReview: async (input) => pendingReview({ reviewStatus: "approved", actionRequestId: input.actionRequestId }) as any,
      rejectReview: async () => pendingReview({ reviewStatus: "rejected" }) as any
    }
  );

  assert.equal((requestPayload as any)?.["appliesToEntirePo"], true);
  assert.equal((requestPayload as any)?.["applies_to_entire_po"], true);
  assert.equal((requestPayload as any)?.["itemNumber"], null);
  assert.equal((requestPayload as any)?.["item_number"], null);
  assert.equal((requestPayload as any)?.["updateScope"], "po_all_lines");
  assert.equal((requestPayload as any)?.["update_scope"], "po_all_lines");
  assert.equal((requestPayload as any)?.["appliesTo"], "all_open_po_lines");
  assert.equal((requestPayload as any)?.["applies_to"], "all_open_po_lines");
  assert.equal((requestPayload as any)?.["eta_update_id"], "cand-1");
  assert.equal((requestPayload as any)?.["source_type"], "document_review");
  assert.equal((requestPayload as any)?.["extraction_confidence"], "HIGH");
});

test("Schinner whole-PO review creates executable eta_update payload fields", async () => {
  let requestPayload: Record<string, unknown> | null = null;
  await approveEtaCandidateWithDeps(
    { candidateId: "cand-schinner", reviewedBy: "reviewer-1" },
    {
      findEtaUpdateCandidateById: async () =>
        candidate({
          id: "cand-schinner",
          poNumber: "PO289829",
          etaDate: "2026-05-26",
          itemNumber: null,
          appliesToEntirePo: true,
          carrier: "RJ_SCHINNER_TRUCK",
          etaDateSource: "ship_date"
        }) as any,
      findDocumentExtractionById: async () => ({ id: "extract-1", documentId: "doc-1" }) as any,
      findIngestedDocumentById: async () => ({ id: "doc-1", fileName: "S650-test.pdf", sourceSender: "ops@rjschinner.com", ocrUsed: true }) as any,
      createPendingReview: async () => pendingReview({ etaUpdateCandidateId: "cand-schinner" }) as any,
      findReviewByCandidateId: async () => null,
      createAgentActionRequest: async (input: Record<string, unknown>) => {
        requestPayload = (input.inputJson ?? null) as Record<string, unknown> | null;
        return "req-schinner";
      },
      approveReview: async (input) => pendingReview({ reviewStatus: "approved", actionRequestId: input.actionRequestId }) as any,
      rejectReview: async () => pendingReview({ reviewStatus: "rejected" }) as any
    }
  );

  assert.equal((requestPayload as any)?.["po_number"], "PO289829");
  assert.equal((requestPayload as any)?.["eta_date"], "2026-05-26");
  assert.equal((requestPayload as any)?.["eta_update_id"], "cand-schinner");
  assert.equal((requestPayload as any)?.["update_scope"], "po_all_lines");
  assert.equal((requestPayload as any)?.["source_type"], "document_review");
  assert.equal((requestPayload as any)?.["extraction_confidence"], "HIGH");
});

test("approveEtaCandidate rejects missing po_number", async () => {
  await assert.rejects(
    () =>
      approveEtaCandidateWithDeps(
        { candidateId: "cand-1" },
        {
          findEtaUpdateCandidateById: async () => candidate({ poNumber: null }) as any,
          findDocumentExtractionById: async () => ({ id: "extract-1", documentId: "doc-1" }) as any,
          createPendingReview: async () => pendingReview() as any,
          findReviewByCandidateId: async () => null,
          createAgentActionRequest: async () => "req-1",
          approveReview: async () => pendingReview() as any,
          rejectReview: async () => pendingReview() as any
        }
      ),
    /missing required field: po_number/
  );
});

test("approveEtaCandidate rejects missing eta_date", async () => {
  await assert.rejects(
    () =>
      approveEtaCandidateWithDeps(
        { candidateId: "cand-1" },
        {
          findEtaUpdateCandidateById: async () => candidate({ etaDate: null }) as any,
          findDocumentExtractionById: async () => ({ id: "extract-1", documentId: "doc-1" }) as any,
          createPendingReview: async () => pendingReview() as any,
          findReviewByCandidateId: async () => null,
          createAgentActionRequest: async () => "req-1",
          approveReview: async () => pendingReview() as any,
          rejectReview: async () => pendingReview() as any
        }
      ),
    /missing required field: eta_date/
  );
});

test("approveEtaCandidate is idempotent when already approved", async () => {
  let createCalls = 0;
  const result = await approveEtaCandidateWithDeps(
    { candidateId: "cand-1" },
    {
      findEtaUpdateCandidateById: async () => candidate() as any,
      findDocumentExtractionById: async () => ({ id: "extract-1", documentId: "doc-1" }) as any,
      createPendingReview: async () => pendingReview({ reviewStatus: "approved", actionRequestId: "req-existing" }) as any,
      findReviewByCandidateId: async () => null,
      createAgentActionRequest: async () => {
        createCalls += 1;
        return "req-new";
      },
      approveReview: async () => pendingReview({ reviewStatus: "approved", actionRequestId: "req-existing" }) as any,
      rejectReview: async () => pendingReview({ reviewStatus: "rejected" }) as any
    }
  );

  assert.equal(result.actionRequestId, "req-existing");
  assert.equal(createCalls, 0);
});

test("rejectEtaCandidate marks rejected", async () => {
  const result = await rejectEtaCandidateWithDeps(
    { candidateId: "cand-1", reviewedBy: "reviewer-1" },
    {
      findEtaUpdateCandidateById: async () => candidate() as any,
      findDocumentExtractionById: async () => ({ id: "extract-1", documentId: "doc-1" }) as any,
      createPendingReview: async () => pendingReview() as any,
      findReviewByCandidateId: async () => null,
      createAgentActionRequest: async () => "req-1",
      approveReview: async () => pendingReview({ reviewStatus: "approved", actionRequestId: "req-1" }) as any,
      rejectReview: async () => pendingReview({ reviewStatus: "rejected", reviewedBy: "reviewer-1" }) as any
    }
  );

  assert.equal(result.reviewStatus, "rejected");
});

test("rejected review cannot be approved", async () => {
  await assert.rejects(
    () =>
      approveEtaCandidateWithDeps(
        { candidateId: "cand-1" },
        {
          findEtaUpdateCandidateById: async () => candidate() as any,
          findDocumentExtractionById: async () => ({ id: "extract-1", documentId: "doc-1" }) as any,
          createPendingReview: async () => pendingReview({ reviewStatus: "rejected" }) as any,
          findReviewByCandidateId: async () => null,
          createAgentActionRequest: async () => "req-1",
          approveReview: async () => pendingReview({ reviewStatus: "approved", actionRequestId: "req-1" }) as any,
          rejectReview: async () => pendingReview({ reviewStatus: "rejected" }) as any
        }
      ),
    /cannot be approved/
  );
});

test("approving nonexistent review fails clearly", async () => {
  await assert.rejects(
    () =>
      approveEtaReviewByIdWithDeps(
        { reviewId: "missing-review" },
        {
          findReviewById: async () => null as any
        }
      ),
    /review not found/
  );
});

test("approving already approved review returns existing", async () => {
  let createCalls = 0;
  const result = await approveEtaReviewByIdWithDeps(
    { reviewId: "review-1", reviewedBy: "local_cli" },
    {
      findReviewById: async () => pendingReview({ reviewStatus: "approved", actionRequestId: "req-existing" }) as any,
      findEtaUpdateCandidateById: async () => candidate() as any,
      findDocumentExtractionById: async () => ({ id: "extract-1", documentId: "doc-1" }) as any,
      createPendingReview: async () => pendingReview({ reviewStatus: "approved", actionRequestId: "req-existing" }) as any,
      findReviewByCandidateId: async () => null,
      createAgentActionRequest: async () => {
        createCalls += 1;
        return "req-new";
      },
      approveReview: async () => pendingReview({ reviewStatus: "approved", actionRequestId: "req-existing" }) as any,
      rejectReview: async () => pendingReview({ reviewStatus: "rejected" }) as any
    }
  );

  assert.equal(result.actionRequestId, "req-existing");
  assert.equal(createCalls, 0);
});

test("rejecting approved review fails clearly", async () => {
  await assert.rejects(
    () =>
      rejectEtaReviewByIdWithDeps(
        { reviewId: "review-1", reviewedBy: "local_cli" },
        {
          findReviewById: async () => pendingReview({ reviewStatus: "approved", actionRequestId: "req-1" }) as any,
          findEtaUpdateCandidateById: async () => candidate() as any,
          createPendingReview: async () => pendingReview({ reviewStatus: "approved", actionRequestId: "req-1" }) as any,
          findReviewByCandidateId: async () => null,
          findDocumentExtractionById: async () => ({ id: "extract-1", documentId: "doc-1" }) as any,
          createAgentActionRequest: async () => "req-1",
          approveReview: async () => pendingReview({ reviewStatus: "approved", actionRequestId: "req-1" }) as any,
          rejectReview: async () => pendingReview({ reviewStatus: "rejected" }) as any
        }
      ),
    /cannot be rejected/
  );
});

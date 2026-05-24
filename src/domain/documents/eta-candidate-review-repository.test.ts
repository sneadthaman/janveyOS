import test from "node:test";
import assert from "node:assert/strict";
import {
  approveReviewWithDeps,
  createPendingReviewWithDeps,
  findPendingReviewsWithDeps,
  rejectReviewWithDeps
} from "./eta-candidate-review-repository.js";

function makeRow(overrides?: Record<string, unknown>) {
  return {
    id: "review-1",
    eta_update_candidate_id: "cand-1",
    review_status: "pending",
    reviewed_by: null,
    reviewed_at: null,
    reviewer_notes: null,
    action_request_id: null,
    created_at: "2026-05-24T00:00:00Z",
    updated_at: "2026-05-24T00:00:00Z",
    ...overrides
  };
}

test("createPendingReview creates pending review", async () => {
  const review = await createPendingReviewWithDeps("cand-1", {
    findById: async () => null,
    findByCandidateId: async () => null,
    insertReview: async () => makeRow({ id: "review-new" }),
    listPending: async () => [],
    updateById: async () => makeRow()
  });

  assert.equal(review.id, "review-new");
  assert.equal(review.reviewStatus, "pending");
});

test("createPendingReview returns existing review", async () => {
  const review = await createPendingReviewWithDeps("cand-1", {
    findById: async () => null,
    findByCandidateId: async () => makeRow({ id: "review-existing", review_status: "approved" }),
    insertReview: async () => makeRow(),
    listPending: async () => [],
    updateById: async () => makeRow()
  });

  assert.equal(review.id, "review-existing");
  assert.equal(review.reviewStatus, "approved");
});

test("findPendingReviews returns pending rows", async () => {
  const rows = await findPendingReviewsWithDeps(20, {
    findById: async () => null,
    findByCandidateId: async () => null,
    insertReview: async () => makeRow(),
    listPending: async () => [makeRow({ id: "r1" }), makeRow({ id: "r2" })],
    updateById: async () => makeRow()
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.id, "r1");
});

test("approveReview updates status + action request id", async () => {
  const review = await approveReviewWithDeps(
    {
      reviewId: "review-1",
      reviewedBy: "user-1",
      actionRequestId: "req-1",
      reviewerNotes: "looks good"
    },
    {
      findById: async () => null,
      findByCandidateId: async () => null,
      insertReview: async () => makeRow(),
      listPending: async () => [],
      updateById: async (_id, patch) => makeRow({ ...patch })
    }
  );

  assert.equal(review.reviewStatus, "approved");
  assert.equal(review.actionRequestId, "req-1");
});

test("rejectReview marks rejected", async () => {
  const review = await rejectReviewWithDeps(
    {
      reviewId: "review-1",
      reviewedBy: "user-1",
      reviewerNotes: "bad data"
    },
    {
      findById: async () => null,
      findByCandidateId: async () => null,
      insertReview: async () => makeRow(),
      listPending: async () => [],
      updateById: async (_id, patch) => makeRow({ ...patch })
    }
  );

  assert.equal(review.reviewStatus, "rejected");
  assert.equal(review.reviewerNotes, "bad data");
});

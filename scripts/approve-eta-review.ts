import { getAgentActionRequestById } from "../src/domain/repositories/agent-manager-repository.js";
import { approveEtaReviewById } from "../src/domain/documents/eta-candidate-review-service.js";
import { findReviewById } from "../src/domain/documents/eta-candidate-review-repository.js";

async function main() {
  const reviewId = process.argv[2];
  const reviewerName = process.argv[3] || "local_cli";

  if (!reviewId) {
    console.error("Usage: npm run eta:approve -- <reviewId> [reviewerName]");
    process.exit(1);
  }

  const existingReview = await findReviewById(reviewId);
  if (!existingReview) {
    throw new Error(`ETA candidate review not found: ${reviewId}`);
  }

  const result = await approveEtaReviewById({
    reviewId,
    reviewedBy: reviewerName,
    requestedBy: reviewerName,
    source: "local_cli"
  });

  const actionRequest = await getAgentActionRequestById(result.actionRequestId);

  if (!actionRequest) {
    throw new Error(`Created action request not found: ${result.actionRequestId}`);
  }

  console.log("ETA review approved", {
    reviewId: result.review.id,
    actionRequestId: result.actionRequestId,
    actionType: actionRequest.action_type,
    actionStatus: actionRequest.status,
    payloadPreview: actionRequest.input_json
  });
}

main().catch((error) => {
  console.error("Failed to approve ETA review", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});

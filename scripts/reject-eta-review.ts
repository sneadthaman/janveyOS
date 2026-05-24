import { rejectEtaReviewById } from "../src/domain/documents/eta-candidate-review-service.js";
import { findReviewById } from "../src/domain/documents/eta-candidate-review-repository.js";

async function main() {
  const reviewId = process.argv[2];
  const reviewerName = process.argv[3] || "local_cli";
  const reason = process.argv.slice(4).join(" ") || "Rejected via local CLI";

  if (!reviewId) {
    console.error("Usage: npm run eta:reject -- <reviewId> [reviewerName] [reason]");
    process.exit(1);
  }

  const review = await findReviewById(reviewId);
  if (!review) throw new Error(`ETA candidate review not found: ${reviewId}`);

  const rejected = await rejectEtaReviewById({
    reviewId,
    reviewedBy: reviewerName,
    reviewerNotes: reason
  });

  console.log("ETA review rejected", {
    reviewId: rejected.id,
    reviewStatus: rejected.reviewStatus,
    reviewedBy: rejected.reviewedBy,
    reviewedAt: rejected.reviewedAt,
    reviewerNotes: rejected.reviewerNotes
  });
}

main().catch((error) => {
  console.error("Failed to reject ETA review", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});

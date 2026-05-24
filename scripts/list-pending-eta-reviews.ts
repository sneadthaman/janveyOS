import { findPendingReviews, loadReviewWithCandidate } from "../src/domain/documents/eta-candidate-review-repository.js";
import { printTable } from "../src/shared/cli/table-printer.js";

async function main() {
  const pending = await findPendingReviews(200);

  if (pending.length === 0) {
    console.log("No pending ETA candidate reviews.");
    return;
  }

  const rows: Array<Array<string | number | boolean | null>> = [];

  for (const review of pending) {
    const joined = await loadReviewWithCandidate(review.id);
    if (!joined?.candidate) continue;
    const { candidate, extraction, document } = joined;

    rows.push([
      review.id,
      candidate.id,
      candidate.poNumber,
      candidate.etaDate,
      candidate.itemNumber,
      candidate.trackingNumber,
      candidate.appliesToEntirePo,
      candidate.confidence,
      document?.fileName ?? "",
      extraction?.classification ?? "",
      review.createdAt
    ]);
  }

  printTable(
    [
      "review_id",
      "candidate_id",
      "po_number",
      "eta_date",
      "item_number",
      "tracking",
      "entire_po",
      "confidence",
      "source_file",
      "classification",
      "created_at"
    ],
    rows
  );
}

main().catch((error) => {
  console.error("Failed to list pending ETA reviews", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});

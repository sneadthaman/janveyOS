import { postPendingEtaReviewsToSlack } from "../src/domain/services/slack/document-review-notifier.js";

async function main() {
  const rawLimit = process.argv[2];
  const parsed = rawLimit ? Number(rawLimit) : 10;
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10;

  const posted = await postPendingEtaReviewsToSlack(limit);
  if (posted.length === 0) {
    console.log("No pending ETA reviews were posted to Slack.");
    return;
  }

  console.log(`Posted ${posted.length} pending ETA review(s) to Slack:`);
  for (const reviewId of posted) {
    console.log(`- ${reviewId}`);
  }
}

main().catch((error) => {
  console.error("Failed to post pending ETA reviews to Slack", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});

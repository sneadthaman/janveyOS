import fs from "node:fs/promises";
import path from "node:path";
import { ingestPdfDocument } from "../src/domain/documents/document-ingestion-service.js";
import { processIngestedDocument } from "../src/domain/documents/document-extraction-service.js";
import { createPendingReviewForCandidate } from "../src/domain/documents/eta-candidate-review-service.js";

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((arg) => !arg.startsWith("--"));
  const shouldExtract = args.includes("--extract");
  const shouldReview = args.includes("--review");
  if (!filePath) {
    console.error("Usage: npm run dev:ingest-pdf -- <path-to-pdf> [--extract]");
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);
  const fileName = path.basename(absolutePath);

  const [buffer, stats] = await Promise.all([fs.readFile(absolutePath), fs.stat(absolutePath)]);

  const result = await ingestPdfDocument({
    source: "manual_upload",
    sourceSubject: "local fixture ingest",
    fileName,
    mimeType: "application/pdf",
    fileSizeBytes: stats.size,
    buffer,
    storagePath: absolutePath
  });

  const extractedText = result.extractedText ?? "";

  console.log("[dev-ingest-pdf] result", {
    documentId: result.id,
    extractionStatus: result.extractionStatus,
    extractionMethod: result.extractionMethod ?? null,
    ocrUsed: result.ocrUsed ?? false,
    documentType: result.documentType,
    extractedTextLength: extractedText.length
  });

  console.log("[dev-ingest-pdf] extractedTextPreview");
  console.log(extractedText.slice(0, 1000));

  if (shouldExtract) {
    const extraction = await processIngestedDocument(result.id);
    console.log("[dev-ingest-pdf] extraction", {
      classification: extraction.extraction.classification,
      confidence: extraction.extraction.confidence,
      candidateCount: extraction.candidates.length
    });
    console.log(
      "[dev-ingest-pdf] candidates",
      JSON.stringify(
        extraction.candidates.map((candidate) => ({
          poNumber: candidate.poNumber,
          etaDate: candidate.etaDate,
          trackingNumber: candidate.trackingNumber,
          carrier: candidate.carrier,
          itemNumber: candidate.itemNumber,
          appliesToEntirePo: candidate.appliesToEntirePo,
          confidence: candidate.confidence
        }))
      )
    );

    if (shouldReview) {
      const reviews = [];
      for (const candidate of extraction.candidates) {
        const review = await createPendingReviewForCandidate(candidate.id);
        reviews.push({ candidateId: candidate.id, reviewId: review.id, reviewStatus: review.reviewStatus });
      }

      console.log("[dev-ingest-pdf] pendingReviews", reviews);
    }
  }
}

main().catch((error) => {
  console.error("[dev-ingest-pdf] failed", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});

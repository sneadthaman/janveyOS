import { ingestCustomerPoFolder, scanCustomerPoFolderDryRun } from "../src/domain/documents/outlook-folder-ingestion-service.js";

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const ingest = argv.includes("--ingest");
  const extract = argv.includes("--extract");
  const includeThread = !argv.includes("--no-thread");
  const includeBody = !argv.includes("--no-body");
  const limitIndex = argv.findIndex((arg) => arg === "--limit");
  const limitRaw = limitIndex >= 0 ? argv[limitIndex + 1] : undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;
  return { dryRun, ingest, extract, includeThread, includeBody, limit };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun && !args.ingest) {
    console.error("Usage: npm run outlook:scan-cust-po -- --dry-run|--ingest [--extract] [--limit 10]");
    process.exit(1);
  }

  if (args.dryRun) {
    const result = await scanCustomerPoFolderDryRun({ limit: args.limit, includeThread: args.includeThread, includeBody: args.includeBody });
    console.log(`[outlook:scan-cust-po] folder found: ${result.folderName} (${result.mailbox})`);
    console.log(`[outlook:scan-cust-po] message count scanned: ${result.scannedMessageCount}`);
    console.log(`[outlook:scan-cust-po] thread messages scanned: ${result.threadMessagesScanned}`);
    console.log(`[outlook:scan-cust-po] thread scan errors: ${result.threadScanErrors}`);
    console.log(`[outlook:scan-cust-po] PDF count found: ${result.pdfAttachmentCount}`);
    console.log(`[outlook:scan-cust-po] PDFs direct: ${result.pdfFoundDirect}`);
    console.log(`[outlook:scan-cust-po] PDFs via thread: ${result.pdfFoundViaThread}`);
    console.log(`[outlook:scan-cust-po] body candidates: ${result.emailBodiesEligible}`);
    console.log(`[outlook:scan-cust-po] skipped auto-replies: ${result.skippedAutoReplies}`);
    console.log(`[outlook:scan-cust-po] duplicates skipped: ${result.duplicatesSkipped}`);
    for (const msg of result.messages) {
      const files = msg.pdfAttachments
        .map((a) => `${a.name}${typeof a.size === "number" ? ` (${a.size} bytes)` : ""} [${a.location}]`)
        .join(", ");
      console.log(`- ${msg.messageId} | ${msg.sender ?? "-"} | ${msg.subject ?? "-"} | ${files || "(no pdf)"}`);
    }
    return;
  }

  const result = await ingestCustomerPoFolder({
    limit: args.limit,
    extract: args.extract,
    includeThread: args.includeThread,
    includeBody: args.includeBody
  });
  console.log(`[outlook:scan-cust-po] folder found: ${result.folderName} (${result.mailbox})`);
  console.log(`[outlook:scan-cust-po] message count scanned: ${result.scannedMessageCount}`);
  console.log(`[outlook:scan-cust-po] thread messages scanned: ${result.threadMessagesScanned}`);
  console.log(`[outlook:scan-cust-po] thread scan errors: ${result.threadScanErrors}`);
  console.log(`[outlook:scan-cust-po] PDF count found: ${result.pdfAttachmentCount}`);
  console.log(`[outlook:scan-cust-po] documents ingested: ${result.ingestedDocumentCount}`);
  console.log(`[outlook:scan-cust-po] body documents ingested: ${result.bodyDocumentsIngested}`);
  console.log(`[outlook:scan-cust-po] duplicates skipped: ${result.duplicatesSkipped}`);
  console.log(`[outlook:scan-cust-po] skipped auto-replies: ${result.skippedAutoReplies}`);
  for (const doc of result.documents) {
    const classInfo = args.extract
      ? ` | classification=${doc.classification ?? "-"} | mismatch=${doc.classificationMismatch} | triage=${doc.needsManualTriage}`
      : "";
    console.log(
      `- ${doc.documentId ?? "-"} | source=${doc.sourceType} | path=${doc.ingestionPath} | status=${doc.status} | ${doc.sender ?? "-"} | ${doc.subject ?? "-"} | ${doc.attachmentName}${classInfo}`
    );
  }
}

main().catch((error) => {
  console.error("[outlook:scan-cust-po] failed", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});

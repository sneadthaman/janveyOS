import fs from "node:fs";
import path from "node:path";
import { getXlsxDiagnostics, parseUploadFile } from "../src/domain/services/upload-parser-service.js";
import { computeNilfiskSchoolHealthcarePricing } from "../src/domain/services/pricing-utils.js";

async function main() {
  const candidatePaths = [
    process.env.NILFISK_FULL_PATH,
    path.resolve(process.cwd(), "scripts/sample-data/nilfisk-sample.xlsx"),
    path.resolve(process.cwd(), "uploads/nilfisk-2023-dealer-price-list.xlsx")
  ].filter(Boolean) as string[];

  const filePath = candidatePaths.find((p) => fs.existsSync(p));
  if (!filePath) {
    console.error("No XLSX file found. Set NILFISK_FULL_PATH=/abs/path/to/NilfiskDealerSheet.xlsx");
    process.exit(1);
  }

  const diagnostics = getXlsxDiagnostics(filePath);
  const parsed = await parseUploadFile({
    filePath,
    originalFileName: path.basename(filePath)
  });
  const autoscrubber = parsed.parsedRows.filter((row) => row.category === "autoscrubber");

  console.log(`File: ${filePath}`);
  console.log("Sheets found:");
  for (const sheet of diagnostics.sheets) {
    console.log(`- ${sheet.sheetName} | rows=${sheet.totalRows} | relevant=${sheet.relevant} | headers=${sheet.headers.join(", ")}`);
  }
  console.log(`Rows parsed: ${parsed.parsedRows.length}`);
  console.log(`Rows skipped: ${parsed.skippedRows.length}`);
  console.log(`Autoscrubber candidates: ${autoscrubber.length}`);
  console.log("Skipped row reasons by count:");
  const reasonCounts = parsed.diagnostics?.skippedReasonCounts ?? {};
  for (const [reason, count] of Object.entries(reasonCounts)) {
    console.log(`- ${reason}: ${count}`);
  }

  console.log("Sample 10 parsed products:");
  for (const row of autoscrubber.slice(0, 10)) {
    const calc = computeNilfiskSchoolHealthcarePricing({
      dealerNet: row.dealerNet,
      listPrice: row.listPrice
    });
    console.log(
      [
        `${row.sheetName ?? "?"}:${row.rawRowNumber ?? row.rowNumber}`,
        row.sku,
        row.productName,
        `list=${row.listPrice}`,
        `dealer=${row.dealerNet}`,
        `margin=${(calc.marginPercent * 100).toFixed(2)}%`
      ].join(" | ")
    );
  }
}

main().catch((error) => {
  console.error("test:parse-nilfisk-full failed", error);
  process.exit(1);
});

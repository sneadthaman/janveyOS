import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const BASE_URL = process.env.JANVEY_API_URL ?? "http://localhost:3000";
const samplePath = path.resolve(process.cwd(), "scripts/sample-data/nilfisk-sample.xlsx");

function ensureSampleFile() {
  if (fs.existsSync(samplePath)) return;
  fs.mkdirSync(path.dirname(samplePath), { recursive: true });
  const rows = [
    { SKU: "NIL-1001", "Product Name": "Nilfisk SC500 20D", "Suggested List Price": 12500, "Dealer Net Price": 8800 },
    { SKU: "NIL-1002", "Product Name": "Nilfisk SC550 26D", "Suggested List Price": 15900, "Dealer Net Price": 11200 },
    { SKU: "", "Product Name": "Bad Row Missing SKU", "Suggested List Price": 1000, "Dealer Net Price": 700 },
    { SKU: "NIL-1003", "Product Name": "Nilfisk BA 651", "Suggested List Price": "not_a_number", "Dealer Net Price": 9200 }
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "PriceList");
  XLSX.writeFile(wb, samplePath);
}

async function main() {
  ensureSampleFile();
  const form = new FormData();
  const buffer = fs.readFileSync(samplePath);
  const file = new File([buffer], "nilfisk-sample.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  form.append("vendor", "Nilfisk");
  form.append("documentType", "price_sheet");
  form.append("file", file);

  console.log(`Uploading: ${samplePath}`);
  const uploadRes = await fetch(`${BASE_URL}/api/uploads`, {
    method: "POST",
    body: form
  });
  const uploadJson = (await uploadRes.json()) as Record<string, unknown>;
  if (!uploadRes.ok) {
    console.error("Upload failed:", uploadJson);
    process.exit(1);
  }
  console.log("Parse summary:", {
    uploaded_document_id: uploadJson.uploaded_document_id,
    parse_status: uploadJson.parse_status,
    parsed_rows: uploadJson.parsed_rows,
    skipped_rows: uploadJson.skipped_rows
  });

  const uploadId = String(uploadJson.uploaded_document_id);
  const previewRes = await fetch(`${BASE_URL}/api/uploads/${uploadId}/parsed-preview`);
  const previewJson = (await previewRes.json()) as Record<string, unknown>;
  if (!previewRes.ok) {
    console.error("Preview failed:", previewJson);
    process.exit(1);
  }
  console.log("Preview summary:", (previewJson.summary ?? {}) as Record<string, unknown>);

  const approveRes = await fetch(`${BASE_URL}/api/uploads/${uploadId}/approve`, { method: "POST" });
  const approveJson = (await approveRes.json()) as Record<string, unknown>;
  if (!approveRes.ok) {
    console.error("Approve failed:", approveJson);
    process.exit(1);
  }
  console.log("Approved product count:", approveJson.approved_rows);
}

main().catch((error) => {
  console.error("test:upload-nilfisk crashed", error);
  process.exit(1);
});

import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.JANVEY_API_URL ?? "http://localhost:3000";
const pdfPath = process.env.PDF_SPEC_PATH ? path.resolve(process.env.PDF_SPEC_PATH) : "";

async function main() {
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.error("Set PDF_SPEC_PATH to a real PDF file path before running test:upload-pdf-spec.");
    process.exit(1);
  }
  const form = new FormData();
  const buffer = fs.readFileSync(pdfPath);
  const file = new File([buffer], path.basename(pdfPath), { type: "application/pdf" });
  form.append("vendor", "Nilfisk");
  form.append("documentType", "product_spec");
  form.append("file", file);

  const uploadRes = await fetch(`${BASE_URL}/api/uploads`, { method: "POST", body: form });
  const uploadJson = (await uploadRes.json()) as Record<string, unknown>;
  if (!uploadRes.ok) {
    console.error("Upload failed", uploadJson);
    process.exit(1);
  }
  console.log("PDF upload response:", JSON.stringify(uploadJson, null, 2));
  const uploadId = String(uploadJson.uploaded_document_id);

  const detailRes = await fetch(`${BASE_URL}/api/uploads/${uploadId}`);
  const detailJson = (await detailRes.json()) as Record<string, unknown>;
  if (!detailRes.ok) {
    console.error("Detail lookup failed", detailJson);
    process.exit(1);
  }
  const chunks = (detailJson.knowledge_chunks as unknown[] | undefined) ?? [];
  console.log(`Knowledge chunks created: ${chunks.length}`);
}

main().catch((error) => {
  console.error("test:upload-pdf-spec failed", error);
  process.exit(1);
});

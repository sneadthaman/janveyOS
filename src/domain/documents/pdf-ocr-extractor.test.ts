import test from "node:test";
import assert from "node:assert/strict";
import { extractEtaUpdateCandidates } from "./eta-candidate-extractor.js";
import { extractPdfTextWithOcrFallback } from "./pdf-ocr-extractor.js";

test("normal text PDF does not call OCR", async () => {
  let rendered = 0;
  let ocrCalled = 0;
  const result = await extractPdfTextWithOcrFallback(Buffer.from("pdf"), {
    minTextLength: 20,
    ocrEnabled: true,
    deps: {
      extractPdfText: async () => "This text is definitely long enough to skip OCR.",
      renderPdfPagesToImages: async () => {
        rendered += 1;
        return [];
      },
      ocrImage: async () => {
        ocrCalled += 1;
        return "";
      }
    }
  });

  assert.equal(result.extractionMethod, "pdf_text");
  assert.equal(result.ocrUsed, false);
  assert.equal(rendered, 0);
  assert.equal(ocrCalled, 0);
});

test("short PDF text calls OCR fallback and returns normalized OCR text", async () => {
  let maxPagesSeen = 0;
  const result = await extractPdfTextWithOcrFallback(Buffer.from("pdf"), {
    minTextLength: 100,
    ocrEnabled: true,
    maxPages: 3,
    deps: {
      extractPdfText: async () => "tiny",
      renderPdfPagesToImages: async (_buf, options) => {
        maxPagesSeen = options.maxPages;
        return [Buffer.from("page1"), Buffer.from("page2")];
      },
      ocrImage: async (img) => (img.toString() === "page1" ? " RJ Schinner \n\n" : "PO289824 \r\n 05/26/26 OUR.TRUCK")
    }
  });

  assert.equal(result.extractionMethod, "ocr");
  assert.equal(result.ocrUsed, true);
  assert.equal(maxPagesSeen, 3);
  assert.equal(result.pagesRendered, 2);
  assert.equal(result.pagesOcrProcessed, 2);
  assert.equal(result.text, "RJ Schinner\n\nPO289824 \n 05/26/26 OUR.TRUCK");
});

test("short PDF text does not OCR when OCR is disabled", async () => {
  let rendered = 0;
  const result = await extractPdfTextWithOcrFallback(Buffer.from("pdf"), {
    minTextLength: 100,
    ocrEnabled: false,
    deps: {
      extractPdfText: async () => "tiny",
      renderPdfPagesToImages: async () => {
        rendered += 1;
        return [];
      },
      ocrImage: async () => ""
    }
  });
  assert.equal(result.text, "tiny");
  assert.equal(result.extractionMethod, "pdf_text");
  assert.equal(result.ocrUsed, false);
  assert.equal(rendered, 0);
});

test("OCR failure with no normal text throws", async () => {
  await assert.rejects(
    () =>
      extractPdfTextWithOcrFallback(Buffer.from("pdf"), {
        minTextLength: 100,
        ocrEnabled: true,
        deps: {
          extractPdfText: async () => "",
          renderPdfPagesToImages: async () => {
            throw new Error("ocr engine unavailable");
          },
          ocrImage: async () => ""
        }
      }),
    /ocr engine unavailable/i
  );
});

test("OCR failure with usable normal text succeeds with pdf_text", async () => {
  const result = await extractPdfTextWithOcrFallback(Buffer.from("pdf"), {
    minTextLength: 100,
    ocrEnabled: true,
    deps: {
      extractPdfText: async () => "short but usable",
      renderPdfPagesToImages: async () => {
        throw new Error("ocr engine unavailable");
      },
      ocrImage: async () => ""
    }
  });

  assert.equal(result.extractionMethod, "pdf_text");
  assert.equal(result.ocrUsed, false);
  assert.equal(result.text, "short but usable");
});

test("RJ Schinner OCR-like text produces expected ETA extraction candidate", () => {
  const ocrText = [
    "RJ Schinner",
    "Acknowledgement",
    "Customer PO: PO289824",
    "Ship Date: 05/26/26",
    "Ship Via: OUR.TRUCK",
    "30359 qty 300",
    "02001 qty 20",
    "30358 qty 100"
  ].join("\n");

  const candidates = extractEtaUpdateCandidates(ocrText, {
    classification: "invoice_with_shipping_signal",
    fileName: "S6509406-0001_3529484.pdf"
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.poNumber, "PO289824");
  assert.equal(candidates[0]?.etaDate, "2026-05-26");
  assert.equal(candidates[0]?.carrier, "RJ_SCHINNER_TRUCK");
  assert.equal(candidates[0]?.appliesToEntirePo, true);
});

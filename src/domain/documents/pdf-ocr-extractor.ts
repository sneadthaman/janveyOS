import { config } from "../../shared/config.js";
import { extractPdfText, normalizeExtractedText } from "./pdf-text-extractor.js";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type PdfExtractionMethod = "pdf_text" | "ocr";

export interface PdfTextWithOcrResult {
  text: string;
  extractionMethod: PdfExtractionMethod;
  ocrUsed: boolean;
  pagesRendered?: number;
  pagesOcrProcessed?: number;
}

interface OcrDeps {
  extractPdfText: (buffer: Buffer) => Promise<string>;
  renderPdfPagesToImages: (buffer: Buffer, options: { maxPages: number }) => Promise<Buffer[]>;
  ocrImage: (image: Buffer) => Promise<string>;
}

async function renderPdfPagesToImagesWithPdfjs(buffer: Buffer, options: { maxPages: number }): Promise<Buffer[]> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as Record<string, unknown>;
  const canvasLib = (await import("@napi-rs/canvas")) as {
    createCanvas: (width: number, height: number) => {
      getContext: (kind: "2d") => unknown;
      toBuffer: (mimeType?: string) => Buffer;
    };
  };

  const getDocument = pdfjs.getDocument as (input: Record<string, unknown>) => { promise: Promise<Record<string, unknown>> };
  if (typeof getDocument !== "function") throw new Error("pdfjs getDocument unavailable");

  const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const wasmUrl = `${pathToFileURL(path.join(pdfjsRoot, "wasm")).toString()}/`;

  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableWorker: true,
    wasmUrl
  });
  const pdf = await loadingTask.promise;
  const numPages = Number((pdf as { numPages?: number }).numPages ?? 0);
  const pageCount = Math.max(0, Math.min(numPages, Math.max(1, options.maxPages)));

  const pageImages: Buffer[] = [];
  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    const page = await ((pdf as { getPage: (n: number) => Promise<Record<string, unknown>> }).getPage(pageNum));
    const viewport = (page as { getViewport: (args: { scale: number }) => { width: number; height: number } }).getViewport({ scale: 2.0 });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    const canvas = canvasLib.createCanvas(width, height);
    const context = canvas.getContext("2d");
    const renderTask = (page as { render: (args: Record<string, unknown>) => { promise: Promise<void> } }).render({
      canvasContext: context,
      viewport
    });
    await renderTask.promise;
    pageImages.push(canvas.toBuffer("image/png"));
  }

  return pageImages;
}

async function ocrImageWithTesseract(image: Buffer): Promise<string> {
  const tesseractModule = (await import("tesseract.js")) as unknown as {
    createWorker: (lang?: string) => Promise<{
      recognize: (source: Buffer) => Promise<{ data?: { text?: string } }>;
      terminate: () => Promise<unknown>;
    }>;
  };

  const worker = await tesseractModule.createWorker("eng");
  try {
    const result = await worker.recognize(image);
    return String(result?.data?.text ?? "");
  } finally {
    await worker.terminate();
  }
}

const defaultDeps: OcrDeps = {
  extractPdfText,
  renderPdfPagesToImages: renderPdfPagesToImagesWithPdfjs,
  ocrImage: ocrImageWithTesseract
};

export async function extractPdfTextWithOcrFallback(
  buffer: Buffer,
  options?: {
    minTextLength?: number;
    ocrEnabled?: boolean;
    maxPages?: number;
    deps?: Partial<OcrDeps>;
  }
): Promise<PdfTextWithOcrResult> {
  const deps: OcrDeps = { ...defaultDeps, ...(options?.deps ?? {}) };
  const minTextLength = options?.minTextLength ?? config.PDF_OCR_MIN_TEXT_LENGTH;
  const ocrEnabled = options?.ocrEnabled ?? config.PDF_OCR_ENABLED;
  const maxPages = options?.maxPages ?? config.PDF_OCR_MAX_PAGES;

  const text = normalizeExtractedText(await deps.extractPdfText(buffer));
  if (text.length >= minTextLength) {
    return { text, extractionMethod: "pdf_text", ocrUsed: false };
  }

  if (!ocrEnabled) {
    return { text, extractionMethod: "pdf_text", ocrUsed: false };
  }

  try {
    const pageImages = await deps.renderPdfPagesToImages(buffer, { maxPages });
    const ocrChunks: string[] = [];
    let pagesOcrProcessed = 0;
    for (const image of pageImages) {
      const chunk = normalizeExtractedText(await deps.ocrImage(image));
      pagesOcrProcessed += 1;
      if (chunk) ocrChunks.push(chunk);
    }
    const ocrText = normalizeExtractedText(ocrChunks.join("\n\n"));
    if (!ocrText) throw new Error("OCR produced no usable text");
    return {
      text: ocrText,
      extractionMethod: "ocr",
      ocrUsed: true,
      pagesRendered: pageImages.length,
      pagesOcrProcessed
    };
  } catch (error) {
    if (text.length > 0) {
      return { text, extractionMethod: "pdf_text", ocrUsed: false };
    }
    throw error;
  }
}

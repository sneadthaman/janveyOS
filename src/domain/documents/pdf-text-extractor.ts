export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = (pdfParseModule.default ?? pdfParseModule) as (dataBuffer: Buffer) => Promise<{ text?: string }>;

  const parsed = await pdfParse(buffer);
  const rawText = String(parsed.text ?? "");

  return normalizeExtractedText(rawText);
}

export function normalizeExtractedText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const normalizedNewlines = trimmed.replace(/\r\n?/g, "\n");
  const collapsedBlankLines = normalizedNewlines.replace(/\n{3,}/g, "\n\n");

  return collapsedBlankLines.trim();
}

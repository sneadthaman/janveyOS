export type DocumentClassification = "eta_update" | "purchase_order" | "quote" | "invoice" | "unknown";

export interface DocumentClassificationResult {
  classification: DocumentClassification;
  confidence: number;
  reasons: string[];
}

const ETA_SIGNALS = [
  /\beta\b/i,
  /estimated delivery/i,
  /expected delivery/i,
  /tracking/i,
  /\bshipped\b/i,
  /delivery date/i
];

const PO_SIGNALS = [/\bpo\s*#?\s*\d{4,}\b/i, /purchase\s+order/i, /customer\s+po/i, /\border\s+number\b/i];

const QUOTE_SIGNALS = [/\bquote\b/i, /\bestimate\b/i, /\best\d+/i];
const INVOICE_SIGNALS = [/\binvoice\b/i, /invoice\s*#?/i];

export function classifyDocumentText(text: string): DocumentClassificationResult {
  const normalized = text.trim();
  if (!normalized) {
    return { classification: "unknown", confidence: 0.1, reasons: ["empty_text"] };
  }

  const reasons: string[] = [];
  const hasEtaSignal = ETA_SIGNALS.some((rx) => {
    const matched = rx.test(normalized);
    if (matched) reasons.push(`eta_signal:${rx.source}`);
    return matched;
  });

  const hasPoSignal = PO_SIGNALS.some((rx) => {
    const matched = rx.test(normalized);
    if (matched) reasons.push(`po_signal:${rx.source}`);
    return matched;
  });

  if (hasEtaSignal && hasPoSignal) {
    return { classification: "eta_update", confidence: 0.92, reasons };
  }

  if (hasEtaSignal) {
    return { classification: "eta_update", confidence: 0.82, reasons };
  }

  if (hasPoSignal) {
    return { classification: "purchase_order", confidence: 0.76, reasons };
  }

  if (QUOTE_SIGNALS.some((rx) => rx.test(normalized))) {
    return { classification: "quote", confidence: 0.72, reasons: [...reasons, "quote_signal"] };
  }

  if (INVOICE_SIGNALS.some((rx) => rx.test(normalized))) {
    return { classification: "invoice", confidence: 0.72, reasons: [...reasons, "invoice_signal"] };
  }

  return { classification: "unknown", confidence: 0.3, reasons: [...reasons, "no_strong_signals"] };
}

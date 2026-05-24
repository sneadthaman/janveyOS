export type DocumentClassification =
  | "eta_update"
  | "customer_purchase_order"
  | "invoice_with_shipping_signal"
  | "purchase_order"
  | "quote"
  | "invoice"
  | "unknown";

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
const SHIPPING_SIGNALS = [/tracking/i, /\bcarrier\b/i, /\bship(?:ped|ping)?\b/i, /\bPRO\s*[A-Z0-9-]{3,}\b/i];
const PO_STRUCTURE_SIGNALS = [/\bship\s+to\b/i, /\bbill\s+to\b/i, /\bitem\b/i, /\buom\b/i, /\bext\.?\s*price\b/i, /\bqty\b/i];
const SUBJECT_PO_SIGNALS = [/purchase\s+order/i, /dispatched\s+purchase\s+order/i, /\bpo\s*#?\s*\d{4,}\b/i];
const CUSTOMER_SENDER_HINTS = [/@nyct\.com$/i, /@northwell\.edu$/i, /@chsli\.org$/i, /@esboces\.org$/i];

export interface DocumentClassificationContext {
  fileName?: string | null;
  sourceSubject?: string | null;
  sourceSender?: string | null;
  sourceFolderHint?: string | null;
}

export function classifyDocumentText(text: string, context?: DocumentClassificationContext): DocumentClassificationResult {
  const normalized = text.trim();
  const fileName = String(context?.fileName ?? "").trim();
  const sourceSubject = String(context?.sourceSubject ?? "").trim();
  const sourceSender = String(context?.sourceSender ?? "").trim();
  const sourceFolderHint = String(context?.sourceFolderHint ?? "").trim().toLowerCase();
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

  const hasInvoiceSignal = INVOICE_SIGNALS.some((rx) => rx.test(normalized));
  const hasShippingSignal = SHIPPING_SIGNALS.some((rx) => rx.test(normalized));
  const subjectHasPoSignal = SUBJECT_PO_SIGNALS.some((rx) => rx.test(sourceSubject));
  const senderHasCustomerHint = CUSTOMER_SENDER_HINTS.some((rx) => rx.test(sourceSender));
  const fileNameHasPoHint = /(?:^|[^a-z0-9])po[_ -]/i.test(fileName) || /purchase\s*order/i.test(fileName);
  const structureSignalCount = PO_STRUCTURE_SIGNALS.reduce((count, rx) => (rx.test(normalized) ? count + 1 : count), 0);
  const hasPoNumberLikeSignal = /\bpo\s*(?:number|#)\s*:?\s*[a-z0-9-]{4,}\b/i.test(normalized);
  const strongPoSignals =
    hasPoSignal ||
    fileNameHasPoHint ||
    subjectHasPoSignal ||
    hasPoNumberLikeSignal ||
    (structureSignalCount >= 2 && hasPoSignal) ||
    (structureSignalCount >= 3 && (fileNameHasPoHint || subjectHasPoSignal));

  if (strongPoSignals && sourceFolderHint === "customer_po") {
    const poReasons = [
      ...reasons,
      fileNameHasPoHint ? "po_signal:file_name_hint" : "",
      subjectHasPoSignal ? "po_signal:subject_hint" : "",
      senderHasCustomerHint ? "po_signal:sender_customer_hint" : "",
      structureSignalCount >= 2 ? "po_signal:po_document_structure" : "",
      "po_signal:customer_po_folder_hint"
    ].filter(Boolean);
    return { classification: "customer_purchase_order", confidence: senderHasCustomerHint ? 0.93 : 0.9, reasons: poReasons };
  }

  if (hasInvoiceSignal && hasShippingSignal) {
    return { classification: "invoice_with_shipping_signal", confidence: 0.78, reasons: [...reasons, "invoice_shipping_signal"] };
  }

  if (hasEtaSignal && hasPoSignal) {
    return { classification: "eta_update", confidence: 0.92, reasons };
  }

  if (hasEtaSignal) {
    return { classification: "eta_update", confidence: 0.82, reasons };
  }

  if (strongPoSignals) {
    return { classification: "purchase_order", confidence: 0.82, reasons: [...reasons, "po_signal:strong_po_context"] };
  }

  if (QUOTE_SIGNALS.some((rx) => rx.test(normalized))) {
    return { classification: "quote", confidence: 0.72, reasons: [...reasons, "quote_signal"] };
  }

  if (hasInvoiceSignal) {
    return { classification: "invoice", confidence: 0.72, reasons: [...reasons, "invoice_signal"] };
  }

  return { classification: "unknown", confidence: 0.3, reasons: [...reasons, "no_strong_signals"] };
}

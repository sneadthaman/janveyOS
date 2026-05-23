import type { EtaUpdateScope, NormalizedEtaUpdate } from "./eta-update-types.js";

const MONTHS = new Map<string, number>([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12]
]);

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function normalizeDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function extractPoNumber(text: string) {
  const match = text.match(/\bPO\s*-?\s*(\d{3,20})\b/i);
  if (!match?.[1]) return null;
  return `PO${match[1]}`;
}

function extractTrackingNumber(text: string) {
  const trackingKeyword = text.match(/\btracking\s*[:#-]?\s*([A-Za-z0-9-]{4,40})\b/i);
  if (trackingKeyword?.[1]) return trackingKeyword[1].toUpperCase();

  const proKeyword = text.match(/\bPRO\s*[:#-]?\s*([A-Za-z0-9-]{2,40})\b/i);
  if (proKeyword?.[1]) return `PRO${proKeyword[1].replace(/^PRO/i, "").toUpperCase()}`;
  return null;
}

function extractEtaDate(text: string) {
  const currentYear = new Date().getFullYear();

  const slashOrDash = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (slashOrDash) {
    const month = Number(slashOrDash[1]);
    const day = Number(slashOrDash[2]);
    const yearRaw = slashOrDash[3];
    const year = yearRaw ? (yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw)) : currentYear;
    return normalizeDate(year, month, day);
  }

  const monthName = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?\b/);
  if (monthName) {
    const month = MONTHS.get(monthName[1].toLowerCase());
    const day = Number(monthName[2]);
    const year = monthName[3] ? Number(monthName[3]) : currentYear;
    if (!month) return null;
    return normalizeDate(year, month, day);
  }

  return null;
}

function extractVendorName(text: string) {
  const trimmed = text.trim();

  const saysMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9&\- ]{1,60}?)\s+says\b/i);
  if (saysMatch?.[1]) return saysMatch[1].trim();

  const poMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9&\- ]{1,60}?)\s+PO\s*-?\s*\d{3,20}\b/i);
  if (poMatch?.[1]) return poMatch[1].trim();

  return null;
}

function extractScope(text: string): EtaUpdateScope {
  if (/\b(all lines|whole po|entire po)\b/i.test(text)) return "po_all_lines";
  return "unknown";
}

function computeConfidence(input: { hasPo: boolean; hasEta: boolean; hasVendor: boolean; hasTracking: boolean }) {
  if (!input.hasPo || !input.hasEta) return 0.0;
  if (input.hasVendor && input.hasTracking) return 0.95;
  if (input.hasVendor) return 0.85;
  if (input.hasTracking) return 0.8;
  return 0.7;
}

export function parseSlackEtaUpdate(text: string): NormalizedEtaUpdate | null {
  const poNumber = extractPoNumber(text);
  const etaDate = extractEtaDate(text);
  const vendorName = extractVendorName(text);
  const trackingNumber = extractTrackingNumber(text);
  const updateScope = extractScope(text);

  const confidence = computeConfidence({
    hasPo: Boolean(poNumber),
    hasEta: Boolean(etaDate),
    hasVendor: Boolean(vendorName),
    hasTracking: Boolean(trackingNumber)
  });

  if (!poNumber || !etaDate || confidence < 0.7) return null;

  const now = new Date().toISOString();
  return {
    id: "",
    vendorName: vendorName ?? "Unknown",
    poNumber,
    netsuitePoInternalId: null,
    itemNumber: null,
    netsuiteItemInternalId: null,
    etaDate,
    trackingNumber,
    updateScope,
    sourceType: "slack",
    sourceReference: null,
    rawNotes: text,
    confidence,
    status: "parsed",
    createdActionRequestId: null,
    createdAt: now,
    updatedAt: now
  };
}

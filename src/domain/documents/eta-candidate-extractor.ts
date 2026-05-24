export interface EtaUpdateCandidate {
  poNumber: string | null;
  etaDate: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  itemNumber: string | null;
  appliesToEntirePo: boolean;
  confidence: number;
  rawContext: string;
}

interface ExtractorOptions {
  now?: Date;
}

const PO_REGEX = [
  /\bPO\s*#?\s*(\d{4,})\b/i,
  /\bPurchase\s+Order\s*#?\s*(\d{4,})\b/i,
  /\bCustomer\s+PO\s*:?\s*(\d{4,})\b/i
];

const ITEM_REGEX = [/\bDIV\s+(\d{4,})\b/i, /\bitem\s*:?\s*([A-Z0-9-]{4,})\b/i, /\bsku\s*:?\s*([A-Z0-9-]{4,})\b/i];
const TRACKING_REGEX = [/\btracking\s*(?:#|number|num|no\.?)*\s*:?\s*([A-Z0-9-]{6,})\b/i, /\bPRO\s*([A-Z0-9-]{3,})\b/i];
const CARRIER_REGEX = [/\bUPS\b/i, /\bFedEx\b/i, /\bDHL\b/i, /\bUSPS\b/i, /\bXPO\b/i, /\bOld\s+Dominion\b/i];

const ENTIRE_PO_REGEX = [/entire\s+po/i, /all\s+items/i, /complete\s+order/i, /full\s+po/i, /bring\s+po\s*\d{4,}\s+on/i];

function toIsoDate(raw: string, now: Date): string | null {
  const monthName = raw.match(/\b(Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+(\d{1,2})(?:,\s*(\d{4}))?/i);
  if (monthName) {
    const monthMap: Record<string, number> = {
      jan: 1,
      january: 1,
      feb: 2,
      february: 2,
      mar: 3,
      march: 3,
      apr: 4,
      april: 4,
      may: 5,
      jun: 6,
      june: 6,
      jul: 7,
      july: 7,
      aug: 8,
      august: 8,
      sep: 9,
      sept: 9,
      september: 9,
      oct: 10,
      october: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12
    };
    const month = monthMap[monthName[1].toLowerCase()];
    const day = Number(monthName[2]);
    const year = monthName[3] ? Number(monthName[3]) : now.getFullYear();
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  }

  const short = raw.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (!short) return null;

  const month = Number(short[1]);
  const day = Number(short[2]);
  let year = short[3] ? Number(short[3]) : now.getFullYear();
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function findFirst(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    if (match[1]) return match[1].trim();
    return match[0].trim();
  }
  return null;
}

function normalizePoNumber(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return null;
  return `PO${digits}`;
}

function normalizeItemNumber(value: string | null): string | null {
  if (!value) return null;
  return value.trim().toUpperCase();
}

export function extractEtaUpdateCandidates(text: string, options?: ExtractorOptions): EtaUpdateCandidate[] {
  const now = options?.now ?? new Date();
  const raw = text.trim();
  if (!raw) return [];

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates: EtaUpdateCandidate[] = [];

  const po = normalizePoNumber(findFirst(raw, PO_REGEX));
  const dateRaw = findFirst(raw, [
    /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/,
    /\b(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+\d{1,2}(?:,\s*\d{4})?/i
  ]);
  const etaDate = dateRaw ? toIsoDate(dateRaw, now) : null;
  const tracking = findFirst(raw, TRACKING_REGEX)?.toUpperCase() ?? null;
  const carrierRaw = findFirst(raw, CARRIER_REGEX);
  const carrier = carrierRaw ? carrierRaw.toUpperCase() : null;
  const item = normalizeItemNumber(findFirst(raw, ITEM_REGEX));
  const appliesToEntirePo = ENTIRE_PO_REGEX.some((rx) => rx.test(raw));

  const confidence = (() => {
    let score = 0.5;
    if (po) score += 0.2;
    if (etaDate) score += 0.2;
    if (tracking) score += 0.05;
    if (item) score += 0.05;
    if (appliesToEntirePo) score += 0.05;
    return Math.min(score, 0.99);
  })();

  if (po || etaDate || tracking || item) {
    candidates.push({
      poNumber: po,
      etaDate,
      trackingNumber: tracking,
      carrier,
      itemNumber: item,
      appliesToEntirePo,
      confidence,
      rawContext: lines.slice(0, 6).join("\n")
    });
  }

  return candidates;
}

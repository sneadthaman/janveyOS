import { lookupEtaByPoNumber, type EtaLookupResult } from "../../actions/eta-update/eta-lookup-service.js";
import { formatEtaLookupResponse } from "./eta-lookup-response.js";

const LOOKUP_PATTERNS = [
  /\beta\s+(?:for\s+)?(PO\d+)\b/i,
  /what(?:'s| is)?\s+the\s+eta\s+(?:of|for)?\s*(PO\d+)\b/i,
  /when\s+is\s+(PO\d+)\s+(?:coming|arriving|due)\b/i,
  /status\s+(PO\d+)\b/i
];
const UPDATE_INTENT_PATTERN = /\b(update|set|change)\s+eta\b/i;

function extractLookupPoNumber(text: string): string | null {
  for (const pattern of LOOKUP_PATTERNS) {
    const m = text.match(pattern);
    if (m?.[1]) return m[1].toUpperCase();
  }
  return null;
}

function isEtaLookupIntent(text: string): boolean {
  if (UPDATE_INTENT_PATTERN.test(text)) return false;
  return Boolean(extractLookupPoNumber(text));
}

export function debugExtractEtaIntent(text: string) {
  return {
    text,
    poNumber: extractLookupPoNumber(text),
    matched: isEtaLookupIntent(text)
  };
}

type EtaQueryDependencies = {
  lookupEtaByPoNumber: (poNumber: string) => Promise<EtaLookupResult>;
};

const defaultDependencies: EtaQueryDependencies = {
  lookupEtaByPoNumber
};

export async function handleEtaSlackQuery(
  input: {
    text: string;
    reply: (message: string) => Promise<void>;
  },
  dependencies: EtaQueryDependencies = defaultDependencies
): Promise<boolean> {
  if (!isEtaLookupIntent(input.text)) return false;

  const poNumber = extractLookupPoNumber(input.text);
  if (!poNumber) return false;

  const result = await dependencies.lookupEtaByPoNumber(poNumber);
  await input.reply(formatEtaLookupResponse(result));
  return true;
}


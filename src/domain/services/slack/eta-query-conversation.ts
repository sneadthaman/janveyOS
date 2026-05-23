import { findEtaUpdatesByPoNumber } from "../../actions/eta-update/eta-update-repository.js";
import type { NormalizedEtaUpdate } from "../../actions/eta-update/eta-update-types.js";

export function extractEtaPoNumber(text: string) {
  const match = text.match(/\bPO\s*-?\s*(\d{3,20})\b/i);
  if (!match?.[1]) return null;
  return `PO${match[1]}`;
}

function isEtaQueryIntent(text: string) {
  const lower = text.toLowerCase();
  const hasEtaPhrase = /(what'?s\s+the\s+eta|any\s+updates\s+on|show\s+eta\s+for|eta\s+on|eta\s+for)/i.test(lower);
  return hasEtaPhrase && Boolean(extractEtaPoNumber(text));
}

function formatEtaLine(update: NormalizedEtaUpdate) {
  const eta = update.etaDate ?? "unknown";
  const vendor = update.vendorName || "Unknown vendor";
  const item = update.itemNumber ? `item ${update.itemNumber}` : "all items";
  const scope = update.updateScope;
  const notes = update.rawNotes ? ` | Notes: ${update.rawNotes}` : "";
  return `- ETA ${eta} (${vendor}, ${item}, scope: ${scope}, status: ${update.status})${notes}`;
}

export function debugExtractEtaIntent(text: string) {
  return {
    text,
    poNumber: extractEtaPoNumber(text),
    matched: isEtaQueryIntent(text)
  };
}

type EtaQueryDependencies = {
  findEtaUpdatesByPoNumber: typeof findEtaUpdatesByPoNumber;
};

const defaultDependencies: EtaQueryDependencies = {
  findEtaUpdatesByPoNumber
};

export async function handleEtaSlackQuery(input: {
  text: string;
  reply: (message: string) => Promise<void>;
}, dependencies: EtaQueryDependencies = defaultDependencies): Promise<boolean> {
  if (!isEtaQueryIntent(input.text)) return false;

  const poNumber = extractEtaPoNumber(input.text);
  if (!poNumber) return false;

  const updates = await dependencies.findEtaUpdatesByPoNumber(poNumber);
  if (updates.length === 0) {
    await input.reply(`No local ETA updates found yet for ${poNumber}.`);
    return true;
  }

  const latest = updates[0];
  const summaryLines = updates.slice(0, 5).map(formatEtaLine).join("\n");
  await input.reply(
    `ETA updates for ${poNumber}:\nLatest update: ${latest.etaDate ?? "unknown"} (${latest.vendorName}).\n${summaryLines}`
  );
  return true;
}

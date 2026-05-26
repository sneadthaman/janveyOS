import type { EtaLookupResult } from "../../actions/eta-update/eta-lookup-service.js";

function formatDate(dateIso: string | null): string {
  if (!dateIso) return "-";
  const match = dateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateIso;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return `${month}/${day}/${year}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  const h24 = date.getHours();
  const hour = h24 % 12 || 12;
  const minute = date.getMinutes().toString().padStart(2, "0");
  const ampm = h24 >= 12 ? "PM" : "AM";
  return `${month}/${day}/${year} ${hour}:${minute} ${ampm}`;
}

export function formatEtaLookupResponse(result: EtaLookupResult): string {
  if (result.kind === "not_found") {
    return `I don’t have an ETA for ${result.poNumber} yet.`;
  }

  if (result.kind === "pending_review") {
    return (
      `:hourglass_flowing_sand: ETA for ${result.poNumber} is pending review\n` +
      `• Proposed ETA: ${formatDate(result.etaDate)}\n` +
      `• Confidence: ${result.confidence ?? "-"}\n` +
      `• Tracking: ${result.trackingNumber ?? "-"}\n` +
      `• Source: ${result.source ?? "document_review"}\n` +
      `• Status: ${result.status === "approved" ? "approved queued" : "awaiting approval"}\n` +
      `• Last updated: ${formatTimestamp(result.lastUpdatedAt)}`
    );
  }

  return (
    `:white_check_mark: ETA for ${result.poNumber}\n` +
    `• Expected ETA: ${formatDate(result.etaDate)}\n` +
    `• Confidence: ${result.confidence ?? "-"}\n` +
    `• Tracking: ${result.trackingNumber ?? "-"}\n` +
    `• Source: ${result.source ?? "-"}\n` +
    `• Updated lines: ${typeof result.updatedLines === "number" ? result.updatedLines : "-"}\n` +
    `• Last updated: ${formatTimestamp(result.lastUpdatedAt)}`
  );
}


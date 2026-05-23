export type EtaUpdateScope = "po_all_lines" | "po_line" | "item_global" | "unknown";

export type EtaUpdateSourceType = "slack" | "email" | "pdf" | "portal" | "manual";

export type EtaUpdateStatus = "parsed" | "matched" | "needs_review" | "approved" | "applied" | "rejected" | "superseded";

export interface NormalizedEtaUpdate {
  id: string;
  vendorName: string;
  poNumber: string | null;
  netsuitePoInternalId: string | null;
  itemNumber: string | null;
  netsuiteItemInternalId: string | null;
  etaDate: string | null;
  trackingNumber: string | null;
  updateScope: EtaUpdateScope;
  sourceType: EtaUpdateSourceType;
  sourceReference: string | null;
  rawNotes: string | null;
  confidence: number | null;
  status: EtaUpdateStatus;
  createdActionRequestId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EtaUpdateMatchResult {
  matched: boolean;
  reason?: string;
  poNumber?: string;
  netsuitePoInternalId?: string;
  itemNumber?: string;
  netsuiteItemInternalId?: string;
  confidence?: number;
}

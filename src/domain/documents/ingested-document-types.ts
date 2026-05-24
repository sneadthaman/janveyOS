export type IngestedDocumentSource = "email_attachment" | "email_body" | "slack_upload" | "manual_upload" | "other";

export type ExtractionStatus = "pending" | "completed" | "failed";

export type DocumentType =
  | "unknown"
  | "eta_update"
  | "customer_purchase_order"
  | "invoice_with_shipping_signal"
  | "purchase_order"
  | "quote"
  | "invoice"
  | "other";

export interface CreateIngestedDocumentInput {
  source: IngestedDocumentSource;
  sourceMessageId?: string | null;
  sourceThreadId?: string | null;
  sourceSender?: string | null;
  sourceSubject?: string | null;
  sourceMailbox?: string | null;
  sourceFolder?: string | null;
  sourceFolderHint?: string | null;
  sourceReceivedAt?: string | null;
  routedByMessageId?: string | null;
  routedBySubject?: string | null;
  routedBySender?: string | null;
  fileName: string;
  mimeType?: string;
  fileSizeBytes?: number | null;
  storagePath?: string | null;
  sha256Hash?: string | null;
  extractedText?: string | null;
  extractionStatus?: ExtractionStatus;
  extractionError?: string | null;
  documentType?: DocumentType | null;
  classificationMismatch?: boolean;
  needsManualTriage?: boolean;
}

export interface IngestedDocument {
  id: string;
  source: IngestedDocumentSource;
  sourceMessageId: string | null;
  sourceThreadId: string | null;
  sourceSender: string | null;
  sourceSubject: string | null;
  sourceMailbox: string | null;
  sourceFolder: string | null;
  sourceFolderHint: string | null;
  sourceReceivedAt: string | null;
  routedByMessageId: string | null;
  routedBySubject: string | null;
  routedBySender: string | null;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number | null;
  storagePath: string | null;
  sha256Hash: string | null;
  extractedText: string | null;
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  documentType: DocumentType | null;
  classificationMismatch: boolean;
  needsManualTriage: boolean;
  createdAt: string;
  updatedAt: string;
}

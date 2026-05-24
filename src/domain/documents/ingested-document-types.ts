export type IngestedDocumentSource = "email_attachment" | "slack_upload" | "manual_upload" | "other";

export type ExtractionStatus = "pending" | "completed" | "failed";

export type DocumentType = "unknown" | "eta_update" | "purchase_order" | "quote" | "invoice" | "other";

export interface CreateIngestedDocumentInput {
  source: IngestedDocumentSource;
  sourceMessageId?: string | null;
  sourceThreadId?: string | null;
  sourceSender?: string | null;
  sourceSubject?: string | null;
  fileName: string;
  mimeType?: string;
  fileSizeBytes?: number | null;
  storagePath?: string | null;
  sha256Hash?: string | null;
  extractedText?: string | null;
  extractionStatus?: ExtractionStatus;
  extractionError?: string | null;
  documentType?: DocumentType | null;
}

export interface IngestedDocument {
  id: string;
  source: IngestedDocumentSource;
  sourceMessageId: string | null;
  sourceThreadId: string | null;
  sourceSender: string | null;
  sourceSubject: string | null;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number | null;
  storagePath: string | null;
  sha256Hash: string | null;
  extractedText: string | null;
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  documentType: DocumentType | null;
  createdAt: string;
  updatedAt: string;
}

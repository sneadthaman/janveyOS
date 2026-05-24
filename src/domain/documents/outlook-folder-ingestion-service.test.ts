import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../shared/config.js";
import { ingestCustomerPoFolderWithDeps, scanCustomerPoFolderDryRunWithDeps } from "./outlook-folder-ingestion-service.js";

function withOutlookConfig(fn: () => Promise<void>, overrides?: { enabled?: boolean; mailbox?: string; folder?: string; max?: number }) {
  const prevEnabled = config.OUTLOOK_INGESTION_ENABLED;
  const prevMailbox = config.OUTLOOK_MAILBOX;
  const prevFolder = config.OUTLOOK_CUSTOMER_PO_FOLDER_NAME;
  const prevMax = config.OUTLOOK_MAX_MESSAGES;

  config.OUTLOOK_INGESTION_ENABLED = overrides?.enabled ?? true;
  config.OUTLOOK_MAILBOX = overrides?.mailbox ?? "sam@example.com";
  config.OUTLOOK_CUSTOMER_PO_FOLDER_NAME = overrides?.folder ?? "AI Cust PO";
  config.OUTLOOK_MAX_MESSAGES = overrides?.max ?? 10;

  return fn().finally(() => {
    config.OUTLOOK_INGESTION_ENABLED = prevEnabled;
    config.OUTLOOK_MAILBOX = prevMailbox;
    config.OUTLOOK_CUSTOMER_PO_FOLDER_NAME = prevFolder;
    config.OUTLOOK_MAX_MESSAGES = prevMax;
  });
}

function baseDeps() {
  return {
    findMailFolderByDisplayName: async () => ({ id: "f1", displayName: "AI Cust PO" }),
    listMessagesInFolder: async () => [
      {
        id: "m-route",
        subject: "Dispatched Purchase Order #6030",
        sender: "buyer@nyct.com",
        receivedDateTime: "2026-05-24T00:00:00Z",
        conversationId: "conv-1",
        hasAttachments: false,
        bodyPreview: "Purchase Order PO Number 6030",
        bodyText: "Purchase Order\nPO Number 6030\nShip To\nItem\nQty",
        bodyHtml: null
      }
    ],
    listMessagesByConversationId: async () => [],
    listMessageAttachments: async () => [],
    downloadFileAttachment: async () => Buffer.from("pdf"),
    ingestPdfDocument: async () => ({ id: "doc-1", extractionStatus: "completed" }) as any,
    ingestTextDocument: async () => ({ document: { id: "body-1", extractionStatus: "completed" }, status: "ingested" }) as any,
    processIngestedDocument: async () => ({ extraction: { classification: "customer_purchase_order" } }) as any,
    updateMetadataById: async () => ({ id: "doc-1" }) as any
  } as any;
}

test("thread scan finds PDF on earlier message in same conversation", async () => {
  await withOutlookConfig(async () => {
    const deps: any = baseDeps();
    deps.listMessagesByConversationId = async () => [
      {
        id: "m-earlier",
        subject: "Original PO",
        sender: "buyer@nyct.com",
        receivedDateTime: "2026-05-23T00:00:00Z",
        conversationId: "conv-1",
        hasAttachments: true,
        bodyPreview: null,
        bodyText: null,
        bodyHtml: null
      }
    ] as any;
    deps.listMessageAttachments = async (_mb: string, msgId: string) =>
      msgId === "m-earlier" ? ([{ id: "a1", name: "po.pdf", contentType: "application/pdf", size: 12, isInline: false }] as any) : ([] as any);

    const result = await scanCustomerPoFolderDryRunWithDeps({ includeThread: true, includeBody: false }, deps as any);
    assert.equal(result.pdfAttachmentCount, 1);
    assert.equal(result.pdfFoundViaThread, 1);
    assert.equal(result.threadScanErrors, 0);
  });
});

test("thread fetch failure is handled and direct message processing continues", async () => {
  await withOutlookConfig(async () => {
    const deps: any = baseDeps();
    deps.listMessagesByConversationId = async () => {
      throw new Error("The restriction or sort order is too complex for this operation.");
    };
    deps.listMessageAttachments = async (_mb: string, msgId: string) =>
      msgId === "m-route" ? ([{ id: "a1", name: "po.pdf", contentType: "application/pdf", size: 12, isInline: false }] as any) : ([] as any);

    const dryRun = await scanCustomerPoFolderDryRunWithDeps({ includeThread: true, includeBody: false }, deps);
    assert.equal(dryRun.threadScanErrors, 1);
    assert.equal(dryRun.pdfAttachmentCount, 1);
    assert.equal(dryRun.pdfFoundDirect, 1);

    const ingest = await ingestCustomerPoFolderWithDeps({ includeThread: true, includeBody: false }, deps);
    assert.equal(ingest.threadScanErrors, 1);
    assert.equal(ingest.documents.length, 1);
    assert.equal(ingest.documents[0]?.status, "ingested");
  });
});

test("duplicate thread attachment does not produce duplicate document rows in output", async () => {
  await withOutlookConfig(async () => {
    const deps: any = baseDeps();
    deps.listMessagesByConversationId = async () => [
      {
        id: "m-earlier",
        subject: "Original PO",
        sender: "buyer@nyct.com",
        receivedDateTime: "2026-05-23T00:00:00Z",
        conversationId: "conv-1",
        hasAttachments: true,
        bodyPreview: null,
        bodyText: null,
        bodyHtml: null
      }
    ] as any;
    deps.listMessageAttachments = async (_mb: string, msgId: string) =>
      msgId === "m-earlier" ? ([{ id: "a1", name: "po.pdf", contentType: "application/pdf", size: 12, isInline: false }] as any) : ([] as any);
    let first = true;
    deps.ingestPdfDocument = async () => {
      if (first) {
        first = false;
        return { id: "doc-1", extractionStatus: "completed" } as any;
      }
      return { id: "doc-1", extractionStatus: "completed" } as any;
    };

    const result = await ingestCustomerPoFolderWithDeps({ includeThread: true, includeBody: false }, deps as any);
    assert.equal(result.documents.length, 1);
  });
});

test("email body with PO signals creates email_body ingested document", async () => {
  await withOutlookConfig(async () => {
    const deps: any = baseDeps();
    deps.listMessageAttachments = async () => [] as any;
    let bodyCalls = 0;
    deps.ingestTextDocument = async () => {
      bodyCalls += 1;
      return { document: { id: "body-1", extractionStatus: "completed" }, status: "ingested" } as any;
    };

    const result = await ingestCustomerPoFolderWithDeps({ includeThread: false, includeBody: true }, deps as any);
    assert.equal(bodyCalls, 1);
    assert.equal(result.documents[0]?.sourceType, "email_body");
  });
});

test("automatic reply without strong PO content is skipped", async () => {
  await withOutlookConfig(async () => {
    const deps: any = baseDeps();
    deps.listMessagesInFolder = async () => [
      {
        id: "m-auto",
        subject: "Automatic reply: out of office",
        sender: "buyer@nyct.com",
        receivedDateTime: "2026-05-24T00:00:00Z",
        conversationId: "conv-1",
        hasAttachments: false,
        bodyPreview: "Thanks",
        bodyText: "I am out of office",
        bodyHtml: null
      }
    ] as any;
    let bodyCalls = 0;
    deps.ingestTextDocument = async () => {
      bodyCalls += 1;
      return { document: { id: "body-1", extractionStatus: "completed" }, status: "ingested" } as any;
    };

    const result = await ingestCustomerPoFolderWithDeps({ includeThread: false, includeBody: true }, deps as any);
    assert.equal(bodyCalls, 0);
    assert.equal(result.skippedAutoReplies, 1);
  });
});

test("no-thread flag only scans direct message attachments", async () => {
  await withOutlookConfig(async () => {
    const deps: any = baseDeps();
    let threadCalls = 0;
    deps.listMessagesByConversationId = async () => {
      threadCalls += 1;
      return [] as any;
    };
    deps.listMessageAttachments = async () => [{ id: "a1", name: "po.pdf", contentType: "application/pdf", size: 12, isInline: false }] as any;

    await scanCustomerPoFolderDryRunWithDeps({ includeThread: false, includeBody: false }, deps as any);
    assert.equal(threadCalls, 0);
  });
});

test("no-body flag disables body fallback", async () => {
  await withOutlookConfig(async () => {
    const deps: any = baseDeps();
    deps.listMessageAttachments = async () => [] as any;
    let bodyCalls = 0;
    deps.ingestTextDocument = async () => {
      bodyCalls += 1;
      return { document: { id: "body-1", extractionStatus: "completed" }, status: "ingested" } as any;
    };

    await ingestCustomerPoFolderWithDeps({ includeThread: false, includeBody: false }, deps as any);
    assert.equal(bodyCalls, 0);
  });
});

test("routedBy/source metadata is stored correctly", async () => {
  await withOutlookConfig(async () => {
    const deps: any = baseDeps();
    deps.listMessagesByConversationId = async () => [
      {
        id: "m-src",
        subject: "Earlier with attachment",
        sender: "buyer@nyct.com",
        receivedDateTime: "2026-05-23T00:00:00Z",
        conversationId: "conv-1",
        hasAttachments: true,
        bodyPreview: null,
        bodyText: null,
        bodyHtml: null
      }
    ] as any;
    deps.listMessageAttachments = async (_mb: string, msgId: string) =>
      msgId === "m-src" ? ([{ id: "a1", name: "po.pdf", contentType: "application/pdf", size: 12, isInline: false }] as any) : ([] as any);

    let captured: Record<string, unknown> = {};
    deps.ingestPdfDocument = async (input: Record<string, unknown>) => {
      captured = input;
      return { id: "doc-1", extractionStatus: "completed" } as any;
    };

    await ingestCustomerPoFolderWithDeps({ includeThread: true, includeBody: false }, deps as any);
    assert.equal(captured.sourceMessageId, "m-src");
    assert.equal(captured.sourceThreadId, "conv-1");
    assert.equal(captured.routedByMessageId, "m-route");
    assert.equal(captured.routedBySubject, "Dispatched Purchase Order #6030");
    assert.equal(captured.routedBySender, "buyer@nyct.com");
  });
});

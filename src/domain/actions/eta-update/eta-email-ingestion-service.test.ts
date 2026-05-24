import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../../shared/config.js";
import { processEtaGraphMessage, runEtaOutlookIngestionOnce } from "./eta-email-ingestion-service.js";

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    findMailFolderByDisplayName: async () => ({ id: "folder-1", displayName: "AI ETA" }),
    listMessagesInFolder: async () => [],
    listMessageAttachments: async () => [],
    downloadFileAttachment: async () => Buffer.from(""),
    extractPdfText: async () => "",
    findEtaEmailIngestionByGraphMessageId: async () => null,
    createEtaEmailIngestion: async () => ({ id: "ing-1", extracted_payload: null }),
    updateEtaEmailIngestion: async (_input: Record<string, unknown>) => ({ id: "ing-1", extracted_payload: null }),
    extractEtaPayloadFromEmail: async () => ({
      poNumber: "PO289731",
      etaDate: "2026-05-29",
      trackingNumber: "PRO123",
      vendorName: "Diversey",
      items: [],
      confidence: "HIGH",
      etaSource: "email",
      etaNotes: "parsed"
    }),
    lookupOpenPurchaseOrder: async () => ({ success: true, poInternalId: "9001", poNumber: "PO289731", lines: [] }),
    createEtaUpdate: async () => ({
      id: "eta-1",
      vendorName: "Diversey",
      poNumber: "PO289731",
      netsuitePoInternalId: "9001",
      itemNumber: null,
      netsuiteItemInternalId: null,
      etaDate: "2026-05-29",
      trackingNumber: "PRO123",
      updateScope: "po_all_lines",
      sourceType: "email",
      sourceReference: null,
      rawNotes: null,
      confidence: 0.95,
      status: "parsed",
      createdActionRequestId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }),
    findLatestEtaUpdateActionRequestByEtaId: async () => null,
    findExistingEtaUpdateActionRequest: async () => null,
    createAgentActionRequest: async () => "req-eta-1",
    attachActionRequestToEtaUpdate: async () => undefined,
    notifyEtaUpdateApprovalRequested: async () => undefined,
    postSlackMessage: async () => undefined,
    ...overrides
  };
}

test("skips already processed graph message id", async () => {
  const result = await processEtaGraphMessage(
    { id: "m1", subject: "ETA" },
    "AI ETA",
    baseDeps({
      findEtaEmailIngestionByGraphMessageId: async () => ({ id: "ing-existing" })
    }) as any
  );

  assert.equal(result.status, "skipped");
});

test("fails gracefully when no PO number extracted", async () => {
  const result = await processEtaGraphMessage(
    { id: "m2", subject: "ETA", bodyText: "no po here" },
    "AI ETA",
    baseDeps({
      extractEtaPayloadFromEmail: async () => ({
        poNumber: null,
        etaDate: "2026-05-29",
        trackingNumber: null,
        vendorName: "Diversey",
        items: [],
        confidence: "LOW",
        etaSource: "email",
        etaNotes: ""
      })
    }) as any
  );

  assert.equal(result.status, "skipped");
  assert.equal((result as { reason?: string }).reason, "no_eta_found");
});

test("fails gracefully when open PO lookup not found", async () => {
  const result = await processEtaGraphMessage(
    { id: "m3", subject: "ETA" },
    "AI ETA",
    baseDeps({
      lookupOpenPurchaseOrder: async () => ({ success: false, code: "NOT_FOUND", message: "not found", lines: [] })
    }) as any
  );

  assert.equal(result.status, "failed");
  assert.equal((result as { reason?: string }).reason, "po_not_found");
});

test("creates approval request when extraction and lookup succeed", async () => {
  let createdRequest = 0;
  const result = await processEtaGraphMessage(
    {
      id: "m4",
      subject: "Diversey ETA",
      sender: "vendor@example.com",
      bodyText: "PO289731 ETA 5/29 tracking PRO123",
      internetMessageId: "<id@example.com>",
      receivedDateTime: "2026-05-23T12:00:00Z"
    },
    "AI ETA",
    baseDeps({
      createAgentActionRequest: async () => {
        createdRequest += 1;
        return "req-eta-2";
      }
    }) as any
  );

  assert.equal(result.status, "approval_created");
  assert.equal(createdRequest, 1);
});

test("ingestion proceeds when PO lookup returns RESTlet status/data schema", async () => {
  let createdRequest = 0;
  const result = await processEtaGraphMessage(
    {
      id: "m8",
      subject: "ETA",
      bodyText: "PO289807 ETA 6/2"
    },
    "AI ETA",
    baseDeps({
      extractEtaPayloadFromEmail: async () => ({
        poNumber: "PO289807",
        etaDate: "2026-06-02",
        trackingNumber: null,
        vendorName: "Diversey",
        items: [],
        confidence: "HIGH",
        etaSource: "email",
        etaNotes: "note"
      }),
      lookupOpenPurchaseOrder: async () =>
        ({
          status: true,
          message: "Open PO found",
          data: {
            poInternalId: "9002",
            tranId: "PO289807",
            vendorName: "Diversey",
            status: "Pending Receipt",
            lines: []
          }
        }) as any,
      createAgentActionRequest: async () => {
        createdRequest += 1;
        return "req-eta-3";
      }
    }) as any
  );

  assert.equal(result.status, "approval_created");
  assert.equal(createdRequest, 1);
});

test("PO lookup validation sends payload as { po: extracted.poNumber }", async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  await processEtaGraphMessage(
    {
      id: "m7",
      subject: "ETA",
      bodyText: "PO289807 ETA 6/1"
    },
    "AI ETA",
    baseDeps({
      extractEtaPayloadFromEmail: async () => ({
        poNumber: "PO289807",
        etaDate: "2026-06-01",
        trackingNumber: null,
        vendorName: "Vendor",
        items: [],
        confidence: "HIGH",
        etaSource: "email",
        etaNotes: "note"
      }),
      lookupOpenPurchaseOrder: async (input: { po: string }) => {
        capturedPayload = input as unknown as Record<string, unknown>;
        return { success: true, poInternalId: "9010", poNumber: "PO289807", lines: [] };
      }
    }) as any
  );

  assert.deepEqual(capturedPayload, { po: "PO289807" });
});

test("run ingestion processes copied/read messages in AI ETA folder", async () => {
  const prevEnabled = config.MICROSOFT_GRAPH_ENABLED;
  const prevUser = config.MICROSOFT_GRAPH_USER_EMAIL;
  const prevFolder = config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME;
  config.MICROSOFT_GRAPH_ENABLED = true;
  config.MICROSOFT_GRAPH_USER_EMAIL = "ops@example.com";
  config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME = "AI ETA";

  try {
    const summary = await runEtaOutlookIngestionOnce(
      baseDeps({
        listMessagesInFolder: async () => [
          { id: "m5", subject: "ETA A", bodyText: "PO289731 ETA 5/29" },
          { id: "m6", subject: "ETA B", bodyText: "PO289731 ETA 5/30" }
        ]
      }) as any
    );
    assert.equal(summary.enabled, true);
    assert.equal(summary.folderFound, true);
    assert.equal(summary.totalMessages, 2);
  } finally {
    config.MICROSOFT_GRAPH_ENABLED = prevEnabled;
    config.MICROSOFT_GRAPH_USER_EMAIL = prevUser;
    config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME = prevFolder;
  }
});

test("duplicate email ingestion does not create duplicate approval cards when active request exists", async () => {
  let createActionCalls = 0;
  const result = await processEtaGraphMessage(
    {
      id: "m9",
      subject: "ETA duplicate",
      bodyText: "PO289807 ETA 6/2"
    },
    "AI ETA",
    baseDeps({
      findExistingEtaUpdateActionRequest: async () =>
        ({
          id: "req-existing",
          status: "pending"
        }) as any,
      createAgentActionRequest: async () => {
        createActionCalls += 1;
        return "req-eta-new";
      }
    }) as any
  );

  assert.equal(result.status, "approval_created");
  assert.equal(createActionCalls, 0);
});

test("body-only ETA email still works", async () => {
  let calls = 0;
  const result = await processEtaGraphMessage(
    { id: "m10", subject: "ETA", bodyText: "PO289731 ETA 5/29 tracking PRO123" },
    "AI ETA",
    baseDeps({
      listMessageAttachments: async () => [],
      extractEtaPayloadFromEmail: async (input: { bodyText: string }) => {
        calls += 1;
        assert.match(input.bodyText, /PO289731 ETA 5\/29/);
        return {
          poNumber: "PO289731",
          etaDate: "2026-05-29",
          trackingNumber: "PRO123",
          vendorName: "Diversey",
          items: [],
          confidence: "HIGH",
          etaSource: "email",
          etaNotes: "parsed"
        };
      }
    }) as any
  );
  assert.equal(result.status, "approval_created");
  assert.equal(calls, 1);
});

test("PDF-only ETA email creates ETA approval", async () => {
  const result = await processEtaGraphMessage(
    { id: "m11", subject: "ETA PDF", bodyText: "" },
    "AI ETA",
    baseDeps({
      listMessageAttachments: async () => [{ id: "a1", name: "eta.pdf", contentType: "application/pdf", size: 100 }],
      downloadFileAttachment: async () => Buffer.from("pdf"),
      extractPdfText: async () => "PO289731 ETA 5/29 tracking PRO123",
      extractEtaPayloadFromEmail: async (input: { bodyText: string }) => {
        assert.match(input.bodyText, /PO289731 ETA 5\/29 tracking PRO123/);
        return {
          poNumber: "PO289731",
          etaDate: "2026-05-29",
          trackingNumber: "PRO123",
          vendorName: "Diversey",
          items: [],
          confidence: "HIGH",
          etaSource: "pdf",
          etaNotes: "parsed from pdf"
        };
      }
    }) as any
  );
  assert.equal(result.status, "approval_created");
});

test("body + PDF combines both sources", async () => {
  const result = await processEtaGraphMessage(
    { id: "m12", subject: "ETA mix", bodyText: "from body" },
    "AI ETA",
    baseDeps({
      listMessageAttachments: async () => [{ id: "a1", name: "eta.pdf", contentType: "application/pdf", size: 100 }],
      downloadFileAttachment: async () => Buffer.from("pdf"),
      extractPdfText: async () => "PO289731 ETA 5/29",
      extractEtaPayloadFromEmail: async (input: { bodyText: string }) => {
        assert.match(input.bodyText, /from body/);
        assert.match(input.bodyText, /PO289731 ETA 5\/29/);
        return {
          poNumber: "PO289731",
          etaDate: "2026-05-29",
          trackingNumber: null,
          vendorName: "Diversey",
          items: [],
          confidence: "MED",
          etaSource: "combined",
          etaNotes: "combined"
        };
      }
    }) as any
  );
  assert.equal(result.status, "approval_created");
});

test("non-PDF attachment is ignored", async () => {
  const result = await processEtaGraphMessage(
    { id: "m13", subject: "ETA non-pdf", bodyText: "PO289731 ETA 5/29" },
    "AI ETA",
    baseDeps({
      listMessageAttachments: async () => [{ id: "a1", name: "notes.txt", contentType: "text/plain", size: 100 }],
      extractEtaPayloadFromEmail: async (input: { bodyText: string }) => {
        assert.doesNotMatch(input.bodyText, /notes\.txt/);
        return {
          poNumber: "PO289731",
          etaDate: "2026-05-29",
          trackingNumber: null,
          vendorName: "Diversey",
          items: [],
          confidence: "MED",
          etaSource: "email",
          etaNotes: "body"
        };
      }
    }) as any
  );
  assert.equal(result.status, "approval_created");
});

test("corrupt/unreadable PDF does not crash polling", async () => {
  const prevEnabled = config.MICROSOFT_GRAPH_ENABLED;
  const prevUser = config.MICROSOFT_GRAPH_USER_EMAIL;
  const prevFolder = config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME;
  config.MICROSOFT_GRAPH_ENABLED = true;
  config.MICROSOFT_GRAPH_USER_EMAIL = "ops@example.com";
  config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME = "AI ETA";
  try {
    const summary = await runEtaOutlookIngestionOnce(
      baseDeps({
        listMessagesInFolder: async () => [{ id: "m14", subject: "ETA", bodyText: "PO289731 ETA 5/29" }],
        listMessageAttachments: async () => [{ id: "a1", name: "bad.pdf", contentType: "application/pdf", size: 100 }],
        downloadFileAttachment: async () => Buffer.from("bad"),
        extractPdfText: async () => {
          throw new Error("bad pdf");
        }
      }) as any
    );
    assert.equal(summary.enabled, true);
    assert.equal(summary.folderFound, true);
  } finally {
    config.MICROSOFT_GRAPH_ENABLED = prevEnabled;
    config.MICROSOFT_GRAPH_USER_EMAIL = prevUser;
    config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME = prevFolder;
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../../shared/config.js";
import { processEtaGraphMessage, runEtaOutlookIngestionOnce } from "./eta-email-ingestion-service.js";

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    findMailFolderByDisplayName: async () => ({ id: "folder-1", displayName: "AI ETA" }),
    listMessagesInFolder: async () => [],
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

  assert.equal(result.status, "failed");
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

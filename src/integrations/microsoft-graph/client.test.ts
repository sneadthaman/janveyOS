import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../shared/config.js";
import { findMailFolderByDisplayName, listMessagesInFolder } from "./client.js";

test("folder lookup finds AI ETA by display name", async () => {
  const originalFetch = globalThis.fetch;
  const prevToken = config.MICROSOFT_GRAPH_ACCESS_TOKEN;
  config.MICROSOFT_GRAPH_ACCESS_TOKEN = "token";

  globalThis.fetch = (async (url) => {
    assert.match(String(url), /mailFolders/);
    return {
      ok: true,
      text: async () => JSON.stringify({ value: [{ id: "f1", displayName: "AI ETA" }] })
    } as Response;
  }) as typeof fetch;

  try {
    const folder = await findMailFolderByDisplayName({ userEmail: "ops@example.com", folderName: "AI ETA" });
    assert.equal(folder?.id, "f1");
    assert.equal(folder?.displayName, "AI ETA");
  } finally {
    globalThis.fetch = originalFetch;
    config.MICROSOFT_GRAPH_ACCESS_TOKEN = prevToken;
  }
});

test("message listing returns messages regardless of read status", async () => {
  const originalFetch = globalThis.fetch;
  const prevToken = config.MICROSOFT_GRAPH_ACCESS_TOKEN;
  config.MICROSOFT_GRAPH_ACCESS_TOKEN = "token";

  globalThis.fetch = (async () => {
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          value: [
            {
              id: "m1",
              subject: "ETA",
              isRead: true,
              from: { emailAddress: { address: "vendor@example.com" } },
              receivedDateTime: "2026-05-23T12:00:00Z",
              bodyPreview: "preview",
              body: { contentType: "text", content: "body" }
            }
          ]
        })
    } as Response;
  }) as typeof fetch;

  try {
    const messages = await listMessagesInFolder({ userEmail: "ops@example.com", folderId: "f1" });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.id, "m1");
    assert.equal(messages[0]?.bodyText, "body");
  } finally {
    globalThis.fetch = originalFetch;
    config.MICROSOFT_GRAPH_ACCESS_TOKEN = prevToken;
  }
});

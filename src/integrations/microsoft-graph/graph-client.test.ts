import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../shared/config.js";
import { listMessageAttachments } from "./graph-client.js";

test("listMessageAttachments does not request @odata.type in $select", async () => {
  const originalFetch = globalThis.fetch;
  const prevTenant = config.MICROSOFT_GRAPH_TENANT_ID;
  const prevClientId = config.MICROSOFT_GRAPH_CLIENT_ID;
  const prevClientSecret = config.MICROSOFT_GRAPH_CLIENT_SECRET;

  config.MICROSOFT_GRAPH_TENANT_ID = "tenant";
  config.MICROSOFT_GRAPH_CLIENT_ID = "client";
  config.MICROSOFT_GRAPH_CLIENT_SECRET = "secret";

  const urls: string[] = [];

  globalThis.fetch = (async (url, init) => {
    urls.push(String(url));
    if (String(url).includes("/oauth2/v2.0/token")) {
      return {
        ok: true,
        json: async () => ({ access_token: "token" })
      } as Response;
    }

    assert.equal(init?.method, "GET");
    return {
      ok: true,
      text: async () => JSON.stringify({ value: [] })
    } as Response;
  }) as typeof fetch;

  try {
    await listMessageAttachments("ops@example.com", "msg-1");
    const attachmentsUrl = urls.find((u) => u.includes("/attachments?")) ?? "";
    assert.ok(attachmentsUrl.length > 0);
    assert.match(attachmentsUrl, /\$select=id%2Cname%2CcontentType%2Csize%2CisInline/);
    assert.doesNotMatch(attachmentsUrl, /%40odata\.type|@odata\.type/);
  } finally {
    globalThis.fetch = originalFetch;
    config.MICROSOFT_GRAPH_TENANT_ID = prevTenant;
    config.MICROSOFT_GRAPH_CLIENT_ID = prevClientId;
    config.MICROSOFT_GRAPH_CLIENT_SECRET = prevClientSecret;
  }
});

test("PDF filtering works without @odata.type", async () => {
  const originalFetch = globalThis.fetch;
  const prevTenant = config.MICROSOFT_GRAPH_TENANT_ID;
  const prevClientId = config.MICROSOFT_GRAPH_CLIENT_ID;
  const prevClientSecret = config.MICROSOFT_GRAPH_CLIENT_SECRET;

  config.MICROSOFT_GRAPH_TENANT_ID = "tenant";
  config.MICROSOFT_GRAPH_CLIENT_ID = "client";
  config.MICROSOFT_GRAPH_CLIENT_SECRET = "secret";

  globalThis.fetch = (async (url) => {
    if (String(url).includes("/oauth2/v2.0/token")) {
      return {
        ok: true,
        json: async () => ({ access_token: "token" })
      } as Response;
    }

    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          value: [
            { id: "a1", name: "po.pdf", contentType: "application/pdf", size: 100, isInline: false },
            { id: "a2", name: "scan.PDF", contentType: null, size: 120, isInline: false },
            { id: "a3", name: "notes.txt", contentType: "text/plain", size: 40, isInline: false },
            { id: "a4", name: "image.png", contentType: "image/png", size: 60, isInline: false }
          ]
        })
    } as Response;
  }) as typeof fetch;

  try {
    const attachments = await listMessageAttachments("ops@example.com", "msg-1");
    assert.equal(attachments.length, 2);
    assert.deepEqual(
      attachments.map((a) => a.id),
      ["a1", "a2"]
    );
  } finally {
    globalThis.fetch = originalFetch;
    config.MICROSOFT_GRAPH_TENANT_ID = prevTenant;
    config.MICROSOFT_GRAPH_CLIENT_ID = prevClientId;
    config.MICROSOFT_GRAPH_CLIENT_SECRET = prevClientSecret;
  }
});

import { config } from "../../shared/config.js";

export interface GraphFolder {
  id: string;
  displayName: string;
}

export interface GraphMessageSummary {
  id: string;
  subject: string | null;
  sender: string | null;
  receivedDateTime: string | null;
  conversationId: string | null;
  hasAttachments: boolean;
  bodyPreview: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
}

export interface GraphAttachmentSummary {
  id: string;
  name: string;
  contentType: string | null;
  size: number | null;
  isInline: boolean;
}

function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}

function isPdfAttachment(input: { name: string; contentType: string | null }) {
  const lowerName = input.name.toLowerCase();
  const contentType = (input.contentType ?? "").toLowerCase();
  return contentType === "application/pdf" || lowerName.endsWith(".pdf");
}

export async function getAccessToken(): Promise<string> {
  const tenantId = config.MICROSOFT_GRAPH_TENANT_ID;
  const clientId = config.MICROSOFT_GRAPH_CLIENT_ID;
  const clientSecret = config.MICROSOFT_GRAPH_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Microsoft Graph credentials are not configured (MICROSOFT_GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET).");
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default"
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });

  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  };

  if (!response.ok || !json.access_token) {
    const safeError = json.error_description ?? json.error ?? `status_${response.status}`;
    throw new Error(`Failed to get Microsoft Graph token: ${safeError}`);
  }

  return json.access_token;
}

async function graphGet(path: string): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json"
    }
  });

  const text = await response.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const errorObject = json.error && typeof json.error === "object" ? (json.error as Record<string, unknown>) : null;
    const safeMessage = typeof errorObject?.message === "string" ? errorObject.message : `Graph GET failed (${response.status})`;
    throw new Error(safeMessage);
  }

  return json;
}

async function graphGetBinary(path: string): Promise<Buffer> {
  const token = await getAccessToken();
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const safeBody = await response.text().catch(() => "");
    throw new Error(`Graph binary download failed (${response.status})${safeBody ? `: ${safeBody.slice(0, 120)}` : ""}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function findMailFolderByDisplayName(mailbox: string, folderName: string): Promise<GraphFolder | null> {
  const normalizedMailbox = mailbox.trim();
  const normalizedFolder = folderName.trim();
  if (!normalizedMailbox) throw new Error("Mailbox is required.");
  if (!normalizedFolder) throw new Error("Folder name is required.");

  const filter = encodeURIComponent(`displayName eq '${escapeODataString(normalizedFolder)}'`);
  const data = await graphGet(`/users/${encodeURIComponent(normalizedMailbox)}/mailFolders?$top=200&$filter=${filter}`);
  const value = Array.isArray(data.value) ? data.value : [];
  const first = value.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
  if (!first) return null;

  return {
    id: String(first.id ?? ""),
    displayName: String(first.displayName ?? normalizedFolder)
  };
}

export async function listMessagesInFolder(mailbox: string, folderId: string, limit = 10): Promise<GraphMessageSummary[]> {
  const normalizedMailbox = mailbox.trim();
  const normalizedFolderId = folderId.trim();
  if (!normalizedMailbox) throw new Error("Mailbox is required.");
  if (!normalizedFolderId) throw new Error("Folder id is required.");

  const top = Math.max(1, Math.min(100, limit));
  const select = encodeURIComponent("id,subject,from,receivedDateTime,conversationId,hasAttachments,bodyPreview,body");
  const data = await graphGet(
    `/users/${encodeURIComponent(normalizedMailbox)}/mailFolders/${encodeURIComponent(normalizedFolderId)}/messages?$top=${top}&$orderby=receivedDateTime desc&$select=${select}`
  );
  const value = Array.isArray(data.value) ? data.value : [];

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const from = item.from && typeof item.from === "object" ? (item.from as Record<string, unknown>) : null;
      const emailAddress = from?.emailAddress && typeof from.emailAddress === "object" ? (from.emailAddress as Record<string, unknown>) : null;
      const body = item.body && typeof item.body === "object" ? (item.body as Record<string, unknown>) : null;
      const bodyType = typeof body?.contentType === "string" ? body.contentType.toLowerCase() : "";
      const bodyContent = typeof body?.content === "string" ? body.content : null;
      return {
        id: String(item.id ?? ""),
        subject: typeof item.subject === "string" ? item.subject : null,
        sender: typeof emailAddress?.address === "string" ? emailAddress.address : null,
        receivedDateTime: typeof item.receivedDateTime === "string" ? item.receivedDateTime : null,
        conversationId: typeof item.conversationId === "string" ? item.conversationId : null,
        hasAttachments: Boolean(item.hasAttachments),
        bodyPreview: typeof item.bodyPreview === "string" ? item.bodyPreview : null,
        bodyText: bodyType === "text" ? bodyContent : null,
        bodyHtml: bodyType === "html" ? bodyContent : null
      } satisfies GraphMessageSummary;
    })
    .filter((item) => item.id.length > 0);
}

export async function listMessagesByConversationId(mailbox: string, conversationId: string, limit = 50): Promise<GraphMessageSummary[]> {
  const normalizedMailbox = mailbox.trim();
  const normalizedConversationId = conversationId.trim();
  if (!normalizedMailbox) throw new Error("Mailbox is required.");
  if (!normalizedConversationId) throw new Error("Conversation id is required.");

  const top = Math.max(1, Math.min(25, limit));
  const select = encodeURIComponent("id,subject,from,receivedDateTime,conversationId,hasAttachments,bodyPreview,body");
  const filter = encodeURIComponent(`conversationId eq '${escapeODataString(normalizedConversationId)}'`);
  const data = await graphGet(
    `/users/${encodeURIComponent(normalizedMailbox)}/messages?$top=${top}&$filter=${filter}&$select=${select}`
  );
  const value = Array.isArray(data.value) ? data.value : [];

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const from = item.from && typeof item.from === "object" ? (item.from as Record<string, unknown>) : null;
      const emailAddress = from?.emailAddress && typeof from.emailAddress === "object" ? (from.emailAddress as Record<string, unknown>) : null;
      const body = item.body && typeof item.body === "object" ? (item.body as Record<string, unknown>) : null;
      const bodyType = typeof body?.contentType === "string" ? body.contentType.toLowerCase() : "";
      const bodyContent = typeof body?.content === "string" ? body.content : null;
      return {
        id: String(item.id ?? ""),
        subject: typeof item.subject === "string" ? item.subject : null,
        sender: typeof emailAddress?.address === "string" ? emailAddress.address : null,
        receivedDateTime: typeof item.receivedDateTime === "string" ? item.receivedDateTime : null,
        conversationId: typeof item.conversationId === "string" ? item.conversationId : null,
        hasAttachments: Boolean(item.hasAttachments),
        bodyPreview: typeof item.bodyPreview === "string" ? item.bodyPreview : null,
        bodyText: bodyType === "text" ? bodyContent : null,
        bodyHtml: bodyType === "html" ? bodyContent : null
      } satisfies GraphMessageSummary;
    })
    .filter((item) => item.id.length > 0);
}

export async function listMessageAttachments(mailbox: string, messageId: string): Promise<GraphAttachmentSummary[]> {
  const normalizedMailbox = mailbox.trim();
  const normalizedMessageId = messageId.trim();
  if (!normalizedMailbox) throw new Error("Mailbox is required.");
  if (!normalizedMessageId) throw new Error("Message id is required.");

  const select = encodeURIComponent("id,name,contentType,size,isInline");
  const data = await graphGet(`/users/${encodeURIComponent(normalizedMailbox)}/messages/${encodeURIComponent(normalizedMessageId)}/attachments?$top=200&$select=${select}`);
  const value = Array.isArray(data.value) ? data.value : [];

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: String(item.id ?? ""),
      name: String(item.name ?? "").trim(),
      contentType: typeof item.contentType === "string" ? item.contentType : null,
      size: typeof item.size === "number" ? item.size : item.size ? Number(item.size) : null,
      isInline: Boolean(item.isInline)
    }))
    .filter((item) => item.id.length > 0 && item.name.length > 0)
    .filter((item) => isPdfAttachment({ name: item.name, contentType: item.contentType }));
}

export async function downloadFileAttachment(mailbox: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const normalizedMailbox = mailbox.trim();
  const normalizedMessageId = messageId.trim();
  const normalizedAttachmentId = attachmentId.trim();
  if (!normalizedMailbox) throw new Error("Mailbox is required.");
  if (!normalizedMessageId) throw new Error("Message id is required.");
  if (!normalizedAttachmentId) throw new Error("Attachment id is required.");

  return graphGetBinary(
    `/users/${encodeURIComponent(normalizedMailbox)}/messages/${encodeURIComponent(normalizedMessageId)}/attachments/${encodeURIComponent(normalizedAttachmentId)}/$value`
  );
}

import { config } from "../../shared/config.js";

export interface GraphMailFolder {
  id: string;
  displayName: string;
}

export interface GraphMailMessage {
  id: string;
  internetMessageId?: string;
  subject?: string;
  sender?: string;
  receivedDateTime?: string;
  bodyPreview?: string;
  bodyText?: string;
  bodyHtml?: string;
}

interface GraphTokenResponse {
  access_token: string;
}

function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}

async function getAccessToken() {
  if (config.MICROSOFT_GRAPH_ACCESS_TOKEN) return config.MICROSOFT_GRAPH_ACCESS_TOKEN;

  const tenantId = config.MICROSOFT_GRAPH_TENANT_ID;
  const clientId = config.MICROSOFT_GRAPH_CLIENT_ID;
  const clientSecret = config.MICROSOFT_GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Microsoft Graph credentials are not configured.");
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
  const json = (await response.json()) as Partial<GraphTokenResponse> & { error_description?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(`Failed to get Microsoft Graph token: ${json.error_description ?? response.status}`);
  }

  return json.access_token;
}

async function graphGet(path: string) {
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
    const message =
      typeof json.error === "object" && json.error && typeof (json.error as Record<string, unknown>).message === "string"
        ? String((json.error as Record<string, unknown>).message)
        : `Graph GET failed (${response.status})`;
    throw new Error(message);
  }
  return json;
}

export async function findMailFolderByDisplayName(input: { userEmail: string; folderName: string }): Promise<GraphMailFolder | null> {
  const folderName = input.folderName.trim();
  if (!folderName) return null;

  const filter = encodeURIComponent(`displayName eq '${escapeODataString(folderName)}'`);
  const data = await graphGet(`/users/${encodeURIComponent(input.userEmail)}/mailFolders?$top=50&$filter=${filter}`);
  const value = Array.isArray(data.value) ? data.value : [];
  const folder = value.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
  if (!folder) return null;

  return {
    id: String(folder.id ?? ""),
    displayName: String(folder.displayName ?? folderName)
  };
}

export async function listMessagesInFolder(input: {
  userEmail: string;
  folderId: string;
  limit?: number;
}): Promise<GraphMailMessage[]> {
  const top = Math.max(1, Math.min(100, input.limit ?? 50));
  const select = encodeURIComponent("id,internetMessageId,subject,from,receivedDateTime,bodyPreview,body,isRead");
  const data = await graphGet(
    `/users/${encodeURIComponent(input.userEmail)}/mailFolders/${encodeURIComponent(input.folderId)}/messages?$top=${top}&$orderby=receivedDateTime desc&$select=${select}`
  );
  const value = Array.isArray(data.value) ? data.value : [];

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const from = item.from && typeof item.from === "object" ? (item.from as Record<string, unknown>) : null;
      const emailAddress = from?.emailAddress && typeof from.emailAddress === "object" ? (from.emailAddress as Record<string, unknown>) : null;
      const body = item.body && typeof item.body === "object" ? (item.body as Record<string, unknown>) : null;
      const bodyType = String(body?.contentType ?? "").toLowerCase();
      const bodyContent = typeof body?.content === "string" ? body.content : undefined;

      return {
        id: String(item.id ?? ""),
        internetMessageId: typeof item.internetMessageId === "string" ? item.internetMessageId : undefined,
        subject: typeof item.subject === "string" ? item.subject : undefined,
        sender: typeof emailAddress?.address === "string" ? emailAddress.address : undefined,
        receivedDateTime: typeof item.receivedDateTime === "string" ? item.receivedDateTime : undefined,
        bodyPreview: typeof item.bodyPreview === "string" ? item.bodyPreview : undefined,
        bodyText: bodyType === "text" ? bodyContent : undefined,
        bodyHtml: bodyType === "html" ? bodyContent : undefined
      } satisfies GraphMailMessage;
    })
    .filter((message) => message.id.length > 0);
}

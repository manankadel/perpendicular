import "server-only";

import { getGmailConnection, getIntegrationMetadata, markIntegrationStatus, recordIntegrationHealth, updateIntegrationMetadata } from "@/lib/integration-store";

const gmailScope = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
];

function googleCredentials() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Gmail OAuth credentials are not configured.");
  return { clientId, clientSecret };
}

export function gmailScopes() {
  return [...gmailScope];
}

export function gmailRedirectUri() {
  return process.env.GOOGLE_GMAIL_REDIRECT_URI
    || `${process.env.PERPENDICULAR_API_ORIGIN || "https://perpendicular-api.bluebloodstudio.com"}/api/integrations/google/callback`;
}

export function googleAuthorizeUrl(state: string, codeChallenge: string) {
  const { clientId } = googleCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailRedirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: gmailScope.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(code: string, codeVerifier: string) {
  const { clientId, clientSecret } = googleCredentials();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: gmailRedirectUri(),
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });
  if (!response.ok) throw new Error("Google token exchange failed.");
  const payload = await response.json() as { access_token?: string; refresh_token?: string; scope?: string };
  if (!payload.access_token || !payload.refresh_token) throw new Error("Google did not return a refresh token. Reconnect with consent enabled.");
  return { ...payload, accessToken: payload.access_token };
}

export async function googleProfile(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Could not read the Google account profile.");
  const profile = await response.json() as { sub?: string; email?: string; email_verified?: boolean };
  if (!profile.sub || !profile.email || profile.email_verified === false) throw new Error("Google returned an unverified account.");
  return { id: profile.sub, email: profile.email };
}

async function accessTokenFor(workspaceId: string) {
  const connection = await getGmailConnection(workspaceId);
  if (!connection) throw new Error("Connect Gmail before using mailbox actions.");
  const { clientId, clientSecret } = googleCredentials();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.encryptedRefreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    await markIntegrationStatus(workspaceId, "gmail", "degraded");
    throw new Error("Gmail authorization expired. Reconnect the mailbox.");
  }
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Google did not return a mailbox access token.");
  return { connection, accessToken: payload.access_token };
}

function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function mimeMessage(args: { from: string; to: string; subject: string; body: string; inReplyTo?: string }) {
  const headers = [
    `From: ${args.from}`,
    `To: ${args.to}`,
    `Subject: ${args.subject.replace(/[\r\n]/g, " ")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    ...(args.inReplyTo ? [`In-Reply-To: ${args.inReplyTo}`, `References: ${args.inReplyTo}`] : []),
  ];
  return base64Url(`${headers.join("\r\n")}\r\n\r\n${args.body}`);
}

export async function sendGmailMessage(workspaceId: string, args: { to: string; subject: string; body: string; inReplyTo?: string }) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(args.to)) throw new Error("A valid recipient email is required.");
  if (!args.subject.trim() || !args.body.trim()) throw new Error("Email subject and body are required.");
  const { connection, accessToken } = await accessTokenFor(workspaceId);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: mimeMessage({ ...args, from: connection.accountEmail }) }),
  });
  if (!response.ok) {
    if (response.status === 401) await markIntegrationStatus(workspaceId, "gmail", "degraded");
    throw new Error(`Gmail rejected the message (${response.status}).`);
  }
  return await response.json() as { id?: string; threadId?: string };
}

export async function listRecentGmailMessages(workspaceId: string, maxResults = 25) {
  const { accessToken } = await accessTokenFor(workspaceId);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ maxResults: String(Math.min(maxResults, 100)), q: "newer_than:30d" })}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Gmail message listing failed (${response.status}).`);
  return await response.json() as { messages?: Array<{ id: string; threadId: string }>; resultSizeEstimate?: number };
}

export async function listGmailHistory(workspaceId: string, startHistoryId: string) {
  if (!/^\d+$/.test(startHistoryId)) throw new Error("Gmail history cursor is invalid.");
  const { accessToken } = await accessTokenFor(workspaceId);
  const messageIds = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId: string | null = null;
  do {
    const params = new URLSearchParams({ startHistoryId, maxResults: "100", historyTypes: "messageAdded" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/history?${params}`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (response.status === 404) throw new Error("Gmail history cursor expired. A full mailbox sync is required.");
    if (!response.ok) throw new Error(`Gmail history listing failed (${response.status}).`);
    const payload = await response.json() as { history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>; historyId?: string; nextPageToken?: string };
    latestHistoryId = payload.historyId || latestHistoryId;
    for (const history of payload.history || []) for (const added of history.messagesAdded || []) if (added.message?.id) messageIds.add(added.message.id);
    pageToken = payload.nextPageToken;
  } while (pageToken);
  return { messageIds: [...messageIds], historyId: latestHistoryId };
}

export async function watchGmail(workspaceId: string) {
  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) throw new Error("GMAIL_PUBSUB_TOPIC is not configured.");
  const { accessToken } = await accessTokenFor(workspaceId);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ topicName, labelIds: ["INBOX"] }),
  });
  if (!response.ok) throw new Error(`Gmail watch registration failed (${response.status}).`);
  const payload = await response.json() as { historyId?: string; expiration?: string };
  if (!payload.historyId || !payload.expiration) throw new Error("Gmail returned an incomplete watch registration.");
  await updateIntegrationMetadata(workspaceId, "gmail", { historyId: payload.historyId, watchExpiration: new Date(Number(payload.expiration)).toISOString(), watchTopic: topicName });
  await recordIntegrationHealth(workspaceId, "gmail", "connected", "watch_renewed", `Gmail watch active until ${new Date(Number(payload.expiration)).toISOString()}.`);
  return { historyId: payload.historyId, expiration: payload.expiration };
}

export async function renewGmailWatchIfNeeded(workspaceId: string) {
  if (!process.env.GMAIL_PUBSUB_TOPIC) return null;
  if (!await getGmailConnection(workspaceId)) return null;
  const metadata = await getIntegrationMetadata(workspaceId, "gmail");
  const expiration = typeof metadata.watchExpiration === "string" ? new Date(metadata.watchExpiration).getTime() : 0;
  if (expiration > Date.now() + 12 * 60 * 60 * 1000) return null;
  return watchGmail(workspaceId);
}

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string) {
  return headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeBody(value?: string) {
  if (!value) return "";
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function bodyFromParts(part?: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBody(part.body.data);
  if (Array.isArray(part.parts)) return part.parts.map((child) => bodyFromParts(child as typeof part)).filter(Boolean).join("\n");
  return part.body?.data ? decodeBody(part.body.data) : "";
}

export async function getGmailMessage(workspaceId: string, messageId: string) {
  const { accessToken } = await accessTokenFor(workspaceId);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Gmail message read failed (${response.status}).`);
  const message = await response.json() as {
    id: string;
    threadId: string;
    historyId?: string;
    internalDate?: string;
    payload?: { headers?: Array<{ name?: string; value?: string }>; body?: { data?: string }; parts?: unknown[] };
  };
  const headers = message.payload?.headers;
  const from = header(headers, "From");
  const to = header(headers, "To").split(",").map((item) => item.trim()).filter(Boolean);
  return {
    id: message.id,
    threadId: message.threadId,
    historyId: message.historyId,
    from,
    to,
    subject: header(headers, "Subject"),
    date: new Date(Number(message.internalDate || Date.now())).toISOString(),
    bodyText: decodeBody(message.payload?.body?.data) || bodyFromParts(message.payload),
    messageIdHeader: header(headers, "Message-ID"),
  };
}

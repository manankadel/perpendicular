import { corsHeadersFor } from "@/lib/cors";

type AuthPayload = Record<string, unknown>;
type HeadersWithSetCookie = Headers & { getSetCookie?: () => string[] };

export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

export function sanitizeAuthPayload(value: unknown): AuthPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { message: "Authentication service returned an invalid response." };
  const payload = { ...(value as AuthPayload) };
  delete payload.token;
  delete payload.productJwt;
  return payload;
}

function splitCombinedSetCookie(value: string) {
  const cookies: string[] = [];
  let start = 0;
  let inExpires = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value.slice(index, index + 8).toLowerCase() === "expires=") {
      inExpires = true;
      index += 7;
      continue;
    }
    if (inExpires && value[index] === ";") {
      inExpires = false;
      continue;
    }
    if (!inExpires && value[index] === ",") {
      const cookie = value.slice(start, index).trim();
      if (cookie) cookies.push(cookie);
      start = index + 1;
    }
  }
  const finalCookie = value.slice(start).trim();
  if (finalCookie) cookies.push(finalCookie);
  return cookies;
}

export function getSetCookieHeaders(headers: Headers) {
  const withSetCookie = headers as HeadersWithSetCookie;
  const cookies = withSetCookie.getSetCookie?.();
  if (cookies?.length) return cookies;
  const combined = headers.get("set-cookie");
  return combined ? splitCombinedSetCookie(combined) : [];
}

function identityApiUrl(path: string) {
  const configured = process.env.BLUEBLOOD_ID_API_ORIGIN || process.env.BLUEBLOOD_ID_ISSUER || "https://id.bluebloodstudio.com";
  const origin = new URL(configured);
  return new URL(`/api/${path.replace(/^\/+/, "")}`, origin).toString();
}

function sessionCookie(token: string) {
  const domain = process.env.COOKIE_DOMAIN || (process.env.NODE_ENV === "production" ? ".bluebloodstudio.com" : "");
  return [
    `bb_session=${encodeURIComponent(token)}`,
    "Path=/",
    "Max-Age=3600",
    `Expires=${new Date(Date.now() + 3600 * 1000).toUTCString()}`,
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
    "HttpOnly",
    "SameSite=Lax",
    ...(domain ? [`Domain=${domain}`] : []),
  ].join("; ");
}

async function identityResponse(request: Request, upstream: Response, parsed: unknown, extraCookies: string[] = []) {
  const headers = new Headers({
    ...corsHeadersFor(request),
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  for (const cookie of getSetCookieHeaders(upstream.headers)) headers.append("set-cookie", cookie);
  for (const cookie of extraCookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(sanitizeAuthPayload(parsed)), { status: upstream.status, headers });
}

export async function proxyIdentityRequest(request: Request, path: string, allowedKeys: string[]) {
  let input: unknown = {};
  try {
    input = await request.json();
  } catch {
    input = {};
  }
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as AuthPayload : {};
  const body = Object.fromEntries(allowedKeys.filter((key) => Object.prototype.hasOwnProperty.call(source, key)).map((key) => [key, source[key]]));
  const upstream = await fetch(identityApiUrl(path), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  });
  const raw = await upstream.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { message: "Authentication service returned an invalid response." };
  }
  return identityResponse(request, upstream, parsed);
}

export async function proxyIdentitySignupRequest(request: Request) {
  let input: unknown = {};
  try {
    input = await request.json();
  } catch {
    input = {};
  }
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as AuthPayload : {};
  const body = {
    email: source.email,
    password: source.password,
    firstName: source.firstName,
    lastName: source.lastName,
    productSlug: "perpendicular",
  };
  const upstream = await fetch(identityApiUrl("/auth/signup"), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  });
  const raw = await upstream.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { message: "Authentication service returned an invalid response." };
  }
  const productJwt = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as AuthPayload).productJwt
    : null;
  return identityResponse(request, upstream, parsed, typeof productJwt === "string" ? [sessionCookie(productJwt)] : []);
}

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ApiKeyRateLimitError, authenticateApiKey } from "@/lib/api-keys";
import type { RateLimitDecision } from "@/lib/rate-limit";

export type IdentityMembership = {
  productSlug: string;
  organizationId: string;
  organizationSlug: string;
  role: string;
  permissions: string[];
};

export type IdentityContext = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  workspaceId: string;
  organizationId: string;
  role: string;
  permissions: string[];
  rateLimit?: RateLimitDecision;
};

type IdentityClaims = JWTPayload & {
  email?: string;
  firstName?: string;
  lastName?: string;
  memberships?: unknown;
};

export class IdentityError extends Error {
  constructor(message: string, readonly status: 401 | 403 | 429 = 401, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "IdentityError";
  }
}

function getCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getAccessToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return getCookie(request, "bb_session");
}

export function normalizeMemberships(value: unknown): IdentityMembership[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const membership = entry as Record<string, unknown>;
    const productSlug = typeof membership.productSlug === "string" ? membership.productSlug : "";
    const organizationSlug = typeof membership.organizationSlug === "string" ? membership.organizationSlug : "";
    if (!productSlug || !organizationSlug) return [];
    return [{
      productSlug,
      organizationId: String(membership.organizationId || ""),
      organizationSlug,
      role: typeof membership.role === "string" ? membership.role : "member",
      permissions: Array.isArray(membership.permissions)
        ? membership.permissions.filter((permission): permission is string => typeof permission === "string")
        : [],
    }];
  });
}

function isLocalAuthBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_UNAUTHENTICATED_LOCAL === "true";
}

function localContext(): IdentityContext {
  return {
    userId: "local-user",
    email: "local@perpendicular.test",
    firstName: "Local",
    lastName: "Operator",
    workspaceId: process.env.DEFAULT_COMPANY_ID || "blueblood-demo",
    organizationId: "local-organization",
    role: "owner",
    permissions: ["*"],
  };
}

async function membershipsFromPortalSession(request: Request, issuer: string, productSlug: string) {
  const portalToken = getCookie(request, "payload-token");
  if (!portalToken) return [] as IdentityMembership[];
  try {
    const response = await fetch(`${issuer}/api/me-full`, {
      headers: { cookie: `payload-token=${portalToken}` },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!response.ok) return [] as IdentityMembership[];
    const body = await response.json() as { memberships?: unknown; orgs?: Array<{ organizationId?: string; organizationSlug?: string }> };
    const organizationSlugs = new Map((body.orgs || []).map((org) => [String(org.organizationId || ""), org.organizationSlug || ""]));
    return normalizeMemberships((body.memberships as Array<Record<string, unknown>> | undefined)?.filter((membership) => membership.productSlug === productSlug).map((membership) => ({
      productSlug: membership.productSlug,
      organizationId: membership.organizationId,
      organizationSlug: membership.organizationSlug || organizationSlugs.get(String(membership.organizationId || "")) || membership.organizationId,
      role: membership.role,
      permissions: membership.permissions,
    })));
  } catch {
    return [] as IdentityMembership[];
  }
}

export async function authenticateRequest(request: Request): Promise<IdentityContext> {
  if (isLocalAuthBypassEnabled()) return localContext();

  const authorization = request.headers.get("authorization") || "";
  const apiKey = request.headers.get("x-api-key") || (authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "");
  if (request.headers.get("x-api-key") || (request.headers.get("authorization") || "").startsWith("Bearer pp_")) {
    if (!apiKey.startsWith("pp_")) throw new IdentityError("Your API key is invalid or revoked.");
    try {
      const record = await authenticateApiKey(apiKey);
      if (!record) throw new IdentityError("Your API key is invalid or revoked.");
      return {
        userId: `api-key:${record.id}`,
        email: "",
        firstName: "API",
        lastName: "Key",
        workspaceId: record.workspaceId,
        organizationId: record.workspaceId,
        role: "api",
        permissions: record.scopes,
        rateLimit: record.rateLimit,
      };
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      if (error instanceof ApiKeyRateLimitError) throw new IdentityError(error.message, 429, error.decision.retryAfterSeconds);
      throw new IdentityError("Your API key is invalid or revoked.");
    }
  }

  const token = getAccessToken(request);
  if (!token) throw new IdentityError("Authentication required.");

  const issuer = process.env.BLUEBLOOD_ID_ISSUER || "https://id.bluebloodstudio.com";
  const jwksUrl = process.env.BLUEBLOOD_ID_JWKS_URL || `${issuer}/api/.well-known/jwks.json`;
  const productSlug = process.env.BLUEBLOOD_ID_PRODUCT_SLUG || "perpendicular";
  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  let payload: IdentityClaims;
  try {
    const result = await jwtVerify(token, jwks, {
      issuer,
      audience: [productSlug, "console", "blueblood-products"],
      algorithms: ["RS256"],
    });
    payload = result.payload as IdentityClaims;
  } catch {
    throw new IdentityError("Your session is invalid or expired.");
  }

  const memberships = normalizeMemberships(payload.memberships);
  const productMemberships = memberships.filter((membership) => membership.productSlug === productSlug);
  const resolvedMemberships = productMemberships.length > 0 ? productMemberships : await membershipsFromPortalSession(request, issuer, productSlug);
  if (resolvedMemberships.length === 0) {
    throw new IdentityError("You do not have access to this product.", 403);
  }

  const requestedWorkspace = request.headers.get("x-company-id") || request.headers.get("x-organization-slug");
  const membership = requestedWorkspace
    ? resolvedMemberships.find((candidate) => candidate.organizationSlug === requestedWorkspace)
    : resolvedMemberships[0];
  if (!membership) throw new IdentityError("You do not have access to this workspace.", 403);

  return {
    userId: String(payload.sub || ""),
    email: typeof payload.email === "string" ? payload.email : "",
    firstName: typeof payload.firstName === "string" ? payload.firstName : "",
    lastName: typeof payload.lastName === "string" ? payload.lastName : "",
    workspaceId: membership.organizationSlug,
    organizationId: membership.organizationId,
    role: membership.role,
    permissions: membership.permissions,
  };
}

export function getLoginUrl(request: Request) {
  const configured = process.env.PERPENDICULAR_WEB_ORIGIN || process.env.NEXT_PUBLIC_CANONICAL_URL || new URL(request.url).origin;
  const canonical = new URL(configured);
  canonical.pathname = "/login";
  canonical.search = "";
  canonical.hash = "";
  canonical.searchParams.set("next", "/");
  return canonical.toString();
}

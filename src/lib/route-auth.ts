import { authenticateRequest, getLoginUrl, IdentityError, type IdentityContext } from "@/lib/identity";
import { sameOrigin } from "@/lib/security";
import { corsJson } from "@/lib/cors";

export async function identityOrResponse(request: Request) {
  try {
    return { context: await authenticateRequest(request) as IdentityContext };
  } catch (error) {
    if (error instanceof IdentityError) {
      return {
        response: corsJson({
          error: error.message,
          ...(error.status === 401 ? { loginUrl: getLoginUrl(request) } : {}),
        }, { status: error.status, headers: error.retryAfterSeconds ? { "retry-after": String(error.retryAfterSeconds) } : undefined }, request),
      };
    }
    throw error;
  }
}

export function rejectCrossOrigin(request: Request) {
  if (request.headers.get("x-api-key") || (request.headers.get("authorization") || "").startsWith("Bearer pp_")) return null;
  return sameOrigin(request)
    ? null
    : corsJson({ error: "Cross-origin mutation rejected." }, { status: 403 }, request);
}

export function hasPermission(context: IdentityContext, permission: string) {
  return context.role === "owner" || context.role === "super_admin" || context.permissions.includes("*") || context.permissions.includes(permission);
}

export function rateLimitHeaders(context: IdentityContext): Record<string, string> {
  if (!context.rateLimit) return {};
  return {
    "x-rate-limit-limit": String(context.rateLimit.limit),
    "x-rate-limit-remaining": String(context.rateLimit.remaining),
    "x-rate-limit-reset": String(Math.ceil(context.rateLimit.resetAt / 1000)),
  };
}

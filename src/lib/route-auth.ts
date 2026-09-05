import { NextResponse } from "next/server";
import { authenticateRequest, getLoginUrl, IdentityError, type IdentityContext } from "@/lib/identity";
import { sameOrigin } from "@/lib/security";

export async function identityOrResponse(request: Request) {
  try {
    return { context: await authenticateRequest(request) as IdentityContext };
  } catch (error) {
    if (error instanceof IdentityError) {
      return {
        response: NextResponse.json({
          error: error.message,
          ...(error.status === 401 ? { loginUrl: getLoginUrl(request) } : {}),
        }, { status: error.status }),
      };
    }
    throw error;
  }
}

export function rejectCrossOrigin(request: Request) {
  if (request.headers.get("x-api-key") || (request.headers.get("authorization") || "").startsWith("Bearer pp_")) return null;
  return sameOrigin(request)
    ? null
    : NextResponse.json({ error: "Cross-origin mutation rejected." }, { status: 403 });
}

export function hasPermission(context: IdentityContext, permission: string) {
  return context.role === "owner" || context.role === "super_admin" || context.permissions.includes("*") || context.permissions.includes(permission);
}


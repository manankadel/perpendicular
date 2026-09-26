import { getWorkspace } from "@/lib/server-store";
import { randomToken, sha256 } from "@/lib/security";
import type { Employee, WorkspaceState } from "@/lib/domain";

export const widgetKeyPrefix = "pw_";

export function createWidgetKey() {
  return `${widgetKeyPrefix}${randomToken(24)}`;
}

export function widgetKeyHash(key: string) {
  return sha256(key);
}

export function widgetCorsHeaders(request: Request): Record<string, string> {
  return {
    "access-control-allow-origin": request.headers.get("origin") || "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-perpendicular-widget-key",
    "cache-control": "no-store",
    vary: "Origin",
  };
}

export function widgetEmployee(state: WorkspaceState): Employee | null {
  const configured = state.widget.employeeId ? state.employees.find((employee) => employee.id === state.widget.employeeId) : null;
  return configured || state.employees.find((employee) => employee.status === "live") || null;
}

export async function authenticateWidget(workspaceId: string, key: string) {
  if (!workspaceId || !key.startsWith(widgetKeyPrefix) || key.length < 20) return null;
  const state = await getWorkspace(workspaceId);
  if (!state.widget.enabled || !state.widget.publicKeyHash || widgetKeyHash(key) !== state.widget.publicKeyHash) return null;
  return { state, employee: widgetEmployee(state) };
}


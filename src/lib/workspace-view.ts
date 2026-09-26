import type { WorkspaceState } from "@/lib/domain";

export function workspaceStateForClient(state: WorkspaceState) {
  return {
    ...state,
    widget: { ...state.widget, publicKeyHash: null },
  };
}


import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const domain = readFileSync(join(root, "src/lib/domain.ts"), "utf8");
const widget = readFileSync(join(root, "src/lib/widget.ts"), "utf8");
const config = readFileSync(join(root, "src/app/api/widget/[workspaceId]/config/route.ts"), "utf8");
const chat = readFileSync(join(root, "src/app/api/widget/[workspaceId]/chat/route.ts"), "utf8");
const workspace = readFileSync(join(root, "src/app/api/workspace/route.ts"), "utf8");
const workspaceView = readFileSync(join(root, "src/lib/workspace-view.ts"), "utf8");
const docs = readFileSync(join(root, "src/app/api/docs/route.ts"), "utf8");
const widgetPage = readFileSync(join(root, "src/components/PerpendicularWidget.tsx"), "utf8");
const nextConfig = readFileSync(join(root, "next.config.ts"), "utf8");
const exportRoute = readFileSync(join(root, "src/app/api/workspace/export/route.ts"), "utf8");
const mcp = readFileSync(join(root, "src/app/api/mcp/route.ts"), "utf8");

test("public widget has persisted workspace-scoped state", () => {
  assert.match(domain, /WidgetConversation/);
  assert.match(domain, /widgetConversations: WidgetConversation\[\]/);
  assert.match(domain, /createWidgetSettings/);
  assert.match(workspace, /workspaceStateForClient/);
  assert.match(workspaceView, /publicKeyHash: null/);
  assert.match(exportRoute, /workspaceStateForClient/);
  assert.match(mcp, /workspaceStateForClient/);
});

test("widget access is capability-keyed and not an authenticated workspace read", () => {
  assert.match(widget, /widgetKeyPrefix/);
  assert.match(widget, /state\.widget\.enabled/);
  assert.match(widget, /widgetKeyHash\(key\)/);
  assert.match(config, /x-perpendicular-widget-key/);
  assert.match(config, /status: 401/);
  assert.match(chat, /consumeApiKeyRateLimitPersistent/);
  assert.match(chat, /updateWorkspace\(workspaceId/);
  assert.match(chat, /state\.widgetConversations/);
  assert.match(chat, /recordUsage/);
  assert.match(chat, /recordAuditEvent/);
  assert.match(chat, /aiCreditsRemaining/);
  assert.match(workspace, /publicKeyHash: key \? widgetKeyHash\(key\) : null/);
});

test("widget UI sends real messages and exposes an embeddable route", () => {
  assert.match(widgetPage, /api\/widget/);
  assert.match(widgetPage, /x-perpendicular-widget-key/);
  assert.match(docs, /\/api\/widget\/\{workspaceId\}\/chat/);
  assert.match(nextConfig, /\/widget\/:path\*/);
  assert.match(nextConfig, /frame-ancestors \*/);
});

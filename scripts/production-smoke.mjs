const apiOrigin = (process.env.PERPENDICULAR_SMOKE_API_ORIGIN || "https://perpendicular-api.bluebloodstudio.com").replace(/\/$/, "");
const canonicalOrigin = (process.env.PERPENDICULAR_SMOKE_WEB_ORIGIN || "https://perpendicular.bluebloodstudio.com").replace(/\/$/, "");
const vercelOrigin = (process.env.PERPENDICULAR_SMOKE_VERCEL_ORIGIN || "https://perpendicular-nine.vercel.app").replace(/\/$/, "");
const timeoutMs = 10_000;
const failures = [];

async function request(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function json(response) {
  return response.json().catch(() => ({}));
}

async function check(name, callback) {
  try {
    await callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.error(`FAIL ${name} — ${message}`);
  }
}

await check("API health and launch configuration", async () => {
  const response = await request(`${apiOrigin}/api/health`);
  const body = await json(response);
  if (response.status !== 200 || body.ok !== true) throw new Error(`status=${response.status}`);
  if (body.schema?.ok !== true) throw new Error(`schema gaps: ${(body.schema?.missingTables || []).join(", ") || "unknown"}`);
  if (body.configuration?.ok !== true) throw new Error(`configuration gaps: ${(body.configuration?.gaps || []).join(", ") || "configuration contract missing"}`);
});

await check("credentialed CORS preflight", async () => {
  const response = await request(`${apiOrigin}/api/workspace`, {
    method: "OPTIONS",
    headers: {
      Origin: vercelOrigin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  if (response.status !== 204) throw new Error(`status=${response.status}`);
  if (response.headers.get("access-control-allow-origin") !== vercelOrigin) throw new Error("allowed origin mismatch");
  if (response.headers.get("access-control-allow-credentials") !== "true") throw new Error("credentialed CORS is not enabled");
});

await check("unauthenticated workspace rejection", async () => {
  const response = await request(`${apiOrigin}/api/workspace`);
  const body = await json(response);
  if (response.status !== 401 || body.error !== "Authentication required.") throw new Error(`status=${response.status}`);
});

await check("OpenAPI documentation", async () => {
  const response = await request(`${apiOrigin}/api/docs`);
  const body = await json(response);
  if (response.status !== 200 || body.openapi !== "3.1.0") throw new Error(`status=${response.status}`);
  for (const path of ["/api/inbox", "/api/cron/heartbeat", "/api/keys/{id}"]) {
    if (!body.paths?.[path]) throw new Error(`missing ${path}`);
  }
});

await check("truthful pricing endpoint", async () => {
  const response = await request(`${apiOrigin}/api/pricing`);
  const body = await json(response);
  if (response.status !== 200 || body.openSource !== true) throw new Error(`status=${response.status}`);
  if (body.billing?.checkout !== false) throw new Error("Stripe checkout must remain disabled for the open-source launch");
});

for (const [name, origin] of [["canonical UI", canonicalOrigin], ["Vercel UI", vercelOrigin]]) {
  await check(name, async () => {
    const response = await request(origin);
    const body = await response.text();
    if (response.status !== 200 || !body.includes("Perpendicular")) throw new Error(`status=${response.status}`);
  });
}

if (failures.length) {
  console.error(`\n${failures.length} production smoke check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nProduction smoke checks passed.");
}

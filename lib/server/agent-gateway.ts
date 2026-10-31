import { tenants } from "./config.ts";
import { boundedBody } from "./upstream.ts";
let activeUploads = 0;

// Public machine endpoint. User sessions and the engine administrator token are never forwarded.
export async function agentGateway(
  request: Request,
  tenantId: string,
  path: string[],
) {
  const name = path.join("/");
  const valid =
    (request.method === "POST" &&
      ["enroll", "rotate", "claim"].includes(name)) ||
    (request.method === "POST" &&
      /^tasks\/[0-9a-f-]{36}\/failure$/.test(name)) ||
    (request.method === "PUT" && /^tasks\/[0-9a-f-]{36}\/source$/.test(name));
  const authorization = request.headers.get("authorization") || "";
  if (!valid || !/^Bearer [A-Za-z0-9_-]{32,200}$/.test(authorization))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const upload = name.endsWith("/source");
  if (upload && activeUploads >= 2)
    return Response.json(
      { error: "Upload capacity reached" },
      { status: 429, headers: { "Retry-After": "5" } },
    );
  if (upload) activeUploads++;
  try {
    const tenant = tenants().find(
      (t) => t.id === tenantId && t.enabled !== false,
    );
    const configured = tenant && process.env[tenant.engineUrlEnv];
    if (!tenant || !configured)
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    const base = new URL(configured);
    if (
      !["https:", "http:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new Error("Invalid engine origin");
    if (upload) {
      // Authenticate a small request before accepting a large public upload into memory.
      const check = await fetch(
        configured.replace(/\/$/, "") + "/v1/agent/check",
        {
          method: "POST",
          headers: { Authorization: authorization },
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        },
      );
      await check.body?.cancel();
      if (!check.ok)
        return Response.json(
          { error: "Collector not authorized" },
          { status: check.status === 401 ? 401 : 502 },
        );
    }
    const bytes = await boundedBody(
      new Response(request.body || new Uint8Array()),
      name.endsWith("/source") ? 50 * 1024 * 1024 : 1024,
    );
    const response = await fetch(
      configured.replace(/\/$/, "") + "/v1/agent/" + name,
      {
        method: request.method,
        body: bytes as BodyInit,
        headers: {
          Authorization: authorization,
          "Content-Type": name.endsWith("/source")
            ? "application/zip"
            : "application/json",
          "X-AIRE-Lease": (request.headers.get("x-aire-lease") || "").slice(
            0,
            200,
          ),
        },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(120000),
      },
    );
    const data = await boundedBody(response, 64 * 1024);
    return new Response(data as BodyInit, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "Collector service unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    if (upload) activeUploads--;
  }
}

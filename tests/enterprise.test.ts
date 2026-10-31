import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  tenants,
  membership,
  type Tenant,
  type Identity,
} from "../lib/server/config.ts";
import { validatedIdentity, identityConnection } from "../lib/server/oidc.ts";
import { seal, cookie, SESSION_COOKIE } from "../lib/server/session.ts";
import { api } from "../lib/server/api.ts";
import { agentGateway } from "../lib/server/agent-gateway.ts";
import { getJourney } from "../lib/server/store.ts";
const originalEnv = { ...process.env },
  originalFetch = globalThis.fetch;
const ms = "11111111-1111-4111-8111-111111111111",
  otherMs = "22222222-2222-4222-8222-222222222222";
const operator: Identity = {
  provider: "google",
  sub: "operator",
  issuer: "https://accounts.google.com",
  name: "Operator",
  groups: [],
};
const initial: Tenant = {
  id: "northeia",
  name: "Northeia",
  members: [{ provider: "google", subject: "operator", role: "admin" }],
  groups: [],
  repositories: ["org/repo"],
  githubTokenEnv: "N_GITHUB",
  engineUrlEnv: "N_URL",
  engineTokenEnv: "N_TOKEN",
};
const customer = (enabled = false): Tenant => ({
  id: "alpha",
  name: "Alpha",
  members: [{ provider: "microsoft", subject: "admin-object", role: "admin" }],
  groups: [{ id: "engineers", role: "engineer" }],
  repositories: ["org/repo"],
  githubTokenEnv: "ALPHA_GITHUB",
  engineUrlEnv: "ALPHA_URL",
  engineTokenEnv: "ALPHA_TOKEN",
  enabled,
  sso: { microsoftTenantId: ms, googleDomains: ["alpha.example"] },
  plan: { name: "POC", monthlyUsd: 100, infrastructureMonthlyUsd: 20 },
});
let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aire-enterprise-"));
  process.env.AIRE_DATA_DIR = dir;
  process.env.AIRE_MODE = "live";
  process.env.AIRE_APP_ORIGIN = "https://aire.example";
  process.env.AIRE_SESSION_SECRET = "synthetic-session-" + "x".repeat(40);
  process.env.AIRE_TENANTS_JSON = JSON.stringify([initial]);
  process.env.AIRE_PLATFORM_ADMINS_JSON = JSON.stringify([
    {
      provider: operator.provider,
      issuer: operator.issuer,
      subject: operator.sub,
    },
  ]);
  process.env.AIRE_MICROSOFT_TENANT_ID = otherMs;
  process.env.AIRE_MICROSOFT_CLIENT_ID = "synthetic";
  process.env.AIRE_MICROSOFT_CLIENT_SECRET = "synthetic";
  process.env.AIRE_GOOGLE_CLIENT_ID = "synthetic";
  process.env.AIRE_GOOGLE_CLIENT_SECRET = "synthetic";
  process.env.N_URL = "https://n-engine.example";
  process.env.N_TOKEN = "private-root-token";
  process.env.ALPHA_URL = "https://alpha-engine.example";
  process.env.ALPHA_TOKEN = "other-private-root-token";
  globalThis.fetch = async () => {
    throw new Error("Unexpected network call");
  };
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env))
    if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  await rm(dir, { recursive: true, force: true });
});
async function request(
  path: string,
  method = "GET",
  payload?: unknown,
  identity = operator,
) {
  return new Request("https://aire.example/api/console/" + path, {
    method,
    headers: {
      origin: "https://aire.example",
      cookie: cookie(
        SESSION_COOKIE,
        await seal({ identity }, "session", 300),
        300,
      ),
      "Content-Type": "application/json",
    },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
}
async function save(tenant = customer(), revision = 0) {
  return api(await request("platform", "PUT", { tenant, revision }), [
    "platform",
  ]);
}

test("operator creates draft tenant with revision control and no secrets; customer admin cannot access platform", async () => {
  assert.equal((await save()).status, 200);
  assert.equal(tenants().find((t) => t.id === "alpha")?.enabled, false);
  assert.equal((await save()).status, 409);
  const c = customer(true);
  process.env.AIRE_TENANTS_JSON = JSON.stringify([
    initial,
    { ...c, id: "beta" },
  ]);
  const identity: Identity = {
    sub: "subject",
    objectId: "admin-object",
    issuer: `https://login.microsoftonline.com/${ms}/v2.0`,
    workspace: "beta",
    provider: "microsoft",
    name: "Customer admin",
    groups: [],
  };
  assert.equal(
    (
      await api(await request("platform", "GET", undefined, identity), [
        "platform",
      ])
    ).status,
    403,
  );
});

test("activation verifies immutable engine tenant binding before making SSO available", async () => {
  globalThis.fetch = async () => Response.json({ tenant_id: "wrong-customer" });
  assert.equal((await save(customer(true))).status, 409);
  assert.equal(tenants().length, 1);
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(new Headers(init?.headers).get("x-aire-tenant"), "alpha");
    return Response.json(
      String(url).endsWith("healthz")
        ? { tenant_id: "alpha" }
        : { attempts: 0 },
    );
  };
  assert.equal((await save(customer(true))).status, 200);
  assert.equal(calls.length, 2);
  assert.equal(
    identityConnection("microsoft", "alpha").issuer,
    `https://login.microsoftonline.com/${ms}/v2.0`,
  );
});

test("SSO tenant, issuer, workspace and Google hd are enforced; email domain grants nothing", () => {
  process.env.AIRE_TENANTS_JSON = JSON.stringify([initial, customer(true)]);
  const claims = {
    iss: `https://login.microsoftonline.com/${ms}/v2.0`,
    tid: ms,
    sub: "same-subject",
    oid: "admin-object",
  };
  const id = validatedIdentity("microsoft", claims, "alpha");
  assert.equal(membership(id).tenant.id, "alpha");
  assert.throws(() =>
    validatedIdentity("microsoft", { ...claims, tid: otherMs }, "alpha"),
  );
  assert.throws(() =>
    membership({
      ...id,
      issuer: `https://login.microsoftonline.com/${otherMs}/v2.0`,
    }),
  );
  assert.throws(() => membership({ ...id, workspace: "northeia" }));
  assert.throws(() =>
    validatedIdentity(
      "google",
      {
        iss: "https://accounts.google.com",
        sub: "google",
        email: "admin@alpha.example",
        hd: "evil.example",
      },
      "alpha",
    ),
  );
  const google = validatedIdentity(
    "google",
    { iss: "https://accounts.google.com", sub: "google", hd: "alpha.example" },
    "alpha",
  );
  assert.throws(() => membership(google));
  assert.throws(() => identityConnection("microsoft", "unknown"));
});

test("suspending a client denies existing sessions and machine gateway requests", async () => {
  process.env.AIRE_TENANTS_JSON = JSON.stringify([initial, customer(true)]);
  const identity: Identity = {
    sub: "subject",
    objectId: "admin-object",
    issuer: `https://login.microsoftonline.com/${ms}/v2.0`,
    workspace: "alpha",
    provider: "microsoft",
    name: "Customer",
    groups: [],
  };
  assert.equal(membership(identity).role, "admin");
  assert.equal((await save(customer(false))).status, 200);
  assert.throws(() => membership(identity));
  const response = await agentGateway(
    new Request("https://aire.example/api/agents/alpha/claim", {
      method: "POST",
      headers: { Authorization: "Bearer " + "a".repeat(40) },
    }),
    "alpha",
    ["claim"],
  );
  assert.equal(response.status, 401);
});

test("collector gateway forwards only machine token and restricted paths, never engine admin credential", async () => {
  process.env.AIRE_TENANTS_JSON = JSON.stringify([initial, customer(true)]);
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "https://alpha-engine.example/v1/agent/claim");
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer " + "a".repeat(40),
    );
    assert.equal(new Headers(init?.headers).get("Cookie"), null);
    return Response.json({ task: null });
  };
  const machine = () =>
    new Request("https://aire.example/api/agents/alpha/claim", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + "a".repeat(40),
        Cookie: "never-forward",
      },
    });
  assert.equal((await agentGateway(machine(), "alpha", ["claim"])).status, 200);
  assert.equal(
    (await agentGateway(machine(), "alpha", ["..", "analyses"])).status,
    401,
  );
  assert.equal(
    (await agentGateway(machine(), "unknown", ["claim"])).status,
    401,
  );
  assert.equal(calls, 1);
});

test("private journey queues on selected tenant engine without sending repository credentials to SaaS", async () => {
  const id = "33333333-3333-4333-8333-333333333333",
    agentId = "44444444-4444-4444-8444-444444444444";
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(
      String(url),
      `https://n-engine.example/v1/collectors/${agentId}/analyses`,
    );
    assert.equal(JSON.parse(String(init?.body)).revision, "a".repeat(40));
    return Response.json({
      analysis_id: id,
      created_at: new Date().toISOString(),
    });
  };
  const input = {
    collectorId: agentId,
    name: "Checkout",
    endpoint: "POST /checkout",
    tier: "Gold",
    repository: "org/repo",
    revision: "a".repeat(40),
    sourceSubdirectory: "",
  };
  assert.equal(
    (await api(await request("journeys", "POST", input), ["journeys"])).status,
    202,
  );
  assert.equal((await getJourney("northeia", id)).status, "AWAITING_SOURCE");
  assert.equal(
    (
      await api(
        await request("journeys", "POST", {
          ...input,
          repository: "other/private",
        }),
        ["journeys"],
      )
    ).status,
    403,
  );
  assert.equal(calls, 1);
});

test("customer usage excludes internal costs and price catalog", async () => {
  globalThis.fetch = async () =>
    Response.json({
      month: "2026-10",
      attempts: 2,
      input_tokens: 10,
      output_tokens: 20,
      usage_unknown_attempts: 1,
      estimated_ai_usd: "1",
      events: [{ sensitive: "internal" }],
    });
  const response = await api(await request("usage"), ["usage"]);
  assert.equal(response.status, 200);
  const data = (await response.json()) as Record<string, unknown>;
  assert.equal(data.attempts, 2);
  assert.equal(data.events, undefined);
  assert.equal(data.estimated_ai_usd, undefined);
});

test("verified onboarding identity is visible only to its owner and cannot authenticate the console", async () => {
  const { ONBOARDING_COOKIE, sessionResponse } =
    await import("../lib/server/session.ts");
  const identity = {
    provider: "google",
    issuer: "https://accounts.google.com",
    subject: "pending-user",
    workspace: "alpha",
  };
  const diagnostic = await seal({ identity }, "onboarding-identity", 60);
  const incoming = new Request("https://aire.example/api/console/session", {
    headers: { cookie: cookie(ONBOARDING_COOKIE, diagnostic, 60) },
  });
  const result = await sessionResponse(incoming);
  assert.equal(result.authenticated, false);
  assert.deepEqual(result.onboardingIdentity, identity);
  const forgedSession = new Request(
    "https://aire.example/api/console/journeys",
    { headers: { cookie: cookie(SESSION_COOKIE, diagnostic, 60) } },
  );
  assert.equal((await api(forgedSession, ["journeys"])).status, 401);
});

test("public source upload authenticates collector before reading a large body", async () => {
  process.env.AIRE_TENANTS_JSON = JSON.stringify([initial, customer(true)]);
  let checked = false;
  globalThis.fetch = async (url) => {
    checked = true;
    assert.equal(String(url), "https://alpha-engine.example/v1/agent/check");
    return Response.json({ detail: "Unauthorized" }, { status: 401 });
  };
  const req = new Request(
    "https://aire.example/api/agents/alpha/tasks/33333333-3333-4333-8333-333333333333/source",
    {
      method: "PUT",
      headers: { Authorization: "Bearer " + "a".repeat(40) },
      body: new Uint8Array(2048),
    },
  );
  const result = await agentGateway(req, "alpha", [
    "tasks",
    "33333333-3333-4333-8333-333333333333",
    "source",
  ]);
  assert.equal(result.status, 401);
  assert.equal(checked, true);
  assert.equal(req.bodyUsed, false);
});

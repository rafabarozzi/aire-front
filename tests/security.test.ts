import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  membership,
  allowedRepository,
  isDemo,
  type Tenant,
} from "../lib/server/config.ts";
import {
  seal,
  unseal,
  cookie,
  SESSION_COOKIE,
  checkOrigin,
} from "../lib/server/session.ts";
import { saveJourney, getJourney, savePolicy } from "../lib/server/store.ts";
import { api } from "../lib/server/api.ts";
import { boundedBody } from "../lib/server/upstream.ts";
import {
  normalizeRepository,
  journeyInputSchema,
  policySchema,
} from "../lib/aire/validation.ts";
import { defaultPolicy, type Journey } from "../lib/aire/types.ts";
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const tenant = (id: string, subject: string): Tenant => ({
  id,
  name: id,
  members: [{ provider: "google", subject, role: "admin" }],
  groups: [],
  repositories: ["org/commerce"],
  githubTokenEnv: "TEST_GITHUB",
  engineUrlEnv: "TEST_ENGINE_URL",
  engineTokenEnv: "TEST_ENGINE_TOKEN",
});
const ts = [tenant("alpha", "alice"), tenant("beta", "bob")];
const id = "81ec72d0-3101-49f6-a514-4ab1ad9be830";
const journey: Journey = {
  id,
  name: "Checkout",
  tier: "Gold",
  endpoint: "POST /checkout",
  repository: "org/commerce",
  revision: "a".repeat(40),
  status: "COMPLETED",
  createdAt: "2026-10-31T00:00:00Z",
  stacks: [],
};
let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aire-test-"));
  process.env.AIRE_DATA_DIR = dir;
  process.env.AIRE_MODE = "live";
  process.env.AIRE_APP_ORIGIN = "https://aire.example.test";
  process.env.AIRE_SESSION_SECRET =
    "synthetic-session-secret-at-least-32-chars";
  process.env.AIRE_TENANTS_JSON = JSON.stringify(ts);
  process.env.TEST_GITHUB = "synthetic-github-token";
  process.env.TEST_ENGINE_URL = "https://engine.example.test";
  process.env.TEST_ENGINE_TOKEN = "synthetic-engine-token";
  globalThis.fetch = async () => {
    throw new Error("Unexpected network call");
  };
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const k of Object.keys(process.env))
    if (!(k in originalEnv)) delete process.env[k];
  Object.assign(process.env, originalEnv);
  await rm(dir, { recursive: true, force: true });
});
async function req(
  path: string,
  subject = "alice",
  method = "GET",
  body?: unknown,
  origin = "https://aire.example.test",
) {
  const token = await seal(
    {
      identity: { sub: subject, provider: "google", groups: [], name: "Test" },
    },
    "session",
    60,
  );
  return new Request("https://aire.example.test/api/console/" + path, {
    method,
    headers: {
      cookie: cookie(SESSION_COOKIE, token, 60),
      origin,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

test("demo mode is opt-in and missing mode stays closed", () => {
  delete process.env.AIRE_MODE;
  assert.equal(isDemo(), false);
  process.env.AIRE_MODE = "demo";
  assert.equal(isDemo(), true);
});
test("repository parsing accepts exact GitHub repo and rejects SSRF, paths, credentials and queries", () => {
  assert.equal(
    normalizeRepository("https://github.com/org/commerce.git"),
    "org/commerce",
  );
  for (const s of [
    "http://127.0.0.1/x",
    "https://github.com.evil.test/a/b",
    "https://user:secret@github.com/org/repo",
    "org/repo?token=x",
    "org/../repo",
    "org/repo/tree/main",
    "https://github.com/org/repo#x",
  ])
    assert.throws(() => normalizeRepository(s));
});
test("journey schema rejects caller supplied tenant or role", () => {
  const input = {
    name: "Checkout",
    tier: "Gold",
    endpoint: "POST /checkout",
    repository: "org/commerce",
    revision: "a".repeat(40),
    sourceSubdirectory: "",
  };
  assert.equal(journeyInputSchema.safeParse(input).success, true);
  assert.equal(
    journeyInputSchema.safeParse({ ...input, tenant: "beta" }).success,
    false,
  );
  assert.equal(
    journeyInputSchema.safeParse({ ...input, sourceSubdirectory: "../secret" })
      .success,
    false,
  );
  assert.equal(
    journeyInputSchema.safeParse({ ...input, revision: "main" }).success,
    false,
  );
});
test("membership binds provider and immutable subject", () => {
  assert.equal(
    membership({ provider: "google", sub: "alice", groups: [], name: "x" }, ts)
      .tenant.id,
    "alpha",
  );
  assert.throws(() =>
    membership(
      { provider: "microsoft", sub: "alice", groups: [], name: "x" },
      ts,
    ),
  );
  assert.throws(() =>
    membership(
      { provider: "google", sub: "unknown", groups: [], name: "alpha" },
      ts,
    ),
  );
});
test("ambiguous cross-tenant membership is denied", () => {
  assert.throws(() =>
    membership({ provider: "google", sub: "alice", groups: [], name: "x" }, [
      ts[0],
      tenant("gamma", "alice"),
    ]),
  );
});
test("group roles only apply to Microsoft identities", () => {
  const t = {
    ...ts[0],
    members: [],
    groups: [{ id: "group-a", role: "engineer" as const }],
  };
  assert.equal(
    membership(
      { provider: "microsoft", sub: "s", groups: ["group-a"], name: "x" },
      [t],
    ).role,
    "engineer",
  );
  assert.throws(() =>
    membership(
      { provider: "google", sub: "s", groups: ["group-a"], name: "x" },
      [t],
    ),
  );
});
test("repository allowlist rejects another org", () => {
  assert.throws(() => allowedRepository(ts[0], "other/repo"));
  allowedRepository(ts[0], "ORG/COMMERCE");
});
test("session encryption rejects tampering and wrong audience", async () => {
  const value = await seal({ hello: "world" }, "session", 60);
  assert.equal((await unseal(value, "session")).hello, "world");
  await assert.rejects(() =>
    unseal(value.slice(0, -15) + "changed", "session"),
  );
  await assert.rejects(() => unseal(value, "oidc-flow"));
});
test("expired session is rejected", async () => {
  const value = await seal({ hello: "world" }, "session", -60);
  await assert.rejects(() => unseal(value, "session"));
});
test("cookies are HttpOnly, Secure, host-only and SameSite", () => {
  const c = cookie(SESSION_COOKIE, "test", 60);
  assert.match(c, /HttpOnly; Secure; SameSite=Lax/);
  assert.doesNotMatch(c, /Domain=/);
  assert.match(c, /^__Host-/);
});
test("mutations require exact origin", () => {
  assert.throws(() =>
    checkOrigin(
      new Request("https://aire.example.test", {
        headers: { origin: "https://evil.test" },
      }),
    ),
  );
  assert.throws(() => checkOrigin(new Request("https://aire.example.test")));
});
test("unauthenticated API cannot list journeys", async () => {
  const r = await api(
    new Request("https://aire.example.test/api/console/journeys"),
    ["journeys"],
  );
  assert.equal(r.status, 401);
});
test("invalid session cannot access private data", async () => {
  const r = await api(
    new Request("https://aire.example.test/api/console/journeys", {
      headers: { cookie: SESSION_COOKIE + "=forged" },
    }),
    ["journeys"],
  );
  assert.equal(r.status, 401);
});
test("tenant list is isolated", async () => {
  await saveJourney("alpha", journey);
  const a = await api(await req("journeys"), ["journeys"]);
  assert.equal(((await a.json()) as unknown[]).length, 1);
  const b = await api(await req("journeys", "bob"), ["journeys"]);
  assert.deepEqual(await b.json(), []);
});
test("cross-tenant analysis and artifact access return 404 before network", async () => {
  await saveJourney("alpha", journey);
  for (const path of [
    ["journeys", id],
    ["journeys", id, "artifacts", "manifest"],
  ]) {
    const r = await api(await req(path.join("/"), "bob"), path);
    assert.equal(r.status, 404);
  }
});
test("path traversal cannot escape tenant store", async () => {
  await assert.rejects(() => getJourney("alpha", "../../beta/jobs"));
  await assert.rejects(() => getJourney("../beta", id));
});
test("viewer cannot create analyses or manage access", async () => {
  const tenants = [
    {
      ...ts[0],
      members: [{ provider: "google", subject: "alice", role: "viewer" }],
    },
  ];
  process.env.AIRE_TENANTS_JSON = JSON.stringify(tenants);
  const r = await api(await req("journeys", "alice", "POST", {}), ["journeys"]);
  assert.equal(r.status, 403);
  assert.equal((await api(await req("access"), ["access"])).status, 403);
});
test("policy revocation takes effect for an existing session", async () => {
  const tenants = [
    {
      ...ts[0],
      members: [{ provider: "google", subject: "alice", role: "viewer" }],
    },
  ];
  process.env.AIRE_TENANTS_JSON = JSON.stringify(tenants);
  const r = await req("journeys");
  assert.equal((await api(r.clone() as Request, ["journeys"])).status, 200);
  await savePolicy("alpha", { ...defaultPolicy, viewer: [] }, "admin");
  assert.equal((await api(r.clone() as Request, ["journeys"])).status, 403);
});
test("member removal invalidates an existing encrypted session", async () => {
  const r = await req("journeys");
  process.env.AIRE_TENANTS_JSON = "[]";
  assert.equal((await api(r, ["journeys"])).status, 403);
});
test("administrator cannot lose mandatory permissions", () => {
  assert.equal(
    policySchema.safeParse({ ...defaultPolicy, admin: [] }).success,
    false,
  );
});
test("oversized requests are rejected before JSON processing", async () => {
  const r = await api(
    await req("access", "alice", "PUT", { large: "x".repeat(17000) }),
    ["access"],
  );
  assert.equal(r.status, 413);
});
test("bounded upstream reader cancels oversized streams", async () => {
  await assert.rejects(() => boundedBody(new Response("123456"), 5));
  assert.deepEqual(
    [...(await boundedBody(new Response("abc"), 3))],
    [97, 98, 99],
  );
});
test("CSRF attempt cannot change permission policy", async () => {
  const r = await api(
    await req("access", "alice", "PUT", defaultPolicy, "https://evil.test"),
    ["access"],
  );
  assert.equal(r.status, 403);
});
test("artifact response is attachment, tenant checked and non-cacheable", async () => {
  await saveJourney("alpha", journey);
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      "https://engine.example.test/v1/analyses/" + id + "/artifacts/manifest",
    );
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer synthetic-engine-token",
    );
    return new Response('{"documentType":"journey_structural_manifest"}');
  };
  const r = await api(await req("journeys/" + id + "/artifacts/manifest"), [
    "journeys",
    id,
    "artifacts",
    "manifest",
  ]);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition")!, /^attachment/);
  assert.equal(r.headers.get("cache-control"), "no-store");
});
test("HTML artifacts cannot become same-origin executable content", async () => {
  await saveJourney("alpha", journey);
  assert.equal(
    (
      await api(await req("journeys/" + id + "/artifacts/html"), [
        "journeys",
        id,
        "artifacts",
        "html",
      ])
    ).status,
    404,
  );
});
test("demo mode cannot execute live APIs", async () => {
  process.env.AIRE_MODE = "demo";
  assert.equal((await api(await req("journeys"), ["journeys"])).status, 409);
});
test("create journey validates repository and revision, uploads snapshot, binds engine result to tenant", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const u = String(input);
    calls.push(u);
    if (u === "https://api.github.com/repos/org/commerce")
      return Response.json({ default_branch: "main", private: true });
    if (u.includes("/commits/")) return Response.json({ sha: "a".repeat(40) });
    if (u.includes("/zipball/"))
      return new Response(null, {
        status: 302,
        headers: {
          location:
            "https://codeload.github.com/org/commerce/legacy.zip/" +
            "a".repeat(40),
        },
      });
    if (u.startsWith("https://codeload.github.com/")) {
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return new Response(new Uint8Array([80, 75, 3, 4]));
    }
    if (u === "https://engine.example.test/v1/analyses") {
      const payload = JSON.parse(init?.body as string);
      assert.equal(payload.revision, "a".repeat(40));
      assert.equal(payload.journey_tier, "Gold");
      assert.equal("tenant" in payload, false);
      return Response.json({
        analysis_id: id,
        created_at: "2026-10-31T00:00:00Z",
      });
    }
    if (u.endsWith("/source")) {
      assert.equal(init?.method, "PUT");
      return Response.json({ status: "QUEUED" });
    }
    throw new Error("Unexpected request");
  };
  const r = await api(
    await req("journeys", "alice", "POST", {
      name: "Checkout",
      tier: "Gold",
      endpoint: "POST /checkout",
      repository: "org/commerce",
      revision: "a".repeat(40),
      sourceSubdirectory: "",
    }),
    ["journeys"],
  );
  assert.equal(r.status, 202);
  assert.equal((await getJourney("alpha", id)).status, "QUEUED");
  await assert.rejects(() => getJourney("beta", id));
  assert.equal(calls.length, 6);
});
test("upstream failures never disclose provider bodies or tokens", async () => {
  globalThis.fetch = async () =>
    new Response("secret synthetic-token", { status: 500 });
  const r = await api(
    await req("repositories/validate", "alice", "POST", {
      repository: "org/commerce",
    }),
    ["repositories", "validate"],
  );
  assert.equal(r.status, 502);
  assert.doesNotMatch(await r.text(), /synthetic-token|secret/);
});

type RecoveryError = { code: string; setup?: { githubTokenEnv: string } };
test("missing GitHub credential is actionable and never exposes configuration or calls the provider", async () => {
  delete process.env.TEST_GITHUB;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("No provider call expected");
  };
  let r = await api(
    await req("repositories/validate", "alice", "POST", {
      repository: "org/commerce",
    }),
    ["repositories", "validate"],
  );
  assert.equal(r.status, 503);
  const adminError = (await r.json()) as RecoveryError;
  assert.equal(adminError.code, "github_unconfigured");
  assert.equal("setup" in adminError, false);
  const configured = JSON.parse(JSON.stringify(ts));
  configured[0].members[0].role = "engineer";
  process.env.AIRE_TENANTS_JSON = JSON.stringify(configured);
  r = await api(
    await req("repositories/validate", "alice", "POST", {
      repository: "org/commerce",
    }),
    ["repositories", "validate"],
  );
  const deniedSetup = (await r.json()) as RecoveryError;
  assert.equal(deniedSetup.code, "github_unconfigured");
  assert.equal("setup" in deniedSetup, false);
  r = await api(
    await req("repositories/validate", "alice", "POST", {
      repository: "other/private",
    }),
    ["repositories", "validate"],
  );
  const deniedRepo = (await r.json()) as RecoveryError;
  assert.equal(deniedRepo.code, "repository_not_allowed");
  assert.equal("setup" in deniedRepo, false);
  assert.equal(calls, 0);
});

test("GitHub failures distinguish authentication, SSO, policy, limits and availability without reflecting upstream secrets", async () => {
  for (const [status, headers, expectedStatus, code] of [
    [401, {}, 502, "github_credentials"],
    [
      403,
      { "x-github-sso": "required; url=https://example.test/synthetic-secret" },
      403,
      "github_sso",
    ],
    [403, {}, 403, "github_forbidden"],
    [403, { "x-ratelimit-remaining": "0" }, 429, "github_rate_limited"],
    [403, { "retry-after": "60" }, 429, "github_rate_limited"],
    [429, {}, 429, "github_rate_limited"],
    [404, {}, 404, "repository_unavailable"],
    [503, {}, 502, "github_unavailable"],
  ] as [number, Record<string, string>, number, string][]) {
    globalThis.fetch = async () =>
      new Response("synthetic-secret", { status, headers });
    const r = await api(
      await req("repositories/validate", "alice", "POST", {
        repository: "org/commerce",
      }),
      ["repositories", "validate"],
    );
    assert.equal(r.status, expectedStatus);
    const body = (await r.json()) as RecoveryError;
    assert.equal(body.code, code);
    assert.doesNotMatch(
      JSON.stringify(body),
      /synthetic-secret|synthetic-github-token/,
    );
  }
});

test("repository metadata success followed by missing commit identifies the revision step", async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    if (String(input).endsWith("/repos/org/commerce"))
      return Response.json({ default_branch: "main", private: true });
    assert.ok(String(input).endsWith("/commits/does-not-exist"));
    return new Response(null, { status: 404 });
  };
  const r = await api(
    await req("repositories/validate", "alice", "POST", {
      repository: "org/commerce",
      ref: "does-not-exist",
    }),
    ["repositories", "validate"],
  );
  assert.equal(r.status, 404);
  assert.equal(
    ((await r.json()) as RecoveryError).code,
    "revision_unavailable",
  );
  assert.equal(calls, 2);
});

test("GitHub network failures do not claim that credentials are invalid", async () => {
  globalThis.fetch = async () => {
    throw new Error("network synthetic-secret");
  };
  const r = await api(
    await req("repositories/validate", "alice", "POST", {
      repository: "org/commerce",
    }),
    ["repositories", "validate"],
  );
  assert.equal(r.status, 502);
  assert.equal(((await r.json()) as RecoveryError).code, "github_unavailable");
});

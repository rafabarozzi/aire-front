import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tenant } from "../lib/server/config.ts";
import { seal, cookie, SESSION_COOKIE } from "../lib/server/session.ts";
import { saveJourney } from "../lib/server/store.ts";
import { api } from "../lib/server/api.ts";
import type { Journey } from "../lib/aire/types.ts";
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

test("readiness ownership gate rejects another tenant before network", async () => {
  await saveJourney("alpha", journey);
  const path = `journeys/${id}/readiness`;
  assert.equal(
    (await api(await req(path, "bob"), path.split("/"))).status,
    404,
  );
});

test("readiness mutation requires dedicated permission even with journey read", async () => {
  const limited = tenant("alpha", "alice");
  limited.members[0].role = "viewer";
  process.env.AIRE_TENANTS_JSON = JSON.stringify([limited]);
  await saveJourney("alpha", journey);
  const path = `journeys/${id}/readiness/91ec72d0-3101-49f6-a514-4ab1ad9be830/execute`;
  assert.equal(
    (await api(await req(path, "alice", "POST", {}), path.split("/"))).status,
    403,
  );
});

test("readiness evaluation is bound to the selected journey", async () => {
  await saveJourney("alpha", journey);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ analysis: "another-analysis" });
  };
  const path = `journeys/${id}/readiness/91ec72d0-3101-49f6-a514-4ab1ad9be830/execute`;
  assert.equal(
    (await api(await req(path, "alice", "POST", {}), path.split("/"))).status,
    404,
  );
  assert.equal(calls, 1);
});

test("readiness forwards server-derived tenant and principal, never browser claims", async () => {
  await saveJourney("alpha", journey);
  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-AIRE-Tenant"), "alpha");
    assert.equal(headers.get("X-AIRE-Actor"), "alice");
    assert.ok(
      headers.get("X-AIRE-Permissions")?.includes("readiness:evaluate"),
    );
    return Response.json({ id: "evaluation", state: "QUEUED" });
  };
  const path = `journeys/${id}/readiness`;
  const response = await api(
    await req(path, "alice", "POST", {
      mode: "simulation",
      environment: "lab",
    }),
    path.split("/"),
  );
  assert.equal(response.status, 200);
});

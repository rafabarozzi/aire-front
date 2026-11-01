import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api } from "../lib/server/api.ts";
import {
  seal,
  cookie,
  SESSION_COOKIE,
  sessionResponse,
} from "../lib/server/session.ts";
import { portal } from "../lib/server/portal.ts";
import {
  saveJourney,
  listJourneys,
  journeyHistory,
  lockJourney,
  evolution,
} from "../lib/server/store.ts";
import type { Journey } from "../lib/aire/types.ts";
const saved = { ...process.env },
  fetcher = globalThis.fetch;
let dir: string;
const origin = "https://aire.northeia.com",
  customer = "https://lab.northeia.com";
const operator = {
  sub: "op",
  provider: "google",
  issuer: "https://accounts.google.com",
  name: "Operator",
  groups: [],
};
const member = {
  ...operator,
  sub: "member",
  workspace: "lab",
  domain: "customer.example",
};
const tenant = {
  id: "lab",
  name: "Lab",
  publicOrigin: customer,
  members: [{ provider: "google", subject: "member", role: "admin" }],
  groups: [],
  repositories: ["org/repo"],
  githubTokenEnv: "LAB_GITHUB",
  engineUrlEnv: "LAB_URL",
  engineTokenEnv: "LAB_TOKEN",
  enabled: true,
  sso: { googleDomains: ["customer.example"] },
  plan: { name: "POC", monthlyUsd: 100 },
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aire-portals-"));
  Object.assign(process.env, {
    AIRE_DATA_DIR: dir,
    AIRE_MODE: "live",
    AIRE_PORTAL_MODE: "multi",
    AIRE_APP_ORIGIN: origin,
    AIRE_SESSION_SECRET: "x".repeat(40),
    AIRE_TENANTS_JSON: JSON.stringify([tenant]),
    AIRE_PLATFORM_ADMINS_JSON: JSON.stringify([
      {
        provider: operator.provider,
        issuer: operator.issuer,
        subject: operator.sub,
      },
    ]),
    LAB_URL: "https://engine.example",
    LAB_TOKEN: "secret",
  });
  globalThis.fetch = async () => {
    throw Error("Unexpected network");
  };
});
afterEach(async () => {
  globalThis.fetch = fetcher;
  for (const k of Object.keys(process.env))
    if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await rm(dir, { recursive: true, force: true });
});
async function req(
  base: string,
  path: string,
  identity = operator,
  boundOrigin = base,
  method = "GET",
  data?: unknown,
) {
  return new Request(base + "/api/console/" + path, {
    method,
    headers: {
      origin: base,
      cookie: cookie(
        SESSION_COOKIE,
        await seal({ identity, origin: boundOrigin }, "session", 300),
        300,
      ),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
const job = (
  id = "11111111-1111-4111-8111-111111111111",
  at = "2026-11-01T10:00:00Z",
): Journey => ({
  id,
  name: "Checkout",
  tier: "Gold",
  repository: "org/repo",
  endpoint: "POST /checkout",
  revision: "a".repeat(40),
  status: "COMPLETED",
  createdAt: at,
  stacks: [],
});
test("operator panel works without customer membership; customer admin cannot access it", async () => {
  assert.equal(
    (await api(await req(origin, "platform"), ["platform"])).status,
    200,
  );
  assert.equal(
    (await sessionResponse(await req(origin, "session"))).portal,
    "admin",
  );
  assert.equal(
    (await api(await req(origin, "platform", member), ["platform"])).status,
    403,
  );
  assert.equal(
    (await api(await req(customer, "platform", member), ["platform"])).status,
    403,
  );
  assert.equal(
    (await api(await req(origin, "journeys"), ["journeys"])).status,
    403,
  );
});
test("host binding rejects cookie replay, forged forwarded host and unknown portals", async () => {
  assert.equal(
    (await api(await req(customer, "journeys", member, origin), ["journeys"]))
      .status,
    401,
  );
  const forged = new Request("https://evil.example/api/console/journeys", {
    headers: { "x-forwarded-host": "lab.northeia.com" },
  });
  assert.throws(() => portal(forged));
  const wrong = { ...member, workspace: "other" };
  assert.equal(
    (await api(await req(customer, "journeys", wrong), ["journeys"])).status,
    403,
  );
  const csrf = await req(customer, "journeys", member, customer, "POST", {});
  csrf.headers.set("origin", origin);
  assert.equal((await api(csrf, ["journeys"])).status, 403);
});
test("legacy duplicates collapse without deleting history; endpoint method and subdirectory separate journeys", async () => {
  const first = job(),
    second = {
      ...job("22222222-2222-4222-8222-222222222222", "2026-11-02T10:00:00Z"),
      name: "Renamed",
      revision: "b".repeat(40),
      repository: "ORG/REPO",
    };
  await saveJourney("lab", first);
  await saveJourney("lab", second);
  assert.equal((await listJourneys("lab")).length, 1);
  assert.equal((await listJourneys("lab"))[0].versionCount, 2);
  assert.equal((await journeyHistory("lab", second)).length, 2);
  await saveJourney("lab", {
    ...job("33333333-3333-4333-8333-333333333333"),
    sourceSubdirectory: "other",
  });
  await saveJourney("lab", {
    ...job("44444444-4444-4444-8444-444444444444"),
    endpoint: "GET /checkout",
  });
  assert.equal((await listJourneys("lab")).length, 3);
  assert.equal((await evolution("lab")).reanalyses, 1);
  assert.equal((await evolution("lab")).outcomes.hoursSaved, null);
  assert.deepEqual(await listJourneys("other"), []);
});
test("same revision reused before upstream calls and durable preparation lock rejects competing requests", async () => {
  const j = job();
  await saveJourney("lab", j);
  const response = await api(
    await req(customer, "journeys", member, customer, "POST", {
      name: j.name,
      tier: j.tier,
      endpoint: j.endpoint,
      repository: j.repository,
      revision: j.revision,
    }),
    ["journeys"],
  );
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { reused: boolean }).reused, true);
  const release = await lockJourney("lab", j);
  await assert.rejects(lockJourney("lab", j));
  await release();
  await (
    await lockJourney("lab", j)
  )();
});
test("billing unknown measurements and unavailable engine are never reported as free usage", async () => {
  globalThis.fetch = async () =>
    Response.json({
      month: "2026-11",
      attempts: 2,
      input_tokens: 10,
      output_tokens: 5,
      usage_unknown_attempts: 1,
      unpriced_attempts: 1,
      estimated_ai_usd: "0",
      events: [{ secret: "not in aggregate" }],
    });
  const data = (await (
    await api(await req(origin, "platform/billing?month=2026-11"), [
      "platform",
      "billing",
    ])
  ).json()) as {
    rows: Array<{ usage: { unpriced_attempts: number; events?: unknown } }>;
  };
  assert.equal(data.rows[0].usage.unpriced_attempts, 1);
  assert.equal(data.rows[0].usage.events, undefined);
  globalThis.fetch = async () => {
    throw Error("down");
  };
  const down = (await (
    await api(await req(origin, "platform/billing"), ["platform", "billing"])
  ).json()) as { rows: Array<{ usage: null; status: string }> };
  assert.equal(down.rows[0].usage, null);
  assert.equal(down.rows[0].status, "unavailable");
});

test("unconfigured container keeps unauthenticated journey API closed with 401", async () => {
  delete process.env.AIRE_APP_ORIGIN;
  delete process.env.AIRE_SESSION_SECRET;
  delete process.env.AIRE_PORTAL_MODE;
  const response = await api(
    new Request("http://127.0.0.1:3000/api/console/journeys"),
    ["journeys"],
  );
  assert.equal(response.status, 401);
});

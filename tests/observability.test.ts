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

import {
  environmentSchema,
  isReadinessInProgress,
  defaultObservabilityPolicy,
  policySchema,
  resolvedWait,
  suggestedRules,
} from "../lib/aire/observability.ts";
import {
  saveObservabilityPolicy,
  readObservabilityPolicy,
  readJourneyPreferences,
  saveJourneyPreferences,
} from "../lib/server/observability-store.ts";
const evaluationId = "81ec72d0-3101-49f6-a514-4ab1ad9be831";
const capabilities = {
  policyContract: 1,
  modes: ["simulation"],
  warRoomOverrides: true,
  messageGeneration: true,
};
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  subject = "alice",
) {
  return api(await req(path, subject, method, body), path.split("/"));
}
test("policy saves with revision and is isolated between tenants", async () => {
  const p = defaultObservabilityPolicy();
  p.response.defaultWaitSeconds = 60;
  const r = await call("observability/policy", "PUT", {
    revision: 0,
    policy: p,
  });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { revision: number }).revision, 1);
  assert.equal(
    (await readObservabilityPolicy("beta")).policy.response.defaultWaitSeconds,
    300,
  );
  assert.equal(
    (await call("observability/policy", "PUT", { revision: 0, policy: p }))
      .status,
    409,
  );
});
test("policy edit requires configure permission and preserves CSRF protection", async () => {
  const limited = tenant("alpha", "alice");
  limited.members[0].role = "viewer";
  process.env.AIRE_TENANTS_JSON = JSON.stringify([limited]);
  assert.equal(
    (
      await call("observability/policy", "PUT", {
        revision: 0,
        policy: defaultObservabilityPolicy(),
      })
    ).status,
    403,
  );
  const r = await req(
    "observability/policy",
    "alice",
    "PUT",
    {},
    "https://evil.example.test",
  );
  assert.equal((await api(r, ["observability", "policy"])).status, 403);
});
test("new evaluation blocks unsupported engines before any mutation", async () => {
  await saveJourney("alpha", journey);
  let posts = 0;
  globalThis.fetch = async (_u, init) => {
    if (init?.method === "POST") posts++;
    return new Response("{}", { status: 404 });
  };
  assert.equal(
    (
      await call(`observability/journeys/${id}/evaluations`, "POST", {
        mode: "simulation",
        environment: "lab",
      })
    ).status,
    409,
  );
  assert.equal(posts, 0);
});
test("new evaluation sends server-owned policy and logical journey tags", async () => {
  await saveJourney("alpha", journey);
  const p = defaultObservabilityPolicy();
  p.response.defaultWaitSeconds = 600;
  await saveObservabilityPolicy("alpha", 0, p, "alice");
  await saveJourneyPreferences(
    "alpha",
    journey,
    0,
    { journey: "checkout" },
    "alice",
  );
  let sent: Record<string, unknown> = {};
  globalThis.fetch = async (u, init) => {
    if (String(u).endsWith("/capabilities")) return Response.json(capabilities);
    sent = JSON.parse(String(init?.body));
    return Response.json({ id: evaluationId });
  };
  assert.equal(
    (
      await call(`observability/journeys/${id}/evaluations`, "POST", {
        mode: "simulation",
        environment: "lab",
      })
    ).status,
    200,
  );
  assert.equal((sent.policy_context as { revision: number }).revision, 1);
  assert.deepEqual(Object.keys(sent.policy_context as object).sort(), [
    "policy",
    "revision",
    "updatedAt",
  ]);
  assert.deepEqual(sent.journey_tags, { journey: "checkout" });
  assert.equal(
    (
      await call(`observability/journeys/${id}/evaluations`, "POST", {
        mode: "simulation",
        environment: "lab",
        policy: {},
      })
    ).status,
    422,
  );
});
test("preferences follow new analysis of the same journey and remain tenant-scoped", async () => {
  await saveJourneyPreferences(
    "alpha",
    journey,
    0,
    { journey: "checkout" },
    "alice",
  );
  assert.deepEqual(
    (await readJourneyPreferences("alpha", { ...journey, id: evaluationId }))
      .tags,
    { journey: "checkout" },
  );
  assert.deepEqual((await readJourneyPreferences("beta", journey)).tags, {});
  await saveJourney("alpha", journey);
  assert.equal(
    (
      await call(
        `observability/journeys/${id}/preferences`,
        "GET",
        undefined,
        "bob",
      )
    ).status,
    404,
  );
});
test("approval validates required tags and preserves immediate vs inherited delay", async () => {
  await saveJourney("alpha", journey);
  const p = defaultObservabilityPolicy();
  const evaluation = {
    id: evaluationId,
    analysis: id,
    data: {
      policy_context: { revision: 0, policy: p },
      recommendations: [
        { id: "rec", version: "v1", prerequisites: [], execution: null },
      ],
    },
  };
  let payload: Record<string, unknown> = {};
  globalThis.fetch = async (u, init) => {
    if (String(u).endsWith("/capabilities")) return Response.json(capabilities);
    if (init?.method === "POST") {
      payload = JSON.parse(String(init.body));
      return Response.json({ approval_token: "token" });
    }
    return Response.json(evaluation);
  };
  const path = `observability/journeys/${id}/evaluations/${evaluationId}/accept`;
  const selection = {
    id: "rec",
    version: "v1",
    tags: {},
    monitor_settings: { warRoomEnabled: false, waitSeconds: null },
  };
  assert.equal(
    (await call(path, "POST", { selections: [selection] })).status,
    422,
  );
  assert.equal(
    (
      await call(path, "POST", {
        selections: [
          {
            ...selection,
            tags: { journey: "checkout" },
            monitor_settings: { warRoomEnabled: false, waitSeconds: 0 },
          },
        ],
      })
    ).status,
    200,
  );
  assert.equal(
    (payload.selections as { monitor_settings: { waitSeconds: number } }[])[0]
      .monitor_settings.waitSeconds,
    0,
  );
  assert.equal(
    resolvedWait({ warRoomEnabled: false, waitSeconds: null }, p),
    300,
  );
  assert.equal(resolvedWait({ warRoomEnabled: false, waitSeconds: 0 }, p), 0);
});
test("legacy execution cannot bypass saved policies", async () => {
  await saveJourney("alpha", journey);
  await saveObservabilityPolicy(
    "alpha",
    0,
    defaultObservabilityPolicy(),
    "alice",
  );
  assert.equal(
    (await call(`journeys/${id}/readiness`, "POST", {})).status,
    409,
  );
});
test("matrix must cover all combinations and response requirements are explicit", () => {
  const p = defaultObservabilityPolicy();
  p.mode = "custom";
  assert.equal(policySchema.safeParse(p).success, false);
  p.rules = suggestedRules();
  assert.equal(p.rules.length, 36);
  assert.equal(policySchema.safeParse(p).success, true);
  p.response.warRoomEnabled = true;
  assert.equal(policySchema.safeParse(p).success, false);
  p.response.team = "SRE";
  p.response.onCallReference = "schedule-id";
  p.response.roomTarget = "channel-id";
  assert.equal(policySchema.safeParse(p).success, true);
  p.tags.definitions.push({
    key: "journey",
    required: false,
    defaultValue: "",
  });
  assert.equal(policySchema.safeParse(p).success, false);
});

test("aggregated history forwards actor and permissions for every analysis", async () => {
  await saveJourney("alpha", journey);
  await saveJourney("alpha", {
    ...journey,
    id: evaluationId,
    createdAt: "2026-11-03T00:00:00Z",
  });
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-AIRE-Actor"), "alice");
    assert.ok(
      headers.get("X-AIRE-Permissions")?.split(",").includes("readiness:read"),
    );
    assert.equal(headers.get("X-AIRE-Tenant"), "alpha");
    calls++;
    return Response.json([]);
  };
  const response = await call("observability/journeys");
  assert.equal(response.status, 200);
  const body = (await response.json()) as { items: { error: unknown }[] };
  assert.equal(body.items[0].error, null);
  assert.equal(calls, 2);
});
test("environment identifiers match the motor and reject invalid input before POST", async () => {
  for (const value of ["lab", "prod-br", "ENV_1.2", "a".repeat(80)])
    assert.equal(environmentSchema.safeParse(value).success, true);
  await saveJourney("alpha", journey);
  let posts = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") posts++;
    return Response.json(capabilities);
  };
  for (const value of [
    "",
    "prod br",
    " lab",
    "lab ",
    "produção",
    "a".repeat(81),
  ]) {
    assert.equal(environmentSchema.safeParse(value).success, false);
    assert.equal(
      (
        await call(`observability/journeys/${id}/evaluations`, "POST", {
          mode: "simulation",
          environment: value,
        })
      ).status,
      422,
    );
  }
  assert.equal(posts, 0);
});
test("polling continues through investigation and queued execution but stops on terminal or paused states", () => {
  for (const state of [
    "QUEUED",
    "RUNNING",
    "EXECUTING",
    "DISCOVERING",
    "EVALUATING",
    "INVESTIGATING",
    "EXECUTION_QUEUED",
  ])
    assert.equal(isReadinessInProgress(state), true);
  for (const state of [
    "COMPLETED",
    "FAILED",
    "AWAITING_CONTINUATION",
    "AWAITING_APPROVAL",
  ])
    assert.equal(isReadinessInProgress(state), false);
});

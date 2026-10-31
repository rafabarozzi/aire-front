import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  stat,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api } from "../lib/server/api.ts";
import { seal, cookie, SESSION_COOKIE } from "../lib/server/session.ts";
import { githubCredential } from "../lib/server/connections.ts";
import { readPolicy } from "../lib/server/store.ts";
import { defaultPolicy, type ConnectionsView } from "../lib/aire/types.ts";
import type { Tenant } from "../lib/server/config.ts";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const syntheticToken = "github_pat_SYNTHETIC_TOKEN_FOR_CONNECTION_TESTS";
const tenant = (id: string, subject: string): Tenant => ({
  id,
  name: id,
  members: [{ provider: "google", subject, role: "admin" }],
  groups: [],
  repositories: ["org/seed"],
  githubTokenEnv: "TEST_GITHUB_FALLBACK",
  engineUrlEnv: "TEST_ENGINE_URL",
  engineTokenEnv: "TEST_ENGINE_TOKEN",
});
const alpha = tenant("alpha", "alice"),
  beta = tenant("beta", "bob");
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aire-connection-test-"));
  process.env.AIRE_DATA_DIR = dir;
  process.env.AIRE_MODE = "live";
  process.env.AIRE_APP_ORIGIN = "https://aire.example.test";
  process.env.AIRE_SESSION_SECRET =
    "synthetic-session-secret-at-least-32-chars";
  delete process.env.AIRE_CREDENTIAL_SECRET;
  process.env.AIRE_TENANTS_JSON = JSON.stringify([alpha, beta]);
  process.env.TEST_GITHUB_FALLBACK = "synthetic-environment-credential";
  globalThis.fetch = async () => {
    throw new Error("Unexpected provider call");
  };
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const k of Object.keys(process.env))
    if (!(k in originalEnv)) delete process.env[k];
  Object.assign(process.env, originalEnv);
  await rm(dir, { recursive: true, force: true });
});
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  subject = "alice",
  origin = "https://aire.example.test",
) {
  const session = await seal(
    {
      identity: { sub: subject, provider: "google", groups: [], name: "Test" },
    },
    "session",
    60,
  );
  return api(
    new Request(`https://aire.example.test/api/console/${path}`, {
      method,
      headers: {
        cookie: cookie(SESSION_COOKIE, session, 60),
        origin,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split("/"),
  );
}
async function view(subject = "alice") {
  return (await (
    await call("connections", "GET", undefined, subject)
  ).json()) as ConnectionsView;
}

test("credential is encrypted at rest, write-only over API and used immediately for this tenant", async () => {
  const response = await call("connections/github", "PUT", {
    label: "GitHub Lab",
    token: syntheticToken,
    revision: 0,
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /github_pat_|encrypted|ciphertext/);
  assert.equal((await view()).credential?.label, "GitHub Lab");
  assert.equal(await githubCredential(alpha), syntheticToken);
  assert.equal(
    await githubCredential(beta),
    "synthetic-environment-credential",
  );
  const saved = await readFile(join(dir, "alpha", "connections.json"), "utf8");
  assert.ok(JSON.parse(saved).credential.encrypted);
  assert.ok(!saved.includes(syntheticToken));
  assert.ok(
    !(await readFile(join(dir, "alpha", "audit.jsonl"), "utf8")).includes(
      syntheticToken,
    ),
  );
  assert.equal(
    (await stat(join(dir, "alpha", "connections.json"))).mode & 0o777,
    0o600,
  );
  let authorization = "";
  globalThis.fetch = async (input, init) => {
    authorization = new Headers(init?.headers).get("authorization") || "";
    return String(input).includes("/commits/")
      ? Response.json({ sha: "a".repeat(40) })
      : Response.json({ default_branch: "main", private: true });
  };
  assert.equal(
    (await call("repositories/validate", "POST", { repository: "org/seed" }))
      .status,
    200,
  );
  assert.equal(authorization, `Bearer ${syntheticToken}`);
});

test("credential name edit preserves secret; replacement and deletion work without restarting and deletion blocks env fallback", async () => {
  await call("connections/github", "PUT", {
    label: "First",
    token: syntheticToken,
    revision: 0,
  });
  assert.equal(
    (await call("connections/github", "PUT", { label: "Renamed", revision: 1 }))
      .status,
    200,
  );
  assert.equal(await githubCredential(alpha), syntheticToken);
  const replacement = "github_pat_SYNTHETIC_REPLACEMENT_TOKEN";
  await call("connections/github", "PUT", {
    label: "Rotated",
    token: replacement,
    revision: 2,
  });
  assert.equal(await githubCredential(alpha), replacement);
  assert.equal(
    (await call("connections/github", "DELETE", { revision: 3 })).status,
    200,
  );
  assert.equal((await view()).githubConfigured, false);
  assert.equal(await githubCredential(alpha), undefined);
  const validation = await call("repositories/validate", "POST", {
    repository: "org/seed",
  });
  assert.equal(
    ((await validation.json()) as { code: string }).code,
    "github_unconfigured",
  );
  assert.equal(
    (await call("connections/github", "PUT", { label: "Missing", revision: 4 }))
      .status,
    422,
  );
});

test("repository CRUD persists policy overrides, prevents duplicate and cross-tenant mutations, and immediately revokes validation", async () => {
  assert.equal(
    (
      await call("connections/repositories", "POST", {
        repository: "https://github.com/org/new.git",
        revision: 0,
      })
    ).status,
    200,
  );
  assert.deepEqual((await view()).repositories, ["org/seed", "org/new"]);
  assert.deepEqual((await view("bob")).repositories, ["org/seed"]);
  assert.equal(
    (
      await call("connections/repositories", "POST", {
        repository: "ORG/NEW",
        revision: 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("connections/repositories", "PATCH", {
        previousRepository: "org/new",
        repository: "org/renamed",
        revision: 1,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("connections/repositories", "DELETE", {
        repository: "org/seed",
        revision: 2,
      })
    ).status,
    200,
  );
  assert.deepEqual((await view()).repositories, ["org/renamed"]);
  const validation = await call("repositories/validate", "POST", {
    repository: "org/seed",
  });
  assert.equal(
    ((await validation.json()) as { code: string }).code,
    "repository_not_allowed",
  );
  assert.equal(
    (
      await call("connections/repositories", "POST", {
        repository: "org/injected",
        revision: 3,
        tenant: "beta",
      })
    ).status,
    422,
  );
  assert.deepEqual((await view("bob")).repositories, ["org/seed"]);
});

test("non-managers cannot mutate connections and CSRF is rejected before storage", async () => {
  const limited = JSON.parse(JSON.stringify([alpha, beta]));
  limited[0].members[0].role = "engineer";
  process.env.AIRE_TENANTS_JSON = JSON.stringify(limited);
  for (const [path, method, body] of [
    [
      "connections/github",
      "PUT",
      { label: "x", token: syntheticToken, revision: 0 },
    ],
    ["connections/github", "DELETE", { revision: 0 }],
    [
      "connections/repositories",
      "POST",
      { repository: "org/new", revision: 0 },
    ],
    [
      "connections/repositories",
      "PATCH",
      { repository: "org/new", previousRepository: "org/seed", revision: 0 },
    ],
    [
      "connections/repositories",
      "DELETE",
      { repository: "org/seed", revision: 0 },
    ],
  ] as [string, string, object][])
    assert.equal((await call(path, method, body)).status, 403);
  assert.equal((await view()).revision, 0);
  assert.equal(
    (
      await call(
        "connections/github",
        "PUT",
        { label: "x", token: syntheticToken, revision: 0 },
        "bob",
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal((await view("bob")).revision, 0);
});

test("concurrent edits with the same revision cannot silently overwrite each other", async () => {
  const result = await Promise.all([
    call("connections/repositories", "POST", {
      repository: "org/one",
      revision: 0,
    }),
    call("connections/repositories", "POST", {
      repository: "org/two",
      revision: 0,
    }),
  ]);
  assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await view()).repositories.length, 2);
  assert.equal((await view()).revision, 1);
});

test("encrypted credential cannot be transplanted into another tenant and can be replaced after key loss", async () => {
  await call("connections/github", "PUT", {
    label: "First",
    token: syntheticToken,
    revision: 0,
  });
  await mkdir(join(dir, "beta"));
  await copyFile(
    join(dir, "alpha", "connections.json"),
    join(dir, "beta", "connections.json"),
  );
  await assert.rejects(githubCredential(beta), {
    code: "credential_encryption",
  });
  process.env.AIRE_CREDENTIAL_SECRET =
    "a-different-synthetic-credential-encryption-key";
  await assert.rejects(githubCredential(alpha), {
    code: "credential_encryption",
  });
  assert.equal(
    (
      await call("connections/github", "PUT", {
        label: "Recovered",
        token: syntheticToken,
        revision: 1,
      })
    ).status,
    200,
  );
  assert.equal(await githubCredential(alpha), syntheticToken);
});

test("old RBAC policies gain connection management only for administrators", async () => {
  await mkdir(join(dir, "alpha"));
  const old = structuredClone(defaultPolicy);
  old.admin = old.admin.filter((p) => p !== "connections:manage");
  await writeFile(join(dir, "alpha", "policy.json"), JSON.stringify(old));
  const migrated = await readPolicy("alpha");
  assert.ok(migrated.admin.includes("connections:manage"));
  assert.ok(!migrated.engineer.includes("connections:manage"));
  assert.ok(!migrated.viewer.includes("connections:manage"));
});

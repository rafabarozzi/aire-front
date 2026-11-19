import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { jwtVerify } from "jose";
import { api } from "../lib/server/api.ts";
import { seal, cookie, SESSION_COOKIE } from "../lib/server/session.ts";
import { githubCredential } from "../lib/server/connections.ts";
import { integration } from "../lib/server/integrations.ts";
import { snapshot } from "../lib/server/upstream.ts";
import type { ConnectionsView } from "../lib/aire/types.ts";
import type { Tenant } from "../lib/server/config.ts";

const originalEnv = { ...process.env },
  originalFetch = globalThis.fetch;
const tenant = (id: string, subject: string): Tenant => ({
  id,
  name: id,
  members: [{ provider: "google", subject, role: "admin" }],
  groups: [],
  repositories: ["group/project"],
  githubTokenEnv: "TEST_GITHUB",
  engineUrlEnv: "TEST_ENGINE",
  engineTokenEnv: "TEST_ENGINE_TOKEN",
});
const alpha = tenant("alpha", "alice"),
  beta = tenant("beta", "bob"),
  token = "synthetic-provider-token-never-real";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aire-integrations-"));
  Object.assign(process.env, {
    AIRE_DATA_DIR: dir,
    AIRE_MODE: "live",
    AIRE_APP_ORIGIN: "https://aire.example.test",
    AIRE_SESSION_SECRET: "synthetic-session-secret-at-least-32-chars",
    AIRE_TENANTS_JSON: JSON.stringify([alpha, beta]),
    TEST_GITHUB: "synthetic-legacy-fallback",
    TEST_ENGINE: "http://127.0.0.1:18088",
    TEST_ENGINE_TOKEN: "synthetic-engine-token",
  });
  delete process.env.AIRE_CREDENTIAL_SECRET;
  globalThis.fetch = async () => {
    throw new Error("Unexpected network");
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
    new Request("https://aire.example.test/api/console/" + path, {
      method,
      headers: {
        cookie: cookie(SESSION_COOKIE, session, 60),
        origin,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    path.split("?")[0].split("/"),
  );
}
async function save(provider: string, credential: unknown, revision = 0) {
  const r = await call("connections/integrations/" + provider, "PUT", {
    revision,
    credential,
  });
  assert.equal(r.status, 200, await r.clone().text());
  return r;
}

test("all providers are encrypted, redacted, tenant-bound and recoverable after key loss", async () => {
  for (const [p, c] of [
    ["github", { kind: "github-token", token }],
    ["gitlab", { kind: "gitlab-token", token }],
    [
      "datadog",
      {
        kind: "datadog",
        site: "datadoghq.eu",
        apiKey: token,
        applicationKey: token,
      },
    ],
    [
      "dynatrace",
      {
        kind: "dynatrace",
        environment: "https://test.live.dynatrace.com",
        token,
      },
    ],
  ] as const) {
    const result = await save(p, c);
    assert.ok(!(await result.text()).includes(token));
    const saved = await readFile(
      join(dir, "alpha", "integration-" + p + ".json"),
      "utf8",
    );
    assert.ok(!saved.includes(token));
    assert.ok(JSON.parse(saved).encrypted);
    assert.equal(await integration(beta, p), undefined);
  }
  assert.ok(
    !(await readFile(join(dir, "alpha", "audit.jsonl"), "utf8")).includes(
      token,
    ),
  );
  await mkdir(join(dir, "beta"));
  await copyFile(
    join(dir, "alpha", "integration-gitlab.json"),
    join(dir, "beta", "integration-gitlab.json"),
  );
  await assert.rejects(integration(beta, "gitlab"), {
    code: "credential_encryption",
  });
  process.env.AIRE_CREDENTIAL_SECRET = "changed-synthetic-encryption-secret-32";
  const view = (await (await call("connections/integrations")).json()) as {
    needsReplacement: boolean;
    revision: number;
  }[];
  assert.equal(view[0].needsReplacement, true);
  assert.equal(view[0].revision, 1);
  await save("github", { kind: "github-token", token }, 1);
  assert.equal(await githubCredential(alpha), token);
});

test("GitHub replacement/delete preserves legacy data without resurrecting a revoked token", async () => {
  assert.equal(await githubCredential(alpha), "synthetic-legacy-fallback");
  await save("github", { kind: "github-token", token });
  assert.equal(
    (await call("connections/github", "DELETE", { revision: 0 })).status,
    409,
  );
  assert.equal(
    (await call("connections/integrations/github", "DELETE", { revision: 1 }))
      .status,
    200,
  );
  assert.equal(await githubCredential(alpha), undefined);
  assert.equal(
    ((await (await call("connections")).json()) as ConnectionsView)
      .githubConfigured,
    false,
  );
  assert.equal(await githubCredential(beta), "synthetic-legacy-fallback");
  assert.equal(
    (await call("connections/integrations/github/test", "POST", {})).status,
    503,
  );
});

test("RBAC, CSRF, provider matching and concurrent revisions are enforced", async () => {
  const a = structuredClone(alpha);
  a.members[0].role = "engineer";
  process.env.AIRE_TENANTS_JSON = JSON.stringify([a, beta]);
  for (const [suffix, method, body] of [
    ["github/repositories", "GET", undefined],
    ["github/test", "POST", {}],
    [
      "github",
      "PUT",
      { revision: 0, credential: { kind: "github-token", token } },
    ],
    ["github", "DELETE", { revision: 0 }],
  ] as const)
    assert.equal(
      (await call("connections/integrations/" + suffix, method, body)).status,
      403,
    );
  process.env.AIRE_TENANTS_JSON = JSON.stringify([alpha, beta]);
  assert.equal(
    (
      await call(
        "connections/integrations/github",
        "PUT",
        { revision: 0, credential: { kind: "github-token", token } },
        "alice",
        "https://evil.test",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("connections/integrations/gitlab", "PUT", {
        revision: 0,
        credential: { kind: "github-token", token },
      })
    ).status,
    422,
  );
  const changes = await Promise.all(
    [1, 2].map(() =>
      call("connections/integrations/github", "PUT", {
        revision: 0,
        credential: { kind: "github-token", token },
      }),
    ),
  );
  assert.deepEqual(changes.map((r) => r.status).sort(), [200, 409]);
});

test("GitHub App signs an RSA JWT, scopes installation tokens and uses the installation catalog", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  await save("github", {
    kind: "github-app",
    appId: "Iv1.test-client",
    installationId: "1234",
    privateKey: privateKey.export({ format: "pem", type: "pkcs1" }).toString(),
  });
  let issued = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.redirect, "error");
    const url = String(input),
      headers = new Headers(init?.headers);
    if (url.endsWith("/access_tokens")) {
      issued++;
      assert.equal(
        url,
        "https://api.github.com/app/installations/1234/access_tokens",
      );
      const { payload } = await jwtVerify(
        headers.get("authorization")!.slice(7),
        publicKey,
        { issuer: "Iv1.test-client", algorithms: ["RS256"] },
      );
      assert.ok(payload.exp! - payload.iat! <= 600);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        permissions: { contents: "read", metadata: "read" },
      });
      return Response.json({
        token: "installation-token",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      });
    }
    assert.match(url, /\/installation\/repositories\?per_page=100&page=1$/);
    assert.equal(headers.get("authorization"), "Bearer installation-token");
    return Response.json({ repositories: [{ full_name: "group/project" }] });
  };
  const response = await call("connections/integrations/github/repositories");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    repositories: ["group/project"],
    nextPage: null,
  });
  assert.equal(
    (await call("connections/integrations/github/repositories")).status,
    200,
  );
  assert.equal(
    issued,
    1,
    "reuse the installation token until its renewal window",
  );
});

test("GitLab subgroups resolve a branch, pin archive to SHA and stay distinct from GitHub", async () => {
  const repository = "https://gitlab.com/group/subgroup/project",
    revision = "a".repeat(40);
  await save("gitlab", { kind: "gitlab-token", token });
  assert.equal(
    (
      await call("connections/repositories", "POST", {
        repository,
        revision: 0,
      })
    ).status,
    200,
  );
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("PRIVATE-TOKEN"), token);
    if (url.includes("archive.zip")) {
      assert.ok(url.endsWith("?sha=" + revision));
      return new Response(new Uint8Array([80, 75, 3, 4]));
    }
    if (url.includes("/repository/commits/")) {
      assert.ok(url.endsWith("feature%2Fcheckout"));
      return Response.json({ id: revision });
    }
    assert.ok(url.endsWith("group%2Fsubgroup%2Fproject"));
    return Response.json({ default_branch: "main", visibility: "private" });
  };
  const r = await call("repositories/validate", "POST", {
    repository,
    ref: "feature/checkout",
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {
    repository,
    branch: "feature/checkout",
    revision,
    private: true,
  });
  assert.deepEqual(
    await snapshot(alpha, repository, revision),
    new Uint8Array([80, 75, 3, 4]),
  );
  assert.equal(
    (
      await call("connections/repositories", "POST", {
        repository: "https://gitlab.com/group/project",
        revision: 1,
      })
    ).status,
    200,
  );
  const view = (await (await call("connections")).json()) as ConnectionsView;
  assert.ok(view.repositories.includes("group/project"));
  assert.ok(view.repositories.includes("https://gitlab.com/group/project"));
  await call("connections/repositories", "DELETE", { repository, revision: 2 });
  await assert.rejects(snapshot(alpha, repository, revision), {
    code: "repository_not_allowed",
  });
});

test("GitLab catalog pages are bounded and failures never expose provider bodies or credentials", async () => {
  await save("gitlab", { kind: "gitlab-token", token });
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    assert.ok(String(input).includes("page=2"));
    return Response.json(
      Array.from({ length: 100 }, (_, i) => ({
        path_with_namespace: "group/sub/repo" + i,
      })),
    );
  };
  const r = await call("connections/integrations/gitlab/repositories?page=2");
  assert.equal(r.status, 200);
  const d = (await r.json()) as { nextPage: number; repositories: string[] };
  assert.equal(d.nextPage, 3);
  assert.equal(d.repositories.length, 100);
  assert.equal(
    (await call("connections/integrations/gitlab/repositories?page=-1")).status,
    422,
  );
  assert.equal(calls, 1);
  globalThis.fetch = async () => new Response(token, { status: 401 });
  const failure = await call(
    "connections/integrations/gitlab/test",
    "POST",
    {},
  );
  assert.equal(failure.status, 502);
  assert.ok(!(await failure.text()).includes(token));
  globalThis.fetch = async () => new Response("rate limit", { status: 429 });
  assert.equal(
    (await call("connections/integrations/gitlab/test", "POST", {})).status,
    429,
  );
});

test("observability tests use approved hosts and read-only operations", async () => {
  for (const environment of [
    "http://localhost",
    "https://test.live.dynatrace.com.evil.test",
    "https://test.live.dynatrace.com/api",
    "https://u:p@test.live.dynatrace.com",
    "https://127.0.0.1",
  ])
    assert.equal(
      (
        await call("connections/integrations/dynatrace", "PUT", {
          revision: 0,
          credential: { kind: "dynatrace", environment, token },
        })
      ).status,
      422,
    );
  assert.equal(
    (
      await call("connections/integrations/datadog", "PUT", {
        revision: 0,
        credential: {
          kind: "datadog",
          site: "evil.test",
          apiKey: token,
          applicationKey: token,
        },
      })
    ).status,
    422,
  );
  await save("datadog", {
    kind: "datadog",
    site: "datadoghq.eu",
    apiKey: token,
    applicationKey: token,
  });
  await save("dynatrace", {
    kind: "dynatrace",
    environment: "https://test.live.dynatrace.com",
    token,
  });
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method, undefined);
    assert.equal(init?.redirect, "error");
    if (String(input).includes("datadog")) {
      assert.equal(
        String(input),
        "https://api.datadoghq.eu/api/v2/validate_keys",
      );
      assert.equal(new Headers(init?.headers).get("DD-APPLICATION-KEY"), token);
      return Response.json({ status: "ok" });
    }
    assert.equal(
      String(input),
      "https://test.live.dynatrace.com/api/v2/entities?pageSize=1",
    );
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Api-Token " + token,
    );
    return Response.json({ entities: [] });
  };
  for (const p of ["datadog", "dynatrace"])
    assert.equal(
      (await call("connections/integrations/" + p + "/test", "POST", {}))
        .status,
      200,
    );
  globalThis.fetch = async () => Response.json({ valid: false });
  assert.equal(
    (await call("connections/integrations/datadog/test", "POST", {})).status,
    422,
  );
});

test("GitLab journey creation sends qualified source metadata to the engine and reuses the same journey", async () => {
  const repository = "https://gitlab.com/group/project",
    revision = "a".repeat(40),
    id = "18a6735c-80d7-4f47-9ce0-f2a0f05b8eb7";
  await save("gitlab", { kind: "gitlab-token", token });
  await call("connections/repositories", "POST", { repository, revision: 0 });
  let created = 0,
    uploaded = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://gitlab.com/")) {
      assert.equal(new Headers(init?.headers).get("PRIVATE-TOKEN"), token);
      if (url.includes("archive.zip"))
        return new Response(new Uint8Array([80, 75, 3, 4]));
      if (url.includes("/commits/")) return Response.json({ id: revision });
      return Response.json({ default_branch: "main", visibility: "private" });
    }
    assert.ok(url.startsWith("http://127.0.0.1:18088/"));
    assert.equal(new Headers(init?.headers).get("PRIVATE-TOKEN"), null);
    if (url.endsWith("/v1/analyses")) {
      created++;
      const metadata = JSON.parse(String(init?.body));
      assert.equal(metadata.repository, repository);
      assert.equal(metadata.revision, revision);
      return Response.json({ analysis_id: id });
    }
    assert.ok(url.endsWith("/source"));
    uploaded++;
    return Response.json({ analysis_id: id, status: "QUEUED" });
  };
  const input = {
    name: "Checkout",
    tier: "Gold",
    endpoint: "POST /checkout",
    repository,
    revision,
  };
  const first = await call("journeys", "POST", input);
  assert.equal(first.status, 202, await first.clone().text());
  const second = await call("journeys", "POST", input);
  assert.equal(second.status, 200);
  assert.equal(created, 1);
  assert.equal(uploaded, 1);
  const data = (await second.json()) as { reused: boolean; repository: string };
  assert.equal(data.reused, true);
  assert.equal(data.repository, repository);
});

test("review registration references are isolated, redacted and cannot provide credentials", async () => {
  const observedAt = "2026-11-05T12:00:00.000Z";
  const file = join(dir, "alpha", "connection-references.json");
  await mkdir(join(dir, "alpha"), {recursive:true});
  await writeFile(file, JSON.stringify({tenant:"alpha", observedAt, github:true, datadog:{engineReadBridge:true}}));
  delete process.env.TEST_GITHUB;
  let probes = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url),"http://127.0.0.1:18088/v1/readiness/capabilities");
    assert.equal(new Headers(init?.headers).get("X-AIRE-Tenant"),"alpha");
    probes++;
    return Response.json({modes:["real"], realRead:{ready:true, validation:{ready:true,privateValue:"never-reveal"}}});
  };
  type Row = {provider: string; configured: boolean; reference?: {observedAt: string; engineStatus?: string}};
  const list = (await (await call("connections/integrations")).json()) as Row[];
  assert.deepEqual(list.find(p=>p.provider==="github")?.reference,{observedAt});
  const dd = list.find(p=>p.provider==="datadog");
  assert.equal(dd?.configured,false);
  assert.deepEqual(dd?.reference,{observedAt,engineStatus:"verified"});
  assert.ok(!JSON.stringify(list).includes("never-reveal"));
  assert.equal(await githubCredential(alpha),undefined);
  const other = (await (await call("connections/integrations","GET",undefined,"bob")).json()) as Row[];
  assert.ok(other.every(p=>!p.reference));
  assert.equal(probes,1);
  globalThis.fetch=async()=>{throw Error("offline")};
  const offline = (await (await call("connections/integrations")).json()) as Row[];
  assert.equal(offline.find(p=>p.provider==="datadog")?.reference?.engineStatus,"unavailable");
  await writeFile(file,JSON.stringify({tenant:"beta",observedAt,github:true}));
  assert.equal((await call("connections/integrations")).status,503);
});

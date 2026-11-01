import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api } from "../lib/server/api.ts";
import {
  setupApi,
  recordVerified,
  candidate,
  SETUP_COOKIE,
} from "../lib/server/onboarding.ts";
import { setupAuth } from "../lib/server/onboarding-oidc.ts";
import { cookie, seal, SESSION_COOKIE, unseal } from "../lib/server/session.ts";
import { tenants, type Identity } from "../lib/server/config.ts";
import { validatedIdentity } from "../lib/server/oidc.ts";
const env = { ...process.env },
  fetcher = globalThis.fetch,
  origin = "https://aire.example",
  ms = "11111111-1111-4111-8111-111111111111";
const operator: Identity = {
  provider: "google",
  issuer: "https://accounts.google.com",
  sub: "operator",
  name: "Operator",
  groups: [],
};
const customer = {
  id: "lab",
  name: "Lab",
  enabled: false,
  publicOrigin: "https://lab.example",
  members: [],
  groups: [],
  repositories: [],
  githubTokenEnv: "LAB_GITHUB",
  engineUrlEnv: "LAB_URL",
  engineTokenEnv: "LAB_TOKEN",
  plan: { name: "POC", monthlyUsd: 0 },
};
let dir = "",
  mail = "",
  operatorCookie = "",
  local = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aire-onboarding-"));
  mail = "";
  local = "";
  Object.assign(process.env, {
    AIRE_DATA_DIR: dir,
    AIRE_MODE: "live",
    AIRE_PORTAL_MODE: "multi",
    AIRE_APP_ORIGIN: origin,
    AIRE_SESSION_SECRET: "x".repeat(40),
    AIRE_TENANTS_JSON: JSON.stringify([
      customer,
      {
        ...customer,
        id: "other",
        engineUrlEnv: "OTHER_URL",
        engineTokenEnv: "OTHER_TOKEN",
        publicOrigin: "https://other.example",
      },
    ]),
    AIRE_PLATFORM_ADMINS_JSON: JSON.stringify([
      {
        provider: operator.provider,
        issuer: operator.issuer,
        subject: operator.sub,
      },
    ]),
    AIRE_RESEND_API_KEY: "synthetic",
    AIRE_EMAIL_FROM: "AIRE <setup@example.com>",
    AIRE_MICROSOFT_CLIENT_ID: "synthetic",
    AIRE_MICROSOFT_CLIENT_SECRET: "synthetic",
    AIRE_GOOGLE_CLIENT_ID: "synthetic",
    AIRE_GOOGLE_CLIENT_SECRET: "synthetic",
  });
  operatorCookie = cookie(
    SESSION_COOKIE,
    await seal({ identity: operator, origin }, "session", 300),
    300,
  );
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    mail = String(options?.body);
    return Response.json({ id: "fake" });
  };
});
afterEach(async () => {
  globalThis.fetch = fetcher;
  for (const k of Object.keys(process.env))
    if (!(k in env)) delete process.env[k];
  Object.assign(process.env, env);
  await rm(dir, { recursive: true, force: true });
});
function req(path: string, method = "GET", body?: unknown, auth = local) {
  return new Request(origin + path, {
    method,
    headers: { origin, cookie: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function op(
  method = "POST",
  body: unknown = { email: "admin@example.com" },
  auth = operatorCookie,
) {
  return api(
    req(
      "/api/console/platform/lab/onboarding",
      method,
      method === "POST" ? body : undefined,
      auth,
    ),
    ["platform", "lab", "onboarding"],
  );
}
async function setup(action: string, method = "GET", body?: unknown) {
  return setupApi(req("/api/onboarding/" + action, method, body), action);
}
async function activate() {
  const r = await op();
  assert.equal(r.status, 200);
  const secret = JSON.parse(mail).text.match(/#invite=([\w-]+)/)[1];
  const r2 = await setup("activate", "POST", {
    organization: "lab",
    username: "admin@example.com",
    password: "long synthetic password",
    invite: secret,
  });
  assert.equal(r2.status, 200);
  local = r2.headers.get("set-cookie")!.split(";")[0];
  return secret;
}
async function config(extra: Record<string, string> = {}) {
  const r = await setup("config", "PUT", {
    revision: 0,
    config: { provider: "microsoft", microsoftTenantId: ms, ...extra },
  });
  assert.equal(r.status, 200);
}
async function state() {
  return JSON.parse(await readFile(join(dir, "onboarding/lab.json"), "utf8"));
}
async function editState(patch: Record<string, unknown>) {
  await writeFile(
    join(dir, "onboarding/lab.json"),
    JSON.stringify({ ...(await state()), ...patch }),
  );
}
const identity: Identity = {
  provider: "microsoft",
  issuer: `https://login.microsoftonline.com/${ms}/v2.0`,
  sub: "subject",
  objectId: "object",
  workspace: "lab",
  name: "Client Admin",
  groups: [],
};

test("operator can register a draft without SSO; activation still requires configuration", async () => {
  const draft = {
    ...customer,
    id: "new",
    engineUrlEnv: "NEW_URL",
    engineTokenEnv: "NEW_TOKEN",
    publicOrigin: "https://new.example",
  };
  assert.equal(
    (
      await api(
        req(
          "/api/console/platform",
          "PUT",
          { revision: 0, tenant: draft },
          operatorCookie,
        ),
        ["platform"],
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await api(
        req(
          "/api/console/platform",
          "PUT",
          { revision: 1, tenant: { ...draft, enabled: true } },
          operatorCookie,
        ),
        ["platform"],
      )
    ).status,
    422,
  );
});
test("invite is single use, hash-only at rest; setup session cannot access platform or journeys", async () => {
  const secret = await activate();
  const s = await state();
  assert.ok(s.account.passwordHash);
  assert.equal(s.inviteHash, undefined);
  assert.ok(!JSON.stringify(s).includes(secret));
  assert.ok(!JSON.stringify(s).includes("long synthetic password"));
  assert.equal(
    (
      await setup("activate", "POST", {
        organization: "lab",
        username: "admin@example.com",
        password: "long synthetic password",
        invite: secret,
      })
    ).status,
    401,
  );
  assert.equal(
    (await api(req("/api/console/journeys"), ["journeys"])).status,
    401,
  );
  assert.equal((await op("GET", undefined, local)).status, 401);
  const status = await (await op("GET")).text();
  assert.ok(!status.includes("passwordHash"));
  assert.ok(!status.includes("sessions"));
});
test("complete requires verified corporate identity and revokes all local sessions", async () => {
  await activate();
  await config();
  assert.equal(
    (await setup("complete", "POST", { confirm: true })).status,
    409,
  );
  await assert.rejects(() =>
    recordVerified(req("/"), 1, {
      ...identity,
      issuer: "https://evil.example",
    }),
  );
  await recordVerified(req("/"), 1, identity);
  const before = tenants().find((t) => t.id === "other");
  assert.equal(
    (await setup("complete", "POST", { confirm: true })).status,
    200,
  );
  assert.equal((await setup("session")).status, 401);
  assert.equal(
    (
      await setup("login", "POST", {
        organization: "lab",
        username: "admin@example.com",
        password: "long synthetic password",
      })
    ).status,
    401,
  );
  const t = tenants().find((t) => t.id === "lab")!;
  assert.equal(t.enabled, false);
  assert.deepEqual(t.members, [
    { provider: "microsoft", subject: "object", role: "admin" },
  ]);
  assert.deepEqual(
    tenants().find((t) => t.id === "other"),
    before,
  );
});
test("group admin needs group claim; editing config invalidates test", async () => {
  await activate();
  const group = "22222222-2222-4222-8222-222222222222";
  await config({ adminGroup: group });
  await assert.rejects(() => recordVerified(req("/"), 1, identity));
  await recordVerified(req("/"), 1, { ...identity, groups: [group] });
  assert.equal(
    (
      await setup("config", "PUT", {
        revision: 1,
        config: {
          provider: "microsoft",
          microsoftTenantId: ms,
          adminGroup: group,
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (await setup("complete", "POST", { confirm: true })).status,
    409,
  );
  await recordVerified(req("/"), 2, { ...identity, groups: [group] });
  assert.equal(
    (await setup("complete", "POST", { confirm: true })).status,
    200,
  );
  assert.equal(tenants().find((t) => t.id === "lab")!.members.length, 0);
});
test("new invitation and revocation invalidate sessions and old invitation", async () => {
  const old = await activate();
  await editState({ sentAt: 0 });
  assert.equal((await op()).status, 200);
  assert.equal((await setup("session")).status, 401);
  assert.equal(
    (
      await setup("activate", "POST", {
        organization: "lab",
        username: "admin@example.com",
        password: "long synthetic password",
        invite: old,
      })
    ).status,
    401,
  );
  assert.equal((await op("DELETE")).status, 200);
  const secret = JSON.parse(mail).text.match(/#invite=([\w-]+)/)[1];
  assert.equal(
    (
      await setup("activate", "POST", {
        organization: "lab",
        username: "admin@example.com",
        password: "long synthetic password",
        invite: secret,
      })
    ).status,
    401,
  );
});
test("provider failure invalidates invitation and reports failure without secrets", async () => {
  globalThis.fetch = async () =>
    new Response("private provider error", { status: 500 });
  const r = await op();
  assert.equal(r.status, 502);
  assert.equal((await state()).inviteHash, undefined);
  assert.ok(!(await r.text()).includes("private provider"));
});
test("expiration, rate limiting, CSRF, stale revisions and privilege fields fail closed", async () => {
  await activate();
  await config();
  assert.equal(
    (
      await setup("config", "PUT", {
        revision: 0,
        config: { provider: "microsoft", microsoftTenantId: ms },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await setup("config", "PUT", {
        revision: 1,
        config: {
          provider: "microsoft",
          microsoftTenantId: ms,
          repositories: ["secret/repo"],
        },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await setupApi(
        new Request(origin + "/api/onboarding/config", {
          method: "PUT",
          headers: { cookie: local, origin: "https://evil.example" },
          body: "{}",
        }),
        "config",
      )
    ).status,
    403,
  );
  await setup("logout", "POST");
  assert.equal((await setup("session")).status, 401);
  for (let i = 0; i < 11; i++)
    await setup("login", "POST", {
      organization: "lab",
      username: "admin@example.com",
      password: "wrong long password",
    });
  assert.equal(
    (
      await setup("login", "POST", {
        organization: "lab",
        username: "admin@example.com",
        password: "long synthetic password",
      })
    ).status,
    401,
  );
  await editState({ deadline: 0 });
  assert.equal(
    (
      await setup("login", "POST", {
        organization: "lab",
        username: "admin@example.com",
        password: "long synthetic password",
      })
    ).status,
    401,
  );
});
test("expired invitation cannot activate; anonymous operator request rejected", async () => {
  assert.equal(
    (await op("POST", { email: "admin@example.com" }, "")).status,
    401,
  );
  await op();
  await editState({ inviteExpires: 0 });
  const secret = JSON.parse(mail).text.match(/#invite=([\w-]+)/)[1];
  assert.equal(
    (
      await setup("activate", "POST", {
        organization: "lab",
        username: "admin@example.com",
        password: "long synthetic password",
        invite: secret,
      })
    ).status,
    401,
  );
});
test("setup callback without flow cannot forge corporate verification", async () => {
  await activate();
  await config();
  const r = await setupAuth(
    req("/onboarding/auth/microsoft?code=fake&state=fake"),
    "microsoft",
  );
  assert.match(r.headers.get("location")!, /test=failed/);
  assert.equal((await state()).verified, undefined);
  assert.ok(!r.headers.get("set-cookie")!.includes(SESSION_COOKIE));
});
test("draft candidate uses exact tenant claims and preserves existing credential references", async () => {
  const t = candidate(
    {
      ...customer,
      sso: {
        googleDomains: [],
        microsoftClientIdEnv: "CUSTOM_ID",
        microsoftClientSecretEnv: "CUSTOM_SECRET",
      },
    },
    { provider: "microsoft", microsoftTenantId: ms },
  );
  process.env.CUSTOM_ID = "id";
  process.env.CUSTOM_SECRET = "secret";
  assert.equal(t.sso?.microsoftClientIdEnv, "CUSTOM_ID");
  assert.throws(() =>
    validatedIdentity(
      "microsoft",
      { iss: identity.issuer, sub: "sub", tid: "other" },
      "lab",
      t,
    ),
  );
  assert.equal(
    validatedIdentity(
      "microsoft",
      { iss: identity.issuer, sub: "sub", tid: ms },
      "lab",
      t,
    ).workspace,
    "lab",
  );
  const g = candidate(customer, {
    provider: "google",
    googleDomain: "example.com",
  });
  assert.throws(() =>
    validatedIdentity(
      "google",
      { iss: "https://accounts.google.com", sub: "sub", hd: "other.com" },
      "lab",
      g,
    ),
  );
});

test("OIDC authorization code callback validates signed ID token and records only setup verification", async () => {
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "setup-test",
    use: "sig",
    alg: "RS256",
  };
  await activate();
  await config();
  let nonce = "",
    badAudience = false;
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.includes(".well-known"))
      return Response.json({
        issuer: identity.issuer,
        authorization_endpoint: "https://idp.example/authorize",
        token_endpoint: "https://idp.example/token",
        jwks_uri: "https://idp.example/jwks",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    if (address.endsWith("/jwks")) return Response.json({ keys: [jwk] });
    if (address.endsWith("/token")) {
      assert.ok(String(options?.body).includes("code_verifier="));
      const idToken = await new SignJWT({
        tid: ms,
        oid: "object",
        name: "Client Admin",
        nonce,
      })
        .setProtectedHeader({ alg: "RS256", kid: "setup-test" })
        .setIssuer(identity.issuer!)
        .setSubject("subject")
        .setAudience(badAudience ? "wrong-app" : "synthetic")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      return Response.json({
        access_token: "synthetic-access",
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken,
      });
    }
    throw Error("Unexpected URL " + address);
  };
  async function roundtrip() {
    const start = await setupAuth(
      req("/onboarding/auth/microsoft"),
      "microsoft",
    );
    assert.match(start.headers.get("location")!, /idp.example/);
    const authUrl = new URL(start.headers.get("location")!);
    nonce = authUrl.searchParams.get("nonce")!;
    assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
    const flowCookie = start.headers.get("set-cookie")!.split(";")[0];
    const callback = req(
      `/onboarding/auth/microsoft?code=synthetic&state=${authUrl.searchParams.get("state")}`,
      "GET",
      undefined,
      local + "; " + flowCookie,
    );
    return setupAuth(callback, "microsoft");
  }
  badAudience = true;
  const bad = await roundtrip();
  assert.match(bad.headers.get("location")!, /test=failed/);
  assert.equal((await state()).verified, undefined);
  badAudience = false;
  const good = await roundtrip();
  assert.match(good.headers.get("location")!, /test=success/);
  assert.equal((await state()).verified.identity.objectId, "object");
  assert.ok(!good.headers.get("set-cookie")!.includes(SESSION_COOKIE));
});

test("Google setup binds corporate domain and direct administrator to subject", async () => {
  await activate();
  assert.equal(
    (
      await setup("config", "PUT", {
        revision: 0,
        config: {
          provider: "google",
          googleDomain: "example.com",
          adminGroup: ms,
        },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await setup("config", "PUT", {
        revision: 0,
        config: { provider: "google", googleDomain: "example.com" },
      })
    ).status,
    200,
  );
  const g: Identity = {
    provider: "google",
    issuer: "https://accounts.google.com",
    sub: "google-sub",
    workspace: "lab",
    domain: "example.com",
    name: "Google Admin",
    groups: [],
  };
  await assert.rejects(() =>
    recordVerified(req("/"), 1, { ...g, workspace: "other" }),
  );
  await assert.rejects(() =>
    recordVerified(req("/"), 1, { ...g, domain: "wrong.example" }),
  );
  await recordVerified(req("/"), 1, g);
  assert.equal(
    (await setup("complete", "POST", { confirm: true })).status,
    200,
  );
  assert.deepEqual(tenants().find((t) => t.id === "lab")!.members, [
    { provider: "google", subject: "google-sub", role: "admin" },
  ]);
});
test("new invitation requires recipient email and existing valid local credentials survive a fresh session", async () => {
  assert.equal((await op("POST", { email: "invalid" })).status, 422);
  await activate();
  const replay = local;
  await setup("logout", "POST");
  assert.equal(
    (
      await setup("login", "POST", {
        organization: "lab",
        username: "wrong@example.com",
        password: "long synthetic password",
      })
    ).status,
    401,
  );
  const login = await setup("login", "POST", {
    organization: "lab",
    username: "admin@example.com",
    password: "long synthetic password",
  });
  assert.equal(login.status, 200);
  local = login.headers.get("set-cookie")!.split(";")[0];
  assert.notEqual(local, replay);
  assert.equal((await setup("session")).status, 200);
  const badHost = req("/api/onboarding/session");
  badHost.headers.set("host", "other.example");
  assert.equal((await setupApi(badHost, "session")).status, 403);
  await config();
  await recordVerified(req("/"), 1, identity);
  const s = await state();
  await editState({ verified: { ...s.verified, at: Date.now() - 601000 } });
  assert.equal(
    (await setup("complete", "POST", { confirm: true })).status,
    409,
  );
});

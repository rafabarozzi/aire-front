import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSessionCookie,
  authenticatedIdentity,
  renewSession,
  revokeSession,
  seal,
  unseal,
  SESSION_COOKIE,
  SESSION_IDLE_SECONDS,
  SESSION_ABSOLUTE_SECONDS,
} from "../lib/server/session.ts";
const previous = { ...process.env };
let directory = "";
const identity = {
  sub: "test-user",
  provider: "google" as const,
  groups: [],
  name: "Test",
};
function request(value: string) {
  return new Request("https://aire.test/api/console/session", {
    headers: { cookie: value.split(";")[0] },
  });
}
function token(value: string) {
  return value.split(";")[0].slice(SESSION_COOKIE.length + 1);
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "aire-session-"));
  process.env.AIRE_DATA_DIR = directory;
  process.env.AIRE_MODE = "live";
  process.env.AIRE_PORTAL_MODE = "legacy";
  process.env.AIRE_APP_ORIGIN = "https://aire.test";
  process.env.AIRE_SESSION_SECRET =
    "test-persistent-secret-at-least-32-characters";
});
afterEach(async () => {
  for (const key of Object.keys(process.env))
    if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
  await rm(directory, { recursive: true, force: true });
});
test("login persists a seven-day secure cookie and does not renew every request", async () => {
  const value = await createSessionCookie(identity, "https://aire.test");
  assert.match(value, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(value, new RegExp(`Max-Age=${SESSION_IDLE_SECONDS}`));
  const p = await unseal(token(value), "session");
  assert.equal(Number(p.exp) - Number(p.iat), SESSION_IDLE_SECONDS);
  const req = request(value);
  assert.equal((await authenticatedIdentity(req)).sub, identity.sub);
  assert.equal(
    (await renewSession(req, new Response())).headers.get("set-cookie"),
    null,
  );
});
test("active legacy sessions migrate and renewed tokens preserve the absolute deadline", async () => {
  const started =
    Math.floor(Date.now() / 1000) - SESSION_ABSOLUTE_SECONDS + 1000;
  const old = await seal(
    { identity, origin: "https://aire.test", sessionStartedAt: started },
    "session",
    600,
  );
  const req = request(`${SESSION_COOKIE}=${old}`);
  await authenticatedIdentity(req);
  const response = await renewSession(req, new Response());
  const value = response.headers.get("set-cookie")!;
  const p = await unseal(token(value), "session");
  assert.equal(p.sessionStartedAt, started);
  assert.equal(p.exp, started + SESSION_ABSOLUTE_SECONDS);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("logout revokes all renewals of a session, including replay after a new Request", async () => {
  const old = await seal(
    { identity, origin: "https://aire.test" },
    "session",
    1800,
  );
  const req = request(`${SESSION_COOKIE}=${old}`);
  await authenticatedIdentity(req);
  const response = await renewSession(req, new Response());
  const renewed = request(response.headers.get("set-cookie")!);
  await authenticatedIdentity(renewed);
  await revokeSession(req);
  await assert.rejects(
    authenticatedIdentity(request(response.headers.get("set-cookie")!)),
    /Entre com sua conta/,
  );
  assert.equal(
    (await renewSession(renewed, new Response())).headers.get("set-cookie"),
    null,
  );
});
test("absolute expiry and expired tokens cannot be revived", async () => {
  const old = await seal(
    {
      identity,
      sessionStartedAt:
        Math.floor(Date.now() / 1000) - SESSION_ABSOLUTE_SECONDS,
    },
    "session",
    600,
  );
  await assert.rejects(
    authenticatedIdentity(request(`${SESSION_COOKIE}=${old}`)),
    /Entre com sua conta/,
  );
  const expired = await seal({ identity }, "session", -10);
  await assert.rejects(
    authenticatedIdentity(request(`${SESSION_COOKIE}=${expired}`)),
    /Entre com sua conta/,
  );
});
test("failed and unauthenticated requests never renew cookies", async () => {
  const old = await seal({ identity }, "session", 1800);
  const req = request(`${SESSION_COOKIE}=${old}`);
  await authenticatedIdentity(req);
  assert.equal(
    (await renewSession(req, new Response(null, { status: 403 }))).headers.get(
      "set-cookie",
    ),
    null,
  );
  assert.equal(
    (await renewSession(request(""), new Response())).headers.get("set-cookie"),
    null,
  );
});

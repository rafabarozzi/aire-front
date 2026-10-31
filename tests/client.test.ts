import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, request } from "../lib/aire/client.ts";
import { connectionRecovery } from "../lib/aire/connection-recovery.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("client preserves the server error classification for the recovery UI", async () => {
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.credentials, "same-origin");
    return Response.json(
      {
        error: "Configure a credencial",
        code: "github_unconfigured",
        setup: { githubTokenEnv: "ORG_GITHUB_TOKEN" },
      },
      { status: 503 },
    );
  };
  await assert.rejects(request("repositories/validate"), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.code, "github_unconfigured");
    const recovery = connectionRecovery(e.code);
    assert.equal(recovery.credential, true);
    assert.equal(recovery.signIn, undefined);
    assert.equal(
      recovery.link?.href,
      "https://github.com/settings/personal-access-tokens/new",
    );
    return true;
  });
});

test("expired AIRE session and invalid GitHub credential have different recovery actions", () => {
  assert.equal(connectionRecovery("unauthenticated").signIn, true);
  assert.equal(connectionRecovery("github_credentials").signIn, undefined);
  assert.equal(connectionRecovery("github_credentials").credential, true);
  for (const code of [
    "github_forbidden",
    "github_rate_limited",
    "github_unavailable",
    "unknown_future_error",
  ]) {
    assert.equal(connectionRecovery(code).credential, undefined);
    assert.equal(connectionRecovery(code).signIn, undefined);
  }
});

test("invalid JSON bodies and transport failures stay actionable without leaking raw errors", async () => {
  globalThis.fetch = async () =>
    new Response("upstream-secret", { status: 502 });
  await assert.rejects(
    request("repositories/validate"),
    (e: unknown) =>
      e instanceof ApiError &&
      e.code === "service_error" &&
      !e.message.includes("upstream-secret"),
  );
  globalThis.fetch = async () => {
    throw new Error("transport-secret");
  };
  await assert.rejects(
    request("repositories/validate"),
    (e: unknown) =>
      e instanceof ApiError &&
      e.code === "network_error" &&
      !e.message.includes("transport-secret"),
  );
});

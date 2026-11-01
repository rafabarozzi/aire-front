import * as oidc from "openid-client";
import { appOrigin } from "./config.ts";
import { cookie, seal, unseal, readCookie } from "./session.ts";
import { identityConnection, validatedIdentity } from "./oidc.ts";
import {
  candidate,
  setupContext,
  recordVerified,
  SETUP_FLOW_COOKIE,
} from "./onboarding.ts";

export async function setupAuth(
  request: Request,
  provider: "microsoft" | "google",
) {
  const origin = appOrigin(),
    redirectUri = `${origin}/onboarding/auth/${provider}`;
  const current = new URL(redirectUri);
  current.search = new URL(request.url).search;
  try {
    const c = await setupContext(request),
      selected = c.state.config;
    if (!selected || selected.provider !== provider)
      throw new Error("Configuration required");
    const t = candidate(c.tenant, selected),
      connection = identityConnection(provider, c.id, t);
    const callback =
      current.searchParams.has("code") || current.searchParams.has("error");
    const flow = callback
      ? await unseal(readCookie(request, SETUP_FLOW_COOKIE), "setup-oidc")
      : undefined;
    if (
      callback &&
      (!flow ||
        flow.tenant !== c.id ||
        flow.session !== c.sessionHash ||
        flow.generation !== c.state.generation ||
        flow.revision !== c.state.configRevision ||
        flow.provider !== provider ||
        flow.origin !== origin ||
        flow.issuer !== connection.issuer ||
        typeof flow.verifier !== "string" ||
        typeof flow.state !== "string" ||
        typeof flow.nonce !== "string")
    )
      throw new Error("Flow changed");
    const config = await oidc.discovery(
      new URL(connection.issuer),
      connection.clientId,
      connection.clientSecret,
      undefined,
      { timeout: 15 },
    );
    if (!callback) {
      const verifier = oidc.randomPKCECodeVerifier(),
        state = oidc.randomState(),
        nonce = oidc.randomNonce();
      const destination = oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: "openid profile email",
        prompt: "select_account",
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        state,
        nonce,
      });
      return new Response(null, {
        status: 302,
        headers: {
          Location: destination.href,
          "Cache-Control": "no-store",
          "Set-Cookie": cookie(
            SETUP_FLOW_COOKIE,
            await seal(
              {
                tenant: c.id,
                session: c.sessionHash,
                generation: c.state.generation,
                revision: c.state.configRevision,
                provider,
                origin,
                issuer: connection.issuer,
                verifier,
                state,
                nonce,
              },
              "setup-oidc",
              600,
            ),
            600,
          ),
        },
      });
    }
    const tokens = await oidc.authorizationCodeGrant(config, current, {
      pkceCodeVerifier: flow!.verifier as string,
      expectedState: flow!.state as string,
      expectedNonce: flow!.nonce as string,
      idTokenExpected: true,
    });
    await recordVerified(
      request,
      c.state.configRevision,
      validatedIdentity(provider, tokens.claims()!, c.id, t),
    );
    return finish(origin, "success");
  } catch {
    return finish(origin, "failed");
  }
}
function finish(origin: string, result: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/onboarding?test=${result}`,
      "Cache-Control": "no-store",
      "Set-Cookie": cookie(SETUP_FLOW_COOKIE, "", 0),
    },
  });
}

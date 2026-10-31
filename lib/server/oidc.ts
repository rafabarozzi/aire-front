import * as oidc from "openid-client";
import {
  AppError,
  appOrigin,
  membership,
  providers,
  tenants,
  type Identity,
} from "./config.ts";
import {
  seal,
  unseal,
  readCookie,
  cookie,
  FLOW_COOKIE,
  SESSION_COOKIE,
} from "./session.ts";
async function configuration(provider: "google" | "microsoft") {
  if (!providers()[provider])
    throw new AppError(
      503,
      "provider_unconfigured",
      "Este provedor ainda não foi configurado pelo administrador.",
    );
  const prefix = provider === "google" ? "AIRE_GOOGLE" : "AIRE_MICROSOFT";
  const tenant = process.env.AIRE_MICROSOFT_TENANT_ID;
  if (provider === "microsoft" && !/^[0-9a-f-]{36}$/i.test(tenant || ""))
    throw new AppError(
      503,
      "configuration",
      "Configure um tenant específico no Microsoft Entra ID.",
    );
  const issuer =
    provider === "google"
      ? "https://accounts.google.com"
      : `https://login.microsoftonline.com/${tenant}/v2.0`;
  return oidc.discovery(
    new URL(issuer),
    process.env[prefix + "_CLIENT_ID"]!,
    process.env[prefix + "_CLIENT_SECRET"]!,
    undefined,
    { timeout: 15 },
  );
}
export async function auth(request: Request, provider: "google" | "microsoft") {
  const origin = appOrigin(),
    redirectUri = origin + `/auth/${provider}`;
  const current = new URL(redirectUri);
  current.search = new URL(request.url).search;
  const config = await configuration(provider);
  if (!current.searchParams.has("code") && !current.searchParams.has("error")) {
    const verifier = oidc.randomPKCECodeVerifier(),
      state = oidc.randomState(),
      nonce = oidc.randomNonce();
    const destination = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: "openid profile email",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    const flow = await seal(
      { provider, verifier, state, nonce },
      "oidc-flow",
      600,
    );
    return new Response(null, {
      status: 302,
      headers: {
        Location: destination.href,
        "Set-Cookie": cookie(FLOW_COOKIE, flow, 600),
        "Cache-Control": "no-store",
      },
    });
  }
  try {
    const flow = await unseal(readCookie(request, FLOW_COOKIE), "oidc-flow");
    if (
      flow.provider !== provider ||
      typeof flow.verifier !== "string" ||
      typeof flow.state !== "string" ||
      typeof flow.nonce !== "string"
    )
      throw new Error();
    const tokens = await oidc.authorizationCodeGrant(config, current, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims()!;
    // Bind access to immutable issuer-specific subject, never email/domain matching.
    const allowedGroups = new Set(
      tenants().flatMap((t) => t.groups.map((g) => g.id)),
    );
    const identity: Identity = {
      sub: claims.sub,
      provider,
      name:
        typeof claims.name === "string"
          ? claims.name.slice(0, 120)
          : "Usuário AIRE",
      groups: Array.isArray(claims.groups)
        ? claims.groups
            .filter(
              (g): g is string => typeof g === "string" && allowedGroups.has(g),
            )
            .slice(0, 30)
        : [],
    };
    membership(identity);
    const headers = new Headers({
      Location: origin,
      "Cache-Control": "no-store",
    });
    headers.append(
      "Set-Cookie",
      cookie(SESSION_COOKIE, await seal({ identity }, "session", 1800), 1800),
    );
    headers.append("Set-Cookie", cookie(FLOW_COOKIE, "", 0));
    return new Response(null, { status: 302, headers });
  } catch {
    return new Response(null, {
      status: 302,
      headers: {
        Location: origin + "/?auth_error=access_denied",
        "Set-Cookie": cookie(FLOW_COOKIE, "", 0),
        "Cache-Control": "no-store",
      },
    });
  }
}

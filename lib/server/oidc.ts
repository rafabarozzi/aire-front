import { portal } from "./portal.ts";
import { isPlatformAdmin } from "./platform-identity.ts";
import * as oidc from "openid-client";
import {
  AppError,
  microsoftCredentials,
  membership,
  tenants,
  type Identity,
  type Tenant,
} from "./config.ts";
import {
  seal,
  unseal,
  readCookie,
  cookie,
  FLOW_COOKIE,
  SESSION_COOKIE,
  createSessionCookie,
  ONBOARDING_COOKIE,
} from "./session.ts";

export function identityConnection(
  provider: "google" | "microsoft",
  workspace?: string,
  override?: Tenant,
) {
  const tenant =
    override ||
    (workspace
      ? tenants().find(
          (t) => t.id === workspace && t.enabled !== false && t.sso,
        )
      : undefined);
  if (workspace && !tenant)
    throw new AppError(403, "workspace", "Workspace não autorizado.");
  const prefix = provider === "google" ? "AIRE_GOOGLE" : "AIRE_MICROSOFT";
  const id = tenant
    ? tenant.sso?.microsoftTenantId
    : process.env.AIRE_MICROSOFT_TENANT_ID;
  if (
    provider === "microsoft" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id || "",
    )
  )
    throw new AppError(
      503,
      "configuration",
      "Configure o tenant Microsoft deste workspace.",
    );
  if (tenant && provider === "google" && !tenant.sso?.googleDomains.length)
    throw new AppError(
      403,
      "provider",
      "Google não está autorizado neste workspace.",
    );
  const { clientId, clientSecret } =
    provider === "microsoft"
      ? microsoftCredentials(tenant)
      : {
          clientId:
            process.env[
              tenant?.sso?.googleClientIdEnv || prefix + "_CLIENT_ID"
            ],
          clientSecret:
            process.env[
              tenant?.sso?.googleClientSecretEnv || prefix + "_CLIENT_SECRET"
            ],
        };
  if (!clientId || !clientSecret)
    throw new AppError(
      503,
      "configuration",
      "Configure o aplicativo de identidade no servidor.",
    );
  return {
    tenant,
    issuer:
      provider === "google"
        ? "https://accounts.google.com"
        : `https://login.microsoftonline.com/${id!.toLowerCase()}/v2.0`,
    clientId,
    clientSecret,
  };
}
export function validatedIdentity(
  provider: "google" | "microsoft",
  claims: Record<string, unknown>,
  workspace?: string,
  override?: Tenant,
): Identity {
  const connection = identityConnection(provider, workspace, override);
  if (claims.iss !== connection.issuer || typeof claims.sub !== "string")
    throw new Error("Identity issuer mismatch");
  if (
    provider === "microsoft" &&
    claims.tid !== connection.issuer.split("/")[3]
  )
    throw new Error("Identity tenant mismatch");
  if (
    connection.tenant &&
    provider === "google" &&
    (typeof claims.hd !== "string" ||
      !connection.tenant.sso!.googleDomains.includes(claims.hd))
  )
    throw new Error("Workspace domain mismatch");
  // Overage is explicitly refused for group-based authorization; direct members can sign in.
  const groups = Array.isArray(claims.groups)
    ? claims.groups
        .filter((g): g is string => typeof g === "string")
        .slice(0, 200)
    : [];
  return {
    sub: claims.sub,
    issuer: connection.issuer,
    provider,
    workspace,
    objectId: typeof claims.oid === "string" ? claims.oid : undefined,
    domain: typeof claims.hd === "string" ? claims.hd : undefined,
    name:
      typeof claims.name === "string"
        ? claims.name.slice(0, 120)
        : "Usuário AIRE",
    groups,
  };
}
export async function auth(request: Request, provider: "google" | "microsoft") {
  const realm = portal(request);
  const origin = realm.origin,
    redirectUri = origin + `/auth/${provider}`;
  const current = new URL(redirectUri);
  current.search = new URL(request.url).search;
  try {
    const callback =
      current.searchParams.has("code") || current.searchParams.has("error");
    const flow = callback
      ? await unseal(readCookie(request, FLOW_COOKIE), "oidc-flow")
      : undefined;
    const requestedWorkspace = callback
      ? typeof flow?.workspace === "string"
        ? flow.workspace
        : undefined
      : current.searchParams.get("workspace") || undefined;
    const workspace =
      realm.kind === "customer" ? realm.tenant!.id : requestedWorkspace;
    if (
      realm.kind !== "legacy" &&
      requestedWorkspace &&
      requestedWorkspace !== realm.tenant?.id
    )
      throw new Error("Portal mismatch");
    if (realm.kind !== "legacy" && callback && flow?.origin !== origin)
      throw new Error("Flow origin mismatch");
    const connection = identityConnection(provider, workspace);
    if (
      callback &&
      (flow?.provider !== provider ||
        flow.issuer !== connection.issuer ||
        typeof flow.verifier !== "string" ||
        typeof flow.state !== "string" ||
        typeof flow.nonce !== "string")
    )
      throw new Error("Invalid authorization flow");
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
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        state,
        nonce,
      });
      return new Response(null, {
        status: 302,
        headers: {
          Location: destination.href,
          "Set-Cookie": cookie(
            FLOW_COOKIE,
            await seal(
              {
                provider,
                origin,
                workspace,
                issuer: connection.issuer,
                verifier,
                state,
                nonce,
              },
              "oidc-flow",
              600,
            ),
            600,
          ),
          "Cache-Control": "no-store",
        },
      });
    }
    const tokens = await oidc.authorizationCodeGrant(config, current, {
      pkceCodeVerifier: flow!.verifier as string,
      expectedState: flow!.state as string,
      expectedNonce: flow!.nonce as string,
      idTokenExpected: true,
    });
    const identity = validatedIdentity(provider, tokens.claims()!, workspace);
    try {
      if (realm.kind === "admin") {
        if (!isPlatformAdmin(identity))
          throw new Error("Operator not registered");
      } else membership(identity);
    } catch {
      const safe = {
        provider: identity.provider,
        issuer: identity.issuer,
        subject: identity.sub,
        objectId: identity.objectId,
        workspace: identity.workspace,
      };
      const headers = new Headers({
        Location: origin + "/?auth_error=membership",
        "Cache-Control": "no-store",
      });
      headers.append(
        "Set-Cookie",
        cookie(
          ONBOARDING_COOKIE,
          await seal({ identity: safe, origin }, "onboarding-identity", 300),
          300,
        ),
      );
      headers.append("Set-Cookie", cookie(FLOW_COOKIE, "", 0));
      headers.append("Set-Cookie", cookie(SESSION_COOKIE, "", 0));
      return new Response(null, { status: 302, headers });
    }
    const headers = new Headers({
      Location: origin,
      "Cache-Control": "no-store",
    });
    headers.append("Set-Cookie", await createSessionCookie(identity, origin));
    headers.append("Set-Cookie", cookie(FLOW_COOKIE, "", 0));
    headers.append("Set-Cookie", cookie(ONBOARDING_COOKIE, "", 0));
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

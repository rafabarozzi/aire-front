import {
  AppError,
  appOrigin,
  tenants,
  providers,
  microsoftCredentials,
} from "./config.ts";
export function portal(request: Request) {
  const origin = appOrigin();
  if (process.env.AIRE_PORTAL_MODE !== "multi")
    return { kind: "legacy" as const, origin, tenant: undefined };
  // Host is supplied by the reverse proxy. Forwarded host is never used as an authority.
  const host = request.headers.get("host") || new URL(request.url).host;
  if (host === new URL(origin).host)
    return { kind: "admin" as const, origin, tenant: undefined };
  const matches = tenants().filter(
    (t) =>
      t.publicOrigin &&
      new URL(t.publicOrigin).host === host &&
      t.enabled !== false,
  );
  if (matches.length !== 1)
    throw new AppError(
      403,
      "portal_unknown",
      "Portal não cadastrado ou organização suspensa.",
    );
  return {
    kind: "customer" as const,
    origin: matches[0].publicOrigin!,
    tenant: matches[0],
  };
}
export function portalProviders(request: Request) {
  const p = portal(request),
    sso = p.tenant?.sso;
  if (!p.tenant) return providers();
  const credentials = microsoftCredentials(p.tenant);
  return {
    microsoft: !!(
      sso?.microsoftTenantId &&
      credentials.clientId &&
      credentials.clientSecret
    ),
    google: !!(
      sso?.googleDomains.length &&
      process.env[sso.googleClientIdEnv || "AIRE_GOOGLE_CLIENT_ID"] &&
      process.env[sso.googleClientSecretEnv || "AIRE_GOOGLE_CLIENT_SECRET"]
    ),
  };
}

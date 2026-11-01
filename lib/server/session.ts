import { EncryptJWT, jwtDecrypt } from "jose";
import { AppError, isDemo, membership, type Identity } from "./config.ts";
import { defaultPolicy, type Permission, type Session } from "../aire/types.ts";
import { readPolicy } from "./store.ts";
import { isPlatformAdmin } from "./platform-identity.ts";
import { portal, portalProviders } from "./portal.ts";
export const SESSION_COOKIE = "__Host-aire-session";
export const FLOW_COOKIE = "__Host-aire-flow";
export const ONBOARDING_COOKIE = "__Host-aire-onboarding";
async function key() {
  const secret = process.env.AIRE_SESSION_SECRET || "";
  if (secret.length < 32)
    throw new AppError(
      503,
      "configuration",
      "A chave de sessão precisa ser configurada no servidor.",
    );
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
  );
}
export async function seal(
  value: Record<string, unknown>,
  audience: string,
  seconds: number,
) {
  return new EncryptJWT(value)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer("aire-console")
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .encrypt(await key());
}
export async function unseal(value: string, audience: string) {
  return (
    await jwtDecrypt(value, await key(), {
      issuer: "aire-console",
      audience,
      clockTolerance: 5,
    })
  ).payload;
}
export function readCookie(request: Request, name: string) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
export function cookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== portal(request).origin)
    throw new AppError(
      403,
      "origin",
      "A origem da solicitação não é permitida.",
    );
}
export async function authenticatedIdentity(request: Request) {
  if (isDemo())
    throw new AppError(
      409,
      "demo_mode",
      "Este ambiente usa dados de demonstração.",
    );
  let identity: Identity;
  try {
    const payload = await unseal(
      readCookie(request, SESSION_COOKIE),
      "session",
    );
    const p = portal(request);
    if (p.kind !== "legacy" && payload.origin !== p.origin)
      throw new Error("Session origin mismatch");
    identity = payload.identity as Identity;
    if (
      !identity ||
      !identity.sub ||
      !["google", "microsoft"].includes(identity.provider) ||
      !Array.isArray(identity.groups)
    )
      throw new Error();
  } catch {
    throw new AppError(
      401,
      "unauthenticated",
      "Entre com sua conta para continuar.",
    );
  }
  return identity;
}
export async function platformContext(request: Request) {
  const p = portal(request),
    identity = await authenticatedIdentity(request);
  if (p.kind === "customer" || !isPlatformAdmin(identity))
    throw new AppError(
      403,
      "platform_forbidden",
      "Acesso exclusivo da administração Northeia.",
    );
  return {
    identity,
    tenant: p.kind === "legacy" ? membership(identity).tenant : undefined,
  };
}
export async function context(request: Request, permission?: Permission) {
  const p = portal(request),
    identity = await authenticatedIdentity(request);
  if (p.kind === "admin")
    throw new AppError(
      403,
      "customer_portal",
      "Acesse o portal da organização para usar o workspace.",
    );
  if (p.tenant && identity.workspace !== p.tenant.id)
    throw new AppError(
      403,
      "workspace",
      "Esta sessão pertence a outro workspace.",
    );
  const { tenant, role } = membership(identity);
  const policy = await readPolicy(tenant.id).catch((e) => {
    throw e;
  });
  const grants = policy[role] || defaultPolicy[role];
  if (permission && !grants.includes(permission))
    throw new AppError(
      403,
      "forbidden",
      "Seu perfil não tem permissão para esta ação.",
    );
  return { tenant, role, identity, permissions: grants };
}
export async function sessionResponse(request: Request): Promise<
  Session & {
    identity?: { issuer?: string; subject: string; objectId?: string };
  }
> {
  const p = portal(request);
  const base = {
    portal: p.kind,
    workspace: p.tenant?.id,
    tenant: p.tenant?.name,
    version: "0.2.0",
    providers: portalProviders(request),
  };
  try {
    if (p.kind === "admin") {
      const c = await platformContext(request);
      return {
        ...base,
        mode: "live",
        authenticated: true,
        name: c.identity.name,
        tenant: "Administração Northeia",
        role: "admin",
        permissions: [],
        platformAdmin: true,
        onboardingIdentity: undefined,
      };
    }
    const c = await context(request);
    return {
      ...base,
      mode: "live",
      authenticated: true,
      name: c.identity.name,
      tenant: c.tenant.name,
      role: c.role,
      permissions: c.permissions,
      providers: portalProviders(request),
      platformAdmin: isPlatformAdmin(c.identity),
      identity: {
        issuer: c.identity.issuer,
        subject: c.identity.sub,
        objectId: c.identity.objectId,
      },
    };
  } catch (e) {
    if (e instanceof AppError && e.status === 401) {
      let onboardingIdentity: Session["onboardingIdentity"];
      try {
        const payload = await unseal(
          readCookie(request, ONBOARDING_COOKIE),
          "onboarding-identity",
        );
        if (p.kind === "legacy" || payload.origin === p.origin)
          onboardingIdentity =
            payload.identity as Session["onboardingIdentity"];
      } catch {
        /* No valid identity test was completed. */
      }
      return {
        ...base,
        mode: "live",
        authenticated: false,
        permissions: [],
        providers: portalProviders(request),
        onboardingIdentity,
      };
    }
    throw e;
  }
}

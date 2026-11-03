import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { JWTPayload } from "jose";
import { EncryptJWT, jwtDecrypt } from "jose";
import {
  AppError,
  appOrigin,
  isDemo,
  membership,
  type Identity,
} from "./config.ts";
import { defaultPolicy, type Permission, type Session } from "../aire/types.ts";
import { readPolicy } from "./store.ts";
import { isPlatformAdmin } from "./platform-identity.ts";
import { portal, portalProviders } from "./portal.ts";
export const SESSION_IDLE_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60;
const verifiedSessions = new WeakMap<Request, JWTPayload>();
const nowSeconds = () => Math.floor(Date.now() / 1000);
function sessionId(payload: JWTPayload, token: string) {
  return typeof payload.sid === "string"
    ? payload.sid
    : createHash("sha256").update(token).digest("hex");
}
function revocationPath(sid: string) {
  return join(
    process.env.AIRE_DATA_DIR || "/data",
    "session-revocations",
    createHash("sha256").update(sid).digest("hex") + ".json",
  );
}
async function isRevoked(sid: string) {
  try {
    await readFile(revocationPath(sid));
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
export async function createSessionCookie(identity: Identity, origin: string) {
  const started = nowSeconds();
  return cookie(
    SESSION_COOKIE,
    await seal(
      { identity, origin, sid: crypto.randomUUID(), sessionStartedAt: started },
      "session",
      SESSION_IDLE_SECONDS,
    ),
    SESSION_IDLE_SECONDS,
  );
}
export async function revokeSession(request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  let payload: JWTPayload;
  try {
    payload = await unseal(token, "session");
  } catch {
    return;
  }
  const file = revocationPath(sessionId(payload, token));
  await mkdir(
    join(process.env.AIRE_DATA_DIR || "/data", "session-revocations"),
    { recursive: true, mode: 0o700 },
  );
  await writeFile(
    file,
    JSON.stringify({
      expiresAt:
        Number(payload.sessionStartedAt || payload.iat) +
        SESSION_ABSOLUTE_SECONDS,
    }),
    { mode: 0o600 },
  );
}
export async function renewSession(request: Request, response: Response) {
  const payload = verifiedSessions.get(request);
  if (!payload || response.status >= 400) return response;
  const now = nowSeconds();
  // Renew at most once per hour; short legacy sessions migrate on their next request.
  if (Number(payload.exp) - now > SESSION_IDLE_SECONDS - 3600) return response;
  const started = Number(payload.sessionStartedAt ?? payload.iat);
  const seconds = Math.min(
    SESSION_IDLE_SECONDS,
    started + SESSION_ABSOLUTE_SECONDS - now,
  );
  if (seconds <= 0) return response;
  const sid = sessionId(payload, readCookie(request, SESSION_COOKIE));
  if (await isRevoked(sid)) return response;
  const token = await seal(
    {
      identity: payload.identity,
      origin: payload.origin,
      sid,
      sessionStartedAt: started,
    },
    "session",
    seconds,
  );
  response.headers.append("Set-Cookie", cookie(SESSION_COOKIE, token, seconds));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
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
    const started = Number(payload.sessionStartedAt ?? payload.iat);
    if (
      !Number.isFinite(started) ||
      started > nowSeconds() + 5 ||
      nowSeconds() >= started + SESSION_ABSOLUTE_SECONDS
    )
      throw Error("Session lifetime exceeded");
    if (
      await isRevoked(sessionId(payload, readCookie(request, SESSION_COOKIE)))
    )
      throw Error("Revoked session");
    identity = payload.identity as Identity;
    if (
      !identity ||
      !identity.sub ||
      !["google", "microsoft"].includes(identity.provider) ||
      !Array.isArray(identity.groups)
    )
      throw new Error();
    verifiedSessions.set(request, payload);
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
  const identity = await authenticatedIdentity(request),
    p = portal(request);
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
  const identity = await authenticatedIdentity(request),
    p = portal(request);
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
    onboardingUrl: `${appOrigin()}/onboarding${p.tenant ? `?organization=${encodeURIComponent(p.tenant.id)}` : ""}`,
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

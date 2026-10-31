import { EncryptJWT, jwtDecrypt } from "jose";
import {
  AppError,
  appOrigin,
  isDemo,
  membership,
  providers,
  type Identity,
} from "./config.ts";
import { defaultPolicy, type Permission } from "../aire/types.ts";
import { readPolicy } from "./store.ts";
export const SESSION_COOKIE = "__Host-aire-session";
export const FLOW_COOKIE = "__Host-aire-flow";
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
  if (request.headers.get("origin") !== appOrigin())
    throw new AppError(
      403,
      "origin",
      "A origem da solicitação não é permitida.",
    );
}
export async function context(request: Request, permission?: Permission) {
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
export async function sessionResponse(request: Request) {
  try {
    const c = await context(request);
    return {
      mode: "live",
      authenticated: true,
      name: c.identity.name,
      tenant: c.tenant.name,
      role: c.role,
      permissions: c.permissions,
      providers: providers(),
    };
  } catch (e) {
    if (e instanceof AppError && e.status === 401)
      return {
        mode: "live",
        authenticated: false,
        permissions: [],
        providers: providers(),
      };
    throw e;
  }
}

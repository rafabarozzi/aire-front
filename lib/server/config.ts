import { z } from "zod";
import type { Role } from "../aire/types.ts";
export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const role = z.enum(["admin", "engineer", "viewer"]);
const tenantSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().min(1),
  members: z
    .array(
      z.object({
        provider: z.enum(["google", "microsoft"]),
        subject: z.string().min(1),
        role,
      }),
    )
    .default([]),
  groups: z.array(z.object({ id: z.string().min(1), role })).default([]),
  repositories: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)),
  githubTokenEnv: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  engineUrlEnv: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  engineTokenEnv: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
});
export type Tenant = z.infer<typeof tenantSchema>;
export type Identity = {
  sub: string;
  provider: "google" | "microsoft";
  groups: string[];
  name: string;
};
export const isDemo = () => process.env.AIRE_MODE === "demo";
export function tenants(): Tenant[] {
  try {
    const ts = z
      .array(tenantSchema)
      .parse(JSON.parse(process.env.AIRE_TENANTS_JSON || "[]"));
    if (new Set(ts.map((t) => t.id)).size !== ts.length) throw new Error();
    return ts;
  } catch {
    throw new AppError(
      503,
      "configuration",
      "A configuração da organização precisa ser revisada pelo administrador.",
    );
  }
}
export function membership(
  identity: Identity,
  ts: Tenant[] = tenants(),
): { tenant: Tenant; role: Role } {
  const matches = ts.flatMap((tenant) => {
    const member = tenant.members.find(
      (m) => m.provider === identity.provider && m.subject === identity.sub,
    );
    const groups =
      identity.provider === "microsoft"
        ? tenant.groups.filter((g) => identity.groups.includes(g.id))
        : [];
    const roles: Role[] = member ? [member.role] : groups.map((g) => g.role);
    const selected = (["admin", "engineer", "viewer"] as Role[]).find((r) =>
      roles.includes(r),
    );
    return selected ? [{ tenant, role: selected }] : [];
  });
  if (matches.length !== 1)
    throw new AppError(
      403,
      "membership",
      "Seu usuário não tem uma organização única autorizada. Solicite a vinculação ao administrador.",
    );
  return matches[0];
}
export function appOrigin() {
  const url = new URL(
    process.env.AIRE_APP_ORIGIN || "https://unconfigured.invalid",
  );
  if (
    url.protocol !== "https:" ||
    url.hostname === "unconfigured.invalid" ||
    url.pathname !== "/" ||
    url.username ||
    url.password
  )
    throw new AppError(
      503,
      "configuration",
      "O endereço HTTPS da aplicação não foi configurado.",
    );
  return url.origin;
}
export function providers() {
  return {
    google: Boolean(
      process.env.AIRE_GOOGLE_CLIENT_ID &&
      process.env.AIRE_GOOGLE_CLIENT_SECRET,
    ),
    microsoft: Boolean(
      process.env.AIRE_MICROSOFT_CLIENT_ID &&
      process.env.AIRE_MICROSOFT_CLIENT_SECRET &&
      process.env.AIRE_MICROSOFT_TENANT_ID,
    ),
  };
}
export function allowedRepository(tenant: Tenant, repository: string) {
  if (
    !tenant.repositories.some(
      (r) => r.toLowerCase() === repository.toLowerCase(),
    )
  )
    throw new AppError(
      403,
      "repository_not_allowed",
      "Este repositório não está autorizado para a sua organização.",
    );
}

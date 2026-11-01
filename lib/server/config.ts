import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
export const tenantSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().min(1),
  publicOrigin: z
    .string()
    .url()
    .refine((v) => {
      const u = new URL(v);
      return (
        u.protocol === "https:" &&
        u.pathname === "/" &&
        !u.port &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      );
    }, "Use a origem HTTPS do portal")
    .transform((v) => new URL(v).origin)
    .optional(),
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
  enabled: z.boolean().optional(),
  sso: z
    .object({
      microsoftTenantId: z.string().uuid().optional(),
      microsoftClientIdEnv: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]+$/)
        .optional(),
      microsoftClientSecretEnv: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]+$/)
        .optional(),
      googleClientIdEnv: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]+$/)
        .optional(),
      googleClientSecretEnv: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]+$/)
        .optional(),
      googleDomains: z
        .array(
          z
            .string()
            .toLowerCase()
            .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
        )
        .max(20)
        .default([]),
    })
    .strict()
    .optional(),
  plan: z
    .object({
      name: z.string().min(1).max(80),
      monthlyUsd: z.number().finite().nonnegative(),
      infrastructureMonthlyUsd: z.number().finite().nonnegative().optional(),
    })
    .strict()
    .optional(),
});
export type Tenant = z.infer<typeof tenantSchema>;
export type Identity = {
  sub: string;
  provider: "google" | "microsoft";
  groups: string[];
  name: string;
  issuer?: string;
  workspace?: string;
  objectId?: string;
  domain?: string;
};
export function managedRegistry() {
  try {
    const value = JSON.parse(
      readFileSync(
        join(process.env.AIRE_DATA_DIR || "/data", "managed-tenants.json"),
        "utf8",
      ),
    );
    return z
      .object({
        revision: z.number().int().nonnegative(),
        tenants: z.array(tenantSchema),
      })
      .strict()
      .parse(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { revision: 0, tenants: [] as Tenant[] };
    throw new AppError(
      503,
      "tenant_storage",
      "O cadastro de organizações precisa ser revisado.",
    );
  }
}
export const isDemo = () => process.env.AIRE_MODE === "demo";
export function tenants(): Tenant[] {
  try {
    const configured = z
      .array(tenantSchema)
      .parse(JSON.parse(process.env.AIRE_TENANTS_JSON || "[]"));
    const managed = managedRegistry().tenants;
    const ts = [
      ...configured.filter((t) => !managed.some((m) => m.id === t.id)),
      ...managed,
    ];
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
    if (
      tenant.enabled === false ||
      (identity.workspace && identity.workspace !== tenant.id)
    )
      return [];
    if (tenant.sso) {
      // A dedicated portal pins the workspace above. On the shared legacy
      // portal, verified issuer + immutable membership identify a unique tenant.
      // A tenant-specific OAuth application must still be selected before login.
      if (
        !identity.workspace &&
        (identity.provider === "microsoft"
          ? tenant.sso.microsoftClientIdEnv
          : tenant.sso.googleClientIdEnv)
      )
        return [];
      if (
        identity.provider === "microsoft" &&
        (!tenant.sso.microsoftTenantId ||
          identity.issuer !==
            `https://login.microsoftonline.com/${tenant.sso.microsoftTenantId}/v2.0`)
      )
        return [];
      if (
        identity.provider === "google" &&
        (identity.issuer !== "https://accounts.google.com" ||
          !identity.domain ||
          !tenant.sso.googleDomains.includes(identity.domain))
      )
        return [];
    }
    const member = tenant.members.find(
      (m) =>
        m.provider === identity.provider &&
        (m.subject === identity.sub ||
          (tenant.sso &&
            identity.provider === "microsoft" &&
            m.subject === identity.objectId)),
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

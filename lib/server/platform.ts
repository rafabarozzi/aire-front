import {
  appendFile,
  mkdir,
  open,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  AppError,
  managedRegistry,
  tenantSchema,
  tenants,
  type Identity,
  type Tenant,
} from "./config.ts";
import { context } from "./session.ts";
import { engine } from "./upstream.ts";

export function isPlatformAdmin(identity: Identity) {
  const admins = z
    .array(
      z
        .object({
          provider: z.enum(["microsoft", "google"]),
          issuer: z.string().url(),
          subject: z.string().min(1),
        })
        .strict(),
    )
    .parse(JSON.parse(process.env.AIRE_PLATFORM_ADMINS_JSON || "[]"));
  return admins.some(
    (a) =>
      a.provider === identity.provider &&
      a.issuer === identity.issuer &&
      a.subject === identity.sub,
  );
}
async function saveTenant(tenant: Tenant, revision: number, actor: Identity) {
  const root = process.env.AIRE_DATA_DIR || "/data";
  await mkdir(root, { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = await open(join(root, "managed-tenants.lock"), "wx", 0o600);
  } catch {
    throw new AppError(
      409,
      "registry_busy",
      "O cadastro está sendo atualizado. Tente novamente.",
    );
  }
  const tmp = join(root, `managed-tenants.${crypto.randomUUID()}.tmp`);
  try {
    const current = managedRegistry();
    if (current.revision !== revision)
      throw new AppError(
        409,
        "registry_conflict",
        "Atualize a lista antes de salvar.",
      );
    const next = {
      revision: revision + 1,
      tenants: [...current.tenants.filter((t) => t.id !== tenant.id), tenant],
    };
    await appendFile(
      join(root, "platform-audit.jsonl"),
      JSON.stringify({
        at: new Date().toISOString(),
        action: "tenant.saved",
        tenant: tenant.id,
        actor: { issuer: actor.issuer, subject: actor.sub },
        revision: next.revision,
      }) + "\n",
      { mode: 0o600 },
    );
    await writeFile(tmp, JSON.stringify(next), { mode: 0o600, flag: "wx" });
    await rename(tmp, join(root, "managed-tenants.json"));
    return next.revision;
  } finally {
    await unlink(tmp).catch(() => {});
    await lock.close();
    await unlink(join(root, "managed-tenants.lock"));
  }
}
export async function platformApi(
  request: Request,
  path: string[],
  body: () => Promise<unknown>,
) {
  const c = await context(request);
  if (!isPlatformAdmin(c.identity))
    throw new AppError(
      403,
      "platform_forbidden",
      "Acesso exclusivo da administração Northeia.",
    );
  if (path.length === 1 && request.method === "GET")
    return { revision: managedRegistry().revision, tenants: tenants() };
  if (path.length === 1 && request.method === "PUT") {
    const parsed = z
      .object({
        revision: z.number().int().nonnegative(),
        tenant: tenantSchema,
      })
      .strict()
      .safeParse(await body());
    if (!parsed.success)
      throw new AppError(
        422,
        "tenant_invalid",
        "Revise o cadastro da organização.",
      );
    const { tenant, revision } = parsed.data;
    if (
      !tenant.sso ||
      !tenant.plan ||
      (!tenant.sso.microsoftTenantId && !tenant.sso.googleDomains.length)
    )
      throw new AppError(
        422,
        "onboarding_incomplete",
        "Configure ao menos um provedor SSO e o plano.",
      );
    if (tenant.id === c.tenant.id)
      throw new AppError(
        409,
        "self_lockout",
        "Altere a organização operadora pelo procedimento de manutenção.",
      );
    const others = tenants().filter((t) => t.id !== tenant.id);
    if (
      others.some(
        (t) =>
          t.engineTokenEnv === tenant.engineTokenEnv ||
          t.engineUrlEnv === tenant.engineUrlEnv,
      )
    )
      throw new AppError(
        409,
        "engine_shared",
        "Cada cliente deve ter referências próprias para URL e credencial do motor.",
      );
    if (tenant.enabled !== false) {
      const health = z
        .object({ tenant_id: z.string().optional() })
        .parse(await (await engine(tenant, "/healthz")).json());
      if (health.tenant_id !== tenant.id)
        throw new AppError(
          409,
          "engine_tenant",
          "Configure AIRE_TENANT_ID no motor deste cliente antes de ativá-lo.",
        );
      await engine(tenant, "/v1/usage");
    }
    return { revision: await saveTenant(tenant, revision, c.identity) };
  }
  if (path.length === 3 && path[2] === "usage" && request.method === "GET") {
    const tenant = tenants().find((t) => t.id === path[1]);
    if (!tenant)
      throw new AppError(404, "not_found", "Organização não encontrada.");
    const month = new URL(request.url).searchParams.get("month");
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new AppError(422, "month", "Informe o mês no formato AAAA-MM.");
    return {
      tenant: tenant.id,
      plan: tenant.plan || null,
      usage: await (
        await engine(tenant, "/v1/usage" + (month ? `?month=${month}` : ""))
      ).json(),
    };
  }
  throw new AppError(404, "not_found", "Recurso não encontrado.");
}

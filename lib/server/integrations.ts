import {
  readFile,
  mkdir,
  writeFile,
  rename,
  unlink,
  appendFile,
} from "node:fs/promises";
import { join } from "node:path";
import { hkdfSync } from "node:crypto";
import { CompactEncrypt, compactDecrypt } from "jose";
import { z } from "zod";
import { AppError, type Tenant } from "./config.ts";
import { tenantDirectory } from "./store.ts";
export const providers = ["github", "gitlab", "datadog", "dynatrace"] as const;
export type Provider = (typeof providers)[number];
export const sites = [
  "datadoghq.com",
  "datadoghq.eu",
  "us3.datadoghq.com",
  "us5.datadoghq.com",
  "ap1.datadoghq.com",
  "ap2.datadoghq.com",
  "uk1.datadoghq.com",
  "ddog-gov.com",
  "us2.ddog-gov.com",
] as const;
const secret = z
  .string()
  .trim()
  .min(8)
  .max(8192)
  .regex(/^[^\s\x00-\x1f\x7f]+$/);
const pem = z.string().trim().min(64).max(8192);
export const integrationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("github-token"), token: secret }).strict(),
  z
    .object({
      kind: z.literal("github-app"),
      appId: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
      installationId: z.string().regex(/^[1-9][0-9]{0,19}$/),
      privateKey: pem,
    })
    .strict(),
  z.object({ kind: z.literal("gitlab-token"), token: secret }).strict(),
  z
    .object({
      kind: z.literal("datadog"),
      site: z.enum(sites),
      apiKey: secret,
      applicationKey: secret,
    })
    .strict(),
  z
    .object({
      kind: z.literal("dynatrace"),
      environment: z
        .string()
        .url()
        .refine(
          (v) => /^https:\/\/[a-z0-9-]+\.live\.dynatrace\.com\/?$/.test(v),
          "Use a URL SaaS do ambiente Dynatrace",
        ),
      token: secret,
    })
    .strict(),
]);
export type Integration = z.infer<typeof integrationSchema>;
const schema = z
  .object({
    revision: z.number().int().nonnegative(),
    encrypted: z.string().nullable(),
    updatedAt: z.string(),
  })
  .strict();
type State = z.infer<typeof schema>;
function file(t: Tenant, p: Provider) {
  return join(tenantDirectory(t.id), "integration-" + p + ".json");
}
async function state(t: Tenant, p: Provider): Promise<State> {
  try {
    return schema.parse(JSON.parse(await readFile(file(t, p), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { revision: 0, encrypted: null, updatedAt: "" };
    throw new AppError(
      503,
      "integration_storage",
      "Não foi possível ler a conexão.",
    );
  }
}
function key(t: Tenant, p: Provider) {
  const s =
    process.env.AIRE_CREDENTIAL_SECRET || process.env.AIRE_SESSION_SECRET || "";
  if (s.length < 32)
    throw new AppError(
      503,
      "credential_encryption",
      "Configure a chave de proteção no servidor.",
    );
  return new Uint8Array(
    hkdfSync("sha256", s, "aire-integrations-v1", t.id + ":" + p, 32),
  );
}
export async function integration(
  t: Tenant,
  p: Provider,
): Promise<Integration | null | undefined> {
  const s = await state(t, p);
  if (!s.revision) return undefined;
  if (!s.encrypted) return null;
  try {
    const d = await compactDecrypt(s.encrypted, key(t, p), {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    return integrationSchema.parse(
      JSON.parse(new TextDecoder().decode(d.plaintext)),
    );
  } catch {
    throw new AppError(
      503,
      "credential_encryption",
      "Cadastre novamente a credencial ou revise a chave de proteção.",
    );
  }
}
export async function integrationSummary(t: Tenant, provider: Provider) {
  const s = await state(t, provider);
  let c: Integration | null | undefined,
    needsReplacement = false;
  try {
    c = await integration(t, provider);
  } catch (e) {
    if (!(e instanceof AppError) || e.code !== "credential_encryption") throw e;
    needsReplacement = true;
  }
  return {
    provider,
    revision: s.revision,
    configured: !!s.encrypted,
    needsReplacement,
    updatedAt: s.updatedAt,
    kind: c?.kind,
    site: c?.kind === "datadog" ? c.site : undefined,
    environment: c?.kind === "dynatrace" ? c.environment : undefined,
    appId: c?.kind === "github-app" ? c.appId : undefined,
    installationId: c?.kind === "github-app" ? c.installationId : undefined,
  };
}
export async function integrationView(t: Tenant) {
  return Promise.all(
    providers.map((provider) => integrationSummary(t, provider)),
  );
}
const queues = new Map<string, Promise<unknown>>();
export async function saveIntegration(
  t: Tenant,
  p: Provider,
  revision: number,
  value: Integration | null,
  actor: string,
) {
  if (value && !value.kind.startsWith(p))
    throw new AppError(
      422,
      "integration_provider",
      "Credencial incompatível com o provedor.",
    );
  const id = t.id + ":" + p,
    previous = queues.get(id) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      const s = await state(t, p);
      if (s.revision !== revision)
        throw new AppError(
          409,
          "connection_conflict",
          "A conexão foi alterada. Atualize a tela.",
        );
      const encrypted = value
        ? await new CompactEncrypt(
            new TextEncoder().encode(
              JSON.stringify(integrationSchema.parse(value)),
            ),
          )
            .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
            .encrypt(key(t, p))
        : null;
      const dir = tenantDirectory(t.id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = file(t, p) + "." + crypto.randomUUID() + ".tmp";
      try {
        await appendFile(
          join(dir, "audit.jsonl"),
          JSON.stringify({
            time: new Date().toISOString(),
            action: "integration.changed",
            phase: "requested",
            provider: p,
            subject: actor,
            revision: s.revision + 1,
          }) + "\n",
          { mode: 0o600 },
        );
        await writeFile(
          tmp,
          JSON.stringify({
            revision: s.revision + 1,
            encrypted,
            updatedAt: new Date().toISOString(),
          }),
          { mode: 0o600, flag: "wx" },
        );
        await rename(tmp, file(t, p));
      } finally {
        await unlink(tmp).catch(() => {});
      }
    });
  queues.set(id, operation);
  try {
    await operation;
    return integrationView(t);
  } finally {
    if (queues.get(id) === operation) queues.delete(id);
  }
}

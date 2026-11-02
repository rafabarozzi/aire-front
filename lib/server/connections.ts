import {
  mkdir,
  readFile,
  writeFile,
  rename,
  appendFile,
  unlink,
} from "node:fs/promises";
import { integrationSummary } from "./integrations.ts";
import { modernGithubCredential } from "./provider-auth.ts";
import { hkdfSync } from "node:crypto";
import { join } from "node:path";
import { CompactEncrypt, compactDecrypt } from "jose";
import { z } from "zod";
import { AppError, type Tenant } from "./config.ts";
import { tenantDirectory } from "./store.ts";
import type { ConnectionsView } from "../aire/types.ts";
import { normalizeRepository } from "../aire/validation.ts";

const repository = z
  .string()
  .max(500)
  .transform((value, ctx) => {
    try {
      return normalizeRepository(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Repositório inválido" });
      return z.NEVER;
    }
  });
const credentialSchema = z
  .object({
    label: z.string().min(1).max(80),
    encrypted: z.string().max(16000),
    updatedAt: z.string(),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    repositories: z.array(repository).max(500).optional(),
    credential: credentialSchema.nullable().optional(),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
const revision = z.number().int().nonnegative();
const token = z
  .string()
  .trim()
  .min(20)
  .max(4096)
  .regex(/^[A-Za-z0-9_]+$/);
export const addRepositorySchema = z.object({ repository, revision }).strict();
export const editRepositorySchema = z
  .object({ repository, previousRepository: repository, revision })
  .strict();
export const deleteRepositorySchema = z
  .object({ repository, revision })
  .strict();
export const putCredentialSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[^\x00-\x1f\x7f]+$/),
    token: token.optional(),
    revision,
  })
  .strict();
export const deleteCredentialSchema = z.object({ revision }).strict();

async function readState(tenant: Tenant): Promise<State> {
  try {
    return stateSchema.parse(
      JSON.parse(
        await readFile(
          join(tenantDirectory(tenant.id), "connections.json"),
          "utf8",
        ),
      ),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, revision: 0 };
    throw new AppError(
      503,
      "connection_storage",
      "Não foi possível ler a configuração de conexões. Solicite a revisão do armazenamento.",
    );
  }
}
function encryptionKey(tenant: Tenant) {
  const secret =
    process.env.AIRE_CREDENTIAL_SECRET || process.env.AIRE_SESSION_SECRET || "";
  if (secret.length < 32)
    throw new AppError(
      503,
      "credential_encryption",
      "A chave de proteção das credenciais precisa ser configurada no servidor.",
    );
  return new Uint8Array(
    hkdfSync(
      "sha256",
      secret,
      "aire-connections-v1",
      `github:${tenant.id}`,
      32,
    ),
  );
}
async function tokenFromState(tenant: Tenant, state: State) {
  if (state.credential === null) return undefined;
  if (state.credential === undefined)
    return process.env[tenant.githubTokenEnv] || undefined;
  try {
    const result = await compactDecrypt(
      state.credential.encrypted,
      encryptionKey(tenant),
      {
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256GCM"],
      },
    );
    return new TextDecoder().decode(result.plaintext);
  } catch {
    throw new AppError(
      503,
      "credential_encryption",
      "A credencial salva não pôde ser aberta. Cadastre uma nova credencial ou revise a chave de proteção.",
    );
  }
}
export async function githubCredential(tenant: Tenant) {
  const modern = await modernGithubCredential(tenant);
  return modern === undefined
    ? tokenFromState(tenant, await readState(tenant))
    : modern || undefined;
}
export async function authorizedRepositories(tenant: Tenant) {
  return (await readState(tenant)).repositories ?? tenant.repositories;
}
function view(tenant: Tenant, state: State): ConnectionsView {
  const credential =
    state.credential === null
      ? null
      : state.credential
        ? {
            label: state.credential.label,
            source: "panel" as const,
            updatedAt: state.credential.updatedAt,
          }
        : process.env[tenant.githubTokenEnv]
          ? {
              label: "Credencial do ambiente",
              source: "environment" as const,
            }
          : null;
  return {
    revision: state.revision,
    repositories: state.repositories ?? tenant.repositories,
    credential,
    githubConfigured: Boolean(credential),
    engineConfigured: Boolean(
      process.env[tenant.engineUrlEnv] && process.env[tenant.engineTokenEnv],
    ),
    groups: tenant.groups.length,
  };
}
export async function connectionsView(tenant: Tenant) {
  const result = view(tenant, await readState(tenant));
  const modern = await integrationSummary(tenant, "github");
  if (modern.revision) {
    result.githubConfigured = modern.configured;
    result.credential = modern.configured
      ? {
          label: modern.kind === "github-app" ? "GitHub App" : "Token GitHub",
          source: "panel",
          updatedAt: modern.updatedAt,
        }
      : null;
  }
  return result;
}
const queues = new Map<string, Promise<unknown>>();
async function mutate(
  tenant: Tenant,
  expectedRevision: number,
  subject: string,
  action: string,
  change: (state: State) => Promise<State>,
): Promise<ConnectionsView> {
  const previous = queues.get(tenant.id) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      const state = await readState(tenant);
      if (state.revision !== expectedRevision)
        throw new AppError(
          409,
          "connection_conflict",
          "Outra alteração foi salva neste workspace. Atualize a lista e tente novamente.",
        );
      const next = stateSchema.parse(await change(state));
      next.revision = state.revision + 1;
      const dir = tenantDirectory(tenant.id);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const temp = join(dir, `connections.${crypto.randomUUID()}.tmp`);
      try {
        // Record only the action and actor, never a token, label or provider body.
        await appendFile(
          join(dir, "audit.jsonl"),
          JSON.stringify({
            time: new Date().toISOString(),
            action,
            phase: "requested",
            subject,
            revision: next.revision,
          }) + "\n",
          { mode: 0o600 },
        );
        await writeFile(temp, JSON.stringify(next), {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temp, join(dir, "connections.json"));
      } finally {
        await unlink(temp).catch(() => {});
      }
      return view(tenant, next);
    });
  queues.set(tenant.id, operation);
  try {
    return await operation;
  } finally {
    if (queues.get(tenant.id) === operation) queues.delete(tenant.id);
  }
}
export async function saveCredential(
  tenant: Tenant,
  input: z.infer<typeof putCredentialSchema>,
  subject: string,
) {
  return mutate(
    tenant,
    input.revision,
    subject,
    "connections.credential.saved",
    async (state) => {
      const value = input.token || (await tokenFromState(tenant, state));
      if (!value)
        throw new AppError(
          422,
          "credential_required",
          "Informe o token para cadastrar a credencial.",
        );
      const encrypted = await new CompactEncrypt(
        new TextEncoder().encode(value),
      )
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .encrypt(encryptionKey(tenant));
      return {
        ...state,
        credential: {
          label: input.label,
          encrypted,
          updatedAt: new Date().toISOString(),
        },
      };
    },
  );
}
export async function deleteCredential(
  tenant: Tenant,
  expectedRevision: number,
  subject: string,
) {
  // A tombstone also disables environment fallback after removal through the panel.
  return mutate(
    tenant,
    expectedRevision,
    subject,
    "connections.credential.deleted",
    async (state) => ({ ...state, credential: null }),
  );
}
export async function changeRepository(
  tenant: Tenant,
  action: "add" | "edit" | "delete",
  input: { repository: string; previousRepository?: string; revision: number },
  subject: string,
) {
  return mutate(
    tenant,
    input.revision,
    subject,
    `connections.repository.${action}`,
    async (state) => {
      const repositories = [...(state.repositories ?? tenant.repositories)];
      const old = (input.previousRepository || input.repository).toLowerCase();
      const index = repositories.findIndex((r) => r.toLowerCase() === old);
      if (action !== "add" && index < 0)
        throw new AppError(
          404,
          "repository_not_registered",
          "Este repositório não está cadastrado no workspace.",
        );
      if (
        action !== "delete" &&
        repositories.some(
          (r, i) =>
            r.toLowerCase() === input.repository.toLowerCase() &&
            (action === "add" || i !== index),
        )
      )
        throw new AppError(
          409,
          "repository_duplicate",
          "Este repositório já está cadastrado no workspace.",
        );
      if (action === "add") {
        if (repositories.length >= 500)
          throw new AppError(
            422,
            "repository_limit",
            "O workspace atingiu o limite de 500 repositórios.",
          );
        repositories.push(input.repository);
      } else if (action === "edit") repositories[index] = input.repository;
      else repositories.splice(index, 1);
      return { ...state, repositories };
    },
  );
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AppError, type Tenant } from "./config.ts";
import { connectionsView } from "./connections.ts";
import { integrationSummary } from "./integrations.ts";
import { tenantDirectory } from "./store.ts";
import { validateRepository } from "./upstream.ts";

export const HEALTH_TTL = 15 * 60 * 1000;
const schema = z.object({
  fingerprint: z.string(), repository: z.string(),
  status: z.enum(["ready", "failed"]), checkedAt: z.string().datetime(),
  expiresAt: z.string().datetime(), branch: z.string().optional(),
  revision: z.string().optional(), message: z.string(),
});
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function scope(t: Tenant, repository: string) {
  const view = await connectionsView(t);
  if (!view.repositories.includes(repository))
    throw new AppError(403, "repository_forbidden", "Repositório não autorizado nesta organização.");
  const provider = repository.startsWith("https://gitlab.com/") ? "gitlab" : "github";
  const integration = await integrationSummary(t, provider);
  const fingerprint = hash(JSON.stringify([view.revision, integration.revision,
    integration.needsReplacement, process.env[t.githubTokenEnv] || ""]));
  const directory = join(tenantDirectory(t.id), "repository-health");
  return { fingerprint, directory, file: join(directory, hash(repository) + ".json") };
}
export async function repositoryHealth(t: Tenant, repository: string) {
  const s = await scope(t, repository);
  try {
    const record = schema.parse(JSON.parse(await readFile(s.file, "utf8")));
    if (record.fingerprint === s.fingerprint) {
      const { fingerprint: _, ...result } = record;
      void _;
      return { ...result, stale: Date.parse(result.expiresAt) <= Date.now() };
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return { repository, status: "unknown" as const, stale: true };
}
const pending = new Map<string, Promise<Awaited<ReturnType<typeof repositoryHealth>>>>();
export async function checkRepositoryHealth(t: Tenant, repository: string, force = false) {
  const s = await scope(t, repository);
  const key = JSON.stringify([t.id, repository, s.fingerprint]);
  const existing = pending.get(key);
  if (existing) return existing;
  const operation = (async () => {
    const cached = await repositoryHealth(t, repository);
    if (!force && !cached.stale) return cached;
    let result: { status: "ready" | "failed"; message: string; branch?: string; revision?: string };
    try {
      const validated = await validateRepository(t, repository);
      result = { status: "ready", branch: validated.branch, revision: validated.revision,
        message: "Acesso ao repositório e à revisão validado." };
    } catch {
      // Never persist provider responses, tokens or arbitrary upstream exception text.
      result = { status: "failed", message: "Não foi possível validar. Confira a credencial, as permissões e a revisão padrão e tente novamente." };
    }
    const checkedAt = new Date().toISOString();
    const record = { ...result, repository, fingerprint: s.fingerprint, checkedAt,
      expiresAt: new Date(Date.now() + HEALTH_TTL).toISOString() };
    await mkdir(s.directory, { recursive: true, mode: 0o700 });
    const temp = s.file + "." + randomUUID();
    await writeFile(temp, JSON.stringify(record), { mode: 0o600 });
    await rename(temp, s.file);
    return repositoryHealth(t, repository);
  })();
  pending.set(key, operation);
  try { return await operation; } finally { pending.delete(key); }
}

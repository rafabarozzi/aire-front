import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  appendFile,
  open,
  unlink,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { journeyKey, latestJourneys } from "../aire/journey-identity.ts";
import { join } from "node:path";
import { AppError } from "./config.ts";
import { defaultPolicy, type Journey, type RolePolicy } from "../aire/types.ts";
import { policySchema } from "../aire/validation.ts";
export function tenantDirectory(tenant: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(tenant))
    throw new Error("Invalid tenant");
  return join(process.env.AIRE_DATA_DIR || "/data", tenant);
}
const root = tenantDirectory;
function jobPath(tenant: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id))
    throw new AppError(404, "not_found", "Análise não encontrada.");
  return join(root(tenant), "jobs", id + ".json");
}
export async function saveJourney(tenant: string, j: Journey) {
  const file = jobPath(tenant, j.id);
  await mkdir(join(root(tenant), "jobs"), { recursive: true, mode: 0o700 });
  const tmp = file + "." + crypto.randomUUID();
  await writeFile(tmp, JSON.stringify(j), { mode: 0o600 });
  await rename(tmp, file);
  await recordEvent(tenant, `${j.id}:${j.status}`, {
    kind: "analysis.status",
    analysisId: j.id,
    journeyKey: journeyKey(j),
    status: j.status,
    createdAt: j.createdAt,
  });
}
export async function getJourney(tenant: string, id: string): Promise<Journey> {
  try {
    return JSON.parse(await readFile(jobPath(tenant, id), "utf8"));
  } catch (e) {
    if (e instanceof AppError) throw e;
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw new AppError(404, "not_found", "Análise não encontrada.");
    throw e;
  }
}
export async function listAnalyses(tenant: string): Promise<Journey[]> {
  const dir = join(root(tenant), "jobs");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return (
    await Promise.all(
      names
        .filter((n) => n.endsWith(".json"))
        .map((n) => getJourney(tenant, n.slice(0, -5))),
    )
  ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function readPolicy(tenant: string): Promise<RolePolicy> {
  try {
    const raw = JSON.parse(
      await readFile(join(root(tenant), "policy.json"), "utf8"),
    );
    // Preserve existing grants and add the new mandatory permission only to admin.
    if (Array.isArray(raw?.admin) && !raw.admin.includes("connections:manage"))
      raw.admin.push("connections:manage");
    if (Array.isArray(raw?.admin))
      for (const permission of [
        "collectors:read",
        "collectors:manage",
        "usage:read",
        "readiness:read",
        "readiness:evaluate",
        "readiness:approve",
        "readiness:execute",
      ])
        if (!raw.admin.includes(permission)) raw.admin.push(permission);
    return policySchema.parse(raw);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return structuredClone(defaultPolicy);
    throw e;
  }
}
export async function savePolicy(
  tenant: string,
  policy: RolePolicy,
  subject: string,
) {
  const checked = policySchema.parse(policy);
  await mkdir(root(tenant), { recursive: true, mode: 0o700 });
  const path = join(root(tenant), "policy.json"),
    tmp = path + "." + crypto.randomUUID();
  await appendFile(
    join(root(tenant), "audit.jsonl"),
    JSON.stringify({
      time: new Date().toISOString(),
      action: "access.policy.updated",
      subject,
      policy: checked,
    }) + "\n",
    { mode: 0o600 },
  );
  await writeFile(tmp, JSON.stringify(checked), { mode: 0o600 });
  await rename(tmp, path);
}

export async function listJourneys(tenant: string) {
  return latestJourneys(await listAnalyses(tenant));
}
export async function journeyHistory(tenant: string, journey: Journey) {
  const key = journeyKey(journey);
  return (await listAnalyses(tenant)).filter((j) => journeyKey(j) === key);
}
export async function lockJourney(
  tenant: string,
  journey: Parameters<typeof journeyKey>[0],
) {
  const dir = join(root(tenant), "locks");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(
    dir,
    createHash("sha256").update(journeyKey(journey)).digest("hex") + ".lock",
  );
  let file;
  try {
    file = await open(path, "wx", 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    throw new AppError(
      409,
      "journey_busy",
      "Esta jornada está sendo preparada. Atualize a lista em alguns segundos.",
    );
  }
  await file.writeFile(
    JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
  );
  return async () => {
    await file.close();
    await unlink(path);
  };
}
// Durable, idempotent event per transition. Repeated polling never adds a second event.
export async function recordEvent(
  tenant: string,
  id: string,
  event: Record<string, unknown>,
) {
  const dir = join(root(tenant), "events");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(
    dir,
    createHash("sha256").update(id).digest("hex") + ".json",
  );
  try {
    await writeFile(
      file,
      JSON.stringify({ ...event, id, observedAt: new Date().toISOString() }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}
export async function evolution(tenant: string) {
  const all = await listAnalyses(tenant),
    current = latestJourneys(all);
  const months = new Map<
    string,
    { month: string; analyses: number; completed: number; failed: number }
  >();
  for (const j of all) {
    const month = j.createdAt.slice(0, 7),
      row = months.get(month) || {
        month,
        analyses: 0,
        completed: 0,
        failed: 0,
      };
    row.analyses++;
    row.completed += Number(j.status === "COMPLETED");
    row.failed += Number(j.status === "FAILED");
    months.set(month, row);
  }
  return {
    uniqueJourneys: current.length,
    completedJourneys: current.filter((j) => j.status === "COMPLETED").length,
    analyses: all.length,
    reanalyses: all.length - current.length,
    repositories: new Set(current.map((j) => j.repository.toLowerCase())).size,
    firstAnalysisAt: all.at(-1)?.createdAt || null,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    outcomes: {
      alertsCreated: null,
      alertsAdjusted: null,
      hoursSaved: null,
      financialReturn: null,
    },
    measurement:
      "Análises agrupadas pelo mês de criação, com o estado conhecido atualmente. Efeitos operacionais serão medidos quando as ações da Etapa 2 forem executadas.",
  };
}


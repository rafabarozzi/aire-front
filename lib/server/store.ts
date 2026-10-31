import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  appendFile,
} from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "./config.ts";
import { defaultPolicy, type Journey, type RolePolicy } from "../aire/types.ts";
import { policySchema } from "../aire/validation.ts";
function root(tenant: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(tenant))
    throw new Error("Invalid tenant");
  return join(process.env.AIRE_DATA_DIR || "/data", tenant);
}
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
export async function listJourneys(tenant: string): Promise<Journey[]> {
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
    return policySchema.parse(
      JSON.parse(await readFile(join(root(tenant), "policy.json"), "utf8")),
    );
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

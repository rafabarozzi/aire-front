import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tenantDirectory } from "./store.ts";
import { AppError } from "./config.ts";
import {
  defaultObservabilityPolicy,
  policySchema,
  type PolicyRecord,
  type ObservabilityPolicy,
} from "../aire/observability.ts";
import { journeyKey } from "../aire/journey-identity.ts";
import type { Journey } from "../aire/types.ts";
export type Preferences = { revision: number; tags: Record<string, string> };
async function read<T>(tenant: string, name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(
      await readFile(
        join(tenantDirectory(tenant), "observability", name + ".json"),
        "utf8",
      ),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}
export async function readObservabilityPolicy(
  tenant: string,
): Promise<PolicyRecord> {
  const r = await read<PolicyRecord>(tenant, "policy", {
    revision: 0,
    policy: defaultObservabilityPolicy(),
  });
  return { ...r, policy: policySchema.parse(r.policy) };
}
function preferenceName(j: Journey) {
  return "journey-" + createHash("sha256").update(journeyKey(j)).digest("hex");
}
export function readJourneyPreferences(tenant: string, j: Journey) {
  return read<Preferences>(tenant, preferenceName(j), {
    revision: 0,
    tags: {},
  });
}
async function save<T extends { revision: number }>(
  tenant: string,
  name: string,
  revision: number,
  value: Omit<T, "revision">,
  actor: string,
  fallback: T,
): Promise<T> {
  const dir = join(tenantDirectory(tenant), "observability");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, name + ".lock");
  let handle;
  try {
    handle = await open(lock, "wx", 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      throw new AppError(
        409,
        "policy_busy",
        "Outra gravação está em andamento. Tente novamente.",
      );
    throw e;
  }
  const tmp = join(dir, name + "." + crypto.randomUUID() + ".tmp");
  try {
    const old = await read(tenant, name, fallback);
    if (old.revision !== revision)
      throw new AppError(
        409,
        "policy_conflict",
        "As regras foram alteradas por outra pessoa. Recarregue antes de salvar.",
      );
    const next = {
      ...value,
      revision: revision + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    } as unknown as T;
    // Archive is part of this tenant only. Keep prior policies for audit and reproducibility.
    await writeFile(
      join(
        dir,
        name + ".history-" + revision + "-" + crypto.randomUUID() + ".json",
      ),
      JSON.stringify(old),
      { mode: 0o600, flag: "wx" },
    );
    await writeFile(tmp, JSON.stringify(next), { mode: 0o600, flag: "wx" });
    await rename(tmp, join(dir, name + ".json"));
    return next;
  } finally {
    await unlink(tmp).catch(() => {});
    await handle.close();
    await unlink(lock);
  }
}
export function saveObservabilityPolicy(
  tenant: string,
  revision: number,
  policy: ObservabilityPolicy,
  actor: string,
) {
  return save<PolicyRecord>(
    tenant,
    "policy",
    revision,
    { policy: policySchema.parse(policy) },
    actor,
    { revision: 0, policy: defaultObservabilityPolicy() },
  );
}
export function saveJourneyPreferences(
  tenant: string,
  j: Journey,
  revision: number,
  tags: Record<string, string>,
  actor: string,
) {
  return save<Preferences>(
    tenant,
    preferenceName(j),
    revision,
    { tags },
    actor,
    { revision: 0, tags: {} },
  );
}

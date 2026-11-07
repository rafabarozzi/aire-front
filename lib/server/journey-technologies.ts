import { projectManifest } from "../aire/manifest.ts";
import type { Journey } from "../aire/types.ts";
import type { Tenant } from "./config.ts";
import { boundedBody, engine } from "./upstream.ts";

const languages: Record<string, string> = {
  java: "Java",
  cs: "C#",
  py: "Python",
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  kt: "Kotlin",
  go: "Go",
  rb: "Ruby",
  rs: "Rust",
  php: "PHP",
};
const systems: Record<string, string> = {
  RABBITMQ: "RabbitMQ",
  KAFKA: "Kafka",
  REDIS: "Redis",
  POSTGRESQL: "PostgreSQL",
  SQLITE: "SQLite",
  MYSQL: "MySQL",
  MONGODB: "MongoDB",
};

export function manifestTechnologies(
  raw: unknown,
  analysisId: string,
): string[] {
  const manifest = projectManifest(raw, analysisId);
  const found = new Set<string>();
  for (const e of manifest.evidence) {
    const ext = /\.([a-z0-9]+)$/i.exec(e.path)?.[1].toLowerCase();
    if (ext && Object.hasOwn(languages, ext)) found.add(languages[ext]);
  }
  for (const r of manifest.resources) {
    const tag = r.system?.toUpperCase();
    if (tag && Object.hasOwn(systems, tag)) found.add(systems[tag]);
  }
  return [...found].sort();
}

// Terminal artifacts are immutable. Cache only the small projection, never source paths or tokens.
const cache = new Map<string, { at: number; values: string[] | null }>();
const pending = new Map<string, Promise<string[] | null>>();
async function readStacks(tenant: Tenant, j: Journey) {
  const key = JSON.stringify([
    tenant.id,
    process.env[tenant.engineUrlEnv],
    j.id,
    j.revision,
  ]);
  const cached = cache.get(key);
  if (
    cached &&
    Date.now() - cached.at < (cached.values === null ? 15_000 : 3_600_000)
  )
    return cached.values;
  const existing = pending.get(key);
  if (existing) return existing;
  const work = (async () => {
    let values: string[] | null = null;
    try {
      const response = await engine(
        tenant,
        `/v1/analyses/${j.id}/artifacts/manifest`,
        {
          signal: AbortSignal.timeout(3500),
        },
      );
      values = manifestTechnologies(
        JSON.parse(
          new TextDecoder().decode(
            await boundedBody(response, 10 * 1024 * 1024),
          ),
        ),
        j.id,
      );
    } catch {
      // Keep the inventory usable for old analyses or an unavailable engine. A later read retries.
    }
    cache.delete(key);
    if (cache.size >= 1024) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), values });
    return values;
  })();
  pending.set(key, work);
  try {
    return await work;
  } finally {
    pending.delete(key);
  }
}

export async function withTechnologies(tenant: Tenant, journeys: Journey[]) {
  const rows: Journey[] = [];
  for (let i = 0; i < journeys.length; i += 4) {
    const batch = await Promise.all(
      journeys.slice(i, i + 4).map(async (j) => {
        if (j.status !== "COMPLETED" || j.stacks?.length) return j;
        const values = await readStacks(tenant, j);
        return {
          ...j,
          stacks: values ?? [],
          stackEvidence:
            values === null ? ("unavailable" as const) : ("verified" as const),
        };
      }),
    );
    rows.push(...batch);
  }
  return rows;
}

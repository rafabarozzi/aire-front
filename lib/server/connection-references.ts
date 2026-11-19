// A review instance may display tenant-scoped metadata from its source portal.
// References never participate in authentication, discovery or credential fallback.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AppError, type Tenant } from "./config.ts";
import { tenantDirectory } from "./store.ts";
import { engine } from "./upstream.ts";

const referencesSchema = z
  .object({
    tenant: z.string(),
    observedAt: z.string().datetime(),
    github: z.literal(true).optional(),
    datadog: z.object({ engineReadBridge: z.boolean() }).strict().optional(),
  })
  .strict();

const engineReadSchema = z.object({
  modes: z.array(z.string()),
  realRead: z.object({
    ready: z.boolean(),
    reason: z.string().nullish(),
    validation: z.object({ ready: z.boolean() }).nullish(),
  }),
});

export async function connectionReferences(tenant: Tenant) {
  let raw: string;
  try {
    raw = await readFile(
      join(tenantDirectory(tenant.id), "connection-references.json"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new AppError(
      503,
      "references_unavailable",
      "Referências de conexão indisponíveis.",
    );
  }
  const ref = referencesSchema.safeParse(JSON.parse(raw));
  if (!ref.success || ref.data.tenant !== tenant.id)
    throw new AppError(
      503,
      "invalid_references",
      "Referências de conexão inválidas.",
    );
  const { github, datadog, observedAt } = ref.data;
  let engineStatus: "verified" | "pending" | "unavailable" = "unavailable";
  if (datadog?.engineReadBridge) {
    try {
      const response = await engine(tenant, "/v1/readiness/capabilities", {
        signal: AbortSignal.timeout(2500),
      });
      const caps = engineReadSchema.parse(await response.json());
      if (
        caps.realRead?.ready === true &&
        caps.realRead.validation?.ready === true &&
        caps.modes?.includes("real")
      )
        engineStatus = "verified";
      else if (caps.realRead?.reason === "read_validation_required")
        engineStatus = "pending";
    } catch {
      /* The source observation is still valid when the worker is unavailable. */
    }
  }
  return {
    github: github ? { observedAt } : undefined,
    datadog: datadog
      ? {
          observedAt,
          engineStatus: datadog.engineReadBridge ? engineStatus : undefined,
        }
      : undefined,
  };
}

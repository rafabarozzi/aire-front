import { z } from "zod";
import { AppError, type Tenant } from "./config.ts";
import { context } from "./session.ts";
import { engine } from "./upstream.ts";
import { getJourney, listJourneys, journeyHistory } from "./store.ts";
import {
  readObservabilityPolicy,
  saveObservabilityPolicy,
  readJourneyPreferences,
  saveJourneyPreferences,
} from "./observability-store.ts";
import {
  environmentSchema,
  tagKeySchema,
  policySchema,
  preferencesSchema,
  monitorSettingsSchema,
  validateTags,
  type Capabilities,
  type ReadinessEvaluation,
} from "../aire/observability.ts";
const capSchema = z.object({
  policyContract: z.literal(1),
  modes: z.array(z.enum(["simulation", "real"])),
  warRoomOverrides: z.boolean(),
  messageGeneration: z.boolean(),
});
const unsupported: Capabilities = {
  policyContract: 0,
  modes: [],
  warRoomOverrides: false,
  messageGeneration: false,
};
export async function readinessCapabilities(
  tenant: Tenant,
): Promise<Capabilities> {
  const r = await engine(tenant, "/v1/readiness/capabilities", {}, [404, 501]);
  if (!r.ok) return unsupported;
  const parsed = capSchema.safeParse(await r.json());
  return parsed.success ? parsed.data : unsupported;
}
function checked<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S> {
  const r = schema.safeParse(raw);
  if (!r.success)
    throw new AppError(
      422,
      "validation",
      r.error.issues.map((i) => i.message).join(" "),
    );
  return r.data;
}
export async function observabilityApi(
  request: Request,
  path: string[],
  body: () => Promise<unknown>,
) {
  const method = request.method;
  const permission =
    method === "GET"
      ? "readiness:read"
      : path[1] === "policy"
        ? "readiness:configure"
        : path[3] === "preferences" || path[5] === "accept"
          ? "readiness:approve"
          : path[5] === "execute"
            ? "readiness:execute"
            : "readiness:evaluate";
  const c = await context(request, permission);
  const headers = {
    "Content-Type": "application/json",
    "X-AIRE-Actor": c.identity.sub,
    "X-AIRE-Permissions": c.permissions.join(","),
  };
  if (path.length === 2 && path[1] === "policy") {
    if (method === "GET") return readObservabilityPolicy(c.tenant.id);
    if (method === "PUT") {
      const b = checked(
        z
          .object({
            revision: z.number().int().nonnegative(),
            policy: policySchema,
          })
          .strict(),
        await body(),
      );
      return saveObservabilityPolicy(
        c.tenant.id,
        b.revision,
        b.policy,
        c.identity.sub,
      );
    }
  }
  if (path.length === 2 && path[1] === "capabilities" && method === "GET")
    return readinessCapabilities(c.tenant);
  if (path.length === 2 && path[1] === "journeys" && method === "GET") {
    const u = new URL(request.url),
      page = checked(
        z.coerce.number().int().min(1).max(100000),
        u.searchParams.get("page") || 1,
      ),
      q = (u.searchParams.get("q") || "").slice(0, 200).toLowerCase();
    const journeys = (await listJourneys(c.tenant.id)).filter(
      (j) =>
        j.name.toLowerCase().includes(q) ||
        j.repository.toLowerCase().includes(q),
    );
    const items = [];
    for (const j of journeys.slice((page - 1) * 5, page * 5)) {
      const evaluations: ReadinessEvaluation[] = [];
      const errors: string[] = [];
      for (const version of await journeyHistory(c.tenant.id, j)) {
        if (version.status !== "COMPLETED") continue;
        try {
          const found = await (
            await engine(c.tenant, `/v1/readiness/analyses/${version.id}`, {
              headers,
            })
          ).json();
          if (!Array.isArray(found)) throw Error("invalid history");
          evaluations.push(
            ...found.map((e: ReadinessEvaluation) => ({
              ...e,
              analysis: version.id,
            })),
          );
        } catch {
          errors.push(version.id);
        }
      }
      evaluations.sort((a, b) =>
        (b.created_at || "").localeCompare(a.created_at || ""),
      );
      items.push({
        journey: j,
        evaluations,
        error: errors.length
          ? "Não foi possível consultar todas as avaliações desta jornada."
          : null,
      });
    }
    return { items, total: journeys.length, page, pageSize: 5 };
  }
  if (path[1] !== "journeys" || !z.string().uuid().safeParse(path[2]).success)
    throw new AppError(404, "not_found", "Recurso não encontrado.");
  const j = await getJourney(c.tenant.id, path[2]);
  if (path.length === 4 && path[3] === "preferences") {
    if (method === "GET") return readJourneyPreferences(c.tenant.id, j);
    if (method === "PUT") {
      const b = checked(preferencesSchema, await body());
      return saveJourneyPreferences(
        c.tenant.id,
        j,
        b.revision,
        b.tags,
        c.identity.sub,
      );
    }
  }
  if (path[3] !== "evaluations" || path.length > 6)
    throw new AppError(404, "not_found", "Recurso não encontrado.");

  const evaluationId = path[4],
    action = path[5];
  if (evaluationId && !z.string().uuid().safeParse(evaluationId).success)
    throw new AppError(404, "not_found", "Avaliação não encontrada.");
  const base = evaluationId
    ? `/v1/readiness/${evaluationId}`
    : `/v1/readiness/analyses/${j.id}`;
  let evaluation: ReadinessEvaluation | undefined;
  if (evaluationId) {
    evaluation = await (await engine(c.tenant, base, { headers })).json();
    if (evaluation?.analysis !== j.id)
      throw new AppError(
        404,
        "not_found",
        "Avaliação não encontrada nesta jornada.",
      );
  }
  if (method === "GET" && !action)
    return (
      evaluation ?? (await (await engine(c.tenant, base, { headers })).json())
    );
  if (method === "GET" && action === "report")
    return {
      markdown: await (
        await engine(c.tenant, base + "/report", { headers })
      ).text(),
    };
  if (
    method !== "POST" ||
    (evaluationId && !["accept", "execute", "resume"].includes(action))
  )
    throw new AppError(404, "not_found", "Ação não encontrada.");
  const caps = await readinessCapabilities(c.tenant);
  if (caps.policyContract !== 1 || !caps.warRoomOverrides)
    throw new AppError(
      409,
      "policy_contract_unavailable",
      "O motor ainda não suporta as novas políticas. As regras estão salvas; a execução ficará disponível após a atualização da Etapa 2.",
    );
  let payload: unknown;
  if (!evaluationId) {
    if (j.status !== "COMPLETED")
      throw new AppError(
        409,
        "journey_not_ready",
        "Conclua o mapeamento antes de avaliar.",
      );
    const b = checked(
      z
        .object({
          mode: z.enum(["simulation", "real"]),
          environment: environmentSchema,
        })
        .strict(),
      await body(),
    );
    if (!caps.modes.includes(b.mode))
      throw new AppError(
        409,
        "mode_unavailable",
        "Este modo não está habilitado no motor.",
      );
    const policy = await readObservabilityPolicy(c.tenant.id),
      prefs = await readJourneyPreferences(c.tenant.id, j);
    payload = {
      ...b,
      contract_version: 1,
      requested_by_user: true,
      policy_context: {
        revision: policy.revision,
        updatedAt: policy.updatedAt,
        policy: policy.policy,
      },
      journey_tags: prefs.tags,
    };
  } else if (action === "accept") {
    const b = checked(
      z
        .object({
          selections: z
            .array(
              z
                .object({
                  id: z.string().min(1).max(128),
                  version: z.string().min(1).max(128),
                  tags: z.record(
                    tagKeySchema,
                    z.string().trim().min(1).max(200),
                  ),
                  monitor_settings: monitorSettingsSchema,
                })
                .strict(),
            )
            .min(1)
            .max(500),
        })
        .strict(),
      await body(),
    );
    if (new Set(b.selections.map((s) => s.id)).size !== b.selections.length)
      throw new AppError(422, "validation", "Seleção duplicada.");
    const policy = checked(
      policySchema,
      evaluation?.data.policy_context?.policy,
    );
    for (const s of b.selections) {
      const rec = evaluation?.data.recommendations.find(
        (r) => r.id === s.id && r.version === s.version,
      );
      if (!rec || rec.prerequisites.length || rec.execution === "APPLIED")
        throw new AppError(
          409,
          "recommendation_changed",
          "Atualize as recomendações antes de aceitar.",
        );
      if (s.monitor_settings.warRoomEnabled && !policy.response.warRoomEnabled)
        throw new AppError(
          422,
          "warroom_disabled",
          "War Room está desabilitada na política desta avaliação.",
        );
      const missing = validateTags(s.tags, policy);
      if (missing.length)
        throw new AppError(
          422,
          "tags_required",
          "Preencha as tags: " + missing.join(", "),
        );
    }
    payload = {
      contract_version: 1,
      policy_revision: evaluation?.data.policy_context?.revision,
      ...b,
      selections: b.selections.map((s) => ({
        ...s,
        tags: Object.entries(s.tags).map(([k, v]) => `${k}:${v}`),
      })),
    };
  } else if (action === "execute") {
    payload = {
      contract_version: 1,
      ...checked(
        z
          .object({
            recommendation_ids: z
              .array(z.string().min(1).max(128))
              .min(1)
              .max(500),
            enable_responses: z.boolean(),
            approval_token: z.string().min(1).max(500),
          })
          .strict(),
        await body(),
      ),
    };
  } else {
    checked(z.object({}).strict(), await body());
    payload = { contract_version: 1 };
  }
  return (
    await engine(c.tenant, base + (action ? "/" + action : ""), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    })
  ).json();
}

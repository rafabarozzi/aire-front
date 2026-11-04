import {
  catalogSchema,
  responseSelectionSchema,
  responseContext,
} from "../aire/operational-catalog.ts";
import {
  readOperationalCatalog,
  saveOperationalCatalog,
} from "./observability-store.ts";
import { z } from "zod";
import { AppError, type Tenant } from "./config.ts";
import { context } from "./session.ts";
import { boundedBody, engine } from "./upstream.ts";
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
  operationalCatalog: z.boolean().optional(),
  serverContext: z.boolean().optional(),
  defaultContext: z
    .object({
      mode: z.enum(["simulation", "real"]).nullable().optional(),
      environment: z.string().nullable().optional(),
      ready: z.boolean(),
      reason: z.string().nullable().optional(),
    })
    .optional(),
  realRead: z
    .object({ ready: z.boolean(), reason: z.string().nullable().optional() })
    .optional(),
  realExecution: z.boolean().default(false),
  realResponses: z.boolean().default(false),
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
async function validateRealRead(
  tenant: Tenant,
  headers: Record<string, string>,
) {
  const response = await engine(
    tenant,
    "/v1/readiness/integration/validate",
    {
      method: "POST",
      headers,
      body: "{}",
    },
    [404, 501, 409, 422, 503],
  );
  if (!response.ok)
    throw new AppError(
      409,
      "read_validation_unavailable",
      "A leitura do Datadog ainda não pôde ser validada. Confira a configuração do ambiente e a conexão do motor com as credenciais.",
    );
  const result = z
    .object({ ready: z.boolean() })
    .safeParse(await response.json());
  if (!result.success || !result.data.ready)
    throw new AppError(
      409,
      "read_validation_failed",
      "Não foi possível confirmar a leitura do Datadog. Verifique permissões, conexão e orçamento de consultas antes de tentar novamente.",
    );
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
      ? path[1] === "environments"
        ? "readiness:evaluate"
        : "readiness:read"
      : ["policy", "catalog"].includes(path[1])
        ? "readiness:configure"
        : path[3] === "preferences" || path[5] === "accept"
          ? "readiness:approve"
          : path[5] === "execute"
            ? "readiness:execute"
            : "readiness:evaluate";
  const preferencesWrite = method === "PUT" && path[3] === "preferences";
  const c = await context(request, preferencesWrite ? undefined : permission);
  if (
    preferencesWrite &&
    !c.permissions.some(
      (p) => p === "readiness:evaluate" || p === "readiness:approve",
    )
  )
    throw new AppError(
      403,
      "forbidden",
      "Seu perfil não permite editar os dados da jornada.",
    );
  const headers = {
    "Content-Type": "application/json",
    "X-AIRE-Actor": c.identity.sub,
    "X-AIRE-Permissions": c.permissions.join(","),
  };
  if (method === "GET" && path.length === 2 && path[1] === "environments") {
    const r = await engine(
      c.tenant,
      "/v1/readiness/environments",
      { headers },
      [404, 501],
    );
    if (!r.ok) return { environments: [] };
    return checked(
      z.object({ environments: z.array(environmentSchema) }),
      await r.json(),
    );
  }
  if (path.length === 2 && path[1] === "catalog") {
    if (method === "GET") return readOperationalCatalog(c.tenant.id);
    if (method === "PUT") {
      const b = checked(
        z
          .object({
            revision: z.number().int().nonnegative(),
            catalog: catalogSchema,
          })
          .strict(),
        await body(),
      );
      return saveOperationalCatalog(
        c.tenant.id,
        b.revision,
        b.catalog,
        c.identity.sub,
      );
    }
  }
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
      if (
        b.teamId &&
        !(await readOperationalCatalog(c.tenant.id)).catalog.teams.some(
          (t) => t.id === b.teamId,
        )
      )
        throw new AppError(
          422,
          "team_invalid",
          "Selecione uma equipe cadastrada nesta organização.",
        );
      return saveJourneyPreferences(
        c.tenant.id,
        j,
        b.revision,
        b.tags,
        c.identity.sub,
        b.teamId,
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
  let caps = await readinessCapabilities(c.tenant);
  if (!evaluationId && caps.serverContext) {
    await validateRealRead(c.tenant, headers);
    caps = await readinessCapabilities(c.tenant);
  }
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
          mode: z.enum(["simulation", "real"]).optional(),
          environment: environmentSchema.optional(),
        })
        .strict(),
      await body(),
    );
    const discovery = !!b.environment && !b.mode;
    if (!discovery && !b.mode && !caps.operationalCatalog)
      throw new AppError(
        409,
        "catalog_contract_unavailable",
        "Novas avaliações aguardam a integração dos cadastros operacionais ao serviço de prontidão.",
      );
    const mode = b.mode || "real";
    if (!discovery && !caps.modes.includes(mode))
      throw new AppError(
        409,
        "mode_unavailable",
        "A avaliação com telemetria real ainda não está habilitada para esta organização.",
      );
    const policy = await readObservabilityPolicy(c.tenant.id),
      prefs = await readJourneyPreferences(c.tenant.id, j);
    const catalog = await readOperationalCatalog(c.tenant.id);
    const targetEnvironment = discovery
      ? b.environment
      : caps.serverContext
        ? caps.defaultContext?.environment
        : b.environment ||
          prefs.tags.env ||
          catalog.catalog.evaluationEnvironment;
    if (
      !discovery &&
      caps.serverContext &&
      (!caps.defaultContext?.ready || caps.defaultContext.mode !== "real")
    )
      throw new AppError(
        409,
        "evaluation_context_unavailable",
        "Configure no motor o ambiente real da telemetria para iniciar a avaliação.",
      );
    if (!targetEnvironment)
      throw new AppError(
        422,
        "environment_required",
        "Configure o ambiente em Observabilidade → Cadastros operacionais, ou preencha a tag env da jornada.",
      );
    const environment = checked(environmentSchema, targetEnvironment);
    const missing = validateTags(prefs.tags, policy.policy);
    if (missing.length)
      throw new AppError(
        422,
        "tags_required",
        "Preencha as tags: " + missing.join(", "),
      );
    if (!b.mode && !catalog.catalog.teams.some((t) => t.id === prefs.teamId))
      throw new AppError(
        422,
        "team_required",
        "Selecione uma equipe responsável.",
      );
    if (
      !discovery &&
      !caps.operationalCatalog &&
      policy.policy.response.warRoomEnabled &&
      (!policy.policy.response.team ||
        !policy.policy.response.onCallReference ||
        !policy.policy.response.roomTarget)
    )
      throw new AppError(
        409,
        "catalog_contract_unavailable",
        "A avaliação com resposta de War Room aguarda a atualização do serviço de prontidão para os cadastros operacionais.",
      );
    let manifestRevision: string | undefined;
    if (discovery) {
      const artifact = await engine(
        c.tenant,
        `/v1/analyses/${j.id}/artifacts/manifest`,
      );
      const manifest = checked(
        z.object({
          integrity: z.object({
            contentSha256: z.string().regex(/^[a-f0-9]{64}$/i),
          }),
        }),
        JSON.parse(
          new TextDecoder().decode(
            await boundedBody(artifact, 10 * 1024 * 1024),
          ),
        ),
      );
      manifestRevision = manifest.integrity.contentSha256;
    }
    payload = {
      ...(discovery
        ? { mode, environment, manifest_revision: manifestRevision }
        : caps.serverContext
          ? {}
          : { mode, environment }),
      ...(discovery || caps.operationalCatalog
        ? {
            operational_context: {
              revision: catalog.revision,
              catalog: catalog.catalog,
              teamId: prefs.teamId,
            },
          }
        : {}),
      contract_version: 1,
      requested_by_user: true,
      policy_context: {
        revision: policy.revision,
        updatedAt: policy.updatedAt,
        policy: policy.policy,
      },
      journey_tags: Object.fromEntries(
        Object.entries(prefs.tags).filter(
          ([key]) =>
            key === policy.policy.tags.journeyKey ||
            policy.policy.tags.definitions.some((t) => t.key === key),
        ),
      ),
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
                  response_selection: responseSelectionSchema.optional(),
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
      if (
        s.monitor_settings.warRoomEnabled &&
        evaluation?.data.input?.mode !== "simulation" &&
        !caps.realResponses
      )
        throw new AppError(
          409,
          "real_responses_unavailable",
          "O acionamento de respostas ainda aguarda habilitação. Revise o monitor sem ativar War Room.",
        );
      const missing = validateTags(s.tags, policy);
      if (missing.length)
        throw new AppError(
          422,
          "tags_required",
          "Preencha as tags: " + missing.join(", "),
        );
    }
    const snapshot = evaluation?.data.operational_context;
    const catalog = snapshot
      ? {
          revision: snapshot.revision,
          catalog: checked(catalogSchema, snapshot.catalog),
        }
      : undefined;
    if (b.selections.some((s) => s.response_selection) && !catalog)
      throw new AppError(
        409,
        "catalog_snapshot_missing",
        "Inicie uma nova avaliação para usar os cadastros operacionais nesta aprovação.",
      );
    if (
      b.selections.some((s) => s.response_selection) &&
      !caps.operationalCatalog
    )
      throw new AppError(
        409,
        "catalog_contract_unavailable",
        "A aprovação com equipes, escalas e janelas aguarda a atualização do serviço de prontidão.",
      );
    payload = {
      contract_version: 1,
      policy_revision: evaluation?.data.policy_context?.revision,
      ...b,
      selections: b.selections.map((s) => {
        let resolved;
        if (s.response_selection) {
          try {
            resolved = responseContext(
              catalog!.catalog,
              snapshot?.teamId || "",
              s.response_selection,
              s.tags,
            );
          } catch (e) {
            throw new AppError(
              422,
              "response_configuration",
              (e as Error).message,
            );
          }
          if (
            s.monitor_settings.warRoomEnabled &&
            (!resolved.destination || !resolved.onCallReference)
          )
            throw new AppError(
              422,
              "warroom_configuration",
              "Para ativar War Room, selecione uma escala e configure uma rota para a sala.",
            );
        }
        return {
          id: s.id,
          version: s.version,
          monitor_settings: s.monitor_settings,
          ...(resolved
            ? {
                response_context: {
                  catalogRevision: catalog!.revision,
                  ...resolved,
                },
              }
            : {}),
          tags: Object.entries(s.tags).map(([k, v]) => `${k}:${v}`),
        };
      }),
    };
  } else if (action === "execute") {
    const simulation = evaluation?.data.input?.mode === "simulation";
    if (!simulation && !caps.realExecution)
      throw new AppError(
        409,
        "real_execution_unavailable",
        "Esta integração permite avaliar a telemetria. A aplicação de alterações ainda aguarda habilitação.",
      );
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

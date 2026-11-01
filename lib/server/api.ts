import { z } from "zod";
import { AppError } from "./config.ts";
import {
  checkOrigin,
  context,
  cookie,
  SESSION_COOKIE,
  FLOW_COOKIE,
  ONBOARDING_COOKIE,
} from "./session.ts";
import { connectionsApi } from "./connections-api.ts";
import { platformApi } from "./platform.ts";
import { authorizedRepositories } from "./connections.ts";
import {
  getJourney,
  journeyHistory,
  lockJourney,
  evolution,
  listJourneys,
  readPolicy,
  saveJourney,
  savePolicy,
} from "./store.ts";
import {
  boundedBody,
  engine,
  snapshot,
  validateRepository,
} from "./upstream.ts";
import { journeyInputSchema, policySchema } from "../aire/validation.ts";
import {
  statusLabels,
  type Journey,
  type AnalysisStatus,
} from "../aire/types.ts";
const busy = new Set<string>();
const engineState = z.object({
  status: z.enum([
    "AWAITING_SOURCE",
    "UPLOADING",
    "QUEUED",
    "PREPARING",
    "NARRATING",
    "RENDERING",
    "AWAITING_NARRATION",
    "FINALIZING",
    "COMPLETED",
    "FAILED",
  ]),
});
async function body(request: Request) {
  const bytes = await boundedBody(new Response(request.body), 16000);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError(
      400,
      "invalid_json",
      "O corpo da solicitação não é um JSON válido.",
    );
  }
}
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export async function api(request: Request, path: string[]) {
  try {
    if (request.method !== "GET") checkOrigin(request);
    if (path[0] === "platform")
      return json(await platformApi(request, path, () => body(request)));
    if (path.join("/") === "repositories" && request.method === "GET") {
      const c = await context(request, "journeys:create");
      return json({ repositories: await authorizedRepositories(c.tenant) });
    }
    if (path.join("/") === "evolution" && request.method === "GET") {
      const c = await context(request, "journeys:read");
      return json(await evolution(c.tenant.id));
    }
    if (path[0] === "usage" && path.length === 1 && request.method === "GET") {
      const c = await context(request, "usage:read");
      const report = z
        .object({
          month: z.string(),
          attempts: z.number(),
          input_tokens: z.number(),
          output_tokens: z.number(),
          usage_unknown_attempts: z.number(),
        })
        .parse(await (await engine(c.tenant, "/v1/usage")).json());
      return json({
        month: report.month,
        attempts: report.attempts,
        input_tokens: report.input_tokens,
        output_tokens: report.output_tokens,
        usage_unknown_attempts: report.usage_unknown_attempts,
        plan: c.tenant.plan?.name || null,
      });
    }
    if (path[0] === "collectors") {
      const c = await context(
        request,
        request.method === "GET" ? "collectors:read" : "collectors:manage",
      );
      if (path.length === 1 && request.method === "GET")
        return json(await (await engine(c.tenant, "/v1/collectors")).json());
      if (
        path.length === 2 &&
        path[1] === "enrollments" &&
        request.method === "POST"
      ) {
        const data = z
          .object({
            label: z.string().min(1).max(80),
            repositories: z
              .array(z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/))
              .min(1)
              .max(500),
          })
          .strict()
          .safeParse(await body(request));
        if (!data.success)
          throw new AppError(
            422,
            "validation",
            "Informe nome e repositórios do coletor.",
          );
        const allowed = (await authorizedRepositories(c.tenant)).map((r) =>
          r.toLowerCase(),
        );
        if (
          data.data.repositories.some((r) => !allowed.includes(r.toLowerCase()))
        )
          throw new AppError(
            403,
            "repository_not_allowed",
            "Cadastre os repositórios em Conexões antes de autorizar o coletor.",
          );
        return json(
          await (
            await engine(c.tenant, "/v1/collectors/enrollments", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data.data),
            })
          ).json(),
          201,
        );
      }
      if (
        path.length === 2 &&
        request.method === "DELETE" &&
        z.string().uuid().safeParse(path[1]).success
      ) {
        await engine(c.tenant, `/v1/collectors/${path[1]}`, {
          method: "DELETE",
        });
        return json({ revoked: true });
      }
    }
    if (path.join("/") === "logout" && request.method === "POST") {
      const headers = new Headers({ "Cache-Control": "no-store" });
      for (const name of [SESSION_COOKIE, FLOW_COOKIE, ONBOARDING_COOKIE])
        headers.append("Set-Cookie", cookie(name, "", 0));
      return new Response(null, { status: 204, headers });
    }
    if (
      path.join("/") === "repositories/validate" &&
      request.method === "POST"
    ) {
      const c = await context(request);
      if (
        !c.permissions.includes("journeys:create") &&
        !c.permissions.includes("connections:manage")
      )
        throw new AppError(
          403,
          "forbidden",
          "Seu perfil não permite validar repositórios.",
        );
      const b = await body(request);
      if (
        typeof b.repository !== "string" ||
        (b.ref && typeof b.ref !== "string")
      )
        throw new AppError(
          422,
          "validation",
          "Informe o repositório e a revisão.",
        );
      return json(await validateRepository(c.tenant, b.repository, b.ref));
    }
    if (path[0] === "access") {
      const c = await context(request, "access:manage");
      if (request.method === "GET")
        return json({
          policy: await readPolicy(c.tenant.id),
          members: c.tenant.members.map((m) => ({
            provider: m.provider,
            role: m.role,
            subject: m.subject,
          })),
          groups: c.tenant.groups,
        });
      if (request.method === "PUT") {
        const result = policySchema.safeParse(await body(request));
        if (!result.success)
          throw new AppError(
            422,
            "validation",
            "Política inválida. Mantenha todas as permissões do administrador.",
          );
        await savePolicy(c.tenant.id, result.data, c.identity.sub);
        return json({ policy: result.data });
      }
    }
    if (path[0] === "connections")
      return json(await connectionsApi(request, path, () => body(request)));
    if (path[0] === "journeys" && path.length === 1) {
      if (request.method === "GET") {
        const c = await context(request, "journeys:read");
        return json(await listJourneys(c.tenant.id));
      }
      if (request.method === "POST") {
        const c = await context(request, "journeys:create");
        const parsed = journeyInputSchema.safeParse(await body(request));
        if (!parsed.success)
          throw new AppError(
            422,
            "validation",
            "Revise nome, endpoint, criticidade e revisão da jornada.",
          );
        const input = parsed.data;
        const allowedRepos = await authorizedRepositories(c.tenant);
        if (
          !allowedRepos.some(
            (r) => r.toLowerCase() === input.repository.toLowerCase(),
          )
        )
          throw new AppError(
            403,
            "repository_not_allowed",
            "Repositório não autorizado nesta organização.",
          );
        const release = await lockJourney(c.tenant.id, input);
        try {
          const versions = await journeyHistory(c.tenant.id, input as Journey);
          const active = versions.find(
            (j) => j.status !== "COMPLETED" && j.status !== "FAILED",
          );
          const reusable =
            active ||
            (!input.reanalyze &&
              versions.find(
                (j) =>
                  j.status === "COMPLETED" &&
                  j.revision === input.revision &&
                  j.tier === input.tier,
              ));
          if (reusable)
            return json({
              ...reusable,
              reused: true,
              versionCount: versions.length,
            });
          if (input.collectorId) {
            const allowed = await authorizedRepositories(c.tenant);
            if (
              !allowed.some(
                (r) => r.toLowerCase() === input.repository.toLowerCase(),
              )
            )
              throw new AppError(
                403,
                "repository_not_allowed",
                "Repositório não autorizado nesta organização.",
              );
            const created = z
              .object({
                analysis_id: z.string().uuid(),
                created_at: z.string(),
              })
              .parse(
                await (
                  await engine(
                    c.tenant,
                    `/v1/collectors/${input.collectorId}/analyses`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        journey_name: input.name,
                        journey_tier: input.tier,
                        endpoint: input.endpoint,
                        repository: input.repository,
                        revision: input.revision,
                        source_subdirectory: input.sourceSubdirectory,
                      }),
                    },
                  )
                ).json(),
              );
            const journey: Journey = {
              id: created.analysis_id,
              collectorId: input.collectorId,
              name: input.name,
              tier: input.tier,
              endpoint: input.endpoint,
              repository: input.repository,
              revision: input.revision,
              status: "AWAITING_SOURCE",
              createdAt: created.created_at,
              stacks: [],
              sourceSubdirectory: input.sourceSubdirectory,
            };
            await saveJourney(c.tenant.id, journey);
            return json(journey, 202);
          }
          if (busy.has(c.tenant.id))
            throw new AppError(
              429,
              "busy",
              "Já existe uma solicitação em preparação. Aguarde alguns segundos.",
            );
          busy.add(c.tenant.id);
          let j: Journey | undefined;
          try {
            // Revalidate immutable revision and authorization; never trust prior UI checks.
            await validateRepository(
              c.tenant,
              input.repository,
              input.revision,
            );
            const bytes = await snapshot(
              c.tenant,
              input.repository,
              input.revision,
            );
            const created = z
              .object({
                analysis_id: z.string().uuid(),
                created_at: z.string().optional(),
              })
              .parse(
                await (
                  await engine(c.tenant, "/v1/analyses", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      journey_name: input.name,
                      journey_tier: input.tier,
                      endpoint: input.endpoint,
                      repository: input.repository,
                      revision: input.revision,
                      source_subdirectory: input.sourceSubdirectory,
                    }),
                  })
                ).json(),
              );
            j = {
              id: created.analysis_id,
              collectorId: input.collectorId,
              name: input.name,
              tier: input.tier,
              endpoint: input.endpoint,
              repository: input.repository,
              revision: input.revision,
              status: "AWAITING_SOURCE",
              createdAt: created.created_at || new Date().toISOString(),
              stacks: [],
              sourceSubdirectory: input.sourceSubdirectory,
            };
            await saveJourney(c.tenant.id, j);
            const uploaded = engineState.parse(
              await (
                await engine(c.tenant, `/v1/analyses/${j.id}/source`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/zip" },
                  body: bytes as BodyInit,
                })
              ).json(),
            );
            j.status =
              uploaded.status in statusLabels ? uploaded.status : "QUEUED";
            await saveJourney(c.tenant.id, j);
            return json(j, 202);
          } catch (e) {
            if (j) await saveJourney(c.tenant.id, { ...j, status: "FAILED" });
            throw e;
          } finally {
            busy.delete(c.tenant.id);
          }
        } finally {
          await release();
        }
      }
    }
    if (path[0] === "journeys" && path[1]) {
      const c = await context(
        request,
        path[2] === "artifacts" ? "artifacts:read" : "journeys:read",
      );
      const j = await getJourney(c.tenant.id, path[1]); // Ownership gate precedes every engine request.
      if (
        request.method === "GET" &&
        path[2] === "history" &&
        path.length === 3
      )
        return json(await journeyHistory(c.tenant.id, j));
      if (request.method === "GET" && path.length === 2) {
        const state = engineState.parse(
          await (await engine(c.tenant, `/v1/analyses/${j.id}`)).json(),
        );
        const status: AnalysisStatus =
          state.status in statusLabels ? state.status : j.status;
        const updated = { ...j, status };
        await saveJourney(c.tenant.id, updated);
        return json(updated);
      }
      if (
        request.method === "GET" &&
        path[2] === "artifacts" &&
        ["manifest", "markdown", "technical"].includes(path[3]) &&
        path.length === 4
      ) {
        const response = await engine(
          c.tenant,
          `/v1/analyses/${j.id}/artifacts/${path[3]}`,
        );
        const bytes = await boundedBody(response, 10 * 1024 * 1024);
        return new Response(bytes as BodyInit, {
          headers: {
            "Content-Type":
              path[3] === "manifest"
                ? "application/json"
                : "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename="aire-${j.id}-${path[3]}.${path[3] === "manifest" ? "json" : "md"}"`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
    }
    throw new AppError(404, "not_found", "Recurso não encontrado.");
  } catch (e) {
    if (e instanceof AppError)
      return json({ error: e.message, code: e.code }, e.status);
    return json(
      {
        error:
          "Não foi possível concluir a operação. Verifique a configuração do serviço.",
        code: "service_error",
      },
      500,
    );
  }
}

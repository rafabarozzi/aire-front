import { z } from "zod";
import { AppError } from "./config.ts";
import { checkOrigin, context, cookie, SESSION_COOKIE } from "./session.ts";
import {
  getJourney,
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
    if (path[0] === "logout" && request.method === "POST")
      return new Response(null, {
        status: 204,
        headers: {
          "Set-Cookie": cookie(SESSION_COOKIE, "", 0),
          "Cache-Control": "no-store",
        },
      });
    if (
      path.join("/") === "repositories/validate" &&
      request.method === "POST"
    ) {
      const c = await context(request, "journeys:create"),
        b = await body(request);
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
    if (path[0] === "connections" && request.method === "GET") {
      const c = await context(request, "connections:read");
      return json({
        repositories: c.tenant.repositories,
        githubConfigured: Boolean(process.env[c.tenant.githubTokenEnv]),
        engineConfigured: Boolean(
          process.env[c.tenant.engineUrlEnv] &&
          process.env[c.tenant.engineTokenEnv],
        ),
        groups: c.tenant.groups.length,
      });
    }
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
          await validateRepository(c.tenant, input.repository, input.revision);
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
            name: input.name,
            tier: input.tier,
            endpoint: input.endpoint,
            repository: input.repository,
            revision: input.revision,
            status: "AWAITING_SOURCE",
            createdAt: created.created_at || new Date().toISOString(),
            stacks: [],
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
      }
    }
    if (path[0] === "journeys" && path[1]) {
      const c = await context(
        request,
        path[2] === "artifacts" ? "artifacts:read" : "journeys:read",
      );
      const j = await getJourney(c.tenant.id, path[1]); // Ownership gate precedes every engine request.
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

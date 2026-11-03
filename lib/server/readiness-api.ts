import { readObservabilityPolicy } from "./observability-store.ts";
import { z } from "zod";
import { AppError } from "./config.ts";
import { context } from "./session.ts";
import { getJourney } from "./store.ts";
import { engine } from "./upstream.ts";
import type { Permission } from "../aire/types.ts";

export async function readinessApi(
  request: Request,
  path: string[],
  body: () => Promise<unknown>,
) {
  const action = path[4];
  const permission: Permission =
    request.method === "GET"
      ? "readiness:read"
      : action === "accept"
        ? "readiness:approve"
        : action === "execute"
          ? "readiness:execute"
          : "readiness:evaluate";
  const c = await context(request, permission);
  const journey = await getJourney(c.tenant.id, path[1]);
  if (
    path.length < 3 ||
    path.length > 5 ||
    (path[3] && !z.string().uuid().safeParse(path[3]).success)
  )
    throw new AppError(404, "not_found", "Avaliação não encontrada.");
  const headers = {
    "Content-Type": "application/json",
    "X-AIRE-Actor": c.identity.sub,
    "X-AIRE-Permissions": c.permissions.join(","),
  };
  const base = path[3]
    ? `/v1/readiness/${path[3]}`
    : `/v1/readiness/analyses/${journey.id}`;
  if (path[3]) {
    const evaluation = z
      .object({ analysis: z.string() })
      .parse(await (await engine(c.tenant, base, { headers })).json());
    if (evaluation.analysis !== journey.id)
      throw new AppError(
        404,
        "not_found",
        "Avaliação não encontrada nesta jornada.",
      );
  }
  if (request.method === "GET" && !action)
    return (await engine(c.tenant, base, { headers })).json();
  if (request.method === "GET" && action === "report")
    return {
      markdown: await (
        await engine(c.tenant, base + "/report", { headers })
      ).text(),
    };
  if (
    request.method !== "POST" ||
    (action && !["accept", "execute", "resume"].includes(action))
  )
    throw new AppError(404, "not_found", "Ação não encontrada.");
  if (path[3] && !action) throw new AppError(404, "not_found", "Ação ausente.");
  if ((await readObservabilityPolicy(c.tenant.id)).revision > 0)
    throw new AppError(
      409,
      "policy_required",
      "Use a área de Observabilidade para executar com as políticas da organização.",
    );
  return (
    await engine(c.tenant, base + (action ? `/${action}` : ""), {
      method: "POST",
      headers,
      body: JSON.stringify(await body()),
    })
  ).json();
}

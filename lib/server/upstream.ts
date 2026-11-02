import { gitlabToken } from "./provider-auth.ts";
import { providerFetch, providerJson } from "./provider-http.ts";
import { sourceRepository } from "../aire/source-repository.ts";
import { z } from "zod";
import { AppError, allowedRepository, type Tenant } from "./config.ts";
import { normalizeRepository } from "../aire/validation.ts";
import type { Repository } from "../aire/types.ts";
import { githubCredential, authorizedRepositories } from "./connections.ts";
export async function boundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body)
    throw new AppError(
      502,
      "empty_response",
      "O serviço retornou uma resposta vazia.",
    );
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) {
        await reader.cancel();
        throw new AppError(
          413,
          "size_limit",
          "O conteúdo excede o limite permitido.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}
async function github(
  tenant: Tenant,
  path: string,
  raw = false,
  missing = "repository_unavailable",
) {
  const token = await githubCredential(tenant);
  if (!token)
    throw new AppError(
      503,
      "github_unconfigured",
      "A credencial do GitHub não foi cadastrada para esta organização.",
    );
  let response: Response;
  try {
    response = await fetch("https://api.github.com" + path, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "AIRE-Console",
      },
      redirect: raw ? "manual" : "error",
      signal: AbortSignal.timeout(25000),
      cache: "no-store",
    });
  } catch {
    throw new AppError(
      502,
      "github_unavailable",
      "Não foi possível alcançar o GitHub. Tente novamente em instantes.",
    );
  }
  if (raw && response.status === 302) {
    const location = new URL(response.headers.get("location") || "");
    if (
      location.protocol !== "https:" ||
      location.hostname !== "codeload.github.com" ||
      location.username ||
      location.password
    )
      throw new AppError(
        502,
        "snapshot_host",
        "O destino do snapshot não é permitido.",
      );
    const zip = await fetch(location, {
      redirect: "error",
      signal: AbortSignal.timeout(60000),
      cache: "no-store",
    });
    if (!zip.ok)
      throw new AppError(
        502,
        "snapshot_failed",
        "Não foi possível baixar o código deste commit.",
      );
    return zip;
  }
  if (!response.ok) {
    if (response.status === 401)
      throw new AppError(
        502,
        "github_credentials",
        "O GitHub não aceitou a credencial configurada para este workspace.",
      );
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" ||
          response.headers.has("retry-after")))
    )
      throw new AppError(
        429,
        "github_rate_limited",
        "O GitHub limitou temporariamente as consultas desta credencial.",
      );
    if (
      response.status === 403 &&
      response.headers.get("x-github-sso")?.startsWith("required")
    )
      throw new AppError(
        403,
        "github_sso",
        "O GitHub exige autorização SSO para esta credencial.",
      );
    if (response.status === 403)
      throw new AppError(
        403,
        "github_forbidden",
        "O GitHub recusou o acesso ao repositório.",
      );
    if (response.status === 404)
      throw new AppError(
        404,
        missing,
        missing === "revision_unavailable"
          ? "A branch ou o commit não foi encontrado ou não está acessível à credencial."
          : "O repositório não foi encontrado ou não está acessível à credencial.",
      );
    throw new AppError(
      502,
      "github_unavailable",
      "O GitHub não concluiu a consulta. Tente novamente em instantes.",
    );
  }
  return response;
}
export async function validateRepository(
  tenant: Tenant,
  input: string,
  ref?: string,
): Promise<Repository> {
  let repository: string;
  try {
    repository = normalizeRepository(input);
  } catch {
    throw new AppError(
      422,
      "repository_format",
      "Use uma URL HTTPS do GitHub/GitLab ou organização/repositório do GitHub.",
    );
  }
  allowedRepository(
    { ...tenant, repositories: await authorizedRepositories(tenant) },
    repository,
  );
  if (repository.startsWith("https://gitlab.com/")) {
    const path = sourceRepository("gitlab", repository).path;
    const headers = { "PRIVATE-TOKEN": await gitlabToken(tenant) };
    const base =
      "https://gitlab.com/api/v4/projects/" + encodeURIComponent(path);
    const info = z
      .object({ default_branch: z.string(), visibility: z.string() })
      .parse(await providerJson(await providerFetch(base, { headers })));
    const branch = ref || info.default_branch;
    if (branch.length > 250)
      throw new AppError(422, "revision", "Informe uma revisão válida.");
    const commit = z
      .object({ id: z.string().regex(/^[0-9a-f]{40}$/) })
      .parse(
        await providerJson(
          await providerFetch(
            base + "/repository/commits/" + encodeURIComponent(branch),
            { headers },
          ),
        ),
      );
    return {
      repository,
      branch,
      revision: commit.id,
      private: info.visibility !== "public",
    };
  }
  const info = z
    .object({ default_branch: z.string(), private: z.boolean() })
    .parse(await (await github(tenant, `/repos/${repository}`)).json());
  const branch = ref || info.default_branch;
  if (typeof branch !== "string" || branch.length > 250)
    throw new AppError(422, "revision", "Informe uma revisão válida.");
  const commit = z
    .object({ sha: z.string().regex(/^[0-9a-f]{40}$/) })
    .parse(
      await (
        await github(
          tenant,
          `/repos/${repository}/commits/${encodeURIComponent(branch)}`,
          false,
          "revision_unavailable",
        )
      ).json(),
    );
  if (!/^[0-9a-f]{40}$/.test(commit.sha))
    throw new AppError(
      502,
      "revision",
      "O GitHub não retornou um commit válido.",
    );
  return {
    repository,
    branch,
    revision: commit.sha,
    private: Boolean(info.private),
  };
}
export async function snapshot(
  tenant: Tenant,
  repository: string,
  revision: string,
) {
  allowedRepository(
    { ...tenant, repositories: await authorizedRepositories(tenant) },
    repository,
  );
  if (repository.startsWith("https://gitlab.com/")) {
    const path = sourceRepository("gitlab", repository).path;
    if (!/^[0-9a-f]{40}$/.test(revision))
      throw new AppError(422, "revision", "Commit inválido.");
    return boundedBody(
      await providerFetch(
        "https://gitlab.com/api/v4/projects/" +
          encodeURIComponent(path) +
          "/repository/archive.zip?sha=" +
          revision,
        { headers: { "PRIVATE-TOKEN": await gitlabToken(tenant) } },
      ),
      50 * 1024 * 1024,
    );
  }
  return boundedBody(
    await github(tenant, `/repos/${repository}/zipball/${revision}`, true),
    50 * 1024 * 1024,
  );
}
export async function engine(
  tenant: Tenant,
  path: string,
  init: RequestInit = {},
) {
  const base = process.env[tenant.engineUrlEnv],
    token = process.env[tenant.engineTokenEnv];
  if (!base || !token)
    throw new AppError(
      503,
      "engine_unconfigured",
      "O motor não foi configurado no servidor para esta organização.",
    );
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new AppError(503, "configuration", "Endereço do motor inválido.");
  const response = await fetch(base.replace(/\/$/, "") + path, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "X-AIRE-Tenant": tenant.id,
    },
    redirect: "error",
    signal: AbortSignal.timeout(60000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new AppError(
      response.status === 429 ? 429 : 502,
      "engine_request",
      response.status === 429
        ? "O motor está ocupado. Aguarde e tente novamente."
        : "O motor não concluiu a solicitação. Verifique a conexão e os logs do serviço.",
    );
  return response;
}

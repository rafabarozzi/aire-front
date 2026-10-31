import { z } from "zod";
import { AppError, allowedRepository, type Tenant } from "./config.ts";
import { normalizeRepository } from "../aire/validation.ts";
import type { Repository } from "../aire/types.ts";
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
async function github(tenant: Tenant, path: string, raw = false) {
  const token = process.env[tenant.githubTokenEnv];
  if (!token)
    throw new AppError(
      503,
      "github_unconfigured",
      "A credencial do GitHub não foi configurada no servidor para esta organização.",
    );
  const response = await fetch("https://api.github.com" + path, {
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
  if (!response.ok)
    throw new AppError(
      response.status === 404 ? 404 : response.status === 403 ? 403 : 502,
      "github_access",
      response.status === 404
        ? "Repositório ou revisão não encontrados. Confira o nome e o acesso da credencial."
        : "O GitHub recusou a consulta. Confira a permissão Contents: read e a autorização SSO da organização.",
    );
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
      "Use uma URL HTTPS do GitHub ou organização/repositório.",
    );
  }
  allowedRepository(tenant, repository);
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
  allowedRepository(tenant, repository);
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
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
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

import { z } from "zod";
import { type Tenant, AppError } from "./config.ts";
import { githubCredential } from "./connections.ts";
import { integration } from "./integrations.ts";
import { gitlabToken } from "./provider-auth.ts";
import { providerFetch, providerJson } from "./provider-http.ts";
import { sourceRepository } from "../aire/source-repository.ts";
export async function repositoryCatalog(
  t: Tenant,
  p: "github" | "gitlab",
  page = 1,
) {
  if (!Number.isInteger(page) || page < 1 || page > 1000)
    throw new AppError(422, "page", "Página inválida.");
  if (p === "gitlab") {
    const rows = z
      .array(z.object({ path_with_namespace: z.string() }))
      .parse(
        await providerJson(
          await providerFetch(
            "https://gitlab.com/api/v4/projects?membership=true&simple=true&per_page=100&page=" +
              page,
            { headers: { "PRIVATE-TOKEN": await gitlabToken(t) } },
          ),
        ),
      );
    return {
      repositories: rows.map(
        (r) => sourceRepository("gitlab", r.path_with_namespace).url,
      ),
      nextPage: rows.length === 100 ? page + 1 : null,
    };
  }
  const token = await githubCredential(t);
  if (!token)
    throw new AppError(
      503,
      "github_unconfigured",
      "Cadastre a conexão GitHub.",
    );
  const app = (await integration(t, "github"))?.kind === "github-app";
  const d = await providerJson(
    await providerFetch(
      "https://api.github.com" +
        (app ? "/installation/repositories" : "/user/repos") +
        "?per_page=100&page=" +
        page,
      {
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    ),
  );
  const rows = z
    .array(z.object({ full_name: z.string() }))
    .parse(app ? d.repositories : d);
  return {
    repositories: rows.map((r) => sourceRepository("github", r.full_name).path),
    nextPage: rows.length === 100 ? page + 1 : null,
  };
}

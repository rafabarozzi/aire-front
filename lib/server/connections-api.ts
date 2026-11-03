import { checkRepositoryHealth, repositoryHealth } from "./repository-health.ts";
import { z } from "zod";
import {
  integrationSchema,
  integrationSummary,
  integrationView,
  providers,
  saveIntegration,
} from "./integrations.ts";
import { repositoryCatalog } from "./repository-catalog.ts";
import { testProvider } from "./provider-auth.ts";
import { AppError } from "./config.ts";
import { context } from "./session.ts";
import {
  connectionsView,
  addRepositorySchema,
  editRepositorySchema,
  deleteRepositorySchema,
  putCredentialSchema,
  deleteCredentialSchema,
  changeRepository,
  saveCredential,
  deleteCredential,
} from "./connections.ts";

export async function connectionsApi(
  request: Request,
  path: string[],
  readBody: () => Promise<unknown>,
) {
  const c = await context(request);
  if (path.length === 2 && path[1] === "repository-health") {
    if (request.method === "GET" && (c.permissions.includes("connections:read") || c.permissions.includes("connections:manage"))) {
      const view = await connectionsView(c.tenant);
      return Promise.all(view.repositories.map(r => repositoryHealth(c.tenant, r)));
    }
    if (request.method === "POST" && c.permissions.includes("connections:manage")) {
      const b = z.object({ repository: z.string().max(500), force: z.boolean().default(false) }).strict().parse(await readBody());
      return checkRepositoryHealth(c.tenant, b.repository, b.force);
    }
    throw new AppError(403, "forbidden", "Seu perfil não permite esta operação.");
  }
  if (path[1] === "integrations") {
    if (
      path.length === 2 &&
      request.method === "GET" &&
      (c.permissions.includes("connections:read") ||
        c.permissions.includes("connections:manage"))
    )
      return integrationView(c.tenant);
    if (!c.permissions.includes("connections:manage"))
      throw new AppError(
        403,
        "forbidden",
        "Seu perfil não permite gerenciar conexões.",
      );
    const p = z.enum(providers).safeParse(path[2]);
    if (!p.success)
      throw new AppError(404, "not_found", "Provedor não encontrado.");
    if (
      path.length === 4 &&
      path[3] === "repositories" &&
      request.method === "GET" &&
      (p.data === "github" || p.data === "gitlab")
    )
      return repositoryCatalog(
        c.tenant,
        p.data,
        Number(new URL(request.url).searchParams.get("page") || "1"),
      );
    if (path.length === 4 && path[3] === "test" && request.method === "POST") {
      if (p.data === "github") {
        await repositoryCatalog(c.tenant, "github");
        return {
          ok: true,
          message:
            "Consulta de repositórios validada. Valide também o repositório escolhido antes de mapear.",
        };
      }
      return testProvider(c.tenant, p.data);
    }
    if (path.length === 3 && ["PUT", "DELETE"].includes(request.method)) {
      const b = z
        .object({
          revision: z.number().int().nonnegative(),
          credential: integrationSchema.optional(),
        })
        .strict()
        .safeParse(await readBody());
      if (!b.success || (request.method === "PUT" && !b.data.credential))
        throw new AppError(
          422,
          "integration_format",
          "Revise os campos da conexão.",
        );
      return saveIntegration(
        c.tenant,
        p.data,
        b.data.revision,
        request.method === "DELETE" ? null : b.data.credential!,
        c.identity.sub,
      );
    }
    throw new AppError(404, "not_found", "Operação não encontrada.");
  }
  if (request.method === "GET" && path.length === 1) {
    if (
      !c.permissions.includes("connections:read") &&
      !c.permissions.includes("connections:manage")
    )
      throw new AppError(
        403,
        "forbidden",
        "Seu perfil não permite visualizar conexões.",
      );
    return connectionsView(c.tenant);
  }
  if (!c.permissions.includes("connections:manage"))
    throw new AppError(
      403,
      "forbidden",
      "Seu perfil não permite gerenciar conexões.",
    );
  const actor = `${c.identity.provider}:${c.identity.sub}`;
  if (path.length === 2 && path[1] === "repositories") {
    const schemas = {
      POST: addRepositorySchema,
      PATCH: editRepositorySchema,
      DELETE: deleteRepositorySchema,
    };
    const method = request.method as keyof typeof schemas;
    if (!(method in schemas))
      throw new AppError(405, "method", "Método não permitido.");
    const checked = schemas[method].safeParse(await readBody());
    if (!checked.success)
      throw new AppError(
        422,
        "repository_format",
        "Informe um repositório GitHub ou GitLab válido e atualize a lista antes de salvar.",
      );
    return changeRepository(
      c.tenant,
      method === "POST" ? "add" : method === "PATCH" ? "edit" : "delete",
      checked.data,
      actor,
    );
  }
  if (path.length === 2 && path[1] === "github") {
    if ((await integrationSummary(c.tenant, "github")).revision)
      throw new AppError(
        409,
        "connection_migrated",
        "Gerencie esta credencial na nova seção GitHub de Conexões.",
      );
    if (request.method === "PUT") {
      const checked = putCredentialSchema.safeParse(await readBody());
      if (!checked.success)
        throw new AppError(
          422,
          "credential_format",
          "Informe um nome e um token GitHub válido, sem espaços ou quebras de linha.",
        );
      return saveCredential(c.tenant, checked.data, actor);
    }
    if (request.method === "DELETE") {
      const checked = deleteCredentialSchema.safeParse(await readBody());
      if (!checked.success)
        throw new AppError(
          422,
          "validation",
          "Atualize a lista antes de excluir a credencial.",
        );
      return deleteCredential(c.tenant, checked.data.revision, actor);
    }
    throw new AppError(405, "method", "Método não permitido.");
  }
  throw new AppError(404, "not_found", "Recurso não encontrado.");
}

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
        "Informe um repositório GitHub válido e atualize a lista antes de salvar.",
      );
    return changeRepository(
      c.tenant,
      method === "POST" ? "add" : method === "PATCH" ? "edit" : "delete",
      checked.data,
      actor,
    );
  }
  if (path.length === 2 && path[1] === "github") {
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

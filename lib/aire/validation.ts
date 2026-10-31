import { z } from "zod";
import { permissions } from "./types.ts";
export function normalizeRepository(value: string): string {
  const clean = value
    .trim()
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  const repo = clean.startsWith("https://github.com/")
    ? clean.slice(19)
    : clean;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo) ||
    repo.split("/").some((x) => x === "." || x === "..")
  )
    throw new Error(
      "Use uma URL do GitHub ou organização/repositório, sem parâmetros.",
    );
  return repo;
}
export const journeyInputSchema = z
  .object({
    name: z.string().trim().min(3).max(200),
    tier: z.enum(["Gold", "Silver", "Bronze"]),
    endpoint: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(
        /^(?:(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) )?\/[A-Za-z0-9_/.{}:~-]*$/,
      ),
    repository: z.string().transform((value, ctx) => {
      try {
        return normalizeRepository(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Repositório inválido" });
        return z.NEVER;
      }
    }),
    revision: z.string().regex(/^[0-9a-f]{40}$/),
    collectorId: z.string().uuid().optional(),
    sourceSubdirectory: z
      .string()
      .max(500)
      .default("")
      .refine(
        (v) =>
          !v.startsWith("/") &&
          !v.includes("\\") &&
          !v.split("/").includes("..") &&
          !/[\x00-\x1f]/.test(v),
      ),
  })
  .strict();
export const policySchema = z
  .object({
    admin: z.array(z.enum(permissions)),
    engineer: z.array(z.enum(permissions)),
    viewer: z.array(z.enum(permissions)),
  })
  .strict()
  .refine(
    (p) => permissions.every((x) => p.admin.includes(x)),
    "O administrador deve manter todas as permissões.",
  );

import { z } from "zod";
// Presentation projection, not a replacement for the engine's full schema/hash validator.
const ref = z.string().min(1).max(160);
export const manifestProjection = z
  .object({
    documentType: z.literal("journey_structural_manifest"),
    profile: z.literal("aire.journey-structural-manifest.v1"),
    schemaVersion: z.literal("1.0"),
    analysis: z.object({ id: ref, status: z.literal("COMPLETED") }),
    services: z
      .array(
        z.object({
          id: ref,
          name: z.string(),
          role: z.enum(["entry_service", "participant"]),
        }),
      )
      .max(10000),
    resources: z
      .array(
        z.object({
          id: ref,
          name: z.string(),
          type: z.string(),
          detail: z.string(),
          ownedBy: ref.optional(),
        }),
      )
      .max(10000),
    dependencies: z
      .array(
        z.object({
          id: ref,
          from: ref,
          to: ref,
          type: z.string(),
          conditional: z.boolean(),
          asynchronous: z.boolean(),
          evidenceRefs: z.array(ref),
        }),
      )
      .max(50000),
    evidence: z
      .array(
        z.object({
          id: ref,
          path: z.string(),
          line: z.number().int().positive().nullable(),
          kind: z.string(),
        }),
      )
      .max(100000),
  })
  .superRefine((m, c) => {
    const ids = [...m.services, ...m.resources].map((n) => n.id);
    const nodes = new Set(ids),
      evidence = new Set(m.evidence.map((e) => e.id));
    if (nodes.size !== ids.length)
      c.addIssue({ code: "custom", message: "IDs duplicados" });
    for (const d of m.dependencies)
      if (
        !nodes.has(d.from) ||
        !nodes.has(d.to) ||
        d.evidenceRefs.some((e) => !evidence.has(e))
      )
        c.addIssue({
          code: "custom",
          message: "Referência de dependência desconhecida",
        });
  });
export function projectManifest(value: unknown, analysisId: string) {
  const m = manifestProjection.parse(value);
  if (m.analysis.id !== analysisId)
    throw new Error("O manifesto não corresponde a esta análise.");
  return m;
}

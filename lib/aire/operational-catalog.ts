import { z } from "zod";
import { tagKeySchema } from "./observability.ts";
const id = z.string().uuid();
const label = z.string().trim().min(1).max(160);
const reference = z.string().trim().max(300);
const timezone = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, "Fuso horário inválido.");
export const teamSchema = z.object({ id, name: label }).strict();
export const windowSchema = z
  .object({
    id,
    name: label,
    timezone,
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict()
  .refine(
    (v) => v.start !== v.end && new Set(v.days).size === v.days.length,
    "Informe dias únicos e horários distintos; para o dia inteiro, selecione 24x7.",
  );
export const destinationSchema = z
  .object({
    id,
    name: label,
    provider: z.enum(["teams", "slack"]),
    kind: z.enum(["room", "automation"]),
    reference: reference.refine(
      Boolean,
      "Informe a referência da sala ou automação.",
    ),
  })
  .strict();
export const catalogSchema = z
  .object({
    evaluationEnvironment: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]{0,80}$/)
      .default(""),
    teams: z.array(teamSchema).max(100),
    windows: z.array(windowSchema).max(100),
    destinations: z.array(destinationSchema).max(100),
    routes: z
      .array(
        z
          .object({ id, key: tagKeySchema, value: label, destinationId: id })
          .strict(),
      )
      .max(200),
    defaultDestinationId: id.nullable(),
    alwaysTeamIds: z.array(id).max(100),
  })
  .strict()
  .superRefine((v, c) => {
    const fail = (message: string) => c.addIssue({ code: "custom", message });
    for (const rows of [v.teams, v.windows, v.destinations, v.routes])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        fail("Cadastro duplicado.");
    if (
      new Set(v.routes.map((r) => JSON.stringify([r.key, r.value]))).size !==
      v.routes.length
    )
      fail("Cada combinação de tag e valor deve ter uma única rota.");
    if (
      v.routes.some(
        (r) => !v.destinations.some((d) => d.id === r.destinationId),
      ) ||
      (v.defaultDestinationId &&
        !v.destinations.some((d) => d.id === v.defaultDestinationId))
    )
      fail("Selecione uma sala cadastrada para cada rota.");
    if (
      v.alwaysTeamIds.some((t) => !v.teams.some((team) => team.id === t)) ||
      new Set(v.alwaysTeamIds).size !== v.alwaysTeamIds.length
    )
      fail("Selecione equipes cadastradas, sem duplicar.");
  });
export type OperationalCatalog = z.infer<typeof catalogSchema>;
export type CatalogRecord = { revision: number; catalog: OperationalCatalog };
export const emptyCatalog = (): OperationalCatalog => ({
  evaluationEnvironment: "",
  teams: [],
  windows: [],
  destinations: [],
  routes: [],
  defaultDestinationId: null,
  alwaysTeamIds: [],
});
export const responseSelectionSchema = z
  .object({
    onCallProvider: z.enum(["datadog", "external"]),
    onCallReference: reference,
    notificationTarget: reference,
    itsmTarget: reference,
    notificationWindowId: id.nullable(),
    warRoomWindowId: id.nullable(),
  })
  .strict();
export type ResponseSelection = z.infer<typeof responseSelectionSchema>;
export const emptyResponseSelection = (): ResponseSelection => ({
  onCallProvider: "datadog",
  onCallReference: "",
  notificationTarget: "",
  itsmTarget: "",
  notificationWindowId: null,
  warRoomWindowId: null,
});
export function resolveDestination(
  c: OperationalCatalog,
  tags: Record<string, string>,
) {
  const ids = [
    ...new Set(
      c.routes
        .filter((r) => tags[r.key] === r.value)
        .map((r) => r.destinationId),
    ),
  ];
  if (ids.length > 1)
    throw Error(
      "As tags correspondem a salas diferentes. Ajuste as rotas antes de aprovar.",
    );
  return (
    c.destinations.find((d) => d.id === (ids[0] || c.defaultDestinationId)) ||
    null
  );
}
export function responseContext(
  c: OperationalCatalog,
  teamId: string,
  values: ResponseSelection,
  tags: Record<string, string>,
) {
  const team = c.teams.find((t) => t.id === teamId);
  if (!team) throw Error("Selecione uma equipe cadastrada.");
  for (const key of ["notificationWindowId", "warRoomWindowId"] as const)
    if (values[key] && !c.windows.some((w) => w.id === values[key]))
      throw Error("A janela selecionada não está mais cadastrada.");
  return {
    team,
    additionalTeams: c.teams.filter(
      (t) => c.alwaysTeamIds.includes(t.id) && t.id !== teamId,
    ),
    destination: resolveDestination(c, tags),
    ...values,
    notificationWindow:
      c.windows.find((w) => w.id === values.notificationWindowId) || null,
    warRoomWindow:
      c.windows.find((w) => w.id === values.warRoomWindowId) || null,
  };
}

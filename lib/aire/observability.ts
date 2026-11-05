import { z } from "zod";
export const tiers = ["Gold", "Silver", "Bronze"] as const;
export const roles = ["Core", "Supporting", "Non-Blocking"] as const;
export const signals = ["errors", "latency", "traffic", "saturation"] as const;
export const severities = ["P1", "P2", "P3", "P4", "P5"] as const;
export const signalNames = {
  errors: "Erros",
  latency: "Latência",
  traffic: "Tráfego",
  saturation: "Saturação",
};
export const tagKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_.-]{0,63}$/, "Use uma chave de tag sem espaços.");
const text = z.string().trim().max(200);
const severity = z.enum(severities);
export const ruleSchema = z
  .object({
    tier: z.enum(tiers),
    role: z.enum(roles),
    signal: z.enum(signals),
    severity,
    escalation: z
      .enum(["none", "journey_blocked", "customer_impact"])
      .default("none"),
    escalatedSeverity: severity.default("P2"),
  })
  .strict();
export const policySchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(["automatic", "custom"]),
    rules: z.array(ruleSchema).max(36),
    tags: z
      .object({
        journeyKey: tagKeySchema,
        definitions: z
          .array(
            z
              .object({
                key: tagKeySchema,
                required: z.boolean(),
                defaultValue: text,
              })
              .strict(),
          )
          .max(30),
      })
      .strict(),
    response: z
      .object({
        warRoomEnabled: z.boolean(),
        severities: z.array(severity).max(5),
        defaultWaitSeconds: z.number().int().min(0).max(86400),
        timezone: z.string().refine((v) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: v });
            return true;
          } catch {
            return false;
          }
        }, "Fuso horário inválido."),
        schedule: z.enum(["always", "window"]),
        days: z.array(z.number().int().min(1).max(7)).max(7),
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        outsideHours: z.enum(["notify", "fallback"]),
        fallback: text,
        onCallProvider: z.enum(["datadog", "external"]),
        onCallReference: text,
        team: text,
        notificationTarget: text,
        itsmTarget: text,
        roomTarget: text,
        requiredChecks: z
          .array(
            z.enum([
              "telemetry",
              "monitors",
              "ownership",
              "oncall",
              "itsm",
              "warroom",
            ]),
          )
          .max(6),
      })
      .strict(),
  })
  .strict()
  .superRefine((p, c) => {
    const ids = p.rules.map((r) => `${r.tier}/${r.role}/${r.signal}`);
    if (
      new Set(ids).size !== ids.length ||
      (p.mode === "custom" && ids.length !== 36)
    )
      c.addIssue({
        code: "custom",
        message:
          "Preencha uma regra para cada combinação de jornada, serviço e sinal.",
      });
    const keys = [p.tags.journeyKey, ...p.tags.definitions.map((t) => t.key)];
    if (new Set(keys).size !== keys.length)
      c.addIssue({
        code: "custom",
        message: "As chaves das tags devem ser únicas.",
      });
    if (
      p.response.schedule === "window" &&
      (!p.response.days.length || p.response.start === p.response.end)
    )
      c.addIssue({
        code: "custom",
        message: "Defina os dias e uma janela de horário válida.",
      });
    if (p.response.outsideHours === "fallback" && !p.response.fallback)
      c.addIssue({
        code: "custom",
        message: "Informe o destino alternativo fora do horário.",
      });
    if (p.response.warRoomEnabled && !p.response.severities.length)
      c.addIssue({
        code: "custom",
        message: "Selecione as severidades elegíveis para War Room.",
      });
    for (const r of p.rules)
      if (
        r.escalation !== "none" &&
        severities.indexOf(r.escalatedSeverity) > severities.indexOf(r.severity)
      )
        c.addIssue({
          code: "custom",
          message: "O agravamento não pode reduzir a severidade.",
        });
  });
export type ObservabilityPolicy = z.infer<typeof policySchema>;
export type PolicyRecord = {
  revision: number;
  updatedAt?: string;
  policy: ObservabilityPolicy;
};
export type Capabilities = {
  policyContract: number;
  modes: ("simulation" | "real")[];
  warRoomOverrides: boolean;
  messageGeneration: boolean;
  operationalCatalog?: boolean;
  serverContext?: boolean;
  defaultContext?: {
    mode?: "simulation" | "real" | null;
    environment?: string | null;
    ready: boolean;
    reason?: string | null;
  };
  realRead?: { ready: boolean; reason?: string | null };
  realExecution?: boolean;
  realResponses?: boolean;
};
export function defaultObservabilityPolicy(): ObservabilityPolicy {
  return {
    version: 1,
    mode: "automatic",
    rules: [],
    tags: { journeyKey: "journey", definitions: [] },
    response: {
      warRoomEnabled: false,
      severities: ["P1", "P2"],
      defaultWaitSeconds: 300,
      timezone: "America/Sao_Paulo",
      schedule: "always",
      days: [1, 2, 3, 4, 5],
      start: "08:00",
      end: "18:00",
      outsideHours: "notify",
      fallback: "",
      onCallProvider: "datadog",
      onCallReference: "",
      team: "",
      notificationTarget: "",
      itsmTarget: "",
      roomTarget: "",
      requiredChecks: ["telemetry", "monitors", "ownership"],
    },
  };
}
// Editable starting point, not a copy of a customer's policy and not an AI response.
export function suggestedRules(): ObservabilityPolicy["rules"] {
  return tiers.flatMap((tier) =>
    roles.flatMap((role) =>
      signals.map((signal) => {
        const critical = tier === "Gold" && role === "Core";
        const base = critical
          ? signal === "errors"
            ? "P2"
            : "P3"
          : tier === "Bronze" || role === "Non-Blocking"
            ? "P5"
            : "P4";
        return {
          tier,
          role,
          signal,
          severity: base as (typeof severities)[number],
          escalation: "none" as const,
          escalatedSeverity: "P2" as const,
        };
      }),
    ),
  );
}
export const preferencesSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    teamId: z.string().uuid().optional(),
    tags: z
      .record(tagKeySchema, text)
      .refine((v) => Object.keys(v).length <= 40),
  })
  .strict();
export const monitorSettingsSchema = z
  .object({
    waitSeconds: z.number().int().min(0).max(86400).nullable(), // null inherits, zero means immediate
    warRoomEnabled: z.boolean(),
    message: z.string().max(12000).optional(),
  })
  .strict();
export function resolvedWait(
  settings: z.infer<typeof monitorSettingsSchema>,
  policy: ObservabilityPolicy,
) {
  return settings.waitSeconds ?? policy.response.defaultWaitSeconds;
}
export function validateTags(
  values: Record<string, string>,
  policy: ObservabilityPolicy,
) {
  const required = [
    policy.tags.journeyKey,
    ...policy.tags.definitions.filter((t) => t.required).map((t) => t.key),
  ];
  return required.filter((k) => !values[k]?.trim());
}
export type CustomerRecommendation = {
  version: string;
  subject?: string;
  operation?: string;
  monitor_ids?: (number | string)[];
  conditional?: boolean;
  scopes?: {
    service?: string;
    route?: string;
    metric?: string;
    signal?: string;
  }[];
  evidence?: {
    metric?: string;
    metric_context?: {
      observed_min?: number;
      observed_max?: number;
      samples?: number;
      unit?: ({ short_name?: string; name?: string } | null)[];
    } | null;
    required_scope?: string[];
    monitor_checks?: {
      monitor_id?: number | string;
      observed_thresholds?: { critical?: number; warning?: number };
      observed_unit?: string;
    }[];
  }[];
  id: string;
  title: string;
  explanation: string;
  action: string;
};
export type CustomerDecision = {
  choice: "approved" | "declined";
  fingerprint: string;
  actor: string;
  at: string;
};
export type CustomerReview = {
  revision: number;
  decisions: Record<string, CustomerDecision>;
};
export type ReadinessEvaluation = {
  customer_review?: CustomerReview;
  id: string;
  analysis?: string;
  created_at?: string;
  state: string;
  data: {
    input: { mode: string; environment?: string };
    manifest?: { journey?: { name?: string } };
    discovery?: { from?: number; to?: number };
    manifest_revision?: string;
    operational_context?: {
      revision: number;
      catalog: import("./operational-catalog.ts").OperationalCatalog;
      teamId?: string;
    };
    policy_context?: { revision: number; policy: ObservabilityPolicy };
    pause_reason?: string;
    read_only?: boolean;
    customer_recommendations?: CustomerRecommendation[];
    recommendations: ReadinessRecommendation[];
    findings: {
      service?: string;
      signal?: string;
      status: string;
      note?: string;
    }[];
  };
};
export type ReadinessRecommendation = {
  id: string;
  version: string;
  service: string;
  signal: string;
  action: string;
  proposal: Record<string, unknown>;
  before: unknown;
  prerequisites: string[];
  accepted: unknown;
  execution: string | null;
  evidence_refs: string[];
  severity: unknown;
  monitor_settings?: z.infer<typeof monitorSettingsSchema>;
};

// Shared by the form and BFF: match the engine CreateV1 environment contract.
export const environmentSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9_.-]{1,80}$/,
    "Use de 1 a 80 letras, números, pontos, hífens ou sublinhados, sem espaços.",
  );
export function isReadinessInProgress(state: string): boolean {
  return [
    "QUEUED",
    "RUNNING",
    "EXECUTING",
    "DISCOVERING",
    "EVALUATING",
    "INVESTIGATING",
    "EXECUTION_QUEUED",
  ].includes(state);
}

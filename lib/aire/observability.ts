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
  entryDraftExecution?: boolean;
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
export type EntryMonitoring = {
  status: string;
  calibration?: { scope?: string };
  from?: number;
  to?: number;
  method?: string;
  route?: string;
  counts?: Record<string, number>;
  buckets_with_traffic?: number;
  buckets_with_5xx?: number;
  buckets_without_traffic_witness?: number;
  query?: string;
  inventory_full_visibility?: boolean;
  matching_monitor_ids?: (number | string)[];
  monitor_draft?: {
    validation: string;
    configuration: { name: string; query: string; draft_status: "draft"; options: Record<string, unknown> };
  };
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
export type PlanProposal = {
  id: string; version: string; action: "create" | "adjust"; title: string; trigger: string;
  signal: string; role: string; severity: string; reason: string; safeguards: string;
  validation: string; configuration: Record<string, unknown>; monitor_id?: number; before?: string;
  calibration?: ThresholdCalibration;
  benefit?: string;
  application_status?: string;
  setup?: { steps: string[]; cadence_seconds: number; completion_deadline_seconds: number; contract_revision: string; evidence_bundle: string; collector: Record<string, unknown> };
  proof?: { cases?: string[]; controls?: Record<string, {observations: number; failed: number; unknown: number}>; provider?: string };
};
export type MonitoringExperiments = {
  status: string; testing_environment?: string; target_environment?: string; target_validation?: string;
  model_revision?: string; bundle_hash?: string; training?: number; holdout?: number; constraints?: number;
  limitation?: string; reason?: string;
  target_calibration?: {status: string; environment: string; observations: number; training_count: number; holdout_count: number; threshold?: number; failed_observations: number; unknown_observations: number; entry_paths?: {public?: number; internal?: number}};
  recurrence?: {status: string; threshold?: number; cadence_seconds?: number; maturity_seconds?: number; controls?: Record<string, {observations: number; failed: number; unknown: number}>};
  cases?: {id: string; title: string; scenario: string; transactions: number; detected_transactions: number; unknown_transactions: number; fault_materialized: boolean; independent_outcome_broken: boolean; independent_outcome_healthy?: boolean; condition_met?: boolean}[];
  provider_evidence?: {metric: string; environment?: string; status: string}[];
  record_integrity?: RecordIntegrityExperiments[];
};
export type RecordIntegrityExperiments = {
  status: string; plan_id?: string; model_revision?: string;
  testing_environment?: string; target_environment?: string; limitation?: string;
  cases?: (NonNullable<MonitoringExperiments["cases"]>[number] & {
    record_proof?: {provider_verified?: boolean; recovered?: boolean};
  })[];
  provider_evidence?: MonitoringExperiments["provider_evidence"];
  recurrence?: MonitoringExperiments["recurrence"];
  telemetry_gap?: {status: string; no_data_seconds?: number; proof_scope?: string};
};
export type ThresholdCalibration = {
  status: "validated" | "rejected" | "insufficient_evidence";
  reason: string; threshold?: number; unit?: string; window_seconds?: number;
  false_positive_windows?: number[];
  missed_incident_windows?: {at: number; scenario: string}[];
  samples?: Record<string, number>;
};
export type MonitoringCoverage = {
  version: number; status: string; limitation: string;
  summary: {identified: number; validated_in_replay: number; investigating: number};
  calibration: {status?: string; reason?: string; signals?: Record<string, ThresholdCalibration>};
  requirements: {id: string; kind: string; subject: string; title: string; reason: string;
    status: string; proposal_ids: string[]; evidence_refs: string[]; acceptance?: string}[];
};
export type PlanDecisions = Record<string,{ version: string; choice: "approved" | "declined"; decided_at: string }>;
export type SourceWindowReview = {
  status: string; reason?: string; base_revision?: string; model_revision?: string;
  healthy_controls?: number; stale_detected?: number; recovery?: boolean;
  max_age_seconds?: number; threshold?: number; target_status?: string;
  limitation?: string; provider_checks?: {metric: string; status: string}[];
};
export type ReadinessEvaluation = {
  plan_decisions?: PlanDecisions;
  plan_reviewable?: boolean;
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
    entry_monitoring?: EntryMonitoring;
    monitor_plan?: {proposals: PlanProposal[]; gaps: string[]; tier: string; coverage?: MonitoringCoverage; experiments?: MonitoringExperiments; source_window?: SourceWindowReview};
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

const evaluationLabels: Record<string, string> = {
  QUEUED: "Na fila",
  RUNNING: "Em andamento",
  INVESTIGATING: "Investigação em andamento",
  DISCOVERING: "Coletando evidências",
  EVALUATING: "Avaliando cobertura",
  AWAITING_CONTINUATION: "Análise parcial",
  READY: "Avaliação disponível",
  COMPLETED: "Concluída",
  EXECUTION_QUEUED: "Execução na fila",
  EXECUTING: "Aplicando alterações",
  FAILED: "Falha na avaliação",
};
export function evaluationLabel(state: string) {
  return Object.hasOwn(evaluationLabels, state) ? evaluationLabels[state] : "Consultar detalhes";
}

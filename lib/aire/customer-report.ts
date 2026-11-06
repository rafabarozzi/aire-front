import type {
  CustomerRecommendation,
  EntryMonitoring,
  ReadinessEvaluation,
  PlanProposal,
} from "./observability.ts";

type Scope = NonNullable<CustomerRecommendation["scopes"]>[number];
type Evidence = NonNullable<CustomerRecommendation["evidence"]>[number];
export function scopeText(s: Scope) {
  return (
    [s.service, s.route, s.metric].filter(Boolean).join(" · ") ||
    "Referência do manifesto"
  );
}
export function seriesText(e: Evidence) {
  const c = e.metric_context;
  if (!c?.samples || c.observed_min == null || c.observed_max == null)
    return "";
  const unit = c.unit?.[0]?.short_name || c.unit?.[0]?.name || "";
  const fmt = (n: number) =>
    n.toLocaleString("pt-BR", { maximumSignificantDigits: 4 });
  return `${e.metric ?? "Série"} · ${c.samples} intervalos com dados · faixa observada ${fmt(c.observed_min)} a ${fmt(c.observed_max)} ${unit}`.trim();
}
// Group repeated calls to the same operation, but keep each version's evidence and history.
export function coverageGroups(rows: CustomerRecommendation[]) {
  const groups = new Map<string, CustomerRecommendation[]>();
  for (const row of rows) {
    const locations = [
      ...new Set(
        (row.scopes || []).map((s) => JSON.stringify([s.service, s.route])),
      ),
    ].sort();
    const key =
      row.action === "create" && locations.length
        ? JSON.stringify(locations)
        : row.id;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function observationText(m: EntryMonitoring) {
  if (m.status !== "measured")
    return [
      m.status === "access_denied"
        ? "A credencial do Datadog não permitiu consultar os resultados HTTP."
        : "A medição da entrada aguarda uma série de requisições com rota, ambiente e códigos HTTP identificados.",
    ];
  const counts = Object.entries(m.counts || {});
  const total = counts.reduce((n, [, v]) => n + v, 0);
  const failures = counts
    .filter(([code]) => code.startsWith("5"))
    .reduce((n, [, v]) => n + v, 0);
  return [
    `${m.method} ${m.route} · ${total} respostas HTTP classificadas, ${failures} com erro de servidor (5xx).`,
    counts.map(([code, n]) => `HTTP ${code} · ${n}`).join("  |  "),
    `Nos intervalos de cinco minutos com tráfego, ${m.buckets_with_5xx} de ${m.buckets_with_traffic} tiveram erro. Houve ${m.buckets_without_traffic_witness} intervalos sem tráfego comprovado.`,
  ];
}

const actions: Record<string, string> = {
  keep: "Manter",
  adjust: "Ajuste em análise",
  create: "Cobertura a completar",
  investigate: "Investigação do AIRE",
};
export function draftDescription(m: EntryMonitoring) {
  return `Preparar um monitor de erros HTTP 5xx para a rota ${m.method} ${m.route}, com o limite da configuração abaixo. O rascunho permite revisar a regra no Datadog. A publicação para alertar a equipe exige uma decisão separada.`;
}
export const draftReasons: Record<string, string> = {
  draft_write_disabled:
    "O ambiente está em leitura. O rascunho está disponível para consulta.",
  inventory_visibility_unattested:
    "O AIRE precisa confirmar a cobertura existente antes de propor a criação.",
  validated_draft_required: "O rascunho aguarda validação no Datadog.",
  draft_inventory_conflict:
    "O AIRE identificou um monitor com possível sobreposição e precisa conferir o escopo.",
  draft_evidence_stale: "Uma nova medição é necessária para propor a criação.",
  draft_evaluation_superseded:
    "Consulte a avaliação mais recente desta jornada.",
  connection_changed: "O AIRE precisa verificar a conexão atual da jornada.",
};
export function planAction(p: PlanProposal) {
  if (p.action === "adjust") return "Ajustar monitor";
  if (p.configuration.instrumentation) return "Instrumentar e criar monitor";
  if (p.configuration.type === "Datadog Synthetics API") return "Criar teste externo";
  return "Criar monitor";
}
export function customerReport(
  evaluation: ReadinessEvaluation,
  draftState?: {
    state: string;
    monitor_id: string | null;
    reason?: string | null;
  } | null,
) {
  const { data } = evaluation;
  const counts = new Map<string, number>();
  for (const finding of data.findings)
    counts.set(finding.status, (counts.get(finding.status) ?? 0) + 1);
  const lines = [
    `# ${data.manifest?.journey?.name || "Jornada"} · Revisão operacional`,
    "",
    `Ambiente: ${data.input.environment || "não informado"}. Avaliação: ${evaluation.id}.`,
    `Revisão do manifesto: ${data.manifest_revision || "não informada"}.`,
  ];
  const w = data.discovery;
  if (w?.from && w.to)
    lines.push(
      `Janela UTC: ${new Date(w.from * 1000).toISOString()} a ${new Date(w.to * 1000).toISOString()}.`,
    );
  if (data.entry_monitoring) {
    const m = data.entry_monitoring;
    lines.push("", "## Proteção da entrada", "", ...observationText(m));
    if (m.calibration?.scope === "controlled_lab")
      lines.push("Visão geral do Lab: os totais incluem falhas provocadas nos ensaios. A calibração usa janelas separadas, descritas em cada proposta.");
    if (m.from && m.to)
      lines.push(
        `Período medido UTC · ${new Date(m.from * 1000).toISOString()} a ${new Date(m.to * 1000).toISOString()}`,
      );
    if (m.monitor_draft && !data.monitor_plan)
      lines.push(
        "",
        draftDescription(m),
        "",
        `Consulta da regra · \`${m.monitor_draft.configuration.query}\``,
        m.monitor_draft.validation === "validated"
          ? "Sintaxe validada pelo Datadog."
          : "Validação do Datadog pendente.",
      );
    if (m.matching_monitor_ids?.length)
      lines.push(
        `Monitores com a mesma condição · ${m.matching_monitor_ids.join(", ")}.`,
      );
  }
  if (data.monitor_plan) {
    lines.push("", "## Plano de monitoramento", "");
    const coverage = data.monitor_plan.coverage;
    if (coverage) {
      lines.push("Cobertura ainda em validação.",
        `${coverage.summary.identified} necessidades inferidas do manifesto; ${coverage.summary.validated_in_replay} condições satisfeitas em replay no Lab; ${coverage.summary.investigating} sem detecção comprovada.`,
        coverage.calibration.reason || "Baseline ainda insuficiente.", coverage.limitation, "");
      for (const r of coverage.requirements.filter(r => r.status === "investigating")) {
        lines.push(`- ${r.title}: ${r.reason}`);
        if (r.acceptance) lines.push(`  Evidência necessária: ${r.acceptance}`);
      }
      lines.push("");
    }
    for (const p of data.monitor_plan.proposals) {
      const d = evaluation.plan_decisions?.[p.id];
      lines.push(
        `### ${planAction(p)} · ${p.title} · ${p.severity}`,
        "",
        p.monitor_id ? `Monitor Datadog #${p.monitor_id}` : "Novo monitor",
        `Versão da proposta · ${p.version}`,
        p.trigger,
        p.before || "",
        p.reason,
        p.safeguards,
        p.validation,
        d?.version === p.version
          ? `Decisão registrada · ${d.choice === "approved" ? "Aprovada" : "Recusada"}`
          : "Decisão pendente",
        "",
        "```json",
        JSON.stringify(p.configuration, null, 2),
        "```",
        "",
      );
    }
    lines.push(...data.monitor_plan.gaps);
  }
  if (draftState) {
    const states: Record<string, string> = {
      unavailable: "indisponível",
      proposed: "preparado",
      approved: "aprovado",
      declined: "recusado",
      submitting: "em conferência",
      applied: "aplicado e confirmado no Datadog",
    };
    lines.push(
      "",
      `Estado do rascunho · ${states[draftState.state] ?? "pendente"}${draftState.monitor_id ? " · monitor " + draftState.monitor_id : ""}`,
    );
    if (draftState.reason && draftReasons[draftState.reason])
      lines.push(draftReasons[draftState.reason]);
  }
  if (data.entry_monitoring?.inventory_full_visibility === false)
    lines.push(
      "",
      "A visibilidade do inventário é parcial. Cabe ao AIRE conferir a cobertura equivalente antes de criar outro monitor.",
    );
  lines.push(
    "",
    "## Cobertura e investigações técnicas do AIRE",
    "",
    `Achados por escopo: ${counts.get("adequate") ?? 0} adequados, ${counts.get("adjustment_recommended") ?? 0} com ajuste em análise, ${counts.get("confirmed_gap") ?? 0} lacunas confirmadas e ${counts.get("unverified") ?? 0} por verificar.`,
  );
  for (const group of coverageGroups(data.customer_recommendations ?? [])) {
    const r = group[0];
    lines.push(
      "",
      `### ${actions[r.action] || "Revisar"} · ${r.title}`,
      "",
      ...new Set(group.map((row) => row.explanation)),
    );
    if (r.monitor_ids?.length)
      lines.push("", `Monitores: ${r.monitor_ids.join(", ")}.`);
    const scopes = [
      ...new Set(group.flatMap((row) => row.scopes?.map(scopeText) ?? [])),
    ];
    if (scopes.length)
      lines.push("", "Escopos avaliados:", "", ...scopes.map((s) => `- ${s}`));
    const evidence = [
      ...new Set(
        group.flatMap(
          (row) => row.evidence?.map(seriesText).filter(Boolean) ?? [],
        ),
      ),
    ];
    if (evidence.length) lines.push("", ...evidence.map((t) => `- ${t}`));
    for (const row of group) {
      const d = evaluation.customer_review?.decisions[row.id];
      if (d?.fingerprint === row.version)
        lines.push(
          "",
          `Decisão: ${d.choice === "approved" ? "aprovada" : "recusada"} em ${d.at} (histórico).`,
        );
    }
  }
  return lines.join("\n");
}

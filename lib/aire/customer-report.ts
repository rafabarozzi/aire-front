import type {
  CustomerRecommendation,
  ReadinessEvaluation,
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
const actions: Record<string, string> = {
  keep: "Manter",
  adjust: "Ajustar",
  create: "Propor criação",
  investigate: "Verificar",
};
export function customerReport(evaluation: ReadinessEvaluation) {
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
  lines.push(
    "",
    `Achados por escopo: ${counts.get("adequate") ?? 0} adequados, ${counts.get("adjustment_recommended") ?? 0} com ajuste recomendado, ${counts.get("confirmed_gap") ?? 0} lacunas confirmadas e ${counts.get("unverified") ?? 0} por verificar.`,
  );
  for (const r of data.customer_recommendations ?? []) {
    lines.push(
      "",
      `## ${actions[r.action] || "Revisar"} · ${r.title}`,
      "",
      r.explanation,
    );
    if (r.monitor_ids?.length)
      lines.push("", `Monitores: ${r.monitor_ids.join(", ")}.`);
    const scopes = [...new Set(r.scopes?.map(scopeText))];
    if (scopes.length)
      lines.push("", "Escopos avaliados:", "", ...scopes.map((s) => `- ${s}`));
    const evidence = [...new Set(r.evidence?.map(seriesText).filter(Boolean))];
    if (evidence.length) lines.push("", ...evidence.map((t) => `- ${t}`));
    const d = evaluation.customer_review?.decisions[r.id];
    lines.push(
      "",
      d?.fingerprint === r.version
        ? `Decisão: ${d.choice === "approved" ? "aprovada" : "recusada"} em ${d.at}.`
        : "Decisão: aguardando revisão do cliente.",
    );
  }
  return lines.join("\n");
}

"use client";
import { useState } from "react";
import { planAction } from "@/lib/aire/customer-report";
import { request } from "@/lib/aire/client";
import type {
  ReadinessEvaluation,
  PlanDecisions,
  PlanProposal,
} from "@/lib/aire/observability";
import styles from "./customer-review.module.css";
import { MonitoringExperimentsPanel } from "./monitoring-experiments";

export function MonitoringPlan({
  evaluation,
  base,
  permissions,
  decisions,
  onDecisions,
}: {
  evaluation: ReadinessEvaluation;
  base: string;
  permissions: string[];
  decisions: PlanDecisions;
  onDecisions: (v: PlanDecisions) => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const plan = evaluation.data.monitor_plan;
  if (!plan) return null;
  const readyCount = plan.proposals.filter(p => p.application_status !== "awaiting_target_validation").length;
  const pendingCount = plan.proposals.length - readyCount;
  async function decide(p: PlanProposal, choice: "approved" | "declined") {
    if (busy) return;
    setBusy(p.id);
    setError("");
    try {
      onDecisions(
        await request<PlanDecisions>(base + "/plan-decision", {
          method: "POST",
          body: JSON.stringify({ proposal: p.id, version: p.version, choice }),
        }),
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível registrar a decisão.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <section className={styles.plan} aria-label="Plano de monitoramento">
      <header className={styles.planHero}>
        <span className={styles.planEyebrow}>Plano para {evaluation.data.manifest?.journey?.name || "esta jornada"}</span>
        <h3>O que precisamos monitorar</h3>
        <p>O AIRE encontrou mudanças concretas para detectar falhas e degradação da jornada. Veja quando cada regra dispara e sua severidade; a decisão fica registrada para a próxima etapa de implantação.</p>
        <div className={styles.planStats}>
          <div><strong>{plan.proposals.length}</strong><span>propostas para decisão</span></div>
          <div><strong>{readyCount}</strong><span>com configuração validada</span></div>
          <div><strong>{pendingCount}</strong><span>dependem de validação no ambiente</span></div>
        </div>
        <p className={styles.planBoundary}>Aprovar registra sua decisão. Nenhum monitor será ativado nesta demonstração; a cobertura completa da jornada ainda não foi comprovada.</p>
      </header>
      {plan.source_window?.status === "invalid_evidence" && <aside className={styles.planCard} role="status"><p>{plan.source_window.reason}</p></aside>}
      {plan.experiments?.cases?.length && !plan.source_window ? <MonitoringExperimentsPanel evidence={plan.experiments} /> : null}
      <div className={styles.planSectionHeading}><h4>Mudanças recomendadas</h4><p>Uma decisão por proposta. Os detalhes técnicos estão disponíveis em cada cartão.</p></div>
      {plan.proposals.map((p) => {
        const saved = decisions[p.id];
        const decided = saved?.version === p.version;
        const pendingTarget = p.application_status === "awaiting_target_validation";
        return (
          <article key={p.id} className={styles.planCard}>
            <div className={styles.planMeta}>
              <b>{planAction(p)} {p.monitor_id && `#${p.monitor_id}`}</b>
              <span>Severidade {p.severity}</span>
              <span className={pendingTarget ? styles.planPending : styles.planValidated}>{pendingTarget ? "Validado em teste · pendente no ambiente" : "Configuração validada"}</span>
            </div>
            <h4>{p.title}</h4>
            {p.benefit && <p>{p.benefit}</p>}
            <p className={styles.planTrigger}><strong>Quando dispara</strong><span>{p.trigger}</span></p>
            {p.before && <p><strong>Situação atual</strong> · {p.before}</p>}
            <details><summary>Como o AIRE chegou a esta recomendação</summary><p>{p.validation}</p><p>{p.reason}</p></details>
            <details><summary>O que falta antes de ativar</summary><p>{p.safeguards}</p>{p.setup && <ol>{p.setup.steps.map(step => <li key={step}>{step}</li>)}</ol>}</details>
            <details><summary>Configuração técnica</summary><p>Política de severidade · {plan.tier} / {p.role} / {p.signal}</p><small title={p.version}>Versão {p.version.slice(0,8)}</small><pre>{JSON.stringify(p.configuration, null, 2)}</pre></details>
            <div className="obs-actions" aria-live="polite">
              {decided ? <b>{saved.choice === "approved" ? "Aprovada" : "Recusada"} · decisão registrada</b> : !evaluation.plan_reviewable ? <span>Consulte a avaliação mais recente concluída para decidir.</span> : permissions.includes("readiness:approve") ? <><button type="button" className="button primary" disabled={!!busy} aria-label={`Aprovar: ${p.title}`} onClick={() => void decide(p, "approved")}>Aprovar proposta</button><button type="button" className="button secondary" disabled={!!busy} aria-label={`Recusar: ${p.title}`} onClick={() => void decide(p, "declined")}>Recusar</button></> : <span>Aguardando decisão de um responsável.</span>}
            </div>
          </article>
        );
      })}
      {plan.source_window?.status === "lab_validated" && <aside className={styles.planCard} aria-label="Validade dos dados da jornada">
        <h4>O que aprendemos sobre o valor usado no Checkout</h4>
        <p>O código permite manter o valor em cache por até {plan.source_window.max_age_seconds} segundos. O detector anterior poderia alertar durante uma atualização legítima.</p>
        <p><strong>{plan.source_window.healthy_controls} controles saudáveis sem alerta</strong> · {plan.source_window.stale_detected} valores vencidos detectados · recuperação conferida no Datadog.</p>
        <p>{plan.source_window.limitation}</p>
      </aside>}
      {plan.coverage && (
        <details className={styles.planCard} aria-label="Validação da cobertura">
          <summary>O que o AIRE ainda precisa comprovar</summary>
          <h4>Validação da cobertura da jornada</h4>
          <p>
            {plan.source_window ? "A contagem histórica de cobertura será recalculada para a versão corrigida do detector." : <>{plan.coverage.summary.identified} necessidades de detecção inferidas do manifesto. {" "}{plan.coverage.summary.validated_in_replay} com condição satisfeita em replay no Lab; {" "}{plan.coverage.summary.investigating} ainda sem detecção comprovada.</>}
          </p>
          <p>A jornada ainda não tem cobertura completa demonstrada. As pendências de investigação ficam com o AIRE; somente mudanças com evidência de detecção aparecem para decisão.</p>
          <p>{plan.coverage.calibration.reason}</p>
          {Object.entries(plan.coverage.calibration.signals || {}).map(([signal, fit]) => (
            <p key={signal}>
              <strong>{signal === "errors" ? "Erros técnicos" : "Latência"}</strong> · {fit.status === "validated" ? "Condição satisfeita em replay no Lab" : fit.status === "rejected" ? "Limite reprovado no teste" : "Baseline e testes ainda insuficientes"}.
              {fit.status !== "insufficient_evidence" && ` ${fit.false_positive_windows?.length || 0} janelas de controle que cruzaram o limite; ${fit.missed_incident_windows?.length || 0} janelas de incidente que não cruzaram o limite.`}
            </p>
          ))}
          <details>
            <summary>O que falta demonstrar</summary>
            {plan.coverage.requirements.filter(r => r.status === "investigating").map(r => (
              <div key={r.id}><h5>{r.title}</h5><p>{r.reason}</p>
                {r.acceptance && <p><strong>Para comprovar a detecção</strong> · {r.acceptance}</p>}
              </div>
            ))}
            <p>{plan.coverage.limitation}</p>
          </details>
        </details>
      )}
      {!!plan.gaps.length && <details className={styles.planCard}><summary>Outras investigações em andamento ({plan.gaps.length})</summary>{plan.gaps.map(g => <p key={g}>{g}</p>)}</details>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

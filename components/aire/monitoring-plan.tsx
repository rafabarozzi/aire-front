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
      <header>
        <h3>Plano de monitoramento</h3>
        <p>
          Revise cada mudança para a jornada{" "}
          {evaluation.data.manifest?.journey?.name}. A aprovação registra sua
          decisão no AIRE. A aplicação destas propostas no Datadog está desabilitada.
        </p>
      </header>
      {plan.proposals.map((p) => {
        const saved = decisions[p.id];
        const decided = saved?.version === p.version;
        return (
          <article key={p.id} className={styles.planCard}>
            <div className={styles.planMeta}>
              <b>
                {planAction(p)}{" "}
                {p.monitor_id && `#${p.monitor_id}`}
              </b>
              <span>Prioridade {p.severity}</span>
              <small title={p.version}>Versão {p.version.slice(0,8)}</small>
            </div>
            <h4>{p.title}</h4>
            <p>
              <strong>Dispara quando</strong> · {p.trigger}
            </p>
            {p.before && (
              <p>
                <strong>Hoje</strong> · {p.before}
              </p>
            )}
            <p>{p.validation}</p>
            <p><strong>Antes de aplicar</strong> · {p.safeguards}</p>
            <details>
              <summary>Justificativa e configuração</summary>
              <p>{p.reason}</p>

              <p>
                Política de severidade · {plan.tier} / {p.role} / {p.signal}
              </p>
              <pre>{JSON.stringify(p.configuration, null, 2)}</pre>
            </details>
            <div className="obs-actions" aria-live="polite">
              {decided ? (
                <b>
                  {saved.choice === "approved" ? "Aprovada" : "Recusada"} ·
                  decisão registrada
                </b>
              ) : !evaluation.plan_reviewable ? (
                <span>
                  Consulte a avaliação mais recente concluída para decidir.
                </span>
              ) : permissions.includes("readiness:approve") ? (
                <>
                  <button
                    type="button"
                    className="button primary"
                    disabled={!!busy}
                    aria-label={`Aprovar: ${p.title}`}
                    onClick={() => void decide(p, "approved")}
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!!busy}
                    aria-label={`Recusar: ${p.title}`}
                    onClick={() => void decide(p, "declined")}
                  >
                    Recusar
                  </button>
                </>
              ) : (
                <span>Aguardando decisão de um responsável.</span>
              )}
            </div>
          </article>
        );
      })}
      {plan.gaps.map((g) => (
        <p key={g}>{g}</p>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

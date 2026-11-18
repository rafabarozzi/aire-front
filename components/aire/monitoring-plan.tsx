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
  const [selected, setSelected] = useState<string[]>([]);
  const [tags, setTags] = useState<Record<string,string>>(evaluation.deployment_tags ?? evaluation.data.journey_tags ?? {});
  const [tagsSaved, setTagsSaved] = useState(!!evaluation.deployment_tags);
  const plan = evaluation.data.monitor_plan;
  if (!plan) return null;
  const assessment = evaluation.data.assessment;
  const available = plan.proposals.filter(p => decisions[p.id]?.version !== p.version);
  const chosen = available.filter(p => selected.includes(p.id));
  const approved = plan.proposals.filter(p => decisions[p.id]?.version === p.version && decisions[p.id].choice === "approved");
  const canReview = evaluation.plan_reviewable && permissions.includes("readiness:approve");
  const included = new Set([...approved, ...chosen].map(p => p.id));
  const existing = new Set(assessment?.existing.flatMap(m => m.risks));
  const risks = assessment?.risks ?? [];
  const demonstrable = risks.filter(r => existing.has(r.id) || r.proposals.length > 0);
  const projected = risks.filter(r => existing.has(r.id) || r.proposals.some(id => included.has(id)));
  const percentage = (count:number) => risks.length ? Math.round(100 * count / risks.length) + "%" : "Indisponível";
  const policy = evaluation.data.policy_context?.policy.tags;
  function selectGroup(ids: string[]) {
    setSelected(current => [...new Set([...current, ...ids])]);
  }
  async function approveBatch() {
    setBusy("batch");
    setError("");
    try {
      const result = await request<PlanDecisions>(base + "/plan-batch", {
        method:"POST", body:JSON.stringify({selections:chosen.map(p => ({proposal:p.id,version:p.version}))}),
      });
      onDecisions(result);
      setSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível aprovar as propostas.");
    } finally { setBusy(""); }
  }
  async function saveTags() {
    setBusy("tags");
    setError("");
    try {
      await request(base + "/deployment-tags", {method:"POST", body:JSON.stringify({tags:Object.fromEntries(
        Object.entries(tags).filter(([key,value]) => value && (key === policy?.journeyKey || policy?.definitions.some(d => d.key === key)))
      )})});
      setTagsSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao salvar tags."); }
    finally { setBusy(""); }
  }
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
        <div className={styles.planStats} aria-live="polite">
          <div><strong>{percentage(existing.size)}</strong><span>Inicial comprovada · {existing.size} de {risks.length} riscos mapeados</span></div>
          <div><strong>{percentage(projected.length)}</strong><span>Projetada com a seleção · {projected.length} de {risks.length}</span></div>
          <div><strong>{evaluation.final_verified_ids ? percentage(evaluation.final_verified_ids.length) : "Pendente"}</strong><span>Final verificada · nova medição no ambiente</span></div>
        </div>
        <p className={styles.planBoundary}>Cada risco conta uma vez. O percentual inicial mede o mínimo comprovado no inventário consultado. A projeção inclui propostas selecionadas ou aprovadas com evidência de teste. Nesta revisão a publicação está desabilitada.</p>
      </header>
      {risks.length > 0 && <details className={styles.planCard}><summary>Riscos da jornada · {risks.length - projected.length} sem cobertura demonstrada pela seleção</summary>
        {risks.map(r => <p key={r.id}><strong>{r.title}</strong> {r.role} · {existing.has(r.id) ? "Monitor existente" : r.proposals.some(id => included.has(id)) ? "Incluído na projeção" : "Sem cobertura demonstrada pela seleção"}</p>)}</details>}
      {plan.source_window?.status === "invalid_evidence" && <aside className={styles.planCard} role="status"><p>{plan.source_window.reason}</p></aside>}
      {plan.experiments?.cases?.length && !plan.source_window ? <MonitoringExperimentsPanel evidence={plan.experiments} /> : null}
      <div className={styles.planSectionHeading}><h4>Já atende</h4></div>
      {assessment?.existing.length ? assessment.existing.map(m => <article className={styles.planCard} key={m.id}>
        <h4>{m.title} · {m.severity}</h4><p>Monitor #{m.id} · {m.trigger}</p></article>) :
        <p>Nenhum monitor existente com cobertura comprovada para esses riscos na avaliação.</p>}
      {(["adjust","create"] as const).map(action => {
        const group = plan.proposals.filter(p => p.action === action);
        return <section key={action} className={styles.plan}><div className={styles.planSectionHeading}><h4>{action === "adjust" ? "Ajustar" : "Criar"} ({group.length})</h4></div>
          {!group.length && <p>Nenhuma mudança desse tipo pronta para aprovação.</p>}
          {canReview && group.some(p => available.includes(p)) && <button type="button" className="button secondary" disabled={!!busy} onClick={() => selectGroup(group.filter(p => available.includes(p)).map(p => p.id))}>Selecionar grupo</button>}
          {group.map(p => {
        const linkedRisks = risks.filter(r => r.proposals.includes(p.id));
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
            {linkedRisks.length > 0 && <details><summary>Riscos cobertos por esta proposta ({linkedRisks.length})</summary>
              <ul>{linkedRisks.map(r => <li key={r.id}>{r.title}</li>)}</ul></details>}
            {p.before && <p><strong>Situação atual</strong> · {p.before}</p>}
            <details><summary>Como o AIRE chegou a esta recomendação</summary><p>{p.validation}</p><p>{p.reason}</p></details>
            <details><summary>O que falta antes de ativar</summary><p>{p.safeguards}</p>{p.setup && <ol>{p.setup.steps.map(step => <li key={step}>{step}</li>)}</ol>}</details>
            <details><summary>Configuração técnica</summary><p>Política de severidade · {plan.tier} / {p.role} / {p.signal}</p><small title={p.version}>Versão {p.version.slice(0,8)}</small><pre>{JSON.stringify(p.configuration, null, 2)}</pre></details>
            <div className="obs-actions" aria-live="polite">
              {decided ? <b>{saved.choice === "approved" ? "Aprovada" : "Recusada"} · decisão registrada</b> : !evaluation.plan_reviewable ? <span>Consulte a avaliação mais recente concluída para decidir.</span> : canReview ? <><label><input type="checkbox" checked={selected.includes(p.id)} disabled={!!busy} onChange={e => setSelected(e.target.checked ? [...selected,p.id] : selected.filter(id => id !== p.id))}/> Selecionar proposta</label><button type="button" className="button secondary" disabled={!!busy} aria-label={`Recusar: ${p.title}`} onClick={() => void decide(p, "declined")}>Recusar</button></> : <span>Aguardando decisão de um responsável.</span>}
            </div>
          </article>
        );
      })}</section>})}
      {canReview && available.length > 0 && <div className={styles.planCard}>
        <p>{chosen.length} mudanças selecionadas · cobertura projetada {percentage(projected.length)}</p>
        <div className="obs-actions"><button className="button secondary" disabled={!!busy} onClick={() => selectGroup(available.map(p => p.id))}>Selecionar todas</button>
        <button className="button primary" disabled={!!busy || !chosen.length} onClick={approveBatch}>Aprovar selecionadas ({chosen.length})</button></div>
      </div>}
      {!!approved.length && policy && <section className={styles.planCard}><h4>Tags de implantação</h4>
        <p>{approved.length} propostas aprovadas. Estas tags identificam os monitores no inventário.</p>
        <form onSubmit={e => {e.preventDefault();void saveTags();}}>
          {[...new Set([policy.journeyKey,...policy.definitions.map(d => d.key)])].map(key =>
            <label key={key}>{key}<input value={tags[key] ?? ""} required={key === policy.journeyKey || policy.definitions.some(d => d.key === key && d.required)}
              disabled={!canReview || !!busy} onChange={e => {setTags({...tags,[key]:e.target.value});setTagsSaved(false);}} /></label>)}
          {canReview && <button className="button secondary" disabled={!!busy}>Salvar tags</button>}
          {tagsSaved && <p role="status">Tags registradas para esta avaliação.</p>}
        </form></section>}
      {assessment && <details className={styles.planCard}><summary>Gaps de telemetria ({assessment.gaps.length})</summary>
        <p>Observações referentes ao período analisado. A ausência de eventos pode depender do tráfego.</p>
        {assessment.gaps.map((g,i) => <div key={i}><h5>{g.component} · {g.operation} {g.role}</h5><p>{g.title} · {g.signal}. {g.remedy}</p></div>)}</details>}

      {plan.source_window?.status === "lab_validated" && <aside className={styles.planCard} aria-label="Validade dos dados da jornada">
        <h4>Validade dos dados usados na jornada</h4>
        <p>O código permite manter o valor em cache por até {plan.source_window.max_age_seconds} segundos. O detector anterior poderia alertar durante uma atualização legítima.</p>
        <p><strong>{plan.source_window.healthy_controls} controles saudáveis sem alerta</strong> · {plan.source_window.stale_detected} valores vencidos detectados · recuperação conferida no Datadog.</p>
        <p>{plan.source_window.limitation}</p>
      </aside>}
      {plan.coverage && (
        <details className={styles.planCard} aria-label="Validação da cobertura">
          <summary>O que o AIRE ainda precisa comprovar</summary>
          <h4>Validação da cobertura da jornada</h4>
          <p>
            {assessment ? <>Com todas as propostas, há evidência de teste para {demonstrable.length} dos {risks.length} riscos. Restam {risks.length - demonstrable.length} em investigação.</> : plan.source_window ? "Cobertura da nova versão em validação." : <>{plan.coverage.summary.identified} necessidades de detecção inferidas do manifesto. {" "}{plan.coverage.summary.validated_in_replay} com condição satisfeita em replay no Lab; {" "}{plan.coverage.summary.investigating} ainda sem detecção comprovada.</>}
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
            {plan.coverage.requirements.filter(r => assessment ? !demonstrable.some(d => d.id === r.id) : r.status === "investigating").map(r => (
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

import type { MonitoringExperiments } from "@/lib/aire/observability";
import styles from "./customer-review.module.css";

export function MonitoringExperimentsPanel({ evidence }: { evidence: MonitoringExperiments }) {
  const cases = evidence.cases ?? [];
  const passed = cases.filter(c => c.condition_met);
  const affected = cases.filter(c => c.fault_materialized && c.independent_outcome_broken);
  const observed = cases.reduce((sum, c) => sum + c.transactions, 0);
  const unknown = cases.reduce((sum, c) => sum + c.unknown_transactions, 0);
  const verified = evidence.provider_evidence?.filter(p => p.status === "verified").length ?? 0;
  return <aside className={styles.proofPanel} aria-label="Ensaios de detecção">
    <div className={styles.proofHeading}>
      <div><span className={styles.eyebrow}>EVIDÊNCIA DA RECOMENDAÇÃO</span><h4>Falhas provocadas. Detecção conferida.</h4></div>
      <span className={styles.proofBadge}>Lab isolado</span>
    </div>
    <p>O AIRE comparou o resultado das execuções com fontes independentes e testou a condição dos monitores. Os ensaios abaixo sustentam as propostas desta avaliação.</p>
    <div className={styles.proofGrid}>
      <div><strong>{passed.length}<small> / {affected.length}</small></strong><span>Cenários de impacto detectados</span></div>
      <div><strong>{observed}</strong><span>Execuções sob falha</span></div>
      <div><strong>{evidence.holdout ?? 0}</strong><span>Controles reservados</span></div>
      <div><strong>{verified}</strong><span>Séries conferidas no Datadog</span></div>
    </div>
    <p className={styles.proofScope}><strong>Escopo da prova</strong> · {evidence.testing_environment}. A instalação e os controles em {evidence.target_environment} fazem parte do plano de aplicação. {unknown > 0 && `${unknown} execuções tiveram medição incompleta.`} A entrega de notificações ainda não foi testada.</p>
    <details><summary>Ver cenários e resultados</summary>
      <div className={styles.proofCases}>{cases.map(c => <div key={c.id}>
        <span><b>{c.title}</b><small>{c.detected_transactions} de {c.transactions} execuções com divergência detectada</small></span>
        <span className={c.condition_met ? styles.proofPass : styles.proofPending}>{c.condition_met ? "Condição de disparo atingida" : !c.fault_materialized ? "Injeção não comprovada" : !c.independent_outcome_broken ? "Sem impacto final comprovado" : "Detecção a completar"}</span>
      </div>)}</div>
      <p>{evidence.limitation}</p>
    </details>
  </aside>;
}

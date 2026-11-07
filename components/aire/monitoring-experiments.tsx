import type { MonitoringExperiments } from "@/lib/aire/observability";
import { recordEvidence } from "@/lib/aire/record-evidence";
import styles from "./customer-review.module.css";

export function MonitoringExperimentsPanel({ evidence }: { evidence: MonitoringExperiments }) {
  const cases = evidence.cases ?? [];
  const affected = cases.filter(c => c.fault_materialized && c.independent_outcome_broken);
  const passed = affected.filter(c => c.condition_met);
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
    <p className={styles.proofScope}><strong>Escopo da prova</strong> · Falhas ensaiadas em {evidence.testing_environment}. {evidence.target_validation === "baseline_verified" ? `Baseline e medição confirmadas em ${evidence.target_environment}: ${evidence.target_calibration?.training_count} execuções de treinamento e ${evidence.target_calibration?.holdout_count} controles reservados. A aplicação inclui manter o coletor em execução.` : `A instalação e os controles em ${evidence.target_environment} fazem parte do plano de aplicação.`} {unknown > 0 && `${unknown} execuções tiveram medição incompleta.`} A entrega de notificações ainda não foi testada.</p>
    {evidence.target_validation === "baseline_verified" && evidence.target_calibration?.entry_paths && <p className={styles.proofScope}>Acesso validado: {evidence.target_calibration.entry_paths.public ?? 0} compras pelo endereço público autenticado e {evidence.target_calibration.entry_paths.internal ?? 0} pelas APIs internas. Os testes de falha ocorreram nas réplicas isoladas.</p>}
    <details><summary>Ver cenários e resultados</summary>
      <div className={styles.proofCases}>{cases.map(c => <div key={c.id}>
        <span><b>{c.title}</b><small>{c.detected_transactions} de {c.transactions} execuções com divergência detectada</small></span>
        <span className={c.condition_met ? styles.proofPass : styles.proofPending}>{c.condition_met ? "Condição de disparo atingida" : !c.fault_materialized ? "Injeção não comprovada" : c.independent_outcome_healthy && c.detected_transactions === 0 && c.unknown_transactions === 0 ? "Controle saudável · sem falso alerta" : !c.independent_outcome_broken ? "Sem impacto final comprovado" : "Detecção a completar"}</span>
      </div>)}</div>
      <p>{evidence.limitation}</p>
    </details>
    {recordEvidence(evidence).map(proof => <section key={proof.id} aria-label="Ensaios de integridade dos registros">
      <h5>Integridade dos registros</h5>
      <p><strong>{proof.detected} de {proof.affected} cenários</strong> com disparo e recuperação conferidos no Datadog. {proof.verifiedSeries} consultas de séries verificadas.</p>
      <p>Esta verificação usa um detector independente. A comprovação se limita aos registros e operações ensaiados em {proof.environment ?? "ambiente ainda não confirmado"}.</p>
      <details><summary>Ver falhas nos registros e recuperação</summary>
        <div className={styles.proofCases}>{proof.cases.map(c => <div key={c.id}>
          <span><b>{c.title}</b><small>{c.detected_transactions} de {c.transactions} execuções com divergência detectada</small></span>
          <span className={c.verified ? styles.proofPass : styles.proofPending}>{c.verified ? "Disparo e recuperação conferidos" : "Comprovação a completar"}</span>
        </div>)}</div>
        <p>{proof.collectorVerified ? "Perda de coleta, ausência de emissão e recuperação comprovadas no ensaio." : "Continuidade da coleta ainda em validação pelo AIRE."}</p>
        {proof.status === "invalid_evidence" && <p>O AIRE está conferindo a evidência; ela não sustenta uma proposta para aprovação.</p>}
        <p>{proof.limitation}</p>
      </details>
    </section>)}
  </aside>;
}

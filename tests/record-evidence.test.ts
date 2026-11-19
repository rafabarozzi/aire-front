import test from "node:test";
import assert from "node:assert/strict";
import { recordEvidence } from "../lib/aire/record-evidence.ts";
import { customerReport } from "../lib/aire/customer-report.ts";
import type { MonitoringExperiments, ReadinessEvaluation } from "../lib/aire/observability.ts";

function fixture(): MonitoringExperiments {
  const c = {id: "missing", title: "Registro ausente", scenario: "missing_record", transactions: 3,
    detected_transactions: 3, unknown_transactions: 0, fault_materialized: true,
    independent_outcome_broken: true, condition_met: true,
    record_proof: {provider_verified: true, recovered: true}};
  return {status: "lab_validated", training: 24, holdout: 12, cases: [
    {...c, id: "business", title: "Resultado incorreto"}],
    record_integrity: [{status: "lab_validated", plan_id: "collection", testing_environment: "private",
      cases: [c, {...c, id: "duplicate", title: "Envio duplicado"},
        {...c, id: "wrong", title: "Valor incorreto", record_proof: {provider_verified: false, recovered: true}}],
      provider_evidence: [{metric: "streak", status: "verified"}, {metric: "heartbeat", status: "pending"}],
      telemetry_gap: {status: "verified"}, limitation: "Duplicação histórica preservada."}]};
}

test("a replay alone or a missing recovery cannot be presented as provider-verified detection", () => {
  const evidence = fixture();
  let [proof] = recordEvidence(evidence);
  assert.equal(proof.detected, 2);
  assert.equal(proof.affected, 3);
  assert.equal(proof.verifiedSeries, 1);
  evidence.record_integrity![0].cases![0].record_proof = {provider_verified: true, recovered: false};
  [proof] = recordEvidence(evidence);
  assert.equal(proof.detected, 1);
  evidence.record_integrity![0].status = "invalid_evidence";
  assert.equal(recordEvidence(evidence)[0].detected, 0);
});

test("download retains independent record cases without adding them to the business outcome totals", () => {
  const evidence = fixture();
  const row: ReadinessEvaluation = {id: "run", state: "AWAITING_CONTINUATION", data: {
    input: {mode: "real", environment: "demo"}, recommendations: [], findings: [],
    monitor_plan: {tier: "Gold", proposals: [], gaps: [], experiments: evidence},
  }};
  const report = customerReport(row);
  assert.match(report, /1 de 1 cenários com impacto comprovado atingiram/);
  assert.match(report, /2 de 3 cenários com impacto comprovado tiveram disparo e recuperação/);
  assert.match(report, /Envio duplicado \| 3 \| 3 \| Conferidos no Datadog/);
  assert.match(report, /Valor incorreto \| 3 \| 3 \| Não comprovados/);
  assert.match(report, /Perda de coleta, ausência de emissão e recuperação comprovadas/);
  assert.match(report, /Duplicação histórica preservada/);
  delete evidence.record_integrity;
  assert.doesNotMatch(customerReport(row), /Integridade dos registros/);
});

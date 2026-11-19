import type { MonitoringExperiments } from "./observability.ts";

/** Keep independent detector evidence separate from business outcome totals. */
export function recordEvidence(evidence: MonitoringExperiments) {
  return (evidence.record_integrity ?? []).map((experiment, index) => {
    const cases = (experiment.cases ?? []).map(c => ({
      ...c,
      verified: experiment.status === "lab_validated" && c.condition_met === true
        && c.record_proof?.provider_verified === true && c.record_proof?.recovered === true
        && c.fault_materialized && c.independent_outcome_broken && c.unknown_transactions === 0,
    }));
    const affected = cases.filter(c => c.fault_materialized && c.independent_outcome_broken);
    return {
      id: experiment.plan_id ?? `pending-${index}`,
      cases,
      detected: affected.filter(c => c.verified).length,
      affected: affected.length,
      verifiedSeries: experiment.provider_evidence?.filter(p => p.status === "verified").length ?? 0,
      collectorVerified: experiment.telemetry_gap?.status === "verified",
      environment: experiment.testing_environment,
      limitation: experiment.limitation,
      status: experiment.status,
    };
  });
}

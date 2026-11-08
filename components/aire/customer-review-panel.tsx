"use client";
import {
  Code2,
  BadgeCheck,
  Clock3,
  ChevronDown,
  Search,
  FileDown,
  ListChecks,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  BellRing,
} from "lucide-react";
import { MonitoringPlan } from "./monitoring-plan";
import { EntryOverview } from "./entry-overview";
import styles from "./customer-review.module.css";
import { useState } from "react";
import { DraftDecision, type DraftStatus } from "./draft-decision";
import { download } from "@/lib/aire/download";
import {
  coverageGroups,
  customerReport,
  scopeText,
  seriesText,
} from "@/lib/aire/customer-report";
import type {
  PlanDecisions,
  ReadinessEvaluation,
} from "@/lib/aire/observability";

const sections = [
  ["adjust", "Monitores com ajustes em análise", SlidersHorizontal],
  ["keep", "Cobertura existente", ShieldCheck],
  ["create", "Operações com cobertura a verificar", ScanLine],
  ["investigate", "Verificações do AIRE", Search],
] as const;

export function CustomerReviewPanel({
  evaluation,
  base,
  permissions,
}: {
  evaluation: ReadinessEvaluation;
  base: string;
  permissions: string[];
}) {
  const [draftState, setDraftState] = useState<DraftStatus | null>(null);
  const [updatedDecisions, setDecisions] = useState<PlanDecisions>({});
  const decisions = { ...evaluation.plan_decisions, ...updatedDecisions };
  const plan = evaluation.data.monitor_plan;
  const proposals = evaluation.data.customer_recommendations ?? [];
  const entry = evaluation.data.entry_monitoring;
  const draft = entry?.monitor_draft;
  return (
    <section aria-label="Proteção da jornada" className={styles.review}>
      {plan && (
        <MonitoringPlan
          evaluation={evaluation}
          base={base}
          permissions={permissions}
          decisions={decisions}
          onDecisions={setDecisions}
        />
      )}
      {entry && <details className={styles.group}>
        <summary>Tráfego e respostas observados nesta avaliação <ChevronDown size={15} aria-hidden /></summary>
        <EntryOverview entry={entry} />
      </details>}
      {!plan && draft && (
        <article className={styles.proposal}>
          <div className={styles.proposalIcon}>
            <BellRing size={21} aria-hidden />
          </div>
          <div className={styles.proposalBody}>
            <div className={styles.proposalLabel}>Monitor proposto</div>
            <h3>Detectar erros de servidor na entrada</h3>
            <p>
              Detectar erros HTTP 5xx na condição registrada para a rota{" "}
              <code>
                {entry.method} {entry.route}
              </code>
              .
            </p>
            <code>{draft.configuration.query}</code>
            <div className={styles.validation}>
              {draft.validation === "validated" ? (
                <BadgeCheck size={16} aria-hidden />
              ) : (
                <Clock3 size={16} aria-hidden />
              )}
              {draft.validation === "validated"
                ? "Regra validada pelo Datadog"
                : "Validação da regra pendente"}
            </div>
            <DraftDecision
              base={base}
              permissions={permissions}
              partialInventory={entry.inventory_full_visibility === false}
              onStatus={setDraftState}
            />
          </div>
        </article>
      )}
      {!!entry?.matching_monitor_ids?.length && (
        <p className={styles.match}>
          Monitores com a mesma condição ·{" "}
          {entry.matching_monitor_ids.join(", ")}
        </p>
      )}
      <div className={styles.sectionTitle}>
        <h3>
          <ListChecks size={19} aria-hidden /> Evidências e inventário técnico
        </h3>
        <button
          type="button"
          className="button secondary"
          onClick={() =>
            download(
              `recomendacoes-${evaluation.id}.md`,
              customerReport(
                { ...evaluation, plan_decisions: decisions },
                draftState,
              ),
            )
          }
        >
          <FileDown size={15} aria-hidden /> Baixar documento
        </button>
      </div>
      <div className={styles.sections}>
        {sections.map(([action, title, Icon]) => {
          const groups = coverageGroups(
            proposals.filter((row) => row.action === action),
          );
          if (!groups.length) return null;
          return (
            <details key={action} className={styles.group}>
              <summary>
                <Icon size={17} aria-hidden />
                <span>{title}</span>
                <b>{groups.length}</b>
                <ChevronDown size={15} aria-hidden />
              </summary>
              {groups.map((group) => {
                const row = group[0];
                const scopes = [
                  ...new Set(
                    group.flatMap((r) => r.scopes?.map(scopeText) ?? []),
                  ),
                ];
                const evidence = [
                  ...new Set(
                    group.flatMap(
                      (r) => r.evidence?.map(seriesText).filter(Boolean) ?? [],
                    ),
                  ),
                ];
                return (
                  <article className="obs-rec" key={row.id}>
                    <h4>{row.title}</h4>
                    {[...new Set(group.map((r) => r.explanation))].map((t) => (
                      <p key={t}>{t}</p>
                    ))}
                    {!!row.monitor_ids?.length && (
                      <p>Monitores · {row.monitor_ids.join(", ")}</p>
                    )}
                    <details>
                      <summary>Escopo e evidências</summary>
                      <ul>
                        {scopes.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                      {evidence.map((s) => (
                        <p key={s}>{s}</p>
                      ))}
                    </details>
                    {group.map((r) => {
                      const d = evaluation.customer_review?.decisions[r.id];
                      return (
                        d?.fingerprint === r.version && (
                          <p key={r.id}>
                            Decisão histórica ·{" "}
                            {d.choice === "approved" ? "aprovada" : "recusada"}
                          </p>
                        )
                      );
                    })}
                  </article>
                );
              })}
            </details>
          );
        })}
        {(entry?.query || draft) && (
          <details className={styles.group}>
            <summary>
              <Code2 size={17} aria-hidden />
              <span>Consultas e configuração da regra</span>
              <ChevronDown size={15} aria-hidden />
            </summary>
            <div className={styles.queries}>
              {entry?.query && (
                <>
                  <h4>Consulta de medição</h4>
                  <pre>{entry.query}</pre>
                </>
              )}
              {draft && (
                <>
                  <h4>Configuração proposta</h4>
                  <pre>{JSON.stringify(draft.configuration, null, 2)}</pre>
                </>
              )}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

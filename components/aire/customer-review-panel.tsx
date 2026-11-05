"use client";
import { useState } from "react";
import { DraftDecision, type DraftStatus } from "./draft-decision";
import { download } from "@/lib/aire/download";
import {
  coverageGroups,
  customerReport,
  observationText,
  scopeText,
  seriesText,
} from "@/lib/aire/customer-report";
import type { ReadinessEvaluation } from "@/lib/aire/observability";

const sections = [
  ["adjust", "Monitores existentes a ajustar"],
  ["keep", "Cobertura existente"],
  ["create", "Operações com cobertura a completar"],
  ["investigate", "Verificações técnicas do AIRE"],
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
  const proposals = evaluation.data.customer_recommendations ?? [];
  const entry = evaluation.data.entry_monitoring;
  const draft = entry?.monitor_draft;
  return (
    <section aria-label="Monitoramento da jornada" className="obs-panel">
      <h3>Proteção da jornada</h3>
      {entry && (
        <article className="obs-rec">
          <h4>Resultados na entrada</h4>
          {observationText(entry).map((line) => (
            <p key={line}>{line}</p>
          ))}
          {entry.from && entry.to && (
            <small>
              {new Date(entry.from * 1000).toLocaleString("pt-BR")} —{" "}
              {new Date(entry.to * 1000).toLocaleString("pt-BR")}
            </small>
          )}
          {entry.query && (
            <details>
              <summary>Consulta de medição</summary>
              <pre>{entry.query}</pre>
            </details>
          )}
          {!!entry.matching_monitor_ids?.length && (
            <p>
              Monitores com a mesma condição ·{" "}
              {entry.matching_monitor_ids.join(", ")}
            </p>
          )}
        </article>
      )}
      {draft && (
        <article className="obs-rec">
          <h4>Preparar a detecção de erros na entrada</h4>
          <p>
            Monitor em rascunho para detectar pelo menos uma resposta HTTP 5xx
            em cinco minutos na rota {entry?.route}. A publicação do alerta e o
            acionamento de equipes exigem uma decisão separada.
          </p>
          <p>
            {draft.validation === "validated"
              ? "Configuração validada pelo Datadog."
              : "Configuração aguardando validação pelo Datadog."}
          </p>
          <details>
            <summary>Configuração exata</summary>
            <pre>{JSON.stringify(draft.configuration, null, 2)}</pre>
          </details>
          <DraftDecision
            base={base}
            permissions={permissions}
            onStatus={setDraftState}
          />
        </article>
      )}
      {sections.map(([action, title]) => {
        const groups = coverageGroups(
          proposals.filter((row) => row.action === action),
        );
        if (!groups.length) return null;
        return (
          <details key={action}>
            <summary>
              {title} ({groups.length})
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
      <button
        type="button"
        className="button secondary"
        onClick={() =>
          download(
            `recomendacoes-${evaluation.id}.md`,
            customerReport(evaluation, draftState),
          )
        }
      >
        Baixar documento
      </button>
    </section>
  );
}

"use client";
import { useState } from "react";
import type {
  CustomerDecision,
  CustomerRecommendation,
  ReadinessEvaluation,
} from "@/lib/aire/observability";

export function CustomerReviewPanel({
  evaluation,
  busy,
  canApprove,
  onDecide,
}: {
  evaluation: ReadinessEvaluation;
  busy: boolean;
  canApprove: boolean;
  onDecide: (
    row: CustomerRecommendation,
    choice: CustomerDecision["choice"],
  ) => Promise<void>;
}) {
  const [page, setPage] = useState(0);
  const proposals = evaluation.data.customer_recommendations ?? [];
  const [filter, setFilter] = useState("all");
  const savedChoice = (row: CustomerRecommendation) => {
    const saved = evaluation.customer_review?.decisions[row.id];
    return saved?.fingerprint === row.version ? saved?.choice : undefined;
  };
  const remaining = proposals.filter((row) => !savedChoice(row)).length;
  const rows =
    filter === "pending"
      ? proposals.filter((row) => !savedChoice(row))
      : proposals;
  const last = Math.max(0, Math.ceil(rows.length / 6) - 1);
  const current = Math.min(page, last);
  return (
    <section aria-label="Recomendações para a jornada">
      <h3>Recomendações para a jornada</h3>
      <label>
        Mostrar{" "}
        <select
          value={filter}
          onChange={(e) => {
            setPage(0);
            setFilter(e.target.value);
          }}
        >
          <option value="all">Todas ({proposals.length})</option>
          <option value="pending">Aguardando decisão ({remaining})</option>
        </select>
      </label>
      {rows.slice(current * 6, current * 6 + 6).map((row) => {
        const choice = savedChoice(row);
        const scope = row.evidence?.[0]?.required_scope ?? [];
        const service = scope.find((t) => t.startsWith("service:"))?.slice(8);
        const resource = scope
          .find((t) => t.startsWith("resource_name:"))
          ?.slice(14);
        const checks =
          row.evidence?.flatMap((e) => e.monitor_checks ?? []) ?? [];
        return (
          <article className="obs-rec" key={row.id}>
            <h4>{row.title}</h4>
            {service && (
              <p>{[service, resource].filter(Boolean).join(" · ")}</p>
            )}
            <p>{row.explanation}</p>
            {!!row.monitor_ids?.length && (
              <p>Monitores: {row.monitor_ids.join(", ")}</p>
            )}
            {checks.some((c) => c.observed_thresholds?.critical != null) && (
              <details>
                <summary>Limiares observados</summary>
                {checks
                  .filter((c) => c.observed_thresholds?.critical != null)
                  .map((c, i) => (
                    <p key={i}>
                      Monitor {c.monitor_id} · crítico{" "}
                      {c.observed_thresholds?.critical}{" "}
                      {c.observed_unit === "second" ? "s" : c.observed_unit}
                    </p>
                  ))}
              </details>
            )}
            {choice ? (
              <strong>{choice === "approved" ? "Aprovada" : "Recusada"}</strong>
            ) : (
              <div className="obs-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy || !canApprove}
                  onClick={() => onDecide(row, "approved")}
                >
                  Aprovar
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || !canApprove}
                  onClick={() => onDecide(row, "declined")}
                >
                  Recusar
                </button>
              </div>
            )}
          </article>
        );
      })}
      {!rows.length && <p>Todas as recomendações foram revisadas.</p>}
      {last > 0 && (
        <nav className="obs-actions" aria-label="Páginas das recomendações">
          <button
            type="button"
            className="button secondary"
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            Anterior
          </button>
          <span>
            {current + 1} de {last + 1}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={current === last}
            onClick={() => setPage(current + 1)}
          >
            Próxima
          </button>
        </nav>
      )}
    </section>
  );
}

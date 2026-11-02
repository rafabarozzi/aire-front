"use client";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

type Rec = {
  id: string;
  version: string;
  service: string;
  signal: string;
  action: string;
  proposal: Record<string, unknown>;
  before: unknown;
  prerequisites: string[];
  accepted: unknown;
  execution: string | null;
  evidence_refs: string[];
  severity: unknown;
};
type Evaluation = {
  id: string;
  state: string;
  data: {
    input: { mode: string };
    pause_reason?: string;
    recommendations: Rec[];
    findings: { service?: string; signal?: string; status: string }[];
  };
};

export function ReadinessPanel({ analysisId }: { analysisId: string }) {
  const [permissions, setPermissions] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/console/session")
      .then((r) => r.json())
      .then((s) =>
        setPermissions((s as { permissions?: string[] }).permissions || []),
      )
      .catch(() => {});
  }, []);
  const [history, setHistory] = useState<Evaluation[]>([]),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({}),
    [tags, setTags] = useState("journey:checkout");
  const [perItem, setPerItem] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false),
    [report, setReport] = useState("");
  const base = `/api/console/journeys/${analysisId}/readiness`;
  const api = useCallback(
    async (suffix = "", payload?: unknown) => {
      const response = await fetch(
        base + suffix,
        payload === undefined
          ? {}
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          (data as { error?: string; detail?: string }).error ||
            (data as { detail?: string }).detail ||
            "Operação indisponível.",
        );
      return data;
    },
    [base],
  );
  const refresh = useCallback(async () => {
    setHistory((await api()) as Evaluation[]);
  }, [api]);
  useEffect(() => {
    const initial = setTimeout(
      () => refresh().catch((e) => setError(e.message)),
      0,
    );
    const timer = setInterval(() => refresh().catch(() => {}), 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  const current = history[0];
  async function act(suffix: string, payload: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(suffix, payload);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="Prontidão operacional">
      <h2>Etapa 2 — Prontidão operacional</h2>
      <p>
        Investigue a cobertura e revise recomendações antes de executar qualquer
        alteração.
      </p>
      <button
        disabled={busy || !permissions.includes("readiness:evaluate")}
        onClick={() =>
          act("", {
            mode: "simulation",
            environment: "lab",
            bindings: [],
            scenario: "commerce",
            requested_by_user: true,
          })
        }
      >
        Iniciar simulação Commerce Lab
      </button>
      {error && <p role="alert">{error}</p>}
      {current && (
        <>
          <p>
            <strong>
              {current.data.input.mode === "simulation"
                ? "SIMULAÇÃO — sem alterações no Datadog"
                : "AMBIENTE REAL"}
            </strong>{" "}
            · {current.state}
          </p>
          {current.data.pause_reason && (
            <p>Aguardando continuidade: {current.data.pause_reason}</p>
          )}
          {current.state === "AWAITING_CONTINUATION" && (
            <button
              disabled={busy || !permissions.includes("readiness:evaluate")}
              onClick={() => act(`/${current.id}/resume`, {})}
            >
              Retomar investigação
            </button>
          )}
          <details>
            <summary>Cobertura e evidências</summary>
            {current.data.findings.map((f, i) => (
              <p key={i}>
                {f.service} {f.signal}: {f.status}
              </p>
            ))}
          </details>
          <label>
            Tags para o lote (confirme a tag de jornada)
            <input
              value={tags}
              onChange={(e) => {
                setTags(e.target.value);
                setPreview(false);
              }}
            />
          </label>
          {current.data.recommendations.map((r) => (
            <article key={r.id}>
              <label>
                <input
                  type="checkbox"
                  disabled={
                    !!r.prerequisites.length || r.execution === "APPLIED"
                  }
                  checked={!!selected[r.id]}
                  onChange={(e) => {
                    setSelected({ ...selected, [r.id]: e.target.checked });
                    setPreview(false);
                  }}
                />
                {r.service} · {r.signal} · {r.action}
              </label>
              <p>
                {r.execution ||
                  (r.accepted ? "Aceita; aguardando execução" : "Proposta")}
              </p>
              {!!r.prerequisites.length && (
                <p>Pré-requisitos: {r.prerequisites.join(", ")}</p>
              )}
              <label>
                Tags deste item
                <input
                  value={perItem[r.id] ?? tags}
                  onChange={(e) => {
                    setPerItem({ ...perItem, [r.id]: e.target.value });
                    setPreview(false);
                  }}
                />
              </label>
              <details>
                <summary>Evidências e comparação antes/depois</summary>
                <pre>
                  {JSON.stringify(
                    {
                      evidence: r.evidence_refs,
                      severity: r.severity,
                      before: r.before,
                      after: r.proposal,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </article>
          ))}
          <button
            disabled={busy || !permissions.includes("readiness:approve")}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(`/${current.id}/accept`, {
                  selections: current.data.recommendations
                    .filter((r) => selected[r.id])
                    .map((r) => ({
                      id: r.id,
                      version: r.version,
                      tags: (perItem[r.id] ?? tags)
                        .split(",")
                        .map((t) => t.trim()),
                    })),
                });
                await refresh();
                setPreview(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Aceitar selecionadas e revisar resumo
          </button>
          {preview && (
            <div>
              <h3>Resumo das ações aceitas</h3>
              {current.data.recommendations
                .filter((r) => r.accepted && r.execution !== "APPLIED")
                .map((r) => (
                  <pre key={r.id}>{JSON.stringify(r.accepted, null, 2)}</pre>
                ))}
              <button
                disabled={busy || !permissions.includes("readiness:execute")}
                onClick={() => {
                  setPreview(false);
                  act(`/${current.id}/execute`, {});
                }}
              >
                Executar selecionadas
              </button>
            </div>
          )}
          <details>
            <summary>Histórico de avaliações ({history.length})</summary>
            {history.map((h) => (
              <p key={h.id}>
                <button
                  onClick={async () => {
                    try {
                      setReport(
                        ((await api(`/${h.id}/report`)) as { markdown: string })
                          .markdown,
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {h.id} · {h.state} — relatório consolidado
                </button>
              </p>
            ))}
          </details>
          {report && (
            <details open>
              <summary>Relatório consolidado</summary>
              <ReactMarkdown>{report}</ReactMarkdown>
            </details>
          )}
        </>
      )}
    </section>
  );
}

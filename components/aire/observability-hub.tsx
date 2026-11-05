"use client";
import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw, Settings2, Search } from "lucide-react";
import { request } from "@/lib/aire/client";
import type { Journey, Session } from "@/lib/aire/types";
import type { ReadinessEvaluation } from "@/lib/aire/observability";
import { OperationalCatalogEditor } from "./operational-catalog";
import { ObservabilityPolicyEditor } from "./observability-policy";
import { ReadinessPanel } from "./readiness-panel";
import "./observability.css";
type Result = {
  items: {
    journey: Journey;
    evaluations: ReadinessEvaluation[];
    error: string | null;
  }[];
  page: number;
  pageSize: number;
  total: number;
};
export function ObservabilityHub({
  session,
  demo,
}: {
  session: Session;
  demo: boolean;
}) {
  const [tab, setTab] = useState("journeys"),
    [data, setData] = useState<Result>(),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<{ analysis: string; name: string }>();
  const refresh = useCallback(async () => {
    if (demo) return;
    setBusy(true);
    setError("");
    try {
      setData(
        await request<Result>(
          `observability/journeys?view=summary&page=${page}&q=${encodeURIComponent(search)}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [page, search, demo]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);
  return (
    <div className="obs">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ETAPA 2</div>
          <h1>Observabilidade</h1>
          <p>Cobertura, recomendações e regras de prontidão operacional.</p>
        </div>
        <Activity aria-hidden="true" />
      </div>
      <div
        className="obs-tabs"
        role="group"
        aria-label="Área de observabilidade"
      >
        <button
          className={`button ${tab === "journeys" ? "primary" : "secondary"}`}
          onClick={() => setTab("journeys")}
        >
          <Activity size={16} />
          Jornadas avaliadas
        </button>
        <button
          className={`button ${tab === "policy" ? "primary" : "secondary"}`}
          onClick={() => setTab("policy")}
        >
          <Settings2 size={16} />
          Regras da organização
        </button>
        <button
          className={`button ${tab === "catalog" ? "primary" : "secondary"}`}
          onClick={() => setTab("catalog")}
        >
          Cadastros operacionais
        </button>
      </div>
      {demo ? (
        <div className="panel">
          Entre em uma organização para consultar avaliações e configurar suas
          regras.
        </div>
      ) : tab === "catalog" ? (
        <OperationalCatalogEditor
          editable={session.permissions.includes("readiness:configure")}
        />
      ) : tab === "policy" ? (
        <ObservabilityPolicyEditor
          editable={session.permissions.includes("readiness:configure")}
        />
      ) : selected ? (
        <>
          <button
            className="button secondary"
            onClick={() => {
              setSelected(undefined);
              void refresh();
            }}
          >
            Voltar às jornadas
          </button>
          <h2>{selected.name}</h2>
          <ReadinessPanel
            key={selected.analysis}
            analysisId={selected.analysis}
          />
        </>
      ) : (
        <>
          <form
            className="obs-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setSearch(q);
            }}
          >
            <label className="obs-search">
              <Search size={18} />
              <input
                aria-label="Buscar jornada"
                placeholder="Buscar jornada ou repositório"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <button className="button secondary" disabled={busy}>
              Buscar
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={refresh}
            >
              <RefreshCw size={16} />
              Atualizar
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">Consultando avaliações…</p>}
          {data?.items.map(
            ({ journey: j, evaluations, error: historyError }) => (
              <article className="panel obs-journey" key={j.id}>
                <div>
                  <h2>{j.name}</h2>
                  <p>{j.repository}</p>
                  <span className="badge">
                    {evaluations.length
                      ? `${evaluations.length} avaliações`
                      : "Ainda não avaliada"}
                  </span>
                  {historyError && <p role="alert">{historyError}</p>}
                </div>
                <button
                  className="button secondary"
                  disabled={j.status !== "COMPLETED"}
                  onClick={() => setSelected({ analysis: j.id, name: j.name })}
                >
                  {evaluations.length
                    ? "Consultar / atualizar"
                    : "Avaliar jornada"}
                </button>
                {evaluations.length > 0 && (
                  <details>
                    <summary>
                      Histórico, incluindo versões anteriores do mapeamento
                    </summary>
                    {evaluations.map((e) => (
                      <button
                        className="obs-history"
                        key={e.id}
                        onClick={() =>
                          setSelected({
                            analysis: e.analysis || j.id,
                            name: j.name,
                          })
                        }
                      >
                        {e.created_at
                          ? new Date(e.created_at).toLocaleString("pt-BR")
                          : e.id}{" "}
                        · {e.state} ·{" "}
                        {e.data.input.mode === "simulation"
                          ? "Simulação"
                          : "Real"}
                      </button>
                    ))}
                  </details>
                )}
              </article>
            ),
          )}
          {data && !data.total && (
            <div className="panel">
              <h2>Nenhuma jornada encontrada</h2>
              <p>
                Mapeie uma jornada na Etapa 1 para iniciar a prontidão
                operacional.
              </p>
            </div>
          )}
          <div className="obs-toolbar">
            <button
              className="button secondary"
              disabled={busy || page === 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </button>
            <span>Página {page}</span>
            <button
              className="button secondary"
              disabled={busy || !data || page * data.pageSize >= data.total}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </button>
          </div>
        </>
      )}
    </div>
  );
}

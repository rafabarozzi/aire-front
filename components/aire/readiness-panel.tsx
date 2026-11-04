"use client";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { request } from "@/lib/aire/client";
import {
  isReadinessInProgress,
  resolvedWait,
  validateTags,
  type Capabilities,
  type PolicyRecord,
  type ReadinessEvaluation,
  type ReadinessRecommendation,
} from "@/lib/aire/observability";
import {
  emptyResponseSelection,
  type CatalogRecord,
  type ResponseSelection,
} from "@/lib/aire/operational-catalog";
import "./observability.css";
type Settings = NonNullable<ReadinessRecommendation["monitor_settings"]>;
type Preferences = {
  revision: number;
  tags: Record<string, string>;
  teamId?: string;
};
export function ReadinessPanel({ analysisId }: { analysisId: string }) {
  const base = `observability/journeys/${analysisId}`;
  const [permissions, setPermissions] = useState<string[]>([]),
    [history, setHistory] = useState<ReadinessEvaluation[]>([]),
    [active, setActive] = useState(""),
    [caps, setCaps] = useState<Capabilities>(),
    [policy, setPolicy] = useState<PolicyRecord>(),
    [prefs, setPrefs] = useState<Preferences>(),
    [tags, setTags] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState<Record<string, boolean>>({}),
    [settings, setSettings] = useState<Record<string, Settings>>({}),
    [review, setReview] = useState(false),
    [approval, setApproval] = useState<{ token: string; ids: string[] }>(),
    [enableResponses, setEnableResponses] = useState(false),
    [report, setReport] = useState("");
  const [catalog, setCatalog] = useState<CatalogRecord>();
  const [teamId, setTeamId] = useState("");
  const [environments, setEnvironments] = useState<string[]>([]);
  const [environment, setEnvironment] = useState("");
  const [newTeam, setNewTeam] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, ResponseSelection>>(
    {},
  );
  const [bulk, setBulk] = useState<ResponseSelection>(emptyResponseSelection());
  const refresh = useCallback(async () => {
    setHistory(await request<ReadinessEvaluation[]>(base + "/evaluations"));
  }, [base]);
  useEffect(() => {
    let live = true;
    setEnvironments([]);
    setEnvironment("");
    Promise.all([
      request<{ permissions: string[] }>("session"),
      request<Capabilities>("observability/capabilities"),
      request<PolicyRecord>("observability/policy"),
      request<Preferences>(base + "/preferences"),
      request<CatalogRecord>("observability/catalog"),
    ])
      .then(([s, c, p, pf, cat]) => {
        if (!live) return;
        setPermissions(s.permissions);
        setCaps(c);
        if (s.permissions.includes("readiness:evaluate") && c.serverContext) {
          void request<{ environments: string[] }>("observability/environments")
            .then((result) => {
              if (live) setEnvironments(result.environments);
            })
            .catch((e) => {
              if (live) setError(e.message);
            });
        }
        setPolicy(p);
        setPrefs(pf);
        setTeamId(pf.teamId || "");
        setCatalog(cat);
        setTags({
          ...Object.fromEntries(
            p.policy.tags.definitions.map((t) => [t.key, t.defaultValue]),
          ),
          ...pf.tags,
        });
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    void Promise.resolve()
      .then(refresh)
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [base, refresh]);
  const current = history.find((h) => h.id === active) || history[0];
  const waitingForCapacity = (h: ReadinessEvaluation) =>
    h.data.read_only &&
    h.data.pause_reason === "account_capacity" &&
    ["QUEUED", "AWAITING_CONTINUATION", "INVESTIGATING"].includes(h.state);
  const running = history.some(
    (h) => isReadinessInProgress(h.state) || waitingForCapacity(h),
  );

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, [running, refresh]);
  const contractReady = caps?.policyContract === 1 && caps.warRoomOverrides;
  const evaluatedPolicy = current?.data.policy_context?.policy;
  const effectivePolicy = evaluatedPolicy || policy?.policy;
  const editable = !!contractReady && !!evaluatedPolicy;
  const rows = current?.data.recommendations || [];
  const chosen = rows.filter((r) => selected[r.id]);
  const itemSettings = (r: ReadinessRecommendation): Settings =>
    settings[r.id] ||
    r.monitor_settings || { waitSeconds: null, warRoomEnabled: false };
  function invalidate() {
    setApproval(undefined);
    setEnableResponses(false);
  }
  function changeSetting(r: ReadinessRecommendation, patch: Partial<Settings>) {
    setSettings({ ...settings, [r.id]: { ...itemSettings(r), ...patch } });
    invalidate();
  }
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveTags(values = mergedTags) {
    if (!prefs) return;
    const next = await request<Preferences>(base + "/preferences", {
      method: "PUT",
      body: JSON.stringify({
        revision: prefs.revision,
        tags: values,
        ...(teamId ? { teamId } : {}),
      }),
    });
    setPrefs(next);
  }
  const mergedTags = {
    ...Object.fromEntries(
      (effectivePolicy?.tags.definitions || []).map((t) => [
        t.key,
        t.defaultValue,
      ]),
    ),
    ...tags,
  };
  const tagKeys = effectivePolicy
    ? [
        ...new Set([
          effectivePolicy.tags.journeyKey,
          ...effectivePolicy.tags.definitions.map((t) => t.key),
          ...Object.keys(tags),
        ]),
      ]
    : Object.keys(tags);
  return (
    <section
      className="obs panel readiness-panel"
      aria-label="Prontidão operacional"
    >
      <div>
        <div className="eyebrow">ETAPA 2</div>
        <h2>Prontidão operacional</h2>
        <p>
          Investigue a cobertura e revise cada alteração antes de executá-la.
        </p>
      </div>
      {!contractReady && (
        <p className="obs-notice">
          Histórico disponível para consulta. Novas avaliações e execuções
          aguardam o suporte do motor às políticas da organização e às exceções
          por monitor.
        </p>
      )}
      {policy && (
        <div className="obs-grid">
          {[
            policy.policy.tags.journeyKey,
            ...policy.policy.tags.definitions.map((t) => t.key),
          ].map((k) => (
            <label key={k}>
              {k}
              {k === policy.policy.tags.journeyKey ||
              policy.policy.tags.definitions.some(
                (t) => t.key === k && t.required,
              )
                ? " · obrigatória"
                : ""}
              <input
                value={tags[k] || ""}
                disabled={busy}
                onChange={(e) => {
                  setTags({ ...tags, [k]: e.target.value });
                  invalidate();
                }}
              />
            </label>
          ))}
          <label>
            Equipe responsável
            <select
              value={teamId}
              disabled={busy}
              onChange={(e) => {
                setTeamId(e.target.value);
                invalidate();
              }}
            >
              <option value="">Selecione uma equipe</option>
              {catalog?.catalog.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {permissions.includes("readiness:configure") && (
            <button className="button secondary" onClick={() => setNewTeam("")}>
              Cadastrar equipe
            </button>
          )}
          {newTeam !== null && (
            <div>
              <label>
                Nome da nova equipe
                <input
                  value={newTeam}
                  onChange={(e) => setNewTeam(e.target.value)}
                />
              </label>
              <button
                className="button secondary"
                disabled={busy || !newTeam.trim()}
                onClick={() =>
                  perform(async () => {
                    if (!catalog) return;
                    const team = {
                      id: crypto.randomUUID(),
                      name: newTeam.trim(),
                    };
                    const result = await request<CatalogRecord>(
                      "observability/catalog",
                      {
                        method: "PUT",
                        body: JSON.stringify({
                          revision: catalog.revision,
                          catalog: {
                            ...catalog.catalog,
                            teams: [...catalog.catalog.teams, team],
                          },
                        }),
                      },
                    );
                    setCatalog(result);
                    setTeamId(team.id);
                    setNewTeam(null);
                  })
                }
              >
                Salvar equipe
              </button>
              <button
                className="button secondary"
                onClick={() => setNewTeam(null)}
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}
      {contractReady &&
        !caps?.serverContext &&
        !caps?.modes.includes("real") && (
          <p className="obs-notice">
            A conexão está cadastrada, mas a avaliação com telemetria real ainda
            aguarda habilitação. As avaliações simuladas anteriores continuam
            disponíveis no histórico.
          </p>
        )}
      {caps?.serverContext && permissions.includes("readiness:evaluate") && (
        <label>
          Ambiente Datadog
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
          >
            <option value="">Selecione um ambiente</option>
            {environments.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
          {!environments.length && (
            <small>Nenhum ambiente disponível para avaliação.</small>
          )}
        </label>
      )}
      <div className="obs-toolbar">
        <button
          className="button primary"
          disabled={
            busy ||
            !contractReady ||
            !permissions.includes("readiness:evaluate") ||
            (!caps?.serverContext && !caps?.modes.includes("real")) ||
            (caps?.serverContext
              ? !environments.includes(environment)
              : !caps?.operationalCatalog) ||
            !teamId
          }
          onClick={() =>
            perform(async () => {
              if (!policy) return;
              const missing = validateTags(tags, policy.policy);
              if (missing.length)
                throw Error("Preencha as tags: " + missing.join(", "));
              await saveTags(tags);
              const result = await request<ReadinessEvaluation>(
                base + "/evaluations",
                {
                  method: "POST",
                  body: JSON.stringify(
                    caps?.serverContext ? { environment } : {},
                  ),
                },
              );
              setCaps(
                await request<Capabilities>("observability/capabilities"),
              );
              setActive(result.id);
              setSelected({});
              setSettings({});
              setResponses({});
              setReview(false);
              invalidate();
              await refresh();
            })
          }
        >
          {busy ? "Aguarde…" : "Iniciar avaliação"}
        </button>
      </div>
      {error && (
        <p role="alert" className="obs-notice">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="obs-notice">
          {notice}
        </p>
      )}
      {history.length > 0 && (
        <label>
          Avaliação
          <select
            value={current?.id || ""}
            onChange={(e) => {
              setActive(e.target.value);
              setSelected({});
              setSettings({});
              setReview(false);
              setReport("");
              invalidate();
            }}
          >
            {history.map((h) => (
              <option key={h.id} value={h.id}>
                {h.created_at
                  ? new Date(h.created_at).toLocaleString("pt-BR")
                  : h.id}{" "}
                · {h.state}
              </option>
            ))}
          </select>
        </label>
      )}
      {current && (
        <>
          <div>
            {current.data.input.mode !== "simulation" &&
              !caps?.realExecution && (
                <p className="obs-notice">
                  É possível consultar a avaliação e revisar as recomendações. A
                  aplicação de alterações no Datadog ainda aguarda habilitação.
                </p>
              )}
            <strong>
              {current.data.input.mode === "simulation"
                ? "SIMULAÇÃO — sem alterações no provedor"
                : "AMBIENTE REAL"}
            </strong>
            <p>
              {current.state} ·{" "}
              {evaluatedPolicy
                ? `Política versão ${current.data.policy_context?.revision}`
                : "Avaliação anterior ao suporte de políticas"}
            </p>
            {waitingForCapacity(current) ? (
              <p role="status">
                Aguardando capacidade. A investigação continuará
                automaticamente.
              </p>
            ) : (
              current.data.pause_reason && <p>{current.data.pause_reason}</p>
            )}
            {current.state === "AWAITING_CONTINUATION" &&
              !waitingForCapacity(current) && (
                <button
                  className="button secondary"
                  disabled={
                    busy ||
                    !editable ||
                    !permissions.includes("readiness:evaluate")
                  }
                  onClick={() =>
                    perform(async () => {
                      await request(
                        `${base}/evaluations/${current.id}/resume`,
                        {
                          method: "POST",
                          body: "{}",
                        },
                      );
                      await refresh();
                    })
                  }
                >
                  Retomar investigação
                </button>
              )}
          </div>
          <details>
            <summary>
              Cobertura e evidências ({current.data.findings.length})
            </summary>
            {current.data.findings.map((f, i) => (
              <article key={i}>
                <p>
                  {f.service} · {f.signal} · {f.status}
                </p>
                {f.note && <p>{f.note}</p>}
                <pre>{JSON.stringify(f, null, 2)}</pre>
              </article>
            ))}
            <p>
              Ausência de eventos no período não comprova falta de
              instrumentação.
            </p>
          </details>
          {chosen.length > 1 && (
            <details>
              <summary>
                Configurar os {chosen.length} monitores selecionados
              </summary>
              <MonitorResponseFields
                value={bulk}
                catalog={
                  current.data.operational_context
                    ? {
                        revision: current.data.operational_context.revision,
                        catalog: current.data.operational_context.catalog,
                      }
                    : catalog
                }
                disabled={busy}
                onChange={setBulk}
              />
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setResponses({
                    ...responses,
                    ...Object.fromEntries(
                      chosen.map((r) => [r.id, { ...bulk }]),
                    ),
                  });
                  invalidate();
                }}
              >
                Aplicar aos selecionados
              </button>
            </details>
          )}
          {rows.map((r) => {
            const s = itemSettings(r);
            return (
              <article className="obs-rec" key={r.id}>
                <label className="obs-check">
                  <input
                    type="checkbox"
                    checked={!!selected[r.id]}
                    disabled={
                      busy ||
                      !editable ||
                      !permissions.includes("readiness:approve") ||
                      !!r.prerequisites.length ||
                      r.execution === "APPLIED"
                    }
                    onChange={(e) => {
                      setSelected({ ...selected, [r.id]: e.target.checked });
                      setReview(false);
                      invalidate();
                    }}
                  />
                  <strong>
                    {r.service} · {r.signal} · {r.action}
                  </strong>
                </label>
                <p>
                  {r.execution ||
                    (r.accepted ? "Aceita; aguardando execução" : "Proposta")}
                  {!!r.prerequisites.length &&
                    ` · Pré-requisitos: ${r.prerequisites.join(", ")}`}
                </p>
                {selected[r.id] && effectivePolicy && (
                  <>
                    <MonitorResponseFields
                      value={responses[r.id] || emptyResponseSelection()}
                      catalog={
                        current.data.operational_context
                          ? {
                              revision:
                                current.data.operational_context.revision,
                              catalog: current.data.operational_context.catalog,
                            }
                          : catalog
                      }
                      disabled={busy}
                      onChange={(value) => {
                        setResponses({ ...responses, [r.id]: value });
                        invalidate();
                      }}
                    />
                    {!caps?.operationalCatalog && (
                      <p className="muted">
                        Estas opções poderão ser aprovadas após a atualização do
                        serviço de prontidão. Nenhuma configuração será ignorada
                        silenciosamente.
                      </p>
                    )}
                    <label className="obs-check">
                      <input
                        type="checkbox"
                        disabled={
                          busy ||
                          !effectivePolicy.response.warRoomEnabled ||
                          (current.data.input.mode !== "simulation" &&
                            !caps?.realResponses)
                        }
                        checked={s.warRoomEnabled}
                        onChange={(e) =>
                          changeSetting(r, { warRoomEnabled: e.target.checked })
                        }
                      />
                      Habilitar resposta com War Room para este monitor
                    </label>
                    {s.warRoomEnabled && (
                      <div className="obs-grid">
                        <label className="obs-check">
                          <input
                            type="checkbox"
                            checked={s.waitSeconds === null}
                            disabled={busy}
                            onChange={(e) =>
                              changeSetting(r, {
                                waitSeconds: e.target.checked
                                  ? null
                                  : effectivePolicy.response.defaultWaitSeconds,
                              })
                            }
                          />
                          Usar espera padrão (
                          {effectivePolicy.response.defaultWaitSeconds}s)
                        </label>
                        {s.waitSeconds !== null && (
                          <label>
                            Espera deste monitor (segundos)
                            <input
                              type="number"
                              min="0"
                              max="86400"
                              step="1"
                              value={s.waitSeconds}
                              disabled={busy}
                              onChange={(e) =>
                                changeSetting(r, {
                                  waitSeconds: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                        )}
                        <p>
                          Espera efetiva:{" "}
                          <strong>
                            {resolvedWait(s, effectivePolicy)} segundos
                          </strong>
                          . Ao final, o motor deve confirmar que a falha
                          persiste.
                        </p>
                      </div>
                    )}
                    {caps?.messageGeneration && (
                      <label>
                        Mensagem e frase de impacto
                        <textarea
                          rows={5}
                          value={s.message ?? String(r.proposal.message || "")}
                          disabled={busy}
                          onChange={(e) =>
                            changeSetting(r, { message: e.target.value })
                          }
                        />
                        <small>
                          Revise o conteúdo proposto pelo motor antes de
                          aprovar.
                        </small>
                      </label>
                    )}
                  </>
                )}
                <details>
                  <summary>
                    Evidências, severidade e comparação antes/depois
                  </summary>
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
            );
          })}
          <button
            className="button secondary"
            disabled={
              busy ||
              !chosen.length ||
              !editable ||
              !permissions.includes("readiness:approve")
            }
            onClick={() => {
              setReview(true);
              invalidate();
            }}
          >
            Revisar {chosen.length} recomendações e tags
          </button>
        </>
      )}
      {review && effectivePolicy && prefs && (
        <details open={review}>
          <summary>
            {review ? "Revisão antes da execução" : "Tags salvas desta jornada"}
          </summary>
          <div className={review ? "obs-review" : "obs-grid"}>
            {tagKeys.map((k) => (
              <label key={k}>
                {k}
                {k === effectivePolicy.tags.journeyKey ||
                effectivePolicy.tags.definitions.some(
                  (t) => t.key === k && t.required,
                )
                  ? " · obrigatória"
                  : ""}
                <input
                  value={
                    tags[k] ??
                    effectivePolicy.tags.definitions.find((t) => t.key === k)
                      ?.defaultValue ??
                    ""
                  }
                  disabled={
                    busy ||
                    !permissions.some(
                      (p) =>
                        p === "readiness:approve" || p === "readiness:evaluate",
                    )
                  }
                  onChange={(e) => {
                    setTags({ ...tags, [k]: e.target.value });
                    invalidate();
                  }}
                />
              </label>
            ))}
            {review && current && (
              <>
                <h3>Resumo das alterações</h3>
                {chosen.map((r) => (
                  <p key={r.id}>
                    {r.service} · {r.action} ·{" "}
                    {itemSettings(r).warRoomEnabled
                      ? `War Room: espera de ${resolvedWait(itemSettings(r), effectivePolicy)}s`
                      : "Sem War Room"}
                  </p>
                ))}
                <p>
                  As tags acima serão aplicadas aos monitores selecionados. A
                  criação de monitores não ativa resposta automática sem a
                  confirmação abaixo.
                </p>
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    !editable ||
                    !chosen.length ||
                    !permissions.includes("readiness:approve")
                  }
                  onClick={() =>
                    perform(async () => {
                      const missing = validateTags(mergedTags, effectivePolicy);
                      if (missing.length)
                        throw Error("Preencha as tags: " + missing.join(", "));
                      await saveTags();
                      const result = await request<{ approval_token?: string }>(
                        `${base}/evaluations/${current.id}/accept`,
                        {
                          method: "POST",
                          body: JSON.stringify({
                            selections: chosen.map((r) => ({
                              id: r.id,
                              version: r.version,
                              tags: Object.fromEntries(
                                Object.entries(mergedTags).filter(([, v]) =>
                                  v.trim(),
                                ),
                              ),
                              monitor_settings: itemSettings(r),
                              ...(responses[r.id] ||
                              current.data.operational_context
                                ? {
                                    response_selection:
                                      responses[r.id] ||
                                      emptyResponseSelection(),
                                  }
                                : {}),
                            })),
                          }),
                        },
                      );
                      if (!result.approval_token)
                        throw Error(
                          "O motor não retornou uma confirmação válida. A execução permanece bloqueada.",
                        );
                      setApproval({
                        token: result.approval_token,
                        ids: chosen.map((r) => r.id),
                      });
                      await refresh();
                    })
                  }
                >
                  Aceitar alterações revisadas
                </button>
                {approval && (
                  <>
                    <label className="obs-check">
                      <input
                        type="checkbox"
                        checked={enableResponses}
                        disabled={
                          busy ||
                          !chosen.some((r) => itemSettings(r).warRoomEnabled)
                        }
                        onChange={(e) => setEnableResponses(e.target.checked)}
                      />
                      Também ativar as respostas de War Room aprovadas
                    </label>
                    <button
                      className="button primary"
                      disabled={
                        busy ||
                        !permissions.includes("readiness:execute") ||
                        (current.data.input.mode !== "simulation" &&
                          !caps?.realExecution)
                      }
                      onClick={() =>
                        perform(async () => {
                          await request(
                            `${base}/evaluations/${current.id}/execute`,
                            {
                              method: "POST",
                              body: JSON.stringify({
                                recommendation_ids: approval.ids,
                                approval_token: approval.token,
                                enable_responses: enableResponses,
                              }),
                            },
                          );
                          invalidate();
                          setReview(false);
                          setSelected({});
                          await refresh();
                          setNotice(
                            "Execução solicitada. Consulte o status de cada recomendação.",
                          );
                        })
                      }
                    >
                      {current.data.input.mode === "simulation"
                        ? "Executar simulação"
                        : "Executar alterações aprovadas"}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </details>
      )}
      {current && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            perform(async () => {
              const r = await request<{ markdown: string }>(
                `${base}/evaluations/${current.id}/report`,
              );
              setReport(r.markdown);
            })
          }
        >
          Consultar relatório consolidado
        </button>
      )}
      {report && (
        <article className="panel">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
        </article>
      )}
    </section>
  );
}

function MonitorResponseFields({
  value,
  catalog,
  disabled,
  onChange,
}: {
  value: ResponseSelection;
  catalog?: CatalogRecord;
  disabled: boolean;
  onChange: (value: ResponseSelection) => void;
}) {
  return (
    <div className="obs-grid">
      <label>
        Origem da escala
        <select
          disabled={disabled}
          value={value.onCallProvider}
          onChange={(e) =>
            onChange({
              ...value,
              onCallProvider: e.target.value as "datadog" | "external",
            })
          }
        >
          <option value="datadog">Datadog</option>
          <option value="external">Outra escala</option>
        </select>
      </label>
      {(
        [
          ["onCallReference", "Referência da escala / on-call"],
          ["notificationTarget", "Destino de notificações"],
          ["itsmTarget", "Destino ITSM"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            disabled={disabled}
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          />
        </label>
      ))}
      {(
        [
          ["notificationWindowId", "Janela de notificações"],
          ["warRoomWindowId", "Janela de abertura de War Room"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <select
            disabled={disabled}
            value={value[key] || ""}
            onChange={(e) =>
              onChange({ ...value, [key]: e.target.value || null })
            }
          >
            <option value="">24x7</option>
            {catalog?.catalog.windows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} · {w.start}–{w.end} · {w.timezone}
              </option>
            ))}
          </select>
        </label>
      ))}
      <small>
        A janela de abertura de War Room não silencia as notificações.
      </small>
    </div>
  );
}

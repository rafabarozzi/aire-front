"use client";
import { useEffect, useState } from "react";
import { request } from "@/lib/aire/client";
import {
  tiers,
  roles,
  signals,
  severities,
  signalNames,
  suggestedRules,
  policySchema,
  type PolicyRecord,
  type ObservabilityPolicy,
} from "@/lib/aire/observability";
export function ObservabilityPolicyEditor({ editable }: { editable: boolean }) {
  const [record, setRecord] = useState<PolicyRecord>(),
    [policy, setPolicy] = useState<ObservabilityPolicy>(),
    [tier, setTier] = useState<(typeof tiers)[number]>("Gold"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    request<PolicyRecord>("observability/policy")
      .then((r) => {
        setRecord(r);
        setPolicy(r.policy);
      })
      .catch((e) => setMessage(e.message));
  }, []);
  if (!policy || !record)
    return <p role="status">{message || "Carregando regras…"}</p>;
  const p = policy;
  const response = (patch: Partial<ObservabilityPolicy["response"]>) =>
    setPolicy({ ...p, response: { ...p.response, ...patch } });
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const parsed = policySchema.safeParse(p);
      if (!parsed.success)
        throw Error(parsed.error.issues.map((i) => i.message).join(" "));
      const next = await request<PolicyRecord>("observability/policy", {
        method: "PUT",
        body: JSON.stringify({
          revision: record!.revision,
          policy: parsed.data,
        }),
      });
      setRecord(next);
      setPolicy(next.policy);
      setMessage(
        "Regras salvas. Novas avaliações usarão esta versão quando o motor suportar o contrato. Monitores existentes não foram alterados.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="obs-policy">
      <p className="muted">
        Versão {record.revision} · Regras compartilhadas pela organização.
        Avaliações anteriores preservam as regras utilizadas.
      </p>
      <fieldset disabled={!editable || busy}>
        <section className="panel">
          <h2>Severidade</h2>
          <p>
            Combine criticidade da jornada, papel do serviço e sinal observado.
          </p>
          <div className="obs-options">
            {(["automatic", "custom"] as const).map((mode) => (
              <label key={mode}>
                <input
                  type="radio"
                  name="policy-mode"
                  checked={p.mode === mode}
                  onChange={() =>
                    setPolicy({
                      ...p,
                      mode,
                      rules:
                        mode === "custom" && !p.rules.length
                          ? suggestedRules()
                          : p.rules,
                    })
                  }
                />
                <strong>
                  {mode === "automatic"
                    ? "Automático pelo AIRE"
                    : "Matriz da organização"}
                </strong>
                <span>
                  {mode === "automatic"
                    ? "O motor deve justificar a decisão com as evidências disponíveis."
                    : "Defina as regras e condições de agravamento."}
                </span>
              </label>
            ))}
          </div>
          {p.mode === "custom" && (
            <>
              <div className="obs-toolbar">
                <label>
                  Tier da jornada
                  <select
                    value={tier}
                    onChange={(e) => setTier(e.target.value as typeof tier)}
                  >
                    {tiers.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Substituir toda a matriz pela sugestão inicial?",
                      )
                    )
                      setPolicy({ ...p, rules: suggestedRules() });
                  }}
                >
                  Preencher com sugestão
                </button>
              </div>
              <p className="muted">
                Sugestão inicial editável do AIRE; não é uma política específica
                do BV nem uma resposta gerada por IA.
              </p>
              <div className="obs-table-wrap">
                <table>
                  <caption>Matriz {tier}</caption>
                  <thead>
                    <tr>
                      <th>Serviço / sinal</th>
                      <th>Severidade base</th>
                      <th>Agravar quando</th>
                      <th>Para</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.flatMap((role) =>
                      signals.map((signal) => {
                        const idx = p.rules.findIndex(
                            (r) =>
                              r.tier === tier &&
                              r.role === role &&
                              r.signal === signal,
                          ),
                          r = p.rules[idx];
                        if (!r) return null;
                        const update = (v: Partial<typeof r>) =>
                          setPolicy({
                            ...p,
                            rules: p.rules.map((x, i) =>
                              i === idx ? { ...r, ...v } : x,
                            ),
                          });
                        return (
                          <tr key={role + signal}>
                            <th>
                              {role}
                              <small>{signalNames[signal]}</small>
                            </th>
                            <td>
                              <select
                                aria-label={`${role} ${signal} severidade`}
                                value={r.severity}
                                onChange={(e) =>
                                  update({
                                    severity: e.target
                                      .value as typeof r.severity,
                                  })
                                }
                              >
                                {severities.map((s) => (
                                  <option key={s}>{s}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <select
                                aria-label={`${role} ${signal} condição`}
                                value={r.escalation}
                                onChange={(e) =>
                                  update({
                                    escalation: e.target
                                      .value as typeof r.escalation,
                                  })
                                }
                              >
                                <option value="none">Sem agravamento</option>
                                <option value="journey_blocked">
                                  Jornada bloqueada
                                </option>
                                <option value="customer_impact">
                                  Impacto no cliente confirmado
                                </option>
                              </select>
                            </td>
                            <td>
                              <select
                                aria-label={`${role} ${signal} agravamento`}
                                disabled={r.escalation === "none"}
                                value={r.escalatedSeverity}
                                onChange={(e) =>
                                  update({
                                    escalatedSeverity: e.target
                                      .value as typeof r.severity,
                                  })
                                }
                              >
                                {severities.map((s) => (
                                  <option key={s}>{s}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      }),
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
        <section className="panel">
          <h2>Tags das jornadas</h2>
          <p>
            Estes campos serão solicitados na revisão dos monitores. Tags de
            monitor não substituem filtros de descoberta da telemetria.
          </p>
          <label>
            Chave da tag de jornada · obrigatória
            <input
              value={p.tags.journeyKey}
              onChange={(e) =>
                setPolicy({
                  ...p,
                  tags: { ...p.tags, journeyKey: e.target.value },
                })
              }
            />
          </label>
          {p.tags.definitions.map((t, i) => (
            <div className="obs-tag-row" key={i}>
              <label>
                Chave
                <input
                  value={t.key}
                  onChange={(e) =>
                    setPolicy({
                      ...p,
                      tags: {
                        ...p.tags,
                        definitions: p.tags.definitions.map((x, n) =>
                          n === i ? { ...x, key: e.target.value } : x,
                        ),
                      },
                    })
                  }
                />
              </label>
              <label>
                Valor padrão
                <input
                  value={t.defaultValue}
                  onChange={(e) =>
                    setPolicy({
                      ...p,
                      tags: {
                        ...p.tags,
                        definitions: p.tags.definitions.map((x, n) =>
                          n === i ? { ...x, defaultValue: e.target.value } : x,
                        ),
                      },
                    })
                  }
                />
              </label>
              <label className="obs-check">
                <input
                  type="checkbox"
                  checked={t.required}
                  onChange={(e) =>
                    setPolicy({
                      ...p,
                      tags: {
                        ...p.tags,
                        definitions: p.tags.definitions.map((x, n) =>
                          n === i ? { ...x, required: e.target.checked } : x,
                        ),
                      },
                    })
                  }
                />
                Obrigatória
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  setPolicy({
                    ...p,
                    tags: {
                      ...p.tags,
                      definitions: p.tags.definitions.filter((_, n) => n !== i),
                    },
                  })
                }
              >
                Remover
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            disabled={p.tags.definitions.length >= 30}
            onClick={() =>
              setPolicy({
                ...p,
                tags: {
                  ...p.tags,
                  definitions: [
                    ...p.tags.definitions,
                    { key: "", defaultValue: "", required: false },
                  ],
                },
              })
            }
          >
            Adicionar tag
          </button>
        </section>
        <section className="panel">
          <h2>Resposta e War Room</h2>
          <label className="obs-check">
            <input
              type="checkbox"
              checked={p.response.warRoomEnabled}
              onChange={(e) => response({ warRoomEnabled: e.target.checked })}
            />
            Permitir War Room nas recomendações
          </label>
          <p>
            Salvar esta política não cria salas nem aciona equipes. A ativação
            será confirmada junto à execução dos monitores aprovados.
          </p>
          <div className="obs-grid">
            <label>
              Espera padrão após o alerta (segundos)
              <input
                type="number"
                min="0"
                max="86400"
                step="1"
                value={p.response.defaultWaitSeconds}
                onChange={(e) =>
                  response({ defaultWaitSeconds: Number(e.target.value) })
                }
              />
              <small>
                Cada monitor pode herdar ou substituir este tempo. Zero
                significa imediato.
              </small>
            </label>
            <label>
              Fuso horário
              <input
                value={p.response.timezone}
                onChange={(e) => response({ timezone: e.target.value })}
              />
            </label>
            <label>
              Equipe responsável
              <input
                value={p.response.team}
                onChange={(e) => response({ team: e.target.value })}
              />
            </label>
            <label>
              Origem da escala
              <select
                value={p.response.onCallProvider}
                onChange={(e) =>
                  response({
                    onCallProvider: e.target.value as "datadog" | "external",
                  })
                }
              >
                <option value="datadog">Datadog</option>
                <option value="external">Outra escala existente</option>
              </select>
            </label>
            <label>
              Referência da escala / on-call
              <input
                value={p.response.onCallReference}
                onChange={(e) => response({ onCallReference: e.target.value })}
              />
              <small>
                Referencie uma escala existente. Não informe credenciais.
              </small>
            </label>
            {(
              [
                ["notificationTarget", "Destino de notificações"],
                ["itsmTarget", "Destino ITSM"],
                ["roomTarget", "Destino da War Room"],
              ] as const
            ).map(([k, title]) => (
              <label key={k}>
                {title}
                <input
                  value={p.response[k]}
                  onChange={(e) => response({ [k]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <p>Severidades elegíveis para War Room</p>
          <div className="obs-inline">
            {severities.map((s) => (
              <label className="obs-check" key={s}>
                <input
                  type="checkbox"
                  checked={p.response.severities.includes(s)}
                  onChange={(e) =>
                    response({
                      severities: e.target.checked
                        ? [...p.response.severities, s]
                        : p.response.severities.filter((x) => x !== s),
                    })
                  }
                />
                {s}
              </label>
            ))}
          </div>
          <label>
            Horário para abrir War Room
            <select
              value={p.response.schedule}
              onChange={(e) =>
                response({ schedule: e.target.value as "always" | "window" })
              }
            >
              <option value="always">24 horas por dia</option>
              <option value="window">Janela personalizada</option>
            </select>
          </label>
          {p.response.schedule === "window" && (
            <>
              <div className="obs-inline">
                {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map(
                  (d, i) => (
                    <label key={d} className="obs-check">
                      <input
                        type="checkbox"
                        checked={p.response.days.includes(i + 1)}
                        onChange={(e) =>
                          response({
                            days: e.target.checked
                              ? [...p.response.days, i + 1]
                              : p.response.days.filter((n) => n !== i + 1),
                          })
                        }
                      />
                      {d}
                    </label>
                  ),
                )}
              </div>
              <div className="obs-grid">
                <label>
                  Início
                  <input
                    type="time"
                    value={p.response.start}
                    onChange={(e) => response({ start: e.target.value })}
                  />
                </label>
                <label>
                  Fim
                  <input
                    type="time"
                    value={p.response.end}
                    onChange={(e) => response({ end: e.target.value })}
                  />
                </label>
                <label>
                  Fora da janela
                  <select
                    value={p.response.outsideHours}
                    onChange={(e) =>
                      response({
                        outsideHours: e.target.value as "notify" | "fallback",
                      })
                    }
                  >
                    <option value="notify">Notificar sem abrir sala</option>
                    <option value="fallback">
                      Acionar destino alternativo
                    </option>
                  </select>
                </label>
                {p.response.outsideHours === "fallback" && (
                  <label>
                    Destino alternativo
                    <input
                      value={p.response.fallback}
                      onChange={(e) => response({ fallback: e.target.value })}
                    />
                  </label>
                )}
              </div>
              <p>
                As notificações continuam independentes da janela de abertura da
                sala. Uma janela que cruza meia-noite termina no dia seguinte.
              </p>
            </>
          )}
        </section>
        <section className="panel">
          <h2>Critérios de prontidão</h2>
          <p>
            A conclusão exige evidências verificadas para os critérios
            selecionados; criar um monitor não comprova cobertura operacional.
          </p>
          <div className="obs-inline">
            {(
              [
                ["telemetry", "Telemetria"],
                ["monitors", "Monitores"],
                ["ownership", "Responsáveis"],
                ["oncall", "On-call"],
                ["itsm", "ITSM"],
                ["warroom", "War Room testada"],
              ] as const
            ).map(([key, label]) => (
              <label className="obs-check" key={key}>
                <input
                  type="checkbox"
                  checked={p.response.requiredChecks.includes(key)}
                  onChange={(e) =>
                    response({
                      requiredChecks: e.target.checked
                        ? [...p.response.requiredChecks, key]
                        : p.response.requiredChecks.filter((x) => x !== key),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </section>
      </fieldset>
      {message && (
        <p role="status" className="obs-notice">
          {message}
        </p>
      )}
      <button
        className="button primary"
        disabled={!editable || busy}
        onClick={save}
      >
        {busy ? "Salvando…" : "Salvar regras da organização"}
      </button>
      {!editable && (
        <p>
          Seu perfil permite consultar estas regras. Solicite alterações a um
          administrador.
        </p>
      )}
    </div>
  );
}

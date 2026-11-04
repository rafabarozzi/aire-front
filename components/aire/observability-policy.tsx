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
      const parsed = policySchema.safeParse({
        ...p,
        rules: p.rules.map((r) => ({ ...r, escalation: "none" })),
        tags: {
          ...p.tags,
          definitions: p.tags.definitions.map((t) => ({
            ...t,
            defaultValue: "",
          })),
        },
      });
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
        "Regras salvas. Novas avaliações usarão esta versão. Monitores existentes não foram alterados.",
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
                    : "Defina a severidade para cada serviço e sinal."}
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
                Use a sugestão como ponto de partida e ajuste à realidade da sua
                organização.
              </p>
              <div className="obs-table-wrap">
                <table>
                  <caption>Matriz {tier}</caption>
                  <thead>
                    <tr>
                      <th>Serviço</th>
                      <th>Sinal</th>
                      <th>Severidade</th>
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
                            <th>{role}</th>
                            <td>{signalNames[signal]}</td>
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
            Cadastre os nomes das tags. Os valores serão preenchidos em cada
            jornada antes da avaliação.
          </p>
          <label>
            Nome da tag de jornada · obrigatória
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
                Nome da tag
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
          <p>
            Equipes, janelas e salas ficam em Cadastros operacionais. A escala,
            os destinos de notificação e ITSM e as janelas serão escolhidos na
            revisão de cada monitor.
          </p>
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

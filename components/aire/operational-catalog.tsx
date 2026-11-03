"use client";
import { useEffect, useState } from "react";
import { request } from "@/lib/aire/client";
import {
  catalogSchema,
  type CatalogRecord,
  type OperationalCatalog,
} from "@/lib/aire/operational-catalog";
export function OperationalCatalogEditor({ editable }: { editable: boolean }) {
  const [record, setRecord] = useState<CatalogRecord>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request<CatalogRecord>("observability/catalog")
      .then(setRecord)
      .catch((e) => setMessage(e.message));
  }, []);
  if (!record) return <p role="status">{message || "Carregando cadastros…"}</p>;
  const c = record.catalog;
  const patch = (v: Partial<OperationalCatalog>) =>
    setRecord({ ...record, catalog: { ...c, ...v } });
  const windowNames = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const parsed = catalogSchema.safeParse(record!.catalog);
      if (!parsed.success)
        throw Error(parsed.error.issues.map((i) => i.message).join(" "));
      setRecord(
        await request<CatalogRecord>("observability/catalog", {
          method: "PUT",
          body: JSON.stringify({
            revision: record!.revision,
            catalog: parsed.data,
          }),
        }),
      );
      setMessage(
        "Cadastros salvos. Monitores existentes permanecem com as configurações aprovadas.",
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
        Cadastre as opções da organização. A escolha será feita em cada jornada
        e na revisão dos monitores.
      </p>
      <fieldset disabled={!editable || busy}>
        <section className="panel">
          <h2>Ambiente de avaliação</h2>
          <p>
            Use o identificador do ambiente na telemetria. Ele será aplicado às
            novas avaliações; a tag env da jornada, quando preenchida, terá
            preferência.
          </p>
          <label>
            Ambiente
            <input
              placeholder="Ex.: production"
              value={c.evaluationEnvironment}
              onChange={(e) => patch({ evaluationEnvironment: e.target.value })}
            />
          </label>
        </section>
        <section className="panel">
          <h2>Equipes</h2>
          <p>Quem cuida das jornadas e quem participa de toda War Room.</p>
          {c.teams.map((t) => (
            <div className="obs-catalog-row" key={t.id}>
              <label>
                Nome da equipe
                <input
                  value={t.name}
                  onChange={(e) =>
                    patch({
                      teams: c.teams.map((x) =>
                        x.id === t.id ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <label className="obs-check">
                <input
                  type="checkbox"
                  checked={c.alwaysTeamIds.includes(t.id)}
                  onChange={(e) =>
                    patch({
                      alwaysTeamIds: e.target.checked
                        ? [...c.alwaysTeamIds, t.id]
                        : c.alwaysTeamIds.filter((id) => id !== t.id),
                    })
                  }
                />
                Acionar em toda War Room
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  patch({
                    teams: c.teams.filter((x) => x.id !== t.id),
                    alwaysTeamIds: c.alwaysTeamIds.filter((id) => id !== t.id),
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
            onClick={() =>
              patch({
                teams: [...c.teams, { id: crypto.randomUUID(), name: "" }],
              })
            }
          >
            Adicionar equipe
          </button>
        </section>
        <section className="panel">
          <h2>Janelas de atendimento</h2>
          <p>
            24x7 estará sempre disponível. Cadastre aqui as janelas
            personalizadas; horários que cruzam meia-noite terminam no dia
            seguinte.
          </p>
          {c.windows.map((w) => (
            <div className="obs-catalog-item" key={w.id}>
              <div className="obs-grid">
                {(
                  [
                    ["name", "Nome"],
                    ["timezone", "Fuso horário"],
                    ["start", "Início"],
                    ["end", "Fim"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type={key === "start" || key === "end" ? "time" : "text"}
                      value={w[key]}
                      onChange={(e) =>
                        patch({
                          windows: c.windows.map((x) =>
                            x.id === w.id ? { ...x, [key]: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="obs-inline">
                {windowNames.map((day, i) => (
                  <label className="obs-check" key={day}>
                    <input
                      type="checkbox"
                      checked={w.days.includes(i + 1)}
                      onChange={(e) =>
                        patch({
                          windows: c.windows.map((x) =>
                            x.id === w.id
                              ? {
                                  ...x,
                                  days: e.target.checked
                                    ? [...x.days, i + 1]
                                    : x.days.filter((d) => d !== i + 1),
                                }
                              : x,
                          ),
                        })
                      }
                    />
                    {day}
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  patch({ windows: c.windows.filter((x) => x.id !== w.id) })
                }
              >
                Remover janela
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              patch({
                windows: [
                  ...c.windows,
                  {
                    id: crypto.randomUUID(),
                    name: "",
                    timezone: "America/Sao_Paulo",
                    days: [1, 2, 3, 4, 5],
                    start: "08:00",
                    end: "18:00",
                  },
                ],
              })
            }
          >
            Adicionar janela
          </button>
        </section>
        <section className="panel">
          <h2>Destinos de War Room</h2>
          <p>
            Referencie uma sala existente ou uma automação de criação. Não
            inclua tokens nem URLs com credenciais.
          </p>
          {c.destinations.map((d) => (
            <div className="obs-catalog-item" key={d.id}>
              <div className="obs-grid">
                <label>
                  Nome
                  <input
                    value={d.name}
                    onChange={(e) =>
                      patch({
                        destinations: c.destinations.map((x) =>
                          x.id === d.id ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Ferramenta
                  <select
                    value={d.provider}
                    onChange={(e) =>
                      patch({
                        destinations: c.destinations.map((x) =>
                          x.id === d.id
                            ? {
                                ...x,
                                provider: e.target.value as "teams" | "slack",
                              }
                            : x,
                        ),
                      })
                    }
                  >
                    <option value="teams">Teams</option>
                    <option value="slack">Slack</option>
                  </select>
                </label>
                <label>
                  Tipo
                  <select
                    value={d.kind}
                    onChange={(e) =>
                      patch({
                        destinations: c.destinations.map((x) =>
                          x.id === d.id
                            ? {
                                ...x,
                                kind: e.target.value as "room" | "automation",
                              }
                            : x,
                        ),
                      })
                    }
                  >
                    <option value="room">Sala existente</option>
                    <option value="automation">Automação de criação</option>
                  </select>
                </label>
                <label>
                  Referência
                  <input
                    value={d.reference}
                    onChange={(e) =>
                      patch({
                        destinations: c.destinations.map((x) =>
                          x.id === d.id
                            ? { ...x, reference: e.target.value }
                            : x,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                className="button secondary"
                disabled={
                  c.routes.some((r) => r.destinationId === d.id) ||
                  c.defaultDestinationId === d.id
                }
                onClick={() =>
                  patch({
                    destinations: c.destinations.filter((x) => x.id !== d.id),
                  })
                }
              >
                Remover destino
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              patch({
                destinations: [
                  ...c.destinations,
                  {
                    id: crypto.randomUUID(),
                    name: "",
                    provider: "teams",
                    kind: "room",
                    reference: "",
                  },
                ],
              })
            }
          >
            Adicionar destino
          </button>
          <h3>Roteamento por tags</h3>
          <p>
            Exemplo: bu = varejo → sala Varejo. Se duas tags indicarem salas
            diferentes, a aprovação pedirá a correção da regra.
          </p>
          {c.routes.map((r) => (
            <div className="obs-catalog-row" key={r.id}>
              <label>
                Tag
                <input
                  value={r.key}
                  placeholder="bu"
                  onChange={(e) =>
                    patch({
                      routes: c.routes.map((x) =>
                        x.id === r.id ? { ...x, key: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Valor
                <input
                  value={r.value}
                  placeholder="varejo"
                  onChange={(e) =>
                    patch({
                      routes: c.routes.map((x) =>
                        x.id === r.id ? { ...x, value: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Destino
                <select
                  value={r.destinationId}
                  onChange={(e) =>
                    patch({
                      routes: c.routes.map((x) =>
                        x.id === r.id
                          ? { ...x, destinationId: e.target.value }
                          : x,
                      ),
                    })
                  }
                >
                  <option value="">Selecione</option>
                  {c.destinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name || "Sem nome"}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  patch({ routes: c.routes.filter((x) => x.id !== r.id) })
                }
              >
                Remover
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            disabled={!c.destinations.length}
            onClick={() =>
              patch({
                routes: [
                  ...c.routes,
                  {
                    id: crypto.randomUUID(),
                    key: "bu",
                    value: "",
                    destinationId: c.destinations[0].id,
                  },
                ],
              })
            }
          >
            Adicionar rota
          </button>
          <label>
            Destino quando nenhuma tag corresponder
            <select
              value={c.defaultDestinationId || ""}
              onChange={(e) =>
                patch({ defaultDestinationId: e.target.value || null })
              }
            >
              <option value="">Exigir uma rota correspondente</option>
              {c.destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
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
        {busy ? "Salvando…" : "Salvar cadastros"}
      </button>
    </div>
  );
}

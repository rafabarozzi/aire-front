"use client";
import { useEffect, useState, type FormEvent } from "react";
import { request } from "@/lib/aire/client";
import { LogoutButton } from "./logout-button";
import type { Session, Journey } from "@/lib/aire/types";
import type { Tenant } from "@/lib/server/config";

type Agent = {
  id: string;
  label: string;
  repositories: string[];
  revoked: number;
  expires: number;
  last_seen: number;
};
type Usage = {
  month: string;
  attempts: number;
  input_tokens: number;
  output_tokens: number;
  usage_unknown_attempts: number;
  unpriced_attempts: number;
  estimated_ai_usd: string;
  events: Array<{
    attempt_id: string;
    kind: string;
    provider?: string;
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    estimated_usd?: string | null;
  }>;
};
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "Não foi possível concluir.";
const money = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" }).format(
    v,
  );
const split = (s: string) =>
  s
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);

export function EnterpriseConsole({
  mode,
}: {
  mode: "platform" | "collectors" | "usage" | "evolution";
}) {
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false),
    [dark, setDark] = useState(false);
  const [registry, setRegistry] = useState<{
    revision: number;
    tenants: Tenant[];
  }>({ revision: 0, tenants: [] });
  const [editing, setEditing] = useState<Tenant | null>(null),
    [agents, setAgents] = useState<Agent[]>([]);
  const [enrollment, setEnrollment] = useState<{
    enrollment_token: string;
    expires_at: number;
  } | null>(null);
  const [usage, setUsage] = useState<{
    tenant?: string;
    plan?: Tenant["plan"] | null;
    usage: Usage;
  } | null>(null);
  const [ownUsage, setOwnUsage] = useState<Record<
    string,
    string | number | null
  > | null>(null);
  const [billing, setBilling] = useState<{
    month: string;
    rows: Array<{
      id: string;
      name: string;
      status: string;
      plan?: Tenant["plan"] | null;
      usage: Usage | null;
    }>;
  } | null>(null);
  const [evolution, setEvolution] = useState<{
    uniqueJourneys: number;
    completedJourneys: number;
    analyses: number;
    reanalyses: number;
    repositories: number;
    firstAnalysisAt: string | null;
    measurement: string;
    months: Array<{
      month: string;
      analyses: number;
      completed: number;
      failed: number;
    }>;
  } | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  async function load() {
    if (mode === "platform") {
      setRegistry(await request("platform"));
      setBilling(await request(`platform/billing?month=${month}`));
    }
    if (mode === "evolution") setEvolution(await request("evolution"));
    if (mode === "collectors") setAgents(await request("collectors"));
    if (mode === "usage") setOwnUsage(await request("usage"));
  }
  useEffect(() => {
    setDark(localStorage.getItem("aire-theme") === "dark");
    request<Session>("session")
      .then((s) => {
        setSession(s);
        if (s.authenticated) return load();
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  async function operation(action: () => Promise<void>) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await operation(async () => {
      const value = (key: string) => String(f.get(key) || "").trim();
      const id = value("id"),
        prefix = id.replace(/-/g, "_").toUpperCase();
      const admin = {
        provider: value("adminProvider") as "google" | "microsoft",
        subject: value("adminSubject"),
        role: "admin" as const,
      };
      const ms = value("microsoft").toLowerCase();
      const tenant: Tenant = {
        ...editing,
        id,
        name: value("name"),
        ...(value("publicOrigin")
          ? { publicOrigin: value("publicOrigin") }
          : {}),
        enabled: f.get("enabled") === "on",
        sso: {
          ...editing?.sso,
          ...(ms ? { microsoftTenantId: ms } : {}),
          googleDomains: split(value("domains")),
        },
        members: [
          ...(admin.subject ? [admin] : []),
          ...(editing?.members.filter(
            (m) =>
              m.role !== "admin" ||
              m !== editing.members.find((x) => x.role === "admin"),
          ) || []),
        ],
        groups: (["admin", "engineer", "viewer"] as const).flatMap((role) =>
          split(value("group_" + role)).map((id) => ({ id, role })),
        ),
        repositories: split(value("repositories")),
        githubTokenEnv: editing?.githubTokenEnv || `${prefix}_GITHUB_TOKEN`,
        engineUrlEnv: editing?.engineUrlEnv || `${prefix}_ENGINE_URL`,
        engineTokenEnv: editing?.engineTokenEnv || `${prefix}_ENGINE_TOKEN`,
        plan: {
          name: value("plan"),
          monthlyUsd: Number(value("monthly")),
          infrastructureMonthlyUsd: value("infra")
            ? Number(value("infra"))
            : undefined,
        },
      };
      await request("platform", {
        method: "PUT",
        body: JSON.stringify({ revision: registry.revision, tenant }),
      });
      await load();
      setEditing(null);
      setMessage(
        "Organização salva. A ativação exige um motor vinculado ao mesmo cliente.",
      );
    });
  }
  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await operation(async () =>
      setEnrollment(
        await request("collectors/enrollments", {
          method: "POST",
          body: JSON.stringify({
            label: f.get("label"),
            repositories: split(String(f.get("repositories"))),
          }),
        }),
      ),
    );
  }
  async function map(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await operation(async () => {
      const j = await request<Journey>("journeys", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(f)),
      });
      setMessage(
        `Coleta solicitada. A jornada ${j.name} pode ser acompanhada em Jornadas.`,
      );
    });
  }
  const allowed =
    session?.authenticated &&
    (mode === "platform"
      ? session.platformAdmin
      : session.permissions.includes(
          mode === "collectors"
            ? "collectors:read"
            : mode === "evolution"
              ? "journeys:read"
              : "usage:read",
        ));
  const admin = editing?.members.find((m) => m.role === "admin");
  return (
    <div className="enterprise-page">
      <header className="enterprise-header">
        <a href="/" className="enterprise-brand">
          AIRE <small>by Northeia</small>
        </a>
        <nav>
          <a href="/#jornadas">
            {session?.portal === "admin"
              ? "Início da administração"
              : "Voltar ao workspace"}
          </a>
          <button
            className="button secondary"
            onClick={() => {
              setDark(!dark);
              localStorage.setItem("aire-theme", dark ? "light" : "dark");
            }}
          >
            Tema {dark ? "claro" : "escuro"}
          </button>
          {session?.authenticated && (
            <LogoutButton onError={setError} />
          )}
        </nav>
      </header>
      <main>
        <div className="eyebrow">
          {mode === "platform"
            ? "ADMINISTRAÇÃO NORTHEIA"
            : session?.tenant || "WORKSPACE"}
        </div>
        <h1>
          {mode === "platform"
            ? "Clientes e consumo"
            : mode === "collectors"
              ? "Coletores privados"
              : mode === "evolution"
                ? "Evolução do ambiente"
                : "Consumo do workspace"}
        </h1>
        <p>
          {mode === "platform"
            ? "Organizações, identidade corporativa e custos estimados em um só lugar."
            : mode === "collectors"
              ? "Colete código autorizado na rede do cliente. O processamento acontece no Atlas."
              : mode === "evolution"
                ? "Acompanhe a adoção, as reanálises e os resultados medidos no seu ambiente."
                : "Acompanhe o uso de IA da sua organização no mês atual."}
        </p>
        {error && (
          <div className="error-panel" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="connection-success" role="status">
            {message}
          </div>
        )}
        {!session ? (
          <p>Carregando acesso…</p>
        ) : !allowed ? (
          <div className="panel">
            <p>
              Seu acesso não permite abrir esta área. Entre com uma conta
              autorizada.
            </p>
            <a href="/">Voltar ao login</a>
          </div>
        ) : (
          <>
            {mode === "evolution" && evolution && (
              <section className="panel enterprise-section">
                <h2>Base de evolução</h2>
                <div className="enterprise-metrics">
                  {[
                    ["Jornadas únicas", evolution.uniqueJourneys],
                    [
                      "Análises concluídas (versão atual)",
                      evolution.completedJourneys,
                    ],
                    ["Reanálises preservadas", evolution.reanalyses],
                    ["Repositórios mapeados", evolution.repositories],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <small>{label}</small>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <p>{evolution.measurement}</p>
                <div className="enterprise-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Mês de criação</th>
                        <th>Análises</th>
                        <th>Concluídas</th>
                        <th>Falharam</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evolution.months.map((m) => (
                        <tr key={m.month}>
                          <td>{m.month}</td>
                          <td>{m.analyses}</td>
                          <td>{m.completed}</td>
                          <td>{m.failed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!evolution.analyses && (
                  <p>Mapeie a primeira jornada para iniciar a linha de base.</p>
                )}
                <h3>Resultados operacionais</h3>
                <p>
                  Alertas criados, alertas ajustados, horas poupadas e retorno
                  financeiro: ainda não medidos. O histórico de análises já é
                  preservado; sugestões só contarão como resultado após
                  aplicação comprovada.
                </p>
              </section>
            )}
            {mode === "platform" && (
              <>
                <section className="panel enterprise-section">
                  <h2>Organizações</h2>
                  <p>
                    Cadastre em rascunho, configure o motor e teste a ativação.
                    O aplicativo Microsoft deve aceitar os tenants contratados.
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => setEditing(null)}
                  >
                    Novo cliente
                  </button>
                  <div className="enterprise-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Cliente</th>
                          <th>Estado</th>
                          <th>Plano</th>
                          <th>Mensalidade USD</th>
                          <th>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registry.tenants.map((t) => (
                          <tr key={t.id}>
                            <td>
                              {t.name}
                              <small>{t.id}</small>
                            </td>
                            <td>
                              {t.enabled === false
                                ? "Rascunho / suspenso"
                                : "Ativo"}
                            </td>
                            <td>{t.plan?.name || "Não definido"}</td>
                            <td>{t.plan ? money(t.plan.monthlyUsd) : "—"}</td>
                            <td>
                              <button
                                className="button secondary"
                                onClick={() => setEditing(t)}
                              >
                                Editar
                              </button>{" "}
                              <button
                                className="button secondary"
                                disabled={busy}
                                onClick={() =>
                                  operation(async () =>
                                    setUsage(
                                      await request(
                                        `platform/${t.id}/usage?month=${month}`,
                                      ),
                                    ),
                                  )
                                }
                              >
                                Ver consumo
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <form
                  className="panel enterprise-section"
                  key={editing?.id || "new"}
                  onSubmit={saveTenant}
                >
                  <h2>
                    {editing ? `Editar ${editing.name}` : "Cadastrar cliente"}
                  </h2>
                  <div className="enterprise-grid">
                    <label className="field">
                      Identificador
                      <input
                        name="id"
                        required
                        pattern="[a-z0-9][a-z0-9-]{0,63}"
                        readOnly={!!editing}
                        defaultValue={editing?.id}
                        placeholder="cliente-exemplo"
                      />
                    </label>
                    <label className="field">
                      Nome
                      <input
                        name="name"
                        required
                        maxLength={200}
                        defaultValue={editing?.name}
                      />
                    </label>
                    <label className="field">
                      Domínio do portal do cliente
                      <input
                        name="publicOrigin"
                        type="url"
                        defaultValue={editing?.publicOrigin}
                        placeholder="https://northeia-lab.northeia.com"
                      />
                      <small>
                        Cadastre o DNS e este endereço nos redirects do provedor
                        SSO.
                      </small>
                    </label>
                    <label className="field">
                      Tenant ID do Microsoft Entra
                      <input
                        name="microsoft"
                        defaultValue={editing?.sso?.microsoftTenantId}
                        placeholder="UUID do diretório do cliente"
                      />
                    </label>
                    <label className="field">
                      Domínios Google Workspace
                      <input
                        name="domains"
                        defaultValue={editing?.sso?.googleDomains.join(", ")}
                        placeholder="empresa.com.br"
                      />
                    </label>
                    <label className="field">
                      Identidade do administrador
                      <select
                        name="adminProvider"
                        defaultValue={admin?.provider || "microsoft"}
                      >
                        <option value="microsoft">Microsoft</option>
                        <option value="google">Google</option>
                      </select>
                    </label>
                    <label className="field">
                      ID imutável do administrador
                      <input
                        name="adminSubject"
                        defaultValue={admin?.subject}
                        placeholder="Object ID Microsoft ou subject Google"
                      />
                      <small>
                        Pode ser preenchido após o teste SSO. Sem vínculo ou
                        grupo autorizado, o usuário não recebe acesso.
                      </small>
                    </label>
                    {(["admin", "engineer", "viewer"] as const).map((role) => (
                      <label className="field" key={role}>
                        Grupos Microsoft — {role}
                        <input
                          name={"group_" + role}
                          defaultValue={editing?.groups
                            .filter((g) => g.role === role)
                            .map((g) => g.id)
                            .join(", ")}
                          placeholder="Object IDs dos grupos, separados por vírgula"
                        />
                      </label>
                    ))}
                    <label className="field">
                      Plano
                      <input
                        name="plan"
                        required
                        defaultValue={editing?.plan?.name || "POC"}
                      />
                    </label>
                    <label className="field">
                      Mensalidade em USD
                      <input
                        name="monthly"
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        defaultValue={editing?.plan?.monthlyUsd || 0}
                      />
                    </label>
                    <label className="field">
                      Infra mensal estimada em USD
                      <input
                        name="infra"
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={
                          editing?.plan?.infrastructureMonthlyUsd ?? ""
                        }
                      />
                      <small>
                        Rateio manual; ainda não conciliado com a fatura.
                      </small>
                    </label>
                    <label className="field">
                      Repositórios autorizados
                      <textarea
                        name="repositories"
                        defaultValue={editing?.repositories.join("\n")}
                        placeholder="squad/commerce"
                      />
                    </label>
                  </div>
                  <label>
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={editing?.enabled === true}
                    />{" "}
                    Ativar organização e verificar identidade do motor
                  </label>
                  <p>
                    As variáveis do motor seguem IDENTIFICADOR_ENGINE_URL e
                    IDENTIFICADOR_ENGINE_TOKEN, com o identificador em
                    maiúsculas e hífens substituídos por sublinhados. Chaves de
                    IA ficam no motor.
                  </p>
                  <button
                    disabled={busy}
                    className="button primary"
                    type="submit"
                  >
                    {busy ? "Salvando…" : "Salvar organização"}
                  </button>
                  {editing && (
                    <p>
                      Link de entrada:{" "}
                      <a
                        href={
                          editing.publicOrigin || `/?workspace=${editing.id}`
                        }
                      >
                        {editing.publicOrigin || `/?workspace=${editing.id}`}
                      </a>
                    </p>
                  )}
                </form>
                <section className="panel enterprise-section">
                  <h2>Billing por organização</h2>
                  <p>
                    Consumo de IA medido, custo estimado pelo catálogo e rateio
                    de infraestrutura. Valores sem medição permanecem
                    desconhecidos.
                  </p>
                  <label className="field">
                    Mês de referência, UTC
                    <input
                      type="month"
                      value={month}
                      onChange={(e) => {
                        setMonth(e.target.value);
                        setUsage(null);
                      }}
                    />
                  </label>
                  <p>
                    Selecione “Ver consumo” no cliente. Valores de IA são
                    estimativas, com preços versionados. Tentativas sem preço ou
                    sem medição ficam sinalizadas.
                  </p>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      operation(async () =>
                        setBilling(
                          await request(`platform/billing?month=${month}`),
                        ),
                      )
                    }
                  >
                    Atualizar billing
                  </button>
                  {billing && (
                    <div className="enterprise-table">
                      <table>
                        <caption>{billing.month} · UTC · USD</caption>
                        <thead>
                          <tr>
                            <th>Organização</th>
                            <th>Tentativas / tokens</th>
                            <th>IA conhecida</th>
                            <th>Sem preço / medição</th>
                            <th>Infra mensal</th>
                            <th>Mensalidade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {billing.rows.map((row) => (
                            <tr key={row.id}>
                              <td>
                                {row.name}
                                <small>
                                  {row.status === "available"
                                    ? "Disponível"
                                    : row.status === "inactive"
                                      ? "Inativa"
                                      : "Motor indisponível"}
                                </small>
                              </td>
                              <td>
                                {row.usage
                                  ? `${row.usage.attempts} / ${row.usage.input_tokens + row.usage.output_tokens}`
                                  : "—"}
                              </td>
                              <td>
                                {row.usage
                                  ? money(Number(row.usage.estimated_ai_usd))
                                  : "—"}
                              </td>
                              <td>
                                {row.usage
                                  ? `${row.usage.unpriced_attempts} / ${row.usage.usage_unknown_attempts}`
                                  : "—"}
                              </td>
                              <td>
                                {row.plan?.infrastructureMonthlyUsd == null
                                  ? "Não informado"
                                  : money(row.plan.infrastructureMonthlyUsd)}
                              </td>
                              <td>
                                {row.plan
                                  ? money(row.plan.monthlyUsd)
                                  : "Não definido"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {usage && (
                    <>
                      <h3>
                        {usage.tenant} · {usage.usage.month}
                      </h3>
                      <div className="enterprise-metrics">
                        <div>
                          <small>Tentativas</small>
                          <strong>{usage.usage.attempts}</strong>
                        </div>
                        <div>
                          <small>IA estimada conhecida</small>
                          <strong>
                            {money(Number(usage.usage.estimated_ai_usd))}
                          </strong>
                        </div>
                        <div>
                          <small>Sem preço / sem medição</small>
                          <strong>
                            {usage.usage.unpriced_attempts} /{" "}
                            {usage.usage.usage_unknown_attempts}
                          </strong>
                        </div>
                        <div>
                          <small>Infra estimada manual</small>
                          <strong>
                            {usage.plan?.infrastructureMonthlyUsd === undefined
                              ? "Não definida"
                              : money(usage.plan.infrastructureMonthlyUsd)}
                          </strong>
                        </div>
                      </div>
                      <p>
                        Tokens de entrada:{" "}
                        {usage.usage.input_tokens.toLocaleString("pt-BR")} ·
                        Saída:{" "}
                        {usage.usage.output_tokens.toLocaleString("pt-BR")}.
                        Esta visão não emite faturas.
                      </p>
                      <div className="enterprise-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Provedor / modelo</th>
                              <th>Entrada</th>
                              <th>Saída</th>
                              <th>Custo estimado USD</th>
                            </tr>
                          </thead>
                          <tbody>
                            {usage.usage.events
                              .filter((e) => e.kind === "usage")
                              .map((e) => (
                                <tr key={e.attempt_id}>
                                  <td>
                                    {e.provider}
                                    <small>{e.model}</small>
                                  </td>
                                  <td>{e.input_tokens ?? "Desconhecido"}</td>
                                  <td>{e.output_tokens ?? "Desconhecido"}</td>
                                  <td>
                                    {e.estimated_usd == null
                                      ? "Sem preço"
                                      : money(Number(e.estimated_usd))}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </section>
              </>
            )}
            {mode === "collectors" && (
              <>
                <section className="panel enterprise-section">
                  <h2>Agentes vinculados</h2>
                  <button
                    className="button secondary"
                    onClick={() => operation(load)}
                  >
                    Atualizar
                  </button>
                  <div className="enterprise-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Agente</th>
                          <th>Estado</th>
                          <th>Último contato</th>
                          <th>Repositórios</th>
                          <th>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agents.map((a) => (
                          <tr key={a.id}>
                            <td>
                              {a.label}
                              <small>{a.id}</small>
                            </td>
                            <td>
                              {a.revoked
                                ? "Revogado"
                                : a.expires * 1000 < Date.now()
                                  ? "Expirado"
                                  : "Habilitado"}
                            </td>
                            <td>
                              {new Date(a.last_seen * 1000).toLocaleString(
                                "pt-BR",
                              )}
                            </td>
                            <td>{a.repositories.join(", ")}</td>
                            <td>
                              {session.permissions.includes(
                                "collectors:manage",
                              ) &&
                                !a.revoked && (
                                  <button
                                    className="button secondary"
                                    disabled={busy}
                                    onClick={() => {
                                      if (
                                        confirm(
                                          `Revogar o acesso de ${a.label}?`,
                                        )
                                      )
                                        operation(async () => {
                                          await request(`collectors/${a.id}`, {
                                            method: "DELETE",
                                          });
                                          await load();
                                        });
                                    }}
                                  >
                                    Revogar
                                  </button>
                                )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!agents.length && (
                    <p>
                      Nenhum coletor vinculado. Gere um código e execute a
                      instalação no cliente.
                    </p>
                  )}
                </section>
                {session.permissions.includes("collectors:manage") && (
                  <form className="panel enterprise-section" onSubmit={enroll}>
                    <h2>Vincular novo coletor</h2>
                    <p>
                      O código vale por dez minutos e pode ser usado uma vez.
                      Cadastre primeiro os repositórios em Conexões.
                    </p>
                    <div className="enterprise-grid">
                      <label className="field">
                        Nome
                        <input
                          name="label"
                          required
                          maxLength={80}
                          placeholder="GitHub corporativo — produção"
                        />
                      </label>
                      <label className="field">
                        Repositórios
                        <textarea
                          name="repositories"
                          required
                          placeholder="squad/commerce"
                        />
                      </label>
                    </div>
                    <button className="button primary" disabled={busy}>
                      Gerar código de vinculação
                    </button>
                    {enrollment && (
                      <div className="enterprise-secret">
                        <p>
                          Código temporário — visível somente nesta resposta:
                        </p>
                        <code>{enrollment.enrollment_token}</code>
                        <p>
                          Expira em{" "}
                          {new Date(
                            enrollment.expires_at * 1000,
                          ).toLocaleTimeString("pt-BR")}
                          . Use na instalação do coletor e feche esta mensagem.
                        </p>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => setEnrollment(null)}
                        >
                          Ocultar código
                        </button>
                      </div>
                    )}
                  </form>
                )}
                {session.permissions.includes("journeys:create") && (
                  <form className="panel enterprise-section" onSubmit={map}>
                    <h2>Mapear jornada por coletor</h2>
                    <p>
                      O agente verifica o acesso dentro da rede e envia apenas
                      os arquivos permitidos. Informe o SHA completo do commit.
                    </p>
                    <div className="enterprise-grid">
                      <label className="field">
                        Coletor
                        <select name="collectorId" required>
                          <option value="">Selecione</option>
                          {agents
                            .filter(
                              (a) =>
                                !a.revoked && a.expires * 1000 > Date.now(),
                            )
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.label}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="field">
                        Repositório
                        <input
                          name="repository"
                          required
                          placeholder="squad/commerce"
                        />
                      </label>
                      <label className="field">
                        Commit
                        <input
                          name="revision"
                          required
                          pattern="[a-f0-9]{40}"
                          minLength={40}
                          maxLength={40}
                        />
                      </label>
                      <label className="field">
                        Nome da jornada
                        <input
                          name="name"
                          required
                          minLength={3}
                          maxLength={200}
                        />
                      </label>
                      <label className="field">
                        Endpoint
                        <input
                          name="endpoint"
                          required
                          placeholder="POST /checkout"
                        />
                      </label>
                      <label className="field">
                        Criticidade
                        <select name="tier">
                          <option>Gold</option>
                          <option>Silver</option>
                          <option>Bronze</option>
                        </select>
                      </label>
                      <label className="field">
                        Subdiretório opcional
                        <input
                          name="sourceSubdirectory"
                          placeholder="services"
                        />
                      </label>
                    </div>
                    <button className="button primary" disabled={busy}>
                      Solicitar coleta e mapeamento
                    </button>
                  </form>
                )}
              </>
            )}
            {mode === "usage" && ownUsage && (
              <section className="panel enterprise-section">
                <h2>{ownUsage.month} · UTC</h2>
                <div className="enterprise-metrics">
                  <div>
                    <small>Tentativas de IA</small>
                    <strong>{ownUsage.attempts}</strong>
                  </div>
                  <div>
                    <small>Tokens de entrada</small>
                    <strong>{ownUsage.input_tokens}</strong>
                  </div>
                  <div>
                    <small>Tokens de saída</small>
                    <strong>{ownUsage.output_tokens}</strong>
                  </div>
                  <div>
                    <small>Medições pendentes</small>
                    <strong>{ownUsage.usage_unknown_attempts}</strong>
                  </div>
                </div>
                <p>
                  Plano: {ownUsage.plan || "Não definido"}. Valores de cobrança
                  seguem o contrato da organização.
                </p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

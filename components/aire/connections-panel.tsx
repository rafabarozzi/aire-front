"use client";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { KeyRound, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { ProviderLogo } from "./provider-logo";
import "./connections-panel.css";
import { request } from "@/lib/aire/client";
import type { ConnectionsView, Session } from "@/lib/aire/types";
type Provider = "github" | "gitlab" | "datadog" | "dynatrace";
type Connection = {
  provider: Provider;
  revision: number;
  configured: boolean;
  needsReplacement?: boolean;
  kind?: string;
  site?: string;
  environment?: string;
  appId?: string;
  installationId?: string;
};
const names = {
  github: "GitHub",
  gitlab: "GitLab",
  datadog: "Datadog",
  dynatrace: "Dynatrace",
};
const sites = [
  "datadoghq.com",
  "datadoghq.eu",
  "us3.datadoghq.com",
  "us5.datadoghq.com",
  "ap1.datadoghq.com",
  "ap2.datadoghq.com",
  "uk1.datadoghq.com",
  "ddog-gov.com",
  "us2.ddog-gov.com",
];
const guides = {
  github: (
    <>
      <p>
        <b>Token:</b> crie um token fine-grained, selecione os repositórios e
        conceda Contents: Read e Metadata: Read. Autorize o SSO da organização
        quando necessário.
      </p>
      <p>
        <b>GitHub App:</b> nas configurações da organização, crie um GitHub App
        com Contents: Read e Metadata: Read. Para este acesso de leitura,
        webhooks podem ficar desativados. Instale o App nos repositórios
        desejados, gere uma chave privada e informe o App ID (ou Client ID),
        Installation ID e o conteúdo do arquivo PEM abaixo. A chave fica
        protegida no servidor; o AIRE gera tokens temporários automaticamente.
      </p>
      <a
        href="https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation"
        target="_blank"
        rel="noreferrer"
      >
        Guia oficial do GitHub
      </a>
    </>
  ),
  gitlab: (
    <>
      <p>
        No GitLab.com, crie um token pessoal, de grupo ou de projeto com escopo{" "}
        <code>read_api</code> e acesso de leitura ao código (papel Reporter ou
        superior nos projetos). Os resultados respeitam os projetos acessíveis à
        credencial. Subgrupos são suportados. Deploy tokens não servem para este
        catálogo via API.
      </p>
      <a
        href="https://docs.gitlab.com/api/rest/authentication/"
        target="_blank"
        rel="noreferrer"
      >
        Guia oficial do GitLab
      </a>
    </>
  ),
  datadog: (
    <>
      <p>
        Em Organization Settings → API Keys e Application Keys, crie as duas
        chaves e escolha o site da sua organização. Prefira uma service account
        com permissões de leitura. O teste verifica o par de chaves; permissões
        por produto e cobertura serão verificadas na Etapa 2.
      </p>
      <a
        href="https://docs.datadoghq.com/account_management/api-app-keys/"
        target="_blank"
        rel="noreferrer"
      >
        Guia oficial do Datadog
      </a>
    </>
  ),
  dynatrace: (
    <>
      <p>
        Informe a URL SaaS do ambiente, como
        https://abc12345.live.dynatrace.com, e um Environment API Token com
        escopo <code>entities.read</code>. O teste consulta entidades. A
        integração da Etapa 2 definirá as permissões adicionais de métricas,
        logs e traces. Platform Tokens/OAuth e ambientes Managed não são usados
        por este formulário.
      </p>
      <a
        href="https://docs.dynatrace.com/docs/dynatrace-api/basics/dynatrace-api-authentication"
        target="_blank"
        rel="noreferrer"
      >
        Guia oficial do Dynatrace
      </a>
    </>
  ),
};
function ConnectionDialog({
  title,
  children,
  onClose,
  busy,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="connection-editor panel"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
export function ConnectionsPanel({
  demo,
  session,
  onMap,
  canMap,
}: {
  demo: boolean;
  session: Session;
  onMap: (r?: string) => void;
  canMap: boolean;
}) {
  const repositoryCatalog = useRef<HTMLDetailsElement>(null);
  const [data, setData] = useState<ConnectionsView | null>(null),
    [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null),
    [fields, setFields] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<string[]>([]),
    [catalogProvider, setCatalogProvider] = useState<"github" | "gitlab">(
      "github",
    ),
    [next, setNext] = useState<number | null>(1),
    [search, setSearch] = useState("");
  const [editRepo, setEditRepo] = useState<{
    previous: string;
    value: string;
  } | null>(null);
  const [manual, setManual] = useState(""),
    [registeredSearch, setRegisteredSearch] = useState("");
  const [remove, setRemove] = useState<{
    provider?: Provider;
    repository?: string;
  } | null>(null);
  const manage = !demo && session.permissions.includes("connections:manage");
  async function refresh() {
    const [d, c] = await Promise.all([
      request<ConnectionsView>("connections"),
      request<Connection[]>("connections/integrations"),
    ]);
    setData(d);
    setConnections(c);
  }
  useEffect(() => {
    if (demo) return;
    let active = true;
    Promise.all([
      request<ConnectionsView>("connections"),
      request<Connection[]>("connections/integrations"),
    ])
      .then(([d, c]) => {
        if (active) {
          setData(d);
          setConnections(c);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [demo]);
  async function run(fn: () => Promise<void>) {
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
  function open(p: Provider) {
    const c = connections.find((c) => c.provider === p);
    setFields({
      kind:
        c?.kind ||
        (p === "github" ? "github-token" : p === "gitlab" ? "gitlab-token" : p),
      site: c?.site || "datadoghq.com",
      environment: c?.environment || "",
      appId: c?.appId || "",
      installationId: c?.installationId || "",
    });
    setEditing(p);
    setError("");
  }
  function field(
    name: string,
    label: string,
    secret = false,
    placeholder = "",
  ) {
    return (
      <label className="field" key={name}>
        {label}
        <input
          required
          autoComplete={secret ? "new-password" : "off"}
          type={secret ? "password" : "text"}
          value={fields[name] || ""}
          placeholder={placeholder}
          onChange={(e) => setFields({ ...fields, [name]: e.target.value })}
        />
      </label>
    );
  }
  async function save() {
    if (!editing) return;
    const kind = fields.kind;
    let credential: Record<string, string>;
    if (kind === "github-app")
      credential = {
        kind,
        appId: fields.appId,
        installationId: fields.installationId,
        privateKey: fields.privateKey,
      };
    else if (kind === "datadog")
      credential = {
        kind,
        site: fields.site,
        apiKey: fields.apiKey,
        applicationKey: fields.applicationKey,
      };
    else if (kind === "dynatrace")
      credential = {
        kind,
        environment: fields.environment,
        token: fields.token,
      };
    else credential = { kind, token: fields.token };
    await request("connections/integrations/" + editing, {
      method: "PUT",
      body: JSON.stringify({
        revision:
          connections.find((c) => c.provider === editing)?.revision || 0,
        credential,
      }),
    });
    setEditing(null);
    setFields({});
    setCatalog([]);
    setNext(1);
    await refresh();
    setNotice("Credencial salva. Use Testar conexão para conferir o acesso.");
  }
  async function browse(p: "github" | "gitlab", page: number) {
    const r = await request<{
      repositories: string[];
      nextPage: number | null;
    }>("connections/integrations/" + p + "/repositories?page=" + page);
    setCatalogProvider(p);
    setCatalog((old) =>
      page === 1 ? r.repositories : [...new Set([...old, ...r.repositories])],
    );
    setNext(r.nextPage);
    if (repositoryCatalog.current) {
      repositoryCatalog.current.open = true;
      repositoryCatalog.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
    if (page === 1 && r.repositories.length === 0) {
      setNotice("Nenhum repositório disponível com esta credencial.");
    }
  }
  async function add(repository: string) {
    await request("connections/repositories", {
      method: "POST",
      body: JSON.stringify({ repository, revision: data?.revision }),
    });
    await refresh();
    setManual("");
    setNotice("Repositório autorizado para mapeamento.");
  }
  return (
    <div className="connections-hub">
      <header className="connection-hub-heading">
        <div>
          <p className="eyebrow">INTEGRAÇÕES</p>
          <h1>Conexões</h1>
          <p>As ferramentas da sua organização, em um só lugar.</p>
        </div>
        <button
          className="button secondary"
          disabled={busy || demo}
          onClick={() => run(refresh)}
        >
          <RefreshCw size={18} /> Atualizar
        </button>
      </header>
      {demo && (
        <p className="notice">
          Modo demonstração. Entre na sua organização para configurar conexões.
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {(["code", "observability"] as const).map((category) => (
        <section
          key={category}
          aria-label={category === "code" ? "Código-fonte" : "Observabilidade"}
        >
          <h2>{category === "code" ? "Código-fonte" : "Observabilidade"}</h2>
          <p>
            {category === "code"
              ? "GitHub e GitLab podem ser usados simultaneamente."
              : "Conecte sua telemetria para avaliar a prontidão das jornadas."}
          </p>
          <div className="connection-catalog-grid">
            {(category === "code"
              ? ["github", "gitlab"]
              : ["datadog", "dynatrace"]
            ).map((raw) => {
              const p = raw as Provider,
                c = connections.find((c) => c.provider === p),
                configured = c?.revision
                  ? c.configured
                  : p === "github" && data?.githubConfigured;
              return (
                <article
                  className="panel provider-card integration-card"
                  key={p}
                >
                  <div className="provider-card-heading">
                    <ProviderLogo provider={p} />
                    <h3>{names[p]}</h3>
                    <span
                      className={`badge connection-status ${c?.needsReplacement ? "needs-attention" : configured ? "is-saved" : "is-pending"}`}
                    >
                      {c?.needsReplacement
                        ? "Substitua a credencial"
                        : configured
                          ? "Credencial salva"
                          : "A configurar"}
                    </span>
                  </div>
                  <p>
                    {p === "github"
                      ? c?.kind === "github-app"
                        ? "GitHub App · tokens temporários"
                        : "GitHub App ou token de acesso"
                      : p === "gitlab"
                        ? "Token pessoal, de grupo ou projeto"
                        : p === "datadog"
                          ? "API Key + Application Key"
                          : "Environment API Token · SaaS"}
                  </p>
                  {manage && (
                    <div className="connection-toolbar provider-primary-actions">
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => open(p)}
                      >
                        <KeyRound size={16} />
                        {configured ? "Editar credencial" : "Configurar"}
                      </button>
                      {category === "code" && configured && (
                        <button
                          className="button secondary"
                          disabled={busy || c?.needsReplacement}
                          onClick={() =>
                            run(() => browse(p as "github" | "gitlab", 1))
                          }
                        >
                          <Search size={16} /> Repositórios
                        </button>
                      )}
                    </div>
                  )}
                  <details className="provider-options">
                    <summary>
                      Orientações
                      {manage && configured ? " e opções" : " de conexão"}
                    </summary>
                    <div className="provider-guide">{guides[p]}</div>
                    {category === "observability" && (
                      <p>
                        Salvar ou testar não inicia coleta nem cria monitores.
                      </p>
                    )}
                    {manage && configured && (
                      <div className="connection-toolbar">
                        <button
                          className="button secondary"
                          disabled={busy || c?.needsReplacement}
                          onClick={() =>
                            run(async () => {
                              const r = await request<{ message: string }>(
                                "connections/integrations/" + p + "/test",
                                { method: "POST", body: "{}" },
                              );
                              setNotice(r.message);
                            })
                          }
                        >
                          Testar conexão
                        </button>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => setRemove({ provider: p })}
                        >
                          Remover conexão
                        </button>
                      </div>
                    )}
                  </details>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      {manage && (
        <details
          className="panel repo-catalog repository-discovery"
          ref={repositoryCatalog}
        >
          <summary>Adicionar repositórios</summary>
          <p>
            Consulte GitHub ou GitLab nos cartões acima e autorize os
            repositórios que poderão ser mapeados.
          </p>
          <label className="field">
            <Search size={18} /> Buscar nos resultados carregados
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Organização, subgrupo ou repositório"
            />
          </label>
          <p>
            {catalog.length} resultados carregados · {names[catalogProvider]}
          </p>
          <div className="repository-picker">
            {catalog
              .filter((r) => r.toLowerCase().includes(search.toLowerCase()))
              .map((r) => (
                <div className="provider-repository" key={r}>
                  <span>{r}</span>
                  <button
                    className="button secondary"
                    disabled={busy || data?.repositories.includes(r)}
                    onClick={() => run(() => add(r))}
                  >
                    {data?.repositories.includes(r)
                      ? "Cadastrado"
                      : "Adicionar"}
                  </button>
                </div>
              ))}
          </div>
          {catalog.length > 0 && next && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => run(() => browse(catalogProvider, next))}
            >
              Carregar mais repositórios
            </button>
          )}
          {catalog.length > 0 &&
            !catalog.some((r) =>
              r.toLowerCase().includes(search.toLowerCase()),
            ) && (
              <p>
                Nenhum resultado nesta lista. Carregue mais páginas ou informe a
                URL.
              </p>
            )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => add(manual));
            }}
          >
            <label className="field">
              Ou informe a URL do repositório
              <input
                required
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="https://gitlab.com/organizacao/grupo/repositorio"
              />
            </label>
            <button className="button secondary" disabled={busy}>
              Adicionar repositório
            </button>
          </form>
        </details>
      )}
      <section className="panel repo-catalog">
        <h2>Repositórios autorizados ({data?.repositories.length || 0})</h2>
        <label className="field">
          Buscar cadastrados
          <input
            type="search"
            value={registeredSearch}
            onChange={(e) => setRegisteredSearch(e.target.value)}
          />
        </label>
        {!data?.repositories.length && (
          <p>Adicione seu primeiro repositório para começar.</p>
        )}
        {data?.repositories
          .filter((r) =>
            r.toLowerCase().includes(registeredSearch.toLowerCase()),
          )
          .map((r) => (
            <div className="provider-repository" key={r}>
              <span>
                <b>
                  {r.startsWith("https://gitlab.com/") ? "GitLab" : "GitHub"}
                </b>{" "}
                · {r}
              </span>
              <div className="connection-toolbar">
                {manage && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await request("repositories/validate", {
                          method: "POST",
                          body: JSON.stringify({ repository: r }),
                        });
                        setNotice("Repositório e revisão validados: " + r);
                      })
                    }
                  >
                    Validar
                  </button>
                )}
                {manage && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setEditRepo({ previous: r, value: r })}
                  >
                    Editar
                  </button>
                )}
                {canMap && (
                  <button
                    className="button secondary"
                    disabled={busy || demo}
                    onClick={() => onMap(r)}
                  >
                    Mapear jornada
                  </button>
                )}
                {manage && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setRemove({ repository: r })}
                  >
                    Remover
                  </button>
                )}
              </div>
            </div>
          ))}
      </section>
      <section>
        <h2>Identidade e ambiente</h2>
        <div className="connection-catalog-grid">
          <article className="panel provider-card">
            <h3>
              <ShieldCheck /> Identidade e SSO
            </h3>
            <p>
              Microsoft Entra ID e Google conforme a configuração da
              organização.
            </p>
            <p>
              {data?.groups || 0} grupos vinculados. Gerencie os perfis em
              Equipe e acessos.
            </p>
          </article>
          <article className="panel provider-card">
            <h3>Motor AIRE</h3>
            <p>
              {data?.engineConfigured
                ? "Endereço e credencial configurados"
                : "Configuração pendente"}
            </p>
            <p>O mapeamento usa o motor da sua organização.</p>
          </article>
        </div>
      </section>
      <section>
        <h2>Próximas integrações</h2>
        <div className="connection-catalog-grid">
          <article className="panel provider-card">
            <h3>ITSM</h3>
            <p>ServiceNow · Jira</p>
            <span className="badge">Em breve</span>
          </article>
          <article className="panel provider-card">
            <h3>Comunicação</h3>
            <p>Teams · Slack</p>
            <span className="badge">Em breve</span>
          </article>
        </div>
      </section>
      {editRepo && (
        <ConnectionDialog
          title="Editar repositório"
          busy={busy}
          onClose={() => setEditRepo(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await request("connections/repositories", {
                  method: "PATCH",
                  body: JSON.stringify({
                    previousRepository: editRepo.previous,
                    repository: editRepo.value,
                    revision: data?.revision,
                  }),
                });
                setEditRepo(null);
                await refresh();
                setNotice(
                  "Repositório atualizado. O histórico anterior foi preservado.",
                );
              });
            }}
          >
            <h2>Editar repositório</h2>
            <label className="field">
              Repositório
              <input
                required
                value={editRepo.value}
                onChange={(e) =>
                  setEditRepo({ ...editRepo, value: e.target.value })
                }
              />
            </label>
            <p>
              Altera a autorização para novos mapeamentos. Jornadas existentes
              mantêm a origem registrada.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="connection-toolbar">
              <button className="button primary" disabled={busy}>
                Salvar
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setEditRepo(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </ConnectionDialog>
      )}
      {editing && (
        <ConnectionDialog
          title={"Configurar " + names[editing]}
          busy={busy}
          onClose={() => {
            setEditing(null);
            setFields({});
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(save);
            }}
          >
            <h2>Configurar {names[editing]}</h2>
            <p>
              Os segredos são protegidos por organização e não serão exibidos
              novamente. Ao substituir, informe a credencial completa.
            </p>
            {editing === "github" && (
              <label className="field">
                Autenticação
                <select
                  value={fields.kind}
                  onChange={(e) =>
                    setFields({
                      ...fields,
                      kind: e.target.value,
                      token: "",
                      privateKey: "",
                    })
                  }
                >
                  <option value="github-token">Token</option>
                  <option value="github-app">GitHub App</option>
                </select>
              </label>
            )}
            {fields.kind === "github-app" ? (
              <>
                {field("appId", "App ID ou Client ID")}
                {field("installationId", "Installation ID")}
                <label className="field">
                  Chave privada PEM
                  <textarea
                    required
                    autoComplete="off"
                    spellCheck={false}
                    value={fields.privateKey || ""}
                    onChange={(e) =>
                      setFields({ ...fields, privateKey: e.target.value })
                    }
                  />
                </label>
              </>
            ) : editing === "datadog" ? (
              <>
                <label className="field">
                  Site Datadog
                  <select
                    value={fields.site}
                    onChange={(e) =>
                      setFields({ ...fields, site: e.target.value })
                    }
                  >
                    {sites.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                {field("apiKey", "API Key", true)}
                {field("applicationKey", "Application Key", true)}
              </>
            ) : (
              <>
                {editing === "dynatrace" &&
                  field(
                    "environment",
                    "URL do ambiente",
                    false,
                    "https://abc12345.live.dynatrace.com",
                  )}
                {field("token", "Token", true)}
              </>
            )}
            {error && <p role="alert">{error}</p>}
            <div className="connection-toolbar">
              <button className="button primary" disabled={busy}>
                Salvar conexão
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setFields({});
                }}
              >
                Cancelar
              </button>
            </div>
          </form>
        </ConnectionDialog>
      )}
      {remove && (
        <ConnectionDialog
          title="Confirmar remoção"
          busy={busy}
          onClose={() => setRemove(null)}
        >
          <h2>
            Remover{" "}
            {remove.provider ? names[remove.provider] : remove.repository}?
          </h2>
          <p>
            As próximas operações que dependem deste acesso serão bloqueadas. O
            histórico das jornadas será preservado.
          </p>
          <div className="connection-toolbar">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (remove.provider)
                    await request(
                      "connections/integrations/" + remove.provider,
                      {
                        method: "DELETE",
                        body: JSON.stringify({
                          revision:
                            connections.find(
                              (c) => c.provider === remove.provider,
                            )?.revision || 0,
                        }),
                      },
                    );
                  else
                    await request("connections/repositories", {
                      method: "DELETE",
                      body: JSON.stringify({
                        repository: remove.repository,
                        revision: data?.revision,
                      }),
                    });
                  setRemove(null);
                  setCatalog([]);
                  setNext(1);
                  await refresh();
                })
              }
            >
              Confirmar remoção
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRemove(null)}
            >
              Cancelar
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </ConnectionDialog>
      )}
    </div>
  );
}

"use client";
import { useEffect, useState, useRef, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  ExternalLink,
  FileJson2,
  FileText,
  FolderGit2,
  GitBranch,
  GitFork as Github,
  Globe2,
  Layers3,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Menu,
  Moon,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  Workflow,
  X,
  CircleAlert,
  CheckCircle2,
  LogOut,
  Monitor,
  Eye,
} from "lucide-react";
import {
  defaultPolicy,
  permissions,
  statusLabels,
  type Journey,
  type Session,
  type Tier,
  type Repository,
  type RolePolicy,
  type Role,
  type Permission,
} from "@/lib/aire/types";
import {
  demoJourneys,
  demoMarkdown,
  inventoryMarkdown,
  topologyNodes,
  topologyEdges,
} from "@/lib/aire/demo";
import { CanonicalMap } from "./canonical-map";
import { normalizeRepository, journeyInputSchema } from "@/lib/aire/validation";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch("/api/console/" + path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      data.error || "Não foi possível concluir. Tente novamente.",
    );
  }
  return response.json();
}
export function download(
  name: string,
  contents: string,
  type = "text/markdown",
) {
  const href = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
const permissionLabels: Record<Permission, string> = {
  "journeys:read": "Visualizar jornadas",
  "journeys:create": "Mapear jornadas",
  "artifacts:read": "Exportar artefatos",
  "connections:read": "Visualizar conexões",
  "access:manage": "Administrar acessos",
};
const roleLabels: Record<Role, string> = {
  admin: "Administrador",
  engineer: "Engenheiro",
  viewer: "Leitor",
};
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
function Brand() {
  return (
    <img
      src="/brand/aire-logo.png"
      className="brand-logo"
      alt="AIRE by Northeia"
      width="148"
      height="49"
    />
  );
}
function IconButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function Console() {
  const [session, setSession] = useState<Session | null>(null),
    [bootError, setBootError] = useState("");
  const [journeys, setJourneys] = useState<Journey[]>([]),
    [loading, setLoading] = useState(true),
    [dataError, setDataError] = useState("");
  const [page, setPage] = useState("jornadas"),
    [selected, setSelected] = useState<Journey | null>(null),
    [wizard, setWizard] = useState(false),
    [help, setHelp] = useState(false),
    [mobile, setMobile] = useState(false),
    [toast, setToast] = useState("");
  const [theme, setTheme] = useState("light"),
    [search, setSearch] = useState(""),
    [tier, setTier] = useState("Todas"),
    [sort, setSort] = useState("recent");
  const [notifications, setNotifications] = useState(false),
    [loginPreview, setLoginPreview] = useState(false);
  const demo = session?.mode === "demo";
  const can = (p: Permission) => !!session?.permissions.includes(p);
  useEffect(() => {
    let active = true;
    request<Session>("session")
      .then((s) => {
        if (active) setSession(s);
      })
      .catch((e) => {
        if (active) setBootError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("aire-theme");
      const value =
        saved === "dark" || saved === "light"
          ? saved
          : window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
      setTheme(value);
      document.documentElement.dataset.theme = value;
    } catch {}
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    setLoading(true);
    if (session.mode === "demo") {
      setJourneys(structuredClone(demoJourneys));
      setLoading(false);
    } else if (session.permissions.includes("journeys:read"))
      request<Journey[]>("journeys")
        .then(setJourneys)
        .catch((e) => setDataError(e.message))
        .finally(() => setLoading(false));
    else setLoading(false);
  }, [session]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const update = () => {
      const p = window.location.hash.slice(1);
      if (
        [
          "jornadas",
          "conexoes",
          "acessos",
          "configuracoes",
          "visao-geral",
        ].includes(p)
      ) {
        setPage(p);
        setSelected(null);
      }
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page, selected?.id]);
  function navigate(p: string) {
    setPage(p);
    setSelected(null);
    setMobile(false);
    window.location.hash = p;
  }
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("aire-theme", next);
    } catch {}
  }
  function exported() {
    if (!can("artifacts:read")) return;
    download("aire-inventario-jornadas.md", inventoryMarkdown(journeys));
    setToast("Inventário de jornadas exportado.");
  }
  const results = journeys
    .filter(
      (j) =>
        (tier === "Todas" || j.tier === tier) &&
        `${j.name} ${j.endpoint} ${j.repository}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : b.createdAt.localeCompare(a.createdAt),
    );
  if (bootError)
    return (
      <div className="boot">
        <Brand />
        <CircleAlert size={32} />
        <h1>Não foi possível abrir o console</h1>
        <p>{bootError}</p>
        <button className="button primary" onClick={() => location.reload()}>
          <RefreshCw size={16} />
          Tentar novamente
        </button>
      </div>
    );
  if (!session)
    return (
      <div className="boot">
        <Brand />
        <LoaderCircle className="spin" />
        <p>Preparando seu workspace…</p>
      </div>
    );
  if (!session.authenticated || loginPreview)
    return (
      <Login
        session={session}
        preview={loginPreview}
        close={() => setLoginPreview(false)}
        theme={theme}
        toggleTheme={toggleTheme}
      />
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        Pular para o conteúdo
      </a>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Fechar menu"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <button
          className="brand"
          onClick={() => navigate("jornadas")}
          aria-label="AIRE, início"
        >
          <Brand />
          <span className="beta">CONSOLE</span>
        </button>
        <button
          className="workspace-switch"
          onClick={() =>
            setToast(
              "Você está no workspace " +
                session.tenant +
                ". O acesso é vinculado à sua identidade.",
            )
          }
        >
          <span className="workspace-avatar">N</span>
          <span>
            <strong>{session.tenant}</strong>
            <small>{demo ? "Workspace de demonstração" : "Organização"}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Navegação principal">
          <Nav
            icon={<LayoutDashboard />}
            label="Visão geral"
            active={page === "visao-geral"}
            onClick={() => navigate("visao-geral")}
          />
          {can("journeys:read") && (
            <Nav
              icon={<Workflow />}
              label="Jornadas"
              count={journeys.length}
              active={page === "jornadas"}
              onClick={() => navigate("jornadas")}
            />
          )}
          {can("connections:read") && (
            <Nav
              icon={<Link2 />}
              label="Conexões"
              active={page === "conexoes"}
              onClick={() => navigate("conexoes")}
            />
          )}
        </nav>
        <div className="nav-label later-label">CICLO DE CONFIABILIDADE</div>
        <nav aria-label="Próximos módulos">
          {[
            ["Observabilidade", <Activity key="a" />],
            ["SLOs e error budget", <ShieldCheck key="s" />],
            ["War rooms", <Layers3 key="l" />],
          ].map(([label, icon]) => (
            <button
              className="nav-item upcoming"
              key={String(label)}
              onClick={() =>
                setToast(`${label}: módulo previsto para uma próxima etapa.`)
              }
            >
              {icon}
              <span>{label}</span>
              <LockKeyhole size={12} />
            </button>
          ))}
        </nav>
        <div className="nav-spacer" />
        <div className="nav-label">ADMINISTRAÇÃO</div>
        <nav aria-label="Administração">
          {can("access:manage") && (
            <Nav
              icon={<Users />}
              label="Equipe e acessos"
              active={page === "acessos"}
              onClick={() => navigate("acessos")}
            />
          )}
          <Nav
            icon={<Settings2 />}
            label="Configurações"
            active={page === "configuracoes"}
            onClick={() => navigate("configuracoes")}
          />
          <Nav
            icon={<CircleHelp />}
            label="Guia do produto"
            onClick={() => setHelp(true)}
          />
        </nav>
        <div className="sidebar-foot">
          <span className="small-logo">N</span>
          <div>
            <strong>Northeia</strong>
            <small>Inteligência para confiar.</small>
          </div>
          <span className="version">v0.1</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir menu"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {selected
                ? selected.name
                : {
                    jornadas: "Jornadas",
                    conexoes: "Conexões",
                    acessos: "Equipe e acessos",
                    configuracoes: "Configurações",
                    "visao-geral": "Visão geral",
                  }[page]}
            </strong>
          </div>
          <div className="top-actions">
            {demo && (
              <button className="demo-indicator" onClick={() => setHelp(true)}>
                <span />
                Demonstração
              </button>
            )}
            <IconButton
              label={
                theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"
              }
              onClick={toggleTheme}
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </IconButton>
            <div className="notification-wrap">
              <IconButton
                label="Notificações"
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={18} />
              </IconButton>
              {notifications && (
                <div className="notification-popover">
                  <strong>Você está em dia</strong>
                  <p>
                    {demo
                      ? "Este workspace contém exemplos sintéticos para explorar o produto."
                      : "As atualizações das análises aparecem na página de cada jornada."}
                  </p>
                </div>
              )}
            </div>
            <span className="header-divider" />
            <button
              className="profile-button"
              onClick={() => navigate("configuracoes")}
              aria-label="Abrir perfil"
            >
              <span className="avatar">
                {demo ? "NL" : session.name?.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{demo ? "Northeia Lab" : session.name}</strong>
                <small>{roleLabels[session.role || "viewer"]}</small>
              </span>
              <ChevronDown size={13} />
            </button>
          </div>
        </header>
        <main id="content" className="main-content">
          {selected ? (
            <JourneyDetail
              journey={selected}
              demo={demo}
              canExport={can("artifacts:read")}
              back={() => setSelected(null)}
              notify={setToast}
              updated={(j) => {
                setSelected(j);
                setJourneys((old) => old.map((x) => (x.id === j.id ? j : x)));
              }}
            />
          ) : page === "conexoes" ? (
            <Connections
              demo={demo}
              session={session}
              onMap={() => setWizard(true)}
              canMap={can("journeys:create")}
            />
          ) : page === "acessos" ? (
            <Access
              demo={demo}
              allowed={can("access:manage")}
              notify={setToast}
            />
          ) : page === "configuracoes" ? (
            <Settings
              session={session}
              theme={theme}
              toggleTheme={toggleTheme}
              previewLogin={() => setLoginPreview(true)}
              notify={setToast}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">INTELIGÊNCIA DE CONFIABILIDADE</div>
                  <h1>
                    {page === "visao-geral"
                      ? "Seu ponto de partida."
                      : "Jornadas"}
                    {page === "jornadas" && (
                      <span className="heading-count">{journeys.length}</span>
                    )}
                  </h1>
                  <p>
                    Conheça cada serviço, dependência e caminho do seu negócio.
                  </p>
                </div>
                <div className="heading-actions">
                  {can("artifacts:read") && (
                    <button
                      className="button secondary"
                      onClick={exported}
                      disabled={!journeys.length}
                    >
                      <ArrowDownToLine size={16} />
                      Exportar inventário
                    </button>
                  )}
                  {can("journeys:create") && (
                    <button
                      className="button primary"
                      onClick={() => setWizard(true)}
                    >
                      <Plus size={18} />
                      Mapear jornada
                    </button>
                  )}
                </div>
              </div>
              {demo && (
                <div className="hero-panel">
                  <div className="hero-copy">
                    <span className="hero-kicker">
                      <span className="tiny-line" />
                      DO CÓDIGO AO CONTEXTO
                    </span>
                    <h2>
                      Enxergue a jornada.
                      <br />
                      <span>Conecte os pontos.</span>
                    </h2>
                    <p>
                      Um endpoint é só o começo. Explore o caminho
                      <br className="desktop-only" /> entre serviços,
                      tecnologias e dependências.
                    </p>
                    <button
                      onClick={() =>
                        setSelected(
                          journeys.find((j) => j.id === "demo-checkout") ||
                            demoJourneys[0],
                        )
                      }
                    >
                      Explorar jornada de exemplo <ArrowRight size={16} />
                    </button>
                  </div>
                  <div
                    className="hero-graphic"
                    aria-label="Jornada híbrida de exemplo: checkout Spring, pagamentos .NET e serviços conectados"
                  >
                    <div className="orbit orbit-one" />
                    <div className="orbit orbit-two" />
                    <div className="hero-line line-one" />
                    <div className="hero-line line-two" />
                    <div className="hero-line line-three" />
                    <div className="hero-node entry">
                      <Workflow />
                      <span>
                        Checkout<small>Spring Boot</small>
                      </span>
                      <span className="node-led" />
                    </div>
                    <div className="hero-node payment">
                      <Code2 />
                      <span>
                        Pagamentos<small>.NET / C#</small>
                      </span>
                      <span className="node-led" />
                    </div>
                    <div className="hero-node inventory">
                      <Layers3 />
                      <span>
                        Estoque<small>Spring Boot</small>
                      </span>
                      <span className="node-led" />
                    </div>
                    <span className="hero-caption">
                      <span />
                      JORNADA HÍBRIDA · EXEMPLO
                    </span>
                  </div>
                </div>
              )}
              <div className="stats-grid">
                <Stat
                  icon={<Workflow />}
                  value={
                    journeys.filter((j) => j.status === "COMPLETED").length
                  }
                  label="Jornadas mapeadas"
                  note={
                    demo ? "No workspace de exemplo" : "Análises concluídas"
                  }
                />
                <Stat
                  icon={<Code2 />}
                  value={new Set(journeys.flatMap((j) => j.stacks)).size || "—"}
                  label="Tecnologias identificadas"
                  note={
                    demo ? "Spring Boot e .NET" : "Conforme artefatos do motor"
                  }
                />
                <Stat
                  icon={<CircleAlert />}
                  value={
                    demo ? journeys.reduce((n, j) => n + (j.gaps || 0), 0) : "—"
                  }
                  label="Pontos para revisão"
                  note="Evidências que pedem contexto"
                  accent
                />
                <Stat
                  icon={<FolderGit2 />}
                  value={new Set(journeys.map((j) => j.repository)).size}
                  label="Repositórios"
                  note={
                    demo
                      ? "Fonte sintética de demonstração"
                      : "Com jornadas cadastradas"
                  }
                />
              </div>
              <div className="dashboard-grid">
                <section className="panel journeys-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Suas jornadas</h2>
                      <p>
                        {demo
                          ? "Explore os exemplos ou simule um novo mapeamento."
                          : "Acompanhe o mapeamento estrutural de ponta a ponta."}
                      </p>
                    </div>
                    <span className="panel-number">
                      {results.length}{" "}
                      {results.length === 1 ? "jornada" : "jornadas"}
                    </span>
                  </div>
                  <div className="table-toolbar">
                    <div
                      className="filter-tabs"
                      aria-label="Filtrar por criticidade"
                    >
                      {["Todas", "Gold", "Silver", "Bronze"].map((t) => (
                        <button
                          key={t}
                          className={tier === t ? "active" : ""}
                          onClick={() => setTier(t)}
                          aria-pressed={tier === t}
                        >
                          {t}
                          {t === "Todas" && <span>{journeys.length}</span>}
                        </button>
                      ))}
                    </div>
                    <div className="table-controls">
                      <label className="search-input">
                        <Search size={15} />
                        <input
                          aria-label="Buscar jornada"
                          placeholder="Buscar jornada…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                          <button
                            aria-label="Limpar busca"
                            onClick={() => setSearch("")}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </label>
                      <select
                        className="sort-select"
                        aria-label="Ordenar jornadas"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="recent">Mais recentes</option>
                        <option value="name">Nome A–Z</option>
                      </select>
                    </div>
                  </div>
                  {loading ? (
                    <div className="empty">
                      <LoaderCircle className="spin" />
                      <p>Carregando jornadas…</p>
                    </div>
                  ) : dataError ? (
                    <div className="empty">
                      <CircleAlert />
                      <p role="alert">{dataError}</p>
                      <button
                        className="button secondary"
                        onClick={() => location.reload()}
                      >
                        Tentar novamente
                      </button>
                    </div>
                  ) : !can("journeys:read") ? (
                    <div className="empty">
                      <LockKeyhole />
                      <h3>Acesso restrito</h3>
                      <p>
                        Seu perfil não possui permissão para visualizar
                        jornadas.
                      </p>
                    </div>
                  ) : results.length ? (
                    <div className="table-scroll">
                      <table className="journeys-table">
                        <thead>
                          <tr>
                            <th>Jornada / endpoint</th>
                            <th>Criticidade</th>
                            <th>Tecnologias</th>
                            <th>Status</th>
                            <th>
                              <span className="sr-only">Abrir jornada</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.map((j) => (
                            <tr key={j.id}>
                              <td>
                                <button
                                  className="journey-name"
                                  onClick={() => setSelected(j)}
                                >
                                  <span
                                    className={
                                      "journey-symbol " + j.tier.toLowerCase()
                                    }
                                  >
                                    <Workflow size={18} />
                                  </span>
                                  <span>
                                    <strong>{j.name}</strong>
                                    <code>{j.endpoint}</code>
                                  </span>
                                </button>
                              </td>
                              <td>
                                <Badge tone={j.tier.toLowerCase()}>
                                  <span className="tier-dot" />
                                  {j.tier}
                                </Badge>
                              </td>
                              <td>
                                <div className="stack-list">
                                  {j.stacks.length ? (
                                    j.stacks.map((s) => (
                                      <span className="stack-tag" key={s}>
                                        <span
                                          className={
                                            s === "Spring"
                                              ? "spring-dot"
                                              : "dotnet-dot"
                                          }
                                        />
                                        {s}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="muted">Em descoberta</span>
                                  )}
                                </div>
                              </td>
                              <td>
                                <span
                                  className={
                                    "status " +
                                    (j.status === "COMPLETED"
                                      ? "complete"
                                      : j.status === "FAILED"
                                        ? "failed"
                                        : "pending")
                                  }
                                >
                                  {j.status === "COMPLETED" ? (
                                    <CheckCircle2 size={14} />
                                  ) : j.status === "FAILED" ? (
                                    <CircleAlert size={14} />
                                  ) : (
                                    <Clock3 size={14} />
                                  )}{" "}
                                  {statusLabels[j.status]}
                                </span>
                                {j.gaps ? (
                                  <small className="row-gap">
                                    {j.gaps} para revisão
                                  </small>
                                ) : null}
                              </td>
                              <td>
                                <IconButton
                                  label={"Abrir " + j.name}
                                  onClick={() => setSelected(j)}
                                >
                                  <ArrowRight size={16} />
                                </IconButton>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty">
                      <Search size={28} />
                      <h3>
                        {search || tier !== "Todas"
                          ? "Nenhuma jornada encontrada"
                          : "Tudo começa com uma jornada"}
                      </h3>
                      <p>
                        {search || tier !== "Todas"
                          ? "Tente outro nome, endpoint ou criticidade."
                          : "Conecte seu repositório e informe o endpoint de entrada."}
                      </p>
                      {search || tier !== "Todas" ? (
                        <button
                          className="button secondary"
                          onClick={() => {
                            setSearch("");
                            setTier("Todas");
                          }}
                        >
                          Limpar filtros
                        </button>
                      ) : (
                        can("journeys:create") && (
                          <button
                            className="button primary"
                            onClick={() => setWizard(true)}
                          >
                            Mapear primeira jornada
                          </button>
                        )
                      )}
                    </div>
                  )}
                  <div className="table-footer">
                    <span>
                      <GitBranch size={13} />
                      {demo
                        ? "Dados sintéticos · nenhuma chamada de IA"
                        : "Revisões fixadas por commit"}
                    </span>
                    <span>Etapa 1 · Mapeamento estrutural</span>
                  </div>
                </section>
                <aside className="journey-aside">
                  <div className="panel cycle-panel">
                    <div className="section-eyebrow">UM CICLO CONTÍNUO</div>
                    <h3>
                      Confiabilidade começa
                      <br />
                      com contexto.
                    </h3>
                    <div className="cycle-step active">
                      <span>01</span>
                      <div>
                        <strong>Mapear a jornada</strong>
                        <p>Serviços, caminhos e evidências.</p>
                        <Badge tone="blue">Você está aqui</Badge>
                      </div>
                    </div>
                    {[
                      [
                        "02",
                        "Avaliar observabilidade",
                        "Logs, métricas, traces e alertas.",
                      ],
                      ["03", "Definir objetivos", "SLIs, SLOs e error budget."],
                      ["04", "Operar e aprender", "War room, RCA e evolução."],
                    ].map(([n, title, desc]) => (
                      <div className="cycle-step" key={n}>
                        <span>{n}</span>
                        <div>
                          <strong>{title}</strong>
                          <p>{desc}</p>
                        </div>
                      </div>
                    ))}
                    <div className="cycle-note">
                      <ShieldCheck size={16} />
                      <p>
                        A prontidão operacional será avaliada na próxima etapa.
                      </p>
                    </div>
                  </div>
                  <button className="guide-link" onClick={() => setHelp(true)}>
                    <BookOpen size={19} />
                    <span>
                      <strong>Como funciona o AIRE</strong>
                      <small>Conheça o fluxo de mapeamento</small>
                    </span>
                    <ArrowRight size={16} />
                  </button>
                </aside>
              </div>
            </>
          )}
          <footer className="main-footer">
            <span>
              AIRE <span className="muted">by Northeia</span>
            </span>
            <span>LLM interpreta. Código decide.</span>
            <span>
              <span className="footer-dot" />
              {demo ? "Ambiente de demonstração" : "Console integrado"}
            </span>
          </footer>
        </main>
      </div>
      {wizard && (
        <Wizard
          demo={demo}
          close={() => setWizard(false)}
          created={(j) => {
            setJourneys((old) => [j, ...old]);
            setWizard(false);
            setSelected(j);
            setToast(
              demo
                ? "Simulação criada. Nenhum repositório ou modelo foi acessado."
                : "Análise enviada ao motor.",
            );
          }}
        />
      )}
      {help && (
        <Modal
          title="Conheça o caminho da sua jornada"
          close={() => setHelp(false)}
        >
          <div className="guide-content">
            <Badge tone="blue">AIRE · Etapa 1</Badge>
            <p>
              O mapeamento começa pelo código e organiza as evidências para as
              próximas etapas de confiabilidade.
            </p>
            {[
              [
                "1",
                "Conecte o repositório",
                "Valide a permissão de leitura e fixe a revisão do código.",
              ],
              [
                "2",
                "Defina a jornada",
                "Informe o nome, o endpoint de entrada e a criticidade Gold, Silver ou Bronze.",
              ],
              [
                "3",
                "Revise as evidências",
                "Confira serviços, dependências e pontos que o código não permite resolver.",
              ],
              [
                "4",
                "Leve o contexto adiante",
                "Exporte o relatório e o manifesto canônico gerado pelo motor.",
              ],
            ].map(([n, t, d]) => (
              <div className="guide-step" key={n}>
                <span>{n}</span>
                <div>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              </div>
            ))}
            <div className="notice">
              <CircleAlert size={18} />
              <p>
                {demo
                  ? "Esta prévia contém dados sintéticos. Mapear uma jornada aqui simula o fluxo, sem acessar GitHub, motor ou IA."
                  : "O mapeamento estrutural não substitui validação em execução. Observabilidade e alertas pertencem à etapa 2."}
              </p>
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button aria-label="Fechar aviso" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function Nav({
  icon,
  label,
  active,
  count,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={"nav-item " + (active ? "active" : "")}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  );
}
function Stat({
  icon,
  value,
  label,
  note,
  accent,
}: {
  icon: ReactNode;
  value: number | string;
  label: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className={accent ? "stat-icon amber" : "stat-icon"}>{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,a[href],[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handle);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [close]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <IconButton label="Fechar" onClick={close}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
function Wizard({
  demo,
  close,
  created,
}: {
  demo: boolean;
  close: () => void;
  created: (j: Journey) => void;
}) {
  const [step, setStep] = useState(1),
    [repo, setRepo] = useState(
      demo ? "https://github.com/northeia-lab/commerce-demo" : "",
    ),
    [ref, setRef] = useState(""),
    [connection, setConnection] = useState<Repository | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [name, setName] = useState(""),
    [tier, setTier] = useState<Tier>("Gold"),
    [endpoint, setEndpoint] = useState(""),
    [subdir, setSubdir] = useState("");
  async function validate() {
    setError("");
    setBusy(true);
    try {
      const normalized = normalizeRepository(repo);
      if (demo) {
        if (normalized !== "northeia-lab/commerce-demo")
          throw new Error(
            "Na demonstração, use northeia-lab/commerce-demo. Repositórios reais serão validados no ambiente integrado.",
          );
        setConnection({
          repository: normalized,
          branch: ref || "main",
          revision: demoJourneys[0].revision,
          private: false,
          demo: true,
        });
      } else
        setConnection(
          await request<Repository>("repositories/validate", {
            method: "POST",
            body: JSON.stringify({
              repository: normalized,
              ...(ref ? { ref } : {}),
            }),
          }),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setError("");
    const data = {
      name,
      tier,
      endpoint,
      repository: connection?.repository,
      revision: connection?.revision,
      sourceSubdirectory: subdir,
    };
    let parsed;
    try {
      parsed = journeyInputSchema.safeParse(data);
    } catch {
      setError("Revise os campos da jornada.");
      return;
    }
    if (!parsed.success) {
      setError(
        "Informe um nome de pelo menos 3 caracteres e um endpoint válido, como POST /api/checkout. O subdiretório deve ser relativo.",
      );
      return;
    }
    setBusy(true);
    try {
      if (demo) {
        created({
          id:
            "demo-" +
            Date.now().toString(36) +
            "-" +
            Math.random().toString(36).slice(2),
          name,
          tier,
          endpoint,
          repository: connection!.repository,
          revision: connection!.revision,
          status: "COMPLETED",
          createdAt: new Date().toISOString(),
          stacks: ["Spring", ".NET"],
          demo: true,
          description: "Simulação da interface. Nenhum código foi analisado.",
        });
      } else
        created(
          await request<Journey>("journeys", {
            method: "POST",
            body: JSON.stringify(parsed.data),
          }),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Mapear uma nova jornada" close={busy ? () => {} : close} wide>
      <div className="wizard-steps">
        {["Repositório", "Jornada", "Revisão"].map((label, i) => (
          <div
            key={label}
            className={step === i + 1 ? "active" : step > i + 1 ? "done" : ""}
          >
            <span>{step > i + 1 ? <Check size={14} /> : i + 1}</span>
            {label}
          </div>
        ))}
      </div>
      <div className="wizard-body">
        {demo && (
          <div className="inline-demo">
            <Sparkles size={15} />
            Simulação com dados sintéticos. Nenhuma chamada ao motor ou à IA.
          </div>
        )}
        {step === 1 ? (
          <>
            <div className="form-title">
              <FolderGit2 />
              <h3>Onde a jornada começa?</h3>
              <p>Conecte o código que o motor vai usar como evidência.</p>
            </div>
            <label className="field">
              Repositório GitHub
              <input
                autoComplete="off"
                value={repo}
                onChange={(e) => {
                  setRepo(e.target.value);
                  setConnection(null);
                  setError("");
                }}
                placeholder="https://github.com/organizacao/repositorio"
              />
              <small>URL HTTPS ou organização/repositório.</small>
            </label>
            <label className="field">
              Branch ou commit <span className="optional">opcional</span>
              <input
                value={ref}
                onChange={(e) => {
                  setRef(e.target.value);
                  setConnection(null);
                }}
                placeholder="Branch padrão do repositório"
              />
            </label>
            <button
              className="button secondary validate-button"
              disabled={busy || !repo.trim()}
              onClick={validate}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Github size={16} />
              )}
              {busy
                ? "Validando acesso…"
                : demo
                  ? "Validar exemplo"
                  : "Validar conexão"}
            </button>
            {connection && (
              <div className="connection-success">
                <CheckCircle2 size={20} />
                <div>
                  <strong>
                    {demo ? "Exemplo disponível" : "Conexão validada"}
                  </strong>
                  <p>{connection.repository}</p>
                  <small>
                    {connection.branch} · commit{" "}
                    {connection.revision.slice(0, 7)} {demo ? "· simulado" : ""}
                  </small>
                </div>
                <Badge tone="green">{demo ? "Exemplo" : "Leitura OK"}</Badge>
              </div>
            )}
            <div className="form-note">
              <LockKeyhole size={16} />
              <p>
                O acesso usa a credencial da organização no servidor. Chaves e
                tokens nunca são solicitados neste formulário.
              </p>
            </div>
          </>
        ) : step === 2 ? (
          <>
            <div className="form-title">
              <Workflow />
              <h3>Dê contexto ao mapeamento</h3>
              <p>Defina o ponto de entrada e a importância da jornada.</p>
            </div>
            <label className="field">
              Nome da jornada
              <input
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Finalização de compra"
              />
            </label>
            <label className="field">
              Endpoint de entrada
              <input
                className="mono"
                value={endpoint}
                maxLength={500}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="POST /api/checkout"
              />
              <small>
                Informe o método HTTP e o caminho declarado no código.
              </small>
            </label>
            <fieldset className="tier-field">
              <legend>Criticidade</legend>
              <div>
                {(["Gold", "Silver", "Bronze"] as Tier[]).map((t) => (
                  <label
                    key={t}
                    className={
                      "tier-choice " +
                      t.toLowerCase() +
                      (tier === t ? " selected" : "")
                    }
                  >
                    <input
                      type="radio"
                      name="tier"
                      value={t}
                      checked={tier === t}
                      onChange={() => setTier(t)}
                    />
                    <span className="tier-dot" />
                    <strong>{t}</strong>
                    <small>
                      {t === "Gold"
                        ? "Alta criticidade"
                        : t === "Silver"
                          ? "Criticidade média"
                          : "Criticidade padrão"}
                    </small>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              Subdiretório <span className="optional">opcional</span>
              <input
                value={subdir}
                onChange={(e) => setSubdir(e.target.value)}
                placeholder="Ex.: services/checkout"
              />
              <small>Deixe vazio para considerar a raiz do repositório.</small>
            </label>
          </>
        ) : (
          <>
            <div className="form-title">
              <ShieldCheck />
              <h3>Pronto para conhecer a jornada</h3>
              <p>Confira os dados antes de iniciar.</p>
            </div>
            <dl className="review-summary">
              <dt>Jornada</dt>
              <dd>{name}</dd>
              <dt>Entrada</dt>
              <dd>
                <code>{endpoint}</code>
              </dd>
              <dt>Criticidade</dt>
              <dd>
                <Badge tone={tier.toLowerCase()}>{tier}</Badge>
              </dd>
              <dt>Repositório</dt>
              <dd>{connection?.repository}</dd>
              <dt>Commit</dt>
              <dd>
                <code>{connection?.revision.slice(0, 12)}</code>
              </dd>
              <dt>Subdiretório</dt>
              <dd>{subdir || "Raiz do repositório"}</dd>
            </dl>
            <div className="notice">
              <CircleAlert size={18} />
              <p>
                {demo
                  ? "A simulação cria uma jornada de exemplo nesta sessão. Ela não valida o código nem produz um manifesto canônico."
                  : "O código será enviado ao motor da sua organização. A análise pode aguardar a etapa de narração configurada no n8n antes de gerar os artefatos."}
              </p>
            </div>
          </>
        )}
        {error && (
          <div className="error-panel" role="alert">
            <CircleAlert size={18} />
            <div>
              <strong>{error}</strong>
              {step === 1 && (
                <ol>
                  <li>Confirme o nome e a revisão do repositório.</li>
                  <li>Libere o repositório para esta organização no AIRE.</li>
                  <li>Conceda Contents: read à credencial do GitHub.</li>
                  <li>Autorize o SSO da organização, se exigido.</li>
                </ol>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            step === 1 ? close() : (setStep(step - 1), setError(""))
          }
        >
          {step === 1 ? "Cancelar" : "Voltar"}
        </button>
        {step < 3 ? (
          <button
            className="button primary"
            disabled={
              step === 1 ? !connection : !name.trim() || !endpoint.trim()
            }
            onClick={() => {
              setError("");
              setStep(step + 1);
            }}
          >
            Continuar
            <ArrowRight size={16} />
          </button>
        ) : (
          <button className="button primary" disabled={busy} onClick={start}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Workflow size={16} />
            )}
            {busy
              ? "Enviando ao motor…"
              : demo
                ? "Simular mapeamento"
                : "Iniciar mapeamento"}
          </button>
        )}
      </div>
    </Modal>
  );
}
function JourneyDetail({
  journey: j,
  demo,
  canExport,
  back,
  notify,
  updated,
}: {
  journey: Journey;
  demo: boolean;
  canExport: boolean;
  back: () => void;
  notify: (s: string) => void;
  updated: (j: Journey) => void;
}) {
  const [tab, setTab] = useState("mapa"),
    [node, setNode] = useState(topologyNodes[0]),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [artifact, setArtifact] = useState<Record<string, unknown> | null>(null),
    [zoom, setZoom] = useState(1),
    [reviewed, setReviewed] = useState(false);
  const syntheticGraph = demo && j.id === "demo-checkout";
  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      updated(await request<Journey>("journeys/" + j.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    if (demo || j.status === "COMPLETED" || j.status === "FAILED") return;
    let active = true;
    const t = setInterval(
      () =>
        request<Journey>("journeys/" + j.id)
          .then((result) => {
            if (active) updated(result);
          })
          .catch((e) => {
            if (active) setError(e.message);
          }),
      j.status === "AWAITING_NARRATION" ? 15000 : 5000,
    );
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [demo, j.id, j.status, updated]);
  useEffect(() => {
    if (demo || j.status !== "COMPLETED" || !canExport) return;
    let active = true;
    request<Record<string, unknown>>("journeys/" + j.id + "/artifacts/manifest")
      .then((a) => {
        if (active) setArtifact(a);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [demo, j.id, j.status, canExport]);
  async function exportFile(kind: "markdown" | "manifest") {
    if (!canExport) return;
    if (demo) {
      if (kind === "manifest") {
        download(
          "aire-exemplo-interface.json",
          JSON.stringify(
            {
              documentType: "aire_ui_demo",
              synthetic: true,
              notACanonicalManifest: true,
              journey: { name: j.name, tier: j.tier, endpoint: j.endpoint },
              operationalReadiness: "NOT_ASSESSED",
            },
            null,
            2,
          ),
          "application/json",
        );
        notify("Exemplo JSON exportado. Não é um manifesto canônico do motor.");
      } else {
        download("aire-relatorio-exemplo.md", demoMarkdown(j));
        notify("Relatório de demonstração exportado.");
      }
      return;
    }
    try {
      const response = await fetch(
        "/api/console/journeys/" + j.id + "/artifacts/" + kind,
        { credentials: "same-origin" },
      );
      if (!response.ok) {
        const b = (await response.json()) as { error?: string };
        throw new Error(b.error || "Artefato indisponível.");
      }
      download(
        "aire-" + j.id + (kind === "manifest" ? ".json" : ".md"),
        await response.text(),
        kind === "manifest" ? "application/json" : "text/markdown",
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const gaps = demo
    ? j.gaps || 0
    : artifact && Array.isArray(artifact.unresolvedFacts)
      ? artifact.unresolvedFacts.length
      : undefined;
  return (
    <>
      <button className="back-button" onClick={back}>
        <ArrowLeft size={15} />
        Todas as jornadas
      </button>
      <div className="page-heading detail-heading">
        <div>
          <div className="eyebrow">MAPEAMENTO DA JORNADA</div>
          <h1>{j.name}</h1>
          <div className="detail-meta">
            <Badge tone={j.tier.toLowerCase()}>{j.tier}</Badge>
            <code>{j.endpoint}</code>
            <span
              className={
                "status " + (j.status === "COMPLETED" ? "complete" : "pending")
              }
            >
              <CheckCircle2 size={14} />
              {statusLabels[j.status]}
            </span>
          </div>
        </div>
        <div className="heading-actions">
          {!demo && (
            <button
              className="button secondary"
              onClick={refresh}
              disabled={refreshing}
            >
              <RefreshCw size={16} className={refreshing ? "spin" : ""} />
              Atualizar
            </button>
          )}
          {canExport && (
            <button
              className="button secondary"
              disabled={j.status !== "COMPLETED"}
              onClick={() => exportFile("markdown")}
            >
              <FileText size={16} />
              Relatório MD
            </button>
          )}
          {canExport && (
            <button
              className="button primary"
              disabled={j.status !== "COMPLETED"}
              onClick={() => exportFile("manifest")}
            >
              <FileJson2 size={16} />
              {demo ? "JSON de exemplo" : "JSON canônico"}
            </button>
          )}
        </div>
      </div>
      <div className="source-bar">
        <span>
          <Github size={16} />
          {j.repository}
        </span>
        <span>
          <GitBranch size={15} />
          {j.revision.slice(0, 7)}
        </span>
        <span>
          <Clock3 size={14} />
          {new Date(j.createdAt).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {demo && <Badge tone="blue">Dados sintéticos</Badge>}
      </div>
      {error && (
        <div className="error-panel" role="alert">
          <CircleAlert size={18} />
          {error}
        </div>
      )}
      {j.status !== "COMPLETED" && (
        <div className="notice analysis-state">
          <Activity size={22} />
          <div>
            <strong>{statusLabels[j.status]}</strong>
            <p>
              {j.status === "AWAITING_NARRATION"
                ? "A descoberta estrutural terminou. O motor aguarda a narração do fluxo configurado no n8n. Os artefatos ficam disponíveis após a conclusão."
                : j.status === "FAILED"
                  ? "A análise falhou. Verifique a configuração e os logs do motor antes de iniciar uma nova análise."
                  : "Acompanhe aqui a preparação e o mapeamento do código. O estado é atualizado automaticamente."}
            </p>
          </div>
        </div>
      )}
      <div
        className="detail-tabs"
        role="tablist"
        aria-label="Detalhes da jornada"
      >
        {[
          ["mapa", "Mapa da jornada", Network],
          ["evidencias", "Evidências", Code2],
          ["revisao", "Pontos para revisão", CircleAlert],
          ["artefatos", "Artefatos", FileText],
        ].map(([id, title, Icon]) => (
          <button
            key={String(id)}
            className={tab === id ? "active" : ""}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(String(id))}
          >
            {typeof Icon !== "string" && <Icon size={16} />} {String(title)}
            {id === "revisao" && gaps !== undefined && <span>{gaps}</span>}
          </button>
        ))}
      </div>
      {tab === "mapa" ? (
        <div className="detail-grid">
          <section className="panel graph-panel">
            <div className="panel-heading">
              <div>
                <h2>O caminho da jornada</h2>
                <p>
                  {syntheticGraph
                    ? "Selecione um serviço para explorar suas evidências."
                    : demo
                      ? "Contexto ilustrativo da jornada selecionada."
                      : "Contexto estrutural retornado pelo motor."}
                </p>
              </div>
              {syntheticGraph && (
                <div className="graph-controls">
                  <button
                    aria-label="Reduzir mapa"
                    onClick={() => setZoom(Math.max(0.7, zoom - 0.1))}
                  >
                    −
                  </button>
                  <button
                    onClick={() => setZoom(1)}
                    aria-label="Restaurar zoom"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    aria-label="Ampliar mapa"
                    onClick={() => setZoom(Math.min(1.3, zoom + 0.1))}
                  >
                    +
                  </button>
                </div>
              )}
            </div>
            {syntheticGraph ? (
              <>
                <div className="graph-viewport">
                  <div
                    className="graph-canvas"
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                    }}
                  >
                    <svg
                      className="graph-wires"
                      viewBox="0 0 800 360"
                      aria-hidden="true"
                    >
                      <defs>
                        <marker
                          id="arrow"
                          viewBox="0 0 10 10"
                          refX="8"
                          refY="5"
                          markerWidth="5"
                          markerHeight="5"
                          orient="auto"
                        >
                          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                        </marker>
                      </defs>
                      {topologyEdges.map(([from, to]) => {
                        const a = topologyNodes.find((n) => n.id === from)!,
                          b = topologyNodes.find((n) => n.id === to)!;
                        return (
                          <path
                            key={from + to}
                            d={`M ${a.x + 195} ${a.y + 31} C ${a.x + 235} ${a.y + 31}, ${b.x - 35} ${b.y + 31}, ${b.x} ${b.y + 31}`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            markerEnd="url(#arrow)"
                          />
                        );
                      })}
                    </svg>
                    {topologyNodes.map((n) => (
                      <button
                        style={{ left: n.x, top: n.y }}
                        key={n.id}
                        className={
                          "graph-node " + (node.id === n.id ? "selected" : "")
                        }
                        onClick={() => setNode(n)}
                      >
                        <span
                          className={
                            "node-icon " +
                            (n.stack === "Spring" ? "spring" : "dotnet")
                          }
                        >
                          <Code2 size={17} />
                        </span>
                        <span>
                          <strong>{n.label}</strong>
                          <small>
                            {n.stack} · {n.squad}
                          </small>
                        </span>
                        {n.id === "checkout" && (
                          <span className="entry-label">ENTRADA</span>
                        )}
                      </button>
                    ))}
                    <div className="graph-external">
                      <Globe2 size={15} />
                      <span>Gateway de pagamento</span>
                      <Badge tone="amber">Destino a confirmar</Badge>
                    </div>
                  </div>
                </div>
                <div className="graph-legend">
                  <span>
                    <i className="spring-dot" />
                    Spring Boot
                  </span>
                  <span>
                    <i className="dotnet-dot" />
                    .NET / C#
                  </span>
                  <span>
                    <i className="legend-line" />
                    Chamada HTTP de exemplo
                  </span>
                </div>
              </>
            ) : !demo && artifact ? (
              <CanonicalMap manifest={artifact} analysisId={j.id} />
            ) : (
              <div className="mapping-summary">
                <Network size={36} />
                <h3>
                  {demo
                    ? "Exemplo de mapeamento"
                    : artifact
                      ? "Manifesto disponível"
                      : "Aguardando o resultado estrutural"}
                </h3>
                <p>
                  {demo
                    ? "Esta jornada demonstra os estados e os artefatos da interface. O mapa interativo completo está no exemplo “Finalização de compra”."
                    : artifact
                      ? "Consulte os dados de evidência na aba Evidências ou exporte o manifesto original. A visualização gráfica de manifestos reais será expandida conforme os contratos do motor."
                      : "As evidências e os artefatos aparecerão quando o motor concluir a análise."}
                </p>
                <div className="stack-list">
                  {j.stacks.map((s) => (
                    <Badge key={s} tone="blue">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="graph-foot">
              <ShieldCheck size={15} />
              {demo
                ? "Representação sintética para demonstrar a experiência."
                : "A ausência de uma dependência no mapa não prova sua inexistência."}
            </div>
          </section>
          <aside className="panel node-panel">
            <div className="section-eyebrow">
              {syntheticGraph ? "SERVIÇO SELECIONADO" : "CONTEXTO"}
            </div>
            <div className="node-detail-icon">
              <Code2 size={24} />
            </div>
            <h3>{syntheticGraph ? node.label : j.name}</h3>
            <Badge tone="blue">{syntheticGraph ? node.stack : j.tier}</Badge>
            <p>
              {syntheticGraph
                ? node.detail
                : j.description ||
                  "Análise do repositório na revisão informada."}
            </p>
            <hr />
            <dl>
              <dt>{syntheticGraph ? "Squad" : "Repositório"}</dt>
              <dd>{syntheticGraph ? node.squad : j.repository}</dd>
              <dt>{syntheticGraph ? "Evidência de exemplo" : "Revisão"}</dt>
              <dd>
                <code>
                  {syntheticGraph ? node.evidence : j.revision.slice(0, 12)}
                </code>
              </dd>
            </dl>
            <div className="node-note">
              <Eye size={16} />
              <p>
                {demo
                  ? "Evidência ilustrativa. Não corresponde a um arquivo consultado."
                  : "Verifique limitações e fatos não resolvidos no manifesto."}
              </p>
            </div>
          </aside>
        </div>
      ) : tab === "evidencias" ? (
        <section className="panel evidence-panel">
          <div className="panel-heading">
            <div>
              <h2>Evidências do mapeamento</h2>
              <p>
                {demo
                  ? "Referências sintéticas usadas no exemplo visual."
                  : "Dados originais do manifesto retornado pelo motor."}
              </p>
            </div>
            <Badge tone="blue">{demo ? "Exemplo" : "Fonte: motor"}</Badge>
          </div>
          {syntheticGraph ? (
            topologyNodes.map((n, i) => (
              <div className="evidence-row" key={n.id}>
                <span className="evidence-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{n.label}</strong>
                  <p>{n.detail}</p>
                  <code>{n.evidence}</code>
                </div>
                <Badge>{n.stack}</Badge>
              </div>
            ))
          ) : artifact ? (
            <pre className="code-preview">
              {JSON.stringify(artifact.evidence || artifact, null, 2)}
            </pre>
          ) : (
            <div className="empty">
              <FileText />
              <h3>
                {demo
                  ? "Sem evidências reais neste exemplo"
                  : "Evidências ainda indisponíveis"}
              </h3>
              <p>
                {demo
                  ? "Abra Finalização de compra para explorar o exemplo detalhado."
                  : "Aguarde a conclusão e confirme sua permissão para acessar artefatos."}
              </p>
            </div>
          )}
        </section>
      ) : tab === "revisao" ? (
        <section className="panel review-panel">
          <div className="panel-heading">
            <div>
              <h2>O que ainda precisa de contexto</h2>
              <p>
                As incertezas ficam explícitas para orientar a revisão humana.
              </p>
            </div>
          </div>
          {demo && gaps ? (
            <>
              <div className="review-item">
                <CircleAlert size={22} />
                <div>
                  <h3>Destino do provedor de pagamento</h3>
                  <p>
                    O endereço é resolvido por configuração em execução.
                    Confirme o provedor e o ambiente.
                  </p>
                  <code>PaymentGateway:BaseUrl · exemplo sintético</code>
                </div>
                <Badge tone="amber">A confirmar</Badge>
              </div>
              {gaps > 1 && (
                <div className="review-item">
                  <CircleAlert size={22} />
                  <div>
                    <h3>Consumidor do evento de confirmação</h3>
                    <p>
                      A associação entre a publicação e o consumidor depende de
                      configuração externa.
                    </p>
                    <code>order.confirmed · exemplo sintético</code>
                  </div>
                  <Badge tone="amber">A confirmar</Badge>
                </div>
              )}
              <label className="review-check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                <span>
                  Marcar como revisado nesta demonstração{" "}
                  <small>Não aprova mudanças nem altera o manifesto.</small>
                </span>
              </label>
            </>
          ) : artifact ? (
            <pre className="code-preview">
              {JSON.stringify(
                {
                  limitations: artifact.limitations,
                  unresolvedFacts: artifact.unresolvedFacts,
                  warnings: artifact.warnings,
                },
                null,
                2,
              )}
            </pre>
          ) : (
            <div className="empty">
              <CheckCheck size={30} />
              <h3>
                {demo
                  ? "Nenhuma pendência no exemplo"
                  : "Revisão disponível após a análise"}
              </h3>
              <p>
                {demo
                  ? "Isso não constitui validação de prontidão operacional."
                  : "Os fatos não resolvidos serão preservados no manifesto."}
              </p>
            </div>
          )}
        </section>
      ) : (
        <section className="panel artifacts-panel">
          <div className="panel-heading">
            <div>
              <h2>Contexto pronto para a próxima etapa</h2>
              <p>Exporte a documentação e preserve as evidências da análise.</p>
            </div>
          </div>
          <div className="artifact-grid">
            {[
              [
                "markdown",
                "Relatório da jornada",
                "Documento Markdown para revisar o contexto e registrar o aceite.",
                FileText,
              ],
              [
                "manifest",
                demo ? "JSON de demonstração" : "Manifesto canônico",
                "Estrutura de dados para continuidade da jornada nas próximas etapas.",
                FileJson2,
              ],
            ].map(([kind, title, desc, Icon]) => (
              <div className="artifact-card" key={String(kind)}>
                {typeof Icon !== "string" && <Icon size={30} />}
                <h3>{String(title)}</h3>
                <p>{String(desc)}</p>
                <button
                  className="button secondary"
                  disabled={!canExport || j.status !== "COMPLETED"}
                  onClick={() => exportFile(kind as "markdown" | "manifest")}
                >
                  <ArrowDownToLine size={15} />
                  Exportar {kind === "manifest" ? "JSON" : "MD"}
                </button>
              </div>
            ))}
          </div>
          <div className="notice">
            <ShieldCheck size={18} />
            <p>
              Prontidão operacional: <strong>não avaliada</strong>. O mapeamento
              desta etapa não atesta cobertura de logs, traces, métricas ou
              alertas.
            </p>
          </div>
        </section>
      )}
    </>
  );
}
function Connections({
  demo,
  session,
  onMap,
  canMap,
}: {
  demo: boolean;
  session: Session;
  onMap: () => void;
  canMap: boolean;
}) {
  const [data, setData] = useState<{
      repositories: string[];
      githubConfigured: boolean;
      engineConfigured: boolean;
      groups: number;
    } | null>(
      demo
        ? {
            repositories: ["northeia-lab/commerce-demo"],
            githubConfigured: false,
            engineConfigured: false,
            groups: 0,
          }
        : null,
    ),
    [error, setError] = useState(""),
    [guide, setGuide] = useState(false);
  useEffect(() => {
    if (!demo)
      request<typeof data>("connections")
        .then(setData)
        .catch((e) => setError(e.message));
  }, [demo]);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">INTEGRAÇÕES</div>
          <h1>Conexões</h1>
          <p>As fontes de contexto da sua organização, em um só lugar.</p>
        </div>
        <button className="button secondary" onClick={() => setGuide(true)}>
          <BookOpen size={16} />
          Guia de conexão
        </button>
      </div>
      {error && (
        <div className="error-panel" role="alert">
          {error}
        </div>
      )}
      <div className="integration-grid">
        <Integration
          icon={<Github size={27} />}
          name="GitHub"
          description="Código-fonte e revisões das suas jornadas."
          status={
            demo
              ? "Demonstração"
              : data?.githubConfigured
                ? "Configurado"
                : "A configurar"
          }
        >
          <p>
            O acesso é restrito aos repositórios autorizados para este
            workspace.
          </p>
          {data?.repositories.map((r) => (
            <div className="repo-line" key={r}>
              <FolderGit2 size={16} />
              <span>{r}</span>
              <LockKeyhole size={13} />
            </div>
          ))}
          {canMap && (
            <button className="button secondary" onClick={onMap}>
              Validar um repositório
              <ArrowRight size={15} />
            </button>
          )}
        </Integration>
        <Integration
          icon={<Network size={27} />}
          name="Motor AIRE"
          description="Descoberta estrutural e geração de artefatos."
          status={
            demo
              ? "Demonstração"
              : data?.engineConfigured
                ? "Configurado"
                : "A configurar"
          }
        >
          <p>
            Comunicação pelo servidor, com credencial exclusiva da organização.
            A narração continua no fluxo integrado ao motor.
          </p>
          <div className="capability">
            <Check size={15} />
            Spring Boot
          </div>
          <div className="capability">
            <Check size={15} />
            .NET / C#
          </div>
        </Integration>
        <Integration
          icon={<ShieldCheck size={27} />}
          name="Identidade e SSO"
          description="Acesso com a identidade corporativa."
          status={
            demo
              ? "Prévia"
              : session.providers.google || session.providers.microsoft
                ? "Configurado"
                : "A configurar"
          }
        >
          <div className="provider-line">
            <MicrosoftIcon />
            Microsoft Entra ID
            <Badge>
              {session.providers.microsoft ? "Configurado" : "Pendente"}
            </Badge>
          </div>
          <div className="provider-line">
            <GoogleIcon />
            Google
            <Badge>
              {session.providers.google ? "Configurado" : "Pendente"}
            </Badge>
          </div>
          <p>
            O vínculo à organização usa o identificador do usuário. Grupos do
            Entra podem atribuir perfis.
          </p>
        </Integration>
      </div>
      <div className="notice">
        <LockKeyhole size={18} />
        <p>
          {demo
            ? "As conexões desta prévia são ilustrativas. Nenhuma credencial real está disponível neste ambiente."
            : "“Configurado” indica presença da configuração. A validação do repositório confirma o acesso efetivo ao GitHub."}
        </p>
      </div>
      {guide && (
        <Modal title="Conectar o GitHub" close={() => setGuide(false)}>
          <div className="guide-content">
            <p>
              O administrador configura a credencial no servidor. Não cole
              tokens na interface nem no repositório.
            </p>
            {[
              [
                "1",
                "Autorize o repositório",
                "Inclua organização/repositório na lista do workspace.",
              ],
              [
                "2",
                "Configure a credencial",
                "Use uma credencial com Contents: read somente nos repositórios necessários.",
              ],
              [
                "3",
                "Libere o SSO",
                "Se a organização exige SSO, autorize a credencial para ela.",
              ],
              [
                "4",
                "Valide a conexão",
                "Abra Mapear jornada e valide a leitura da branch ou commit.",
              ],
            ].map(([n, t, d]) => (
              <div className="guide-step" key={n}>
                <span>{n}</span>
                <div>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
function Integration({
  icon,
  name,
  description,
  status,
  children,
}: {
  icon: ReactNode;
  name: string;
  description: string;
  status: string;
  children: ReactNode;
}) {
  return (
    <section className="panel integration-card">
      <div className="integration-top">
        <span>{icon}</span>
        <Badge tone={status === "Configurado" ? "green" : "blue"}>
          {status}
        </Badge>
      </div>
      <h2>{name}</h2>
      <p className="integration-description">{description}</p>
      <hr />
      {children}
    </section>
  );
}
function Access({
  demo,
  allowed,
  notify,
}: {
  demo: boolean;
  allowed: boolean;
  notify: (s: string) => void;
}) {
  const [policy, setPolicy] = useState<RolePolicy>(
      structuredClone(defaultPolicy),
    ),
    [saved, setSaved] = useState<RolePolicy>(structuredClone(defaultPolicy)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [groups, setGroups] = useState<{ id: string; role: Role }[]>([]),
    [members, setMembers] = useState<
      { provider: string; subject: string; role: Role }[]
    >([]),
    [loading, setLoading] = useState(!demo);
  useEffect(() => {
    if (!demo && allowed)
      request<{
        policy: RolePolicy;
        groups: typeof groups;
        members: typeof members;
      }>("access")
        .then((d) => {
          setPolicy(d.policy);
          setSaved(d.policy);
          setGroups(d.groups);
          setMembers(d.members);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
  }, [demo, allowed]);
  if (!allowed)
    return (
      <div className="empty">
        <LockKeyhole />
        <h1>Acesso restrito</h1>
        <p>Somente administradores podem alterar permissões.</p>
      </div>
    );
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (!demo)
        await request("access", {
          method: "PUT",
          body: JSON.stringify(policy),
        });
      setSaved(structuredClone(policy));
      notify(
        demo
          ? "Permissões simuladas nesta tela. Nenhuma autorização real foi alterada."
          : "Permissões salvas. Aplicadas no servidor na próxima solicitação.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMINISTRAÇÃO</div>
          <h1>Equipe e acessos</h1>
          <p>O contexto certo, para as pessoas certas.</p>
        </div>
        <button
          className="button primary"
          disabled={
            busy || loading || JSON.stringify(policy) === JSON.stringify(saved)
          }
          onClick={save}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Check size={16} />
          )}
          Salvar permissões
        </button>
      </div>
      {error && (
        <div className="error-panel" role="alert">
          {error}
        </div>
      )}
      <div className="panel access-panel">
        <div className="panel-heading">
          <div>
            <h2>Permissões por perfil</h2>
            <p>
              {demo
                ? "Explore o controle de acesso na demonstração."
                : "As mesmas permissões são verificadas na interface e no servidor."}
            </p>
          </div>
          <Badge tone="blue">RBAC</Badge>
        </div>
        <div className="table-scroll">
          <table className="permissions-table">
            <thead>
              <tr>
                <th>Tela / ação</th>
                {(["admin", "engineer", "viewer"] as Role[]).map((r) => (
                  <th key={r}>{roleLabels[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissions.map((p) => (
                <tr key={p}>
                  <td>{permissionLabels[p]}</td>
                  {(["admin", "engineer", "viewer"] as Role[]).map((r) => (
                    <td key={r}>
                      <input
                        type="checkbox"
                        aria-label={roleLabels[r] + ": " + permissionLabels[p]}
                        checked={policy[r].includes(p)}
                        disabled={r === "admin" || busy || loading}
                        onChange={(e) =>
                          setPolicy({
                            ...policy,
                            [r]: e.target.checked
                              ? [...policy[r], p]
                              : policy[r].filter((x) => x !== p),
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>
            <LockKeyhole size={14} />O perfil administrador mantém todas as
            permissões.
          </span>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel settings-card">
          <Users size={23} />
          <h2>Vínculos da organização</h2>
          <p>
            Usuários são associados por provedor e identificador imutável. O
            domínio do e-mail, sozinho, não libera acesso.
          </p>
          {members.length ? (
            members.map((m, i) => (
              <div className="member-row" key={i}>
                <span>
                  {m.provider}
                  <small>{m.subject}</small>
                </span>
                <Badge>{roleLabels[m.role]}</Badge>
              </div>
            ))
          ) : (
            <div className="subtle-empty">
              {demo
                ? "Nenhum usuário real nesta demonstração."
                : "Os vínculos são administrados na configuração do servidor."}
            </div>
          )}
        </section>
        <section className="panel settings-card">
          <ShieldCheck size={23} />
          <h2>Grupos do Microsoft Entra ID</h2>
          <p>
            Associe IDs de grupos corporativos a perfis da organização. A
            aplicação usa as informações verificadas no login.
          </p>
          {groups.length ? (
            groups.map((g) => (
              <div className="member-row" key={g.id}>
                <code>{g.id}</code>
                <Badge>{roleLabels[g.role]}</Badge>
              </div>
            ))
          ) : (
            <div className="subtle-empty">Nenhum grupo configurado.</div>
          )}
          <small className="muted">
            Vínculos de identidade e grupos são configurados no servidor nesta
            versão.
          </small>
        </section>
      </div>
    </>
  );
}
function Settings({
  session,
  theme,
  toggleTheme,
  previewLogin,
  notify,
}: {
  session: Session;
  theme: string;
  toggleTheme: () => void;
  previewLogin: () => void;
  notify: (s: string) => void;
}) {
  const [signingOut, setSigningOut] = useState(false);
  async function logout() {
    setSigningOut(true);
    try {
      const r = await fetch("/api/console/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!r.ok) throw new Error();
      location.reload();
    } catch {
      notify("Não foi possível encerrar a sessão. Tente novamente.");
      setSigningOut(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PREFERÊNCIAS</div>
          <h1>Seu workspace</h1>
          <p>Personalize sua experiência e confira o ambiente.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel settings-card">
          <Monitor size={24} />
          <h2>Aparência</h2>
          <p>O tema acompanha você neste navegador.</p>
          <div className="theme-preview">
            <div
              className={
                "theme-swatch light " + (theme === "light" ? "chosen" : "")
              }
            >
              <span />
              <span />
              <span />
              <strong>Claro</strong>
            </div>
            <div
              className={
                "theme-swatch dark " + (theme === "dark" ? "chosen" : "")
              }
            >
              <span />
              <span />
              <span />
              <strong>Escuro</strong>
            </div>
          </div>
          <button className="button secondary" onClick={toggleTheme}>
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}Usar
            tema {theme === "light" ? "escuro" : "claro"}
          </button>
        </section>
        <section className="panel settings-card">
          <ShieldCheck size={24} />
          <h2>Identidade</h2>
          <p>Acesso federado com Microsoft Entra ID e Google.</p>
          <div className="provider-line">
            <MicrosoftIcon />
            Microsoft
            <Badge>
              {session.providers.microsoft ? "Configurado" : "Pendente"}
            </Badge>
          </div>
          <div className="provider-line">
            <GoogleIcon />
            Google
            <Badge>
              {session.providers.google ? "Configurado" : "Pendente"}
            </Badge>
          </div>
          {session.mode === "demo" ? (
            <button className="button secondary" onClick={previewLogin}>
              <Eye size={16} />
              Conhecer a tela de login
            </button>
          ) : (
            <button
              className="button secondary"
              onClick={logout}
              disabled={signingOut}
            >
              <LogOut size={16} />
              Encerrar sessão
            </button>
          )}
        </section>
        <section className="panel settings-card">
          <Globe2 size={24} />
          <h2>Ambiente</h2>
          <dl>
            <dt>Organização</dt>
            <dd>{session.tenant}</dd>
            <dt>Modo</dt>
            <dd>
              {session.mode === "demo"
                ? "Demonstração com dados sintéticos"
                : "Integrado ao servidor"}
            </dd>
            <dt>Seu perfil</dt>
            <dd>{roleLabels[session.role || "viewer"]}</dd>
            <dt>Implantação planejada</dt>
            <dd>Ubuntu 24.04 · Docker ou k3s</dd>
          </dl>
          <p>O domínio de produção será definido na implantação.</p>
        </section>
        <section className="panel settings-card">
          <Network size={24} />
          <h2>Uma base para todo o ciclo</h2>
          <p>
            Este console começa pelo mapeamento de jornadas. Observabilidade,
            SLOs, war rooms e aprendizagem contínua serão incorporados nas
            próximas etapas.
          </p>
          <div className="product-principle">
            LLM interpreta.
            <br />
            <strong>Código decide.</strong>
          </div>
          <small className="muted">AIRE by Northeia · v0.1</small>
        </section>
      </div>
    </>
  );
}
function MicrosoftIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" aria-hidden="true">
      <path fill="#f25022" d="M0 0h9v9H0z" />
      <path fill="#7fba00" d="M11 0h9v9h-9z" />
      <path fill="#00a4ef" d="M0 11h9v9H0z" />
      <path fill="#ffb900" d="M11 11h9v9h-9z" />
    </svg>
  );
}
function GoogleIcon() {
  return (
    <span className="google-icon" aria-hidden="true">
      G
    </span>
  );
}
function Login({
  session,
  preview,
  close,
  theme,
  toggleTheme,
}: {
  session: Session;
  preview: boolean;
  close: () => void;
  theme: string;
  toggleTheme: () => void;
}) {
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (new URLSearchParams(location.search).has("auth_error"))
      setMessage(
        "Não foi possível concluir o acesso. Confira a vinculação do seu usuário à organização e tente novamente.",
      );
  }, []);
  function login(provider: "google" | "microsoft") {
    if (preview || !session.providers[provider]) {
      setMessage(
        preview
          ? "Esta é a prévia da tela de login. Configure os provedores no ambiente de produção para autenticar."
          : "Este provedor ainda não foi configurado. Solicite a configuração ao administrador.",
      );
      return;
    }
    location.href = "/auth/" + provider;
  }
  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="login-brand">
          <Brand />
        </div>
        <div>
          <div className="hero-kicker">AI RELIABILITY PLATFORM</div>
          <h1>
            Contexto para decidir.
            <br />
            <span>Confiança para evoluir.</span>
          </h1>
          <p>
            Conecte o código à jornada do seu negócio.
            <br />
            Construa confiabilidade, uma evidência por vez.
          </p>
          <div className="login-network">
            <Network size={100} strokeWidth={0.65} />
            <span>Spring Boot</span>
            <span>.NET / C#</span>
          </div>
        </div>
        <small>AIRE by Northeia</small>
      </div>
      <div className="login-form-side">
        <div className="login-top">
          {preview && (
            <button className="back-button" onClick={close}>
              <ArrowLeft size={15} />
              Voltar à demonstração
            </button>
          )}
          <IconButton label="Alternar tema" onClick={toggleTheme}>
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </IconButton>
        </div>
        <div className="login-form">
          <div className="eyebrow">BEM-VINDO AO AIRE</div>
          <h2>Acesse seu workspace</h2>
          <p>Continue com sua identidade corporativa.</p>
          <button className="sso-button" onClick={() => login("microsoft")}>
            <MicrosoftIcon />
            Continuar com Microsoft
            <ArrowRight size={16} />
          </button>
          <button className="sso-button" onClick={() => login("google")}>
            <GoogleIcon />
            Continuar com Google
            <ArrowRight size={16} />
          </button>
          {message && (
            <div className="error-panel" role="alert">
              {message}
            </div>
          )}
          <div className="login-security">
            <LockKeyhole size={17} />
            <p>
              Seu acesso é definido pela organização.
              <br />
              Cada workspace mantém seu próprio contexto.
            </p>
          </div>
          {preview && (
            <Badge tone="blue">Prévia · autenticação não executada</Badge>
          )}
        </div>
        <div className="login-footer">
          Inteligência aplicada à confiabilidade.
        </div>
      </div>
    </div>
  );
}

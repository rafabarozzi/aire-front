"use client";
import { useEffect, useState, type FormEvent } from "react";
type Config = {
  provider: "microsoft" | "google";
  microsoftTenantId?: string;
  googleDomain?: string;
  adminGroup?: string;
  engineerGroup?: string;
  viewerGroup?: string;
};
type Session = {
  organization: string;
  name: string;
  email: string;
  config?: Config;
  configRevision: number;
  verified: null | { name: string; provider: string; subject: string };
  callback: string;
  portal?: string;
};
async function api<T>(
  action: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(`/api/onboarding/${action}`, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(data.error || "Não foi possível continuar.");
  return data;
}
function PasswordField({
  confirm = false,
  creating = false,
}: {
  confirm?: boolean;
  creating?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = confirm ? "setup-confirm" : "setup-password";
  return (
    <div className="field">
      <label htmlFor={id}>
        {confirm ? "Confirme a senha" : creating ? "Crie sua senha" : "Senha"}
      </label>
      <div className="setup-password">
        <input
          id={id}
          type={visible ? "text" : "password"}
          name={confirm ? "confirm" : "password"}
          autoComplete={creating ? "new-password" : "current-password"}
          minLength={15}
          maxLength={128}
          required
        />
        <button
          type="button"
          aria-controls={id}
          aria-pressed={visible}
          aria-label={`${visible ? "Ocultar" : "Exibir"} ${confirm ? "confirmação da senha" : "senha"}`}
          onClick={() => setVisible(!visible)}
        >
          {visible ? "Ocultar" : "Exibir"}
        </button>
      </div>
      {!confirm && (
        <small>
          Use de 15 a 128 caracteres. Você pode usar uma frase como senha.
        </small>
      )}
    </div>
  );
}
export function OnboardingConsole() {
  const [session, setSession] = useState<Session | null>(null),
    [organization, setOrganization] = useState(""),
    [invite, setInvite] = useState(""),
    [provider, setProvider] = useState<Config["provider"]>("microsoft"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [done, setDone] = useState(false),
    [dark, setDark] = useState(false),
    [dirty, setDirty] = useState(false);
  async function load() {
    const s = await api<Session>("session");
    setSession(s);
    setProvider(s.config?.provider || "microsoft");
    setDirty(false);
  }
  useEffect(() => {
    setDark(localStorage.getItem("aire-theme") === "dark");
    const u = new URL(location.href);
    setOrganization(u.searchParams.get("organization") || "");
    setInvite(new URLSearchParams(u.hash.slice(1)).get("invite") || "");
    if (u.hash) {
      u.hash = "";
      history.replaceState(null, "", u.pathname + u.search);
    }
    if (u.searchParams.get("test") === "failed")
      setError(
        "O teste SSO não foi concluído. Confira o diretório, o consentimento do aplicativo, os endereços de retorno e a participação no grupo administrador. Salve e tente novamente.",
      );
    load()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  async function run(action: () => Promise<void>) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível continuar.");
    } finally {
      setBusy(false);
    }
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(async () => {
      const password = String(f.get("password"));
      if (invite && password !== f.get("confirm"))
        throw new Error("As senhas precisam ser iguais.");
      await api(invite ? "activate" : "login", "POST", {
        organization,
        username: f.get("username"),
        password,
        ...(invite ? { invite } : {}),
      });
      setInvite("");
      await load();
    });
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(async () => {
      const config: Config = { provider };
      for (const key of provider === "microsoft"
        ? ([
            "microsoftTenantId",
            "adminGroup",
            "engineerGroup",
            "viewerGroup",
          ] as const)
        : (["googleDomain"] as const)) {
        const v = String(f.get(key) || "").trim();
        if (v) config[key] = v;
      }
      await api("config", "PUT", { revision: session!.configRevision, config });
      await load();
      setMessage(
        "Configuração salva. Agora teste o login com a conta corporativa que administrará esta organização.",
      );
    });
  }
  return (
    <main className="setup-page">
      <header>
        <strong>
          AIRE <small>by Northeia</small>
        </strong>
        <button
          className="button secondary"
          onClick={() => {
            setDark(!dark);
            localStorage.setItem("aire-theme", !dark ? "dark" : "light");
          }}
        >
          {dark ? "Tema claro" : "Tema escuro"}
        </button>
      </header>
      <section className="panel setup-card">
        <p className="setup-eyebrow">Boas-vindas à sua organização</p>
        <h1>
          {done
            ? "SSO configurado"
            : session
              ? `Configure o acesso da ${session.name}`
              : invite
                ? "Crie seu acesso de configuração"
                : "Acesso de configuração"}
        </h1>
        <p>
          Este acesso temporário permite somente configurar o Single Sign-On da
          sua organização.
        </p>
        {error && (
          <div role="alert" className="setup-alert">
            {error}
          </div>
        )}
        {message && <p role="status">{message}</p>}
        {loading ? (
          <p role="status">Carregando…</p>
        ) : done ? (
          <>
            <p>
              O login corporativo foi validado e o acesso local foi encerrado. A
              equipe Northeia concluirá a ativação do ambiente antes do primeiro
              mapeamento.
            </p>
            <a className="button secondary" href="/">
              Voltar ao início
            </a>
          </>
        ) : !session ? (
          <form onSubmit={login} className="setup-form">
            {!invite && (
              <p>
                Primeiro acesso? Abra o convite recebido por e-mail para criar
                sua senha. Se já criou seu acesso, entre abaixo para continuar a
                configuração do SSO.
              </p>
            )}
            {invite && (
              <button
                type="button"
                className="button secondary"
                onClick={() => setInvite("")}
              >
                Já criei meu acesso — retomar configuração
              </button>
            )}
            <label className="field">
              Organização
              <input
                required
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                pattern="[a-z0-9][a-z0-9-]{0,63}"
                readOnly={!!invite}
              />
            </label>
            <label className="field">
              E-mail que recebeu o convite
              <input
                type="email"
                name="username"
                autoComplete="username"
                required
              />
            </label>
            <PasswordField creating={!!invite} />
            {invite && <PasswordField confirm creating />}
            <button disabled={busy} className="button primary">
              {busy
                ? "Aguarde…"
                : invite
                  ? "Criar acesso e configurar SSO"
                  : "Entrar"}
            </button>
            <p>
              Convite válido por 24 horas. Acesso local disponível por até 7
              dias. Se expirar ou você perder a senha, solicite um novo convite
              à Northeia.
            </p>
          </form>
        ) : (
          <>
            <ol className="setup-steps">
              <li>Configure o provedor</li>
              <li>Teste o login corporativo</li>
              <li>Confirme o administrador</li>
            </ol>
            <form
              key={session.configRevision}
              onSubmit={save}
              onChange={() => setDirty(true)}
              className="setup-form"
            >
              <label className="field">
                Provedor
                <select
                  value={provider}
                  onChange={(e) =>
                    setProvider(e.target.value as Config["provider"])
                  }
                >
                  <option value="microsoft">Microsoft Entra ID</option>
                  <option value="google">Google Workspace</option>
                </select>
              </label>
              {provider === "microsoft" ? (
                <>
                  <label className="field">
                    Tenant ID do Microsoft Entra
                    <input
                      required
                      name="microsoftTenantId"
                      defaultValue={session.config?.microsoftTenantId}
                      placeholder="UUID do diretório da sua empresa"
                    />
                  </label>
                  <p>
                    Use o diretório corporativo que já possui seu domínio. No
                    Entra, autorize o aplicativo AIRE. A Northeia deve
                    configurar esse aplicativo para aceitar contas de outras
                    organizações.
                  </p>
                  {(["admin", "engineer", "viewer"] as const).map((role) => (
                    <label className="field" key={role}>
                      Grupo Microsoft — {role} (opcional)
                      <input
                        name={`${role}Group`}
                        defaultValue={session.config?.[`${role}Group`]}
                        placeholder="Object ID do grupo"
                      />
                    </label>
                  ))}
                  <p>
                    Para usar grupos, solicite que o aplicativo inclua os grupos
                    de segurança no ID token. O usuário do teste deve pertencer
                    ao grupo administrador informado.
                  </p>
                </>
              ) : (
                <label className="field">
                  Domínio Google Workspace
                  <input
                    required
                    name="googleDomain"
                    defaultValue={session.config?.googleDomain}
                    placeholder="empresa.com.br"
                  />
                </label>
              )}
              <details>
                <summary>
                  Endereços de retorno e preparação do aplicativo
                </summary>
                <p>
                  A equipe responsável pelo aplicativo deve cadastrar estes
                  endereços exatamente, como plataforma Web:
                </p>
                <p>Teste de configuração:</p>
                <code>
                  {session.callback}
                  {provider}
                </code>
                <p>Login do portal após a ativação:</p>
                <code>
                  {session.portal
                    ? `${session.portal}/auth/${provider}`
                    : "O domínio do portal ainda será definido pela Northeia."}
                </code>
                <p>
                  Não cole chaves ou segredos neste formulário. As credenciais
                  do aplicativo são gerenciadas no servidor pela Northeia.
                </p>
              </details>
              <button disabled={busy} className="button primary">
                {busy ? "Salvando…" : "Salvar configuração"}
              </button>
            </form>
            <section className="setup-stage">
              <h2>Teste o login corporativo</h2>
              <p>
                Escolha a conta corporativa que será administradora. O teste
                valida a identidade e o grupo, quando informado.
              </p>
              <button
                className="button secondary"
                disabled={busy || dirty || !session.config}
                onClick={() =>
                  location.assign(
                    `/onboarding/auth/${session.config!.provider}`,
                  )
                }
              >
                Testar SSO
              </button>
              {dirty && <p>Salve as alterações antes do teste.</p>}
            </section>
            {session.verified && !dirty && (
              <form
                className="setup-stage"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    await api("complete", "POST", { confirm: true });
                    setSession(null);
                    setDone(true);
                  });
                }}
              >
                <h2>Confirme a administração</h2>
                <p>
                  Identidade validada: <strong>{session.verified.name}</strong>
                </p>
                <p>
                  {session.config?.adminGroup
                    ? "O grupo administrador configurado receberá acesso administrativo ao portal do cliente."
                    : "Esta identidade será cadastrada como a primeira administradora do portal do cliente."}
                </p>
                <label>
                  <input type="checkbox" required /> Confirmo o administrador e
                  o encerramento do meu acesso local.
                </label>
                <p>
                  <button className="button primary" disabled={busy}>
                    Concluir configuração
                  </button>
                </p>
              </form>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("logout", "POST");
                  setOrganization(session.organization);
                  setSession(null);
                })
              }
            >
              Sair da configuração
            </button>
          </>
        )}
      </section>
      <footer>AIRE by Northeia</footer>
    </main>
  );
}

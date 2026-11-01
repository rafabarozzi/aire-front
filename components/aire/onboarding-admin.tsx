"use client";
import { useEffect, useState } from "react";
import { request } from "@/lib/aire/client";
type Status = {
  status: string;
  email?: string;
  delivery?: string;
  inviteExpires?: number;
};
const labels: Record<string, string> = {
  not_invited: "Ainda não convidado",
  invited: "Aguardando criação do acesso",
  configuring: "SSO em configuração",
  completed: "SSO configurado",
  revoked: "Acesso revogado",
};
export function OnboardingAdmin({ organization }: { organization: string }) {
  const [status, setStatus] = useState<Status | null>(null),
    [email, setEmail] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const path = `platform/${organization}/onboarding`;
  async function load() {
    const s = await request<Status>(path);
    setStatus(s);
    if (s.email) setEmail(s.email);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [organization]);
  async function action(method: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request(path, {
        method,
        ...(method === "POST" ? { body: JSON.stringify({ email }) } : {}),
      });
      await load();
      setMessage(
        method === "POST"
          ? "Convite aceito pelo provedor de e-mail. Confira a entrega no provedor."
          : "Convite e sessões locais revogados.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel enterprise-section">
      <h2>Convite de configuração — {organization}</h2>
      <p>
        Estado:{" "}
        {status ? labels[status.status] || status.status : "Carregando…"}
      </p>
      {status?.delivery && (
        <p>
          Envio:{" "}
          {status.delivery === "accepted"
            ? "Aceito pelo provedor"
            : status.delivery === "failed"
              ? "Falhou"
              : "Em andamento"}
        </p>
      )}
      {status?.inviteExpires && status.status === "invited" && (
        <p>
          Validade do convite:{" "}
          {new Date(status.inviteExpires).toLocaleString("pt-BR")}
        </p>
      )}
      <p>
        Um novo convite invalida o convite anterior, a senha local e as sessões
        de configuração. O cliente terá acesso apenas ao assistente SSO.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action("POST");
        }}
      >
        <label className="field">
          E-mail do responsável
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? "Aguarde…" : "Enviar novo convite"}
        </button>{" "}
        <button
          className="button secondary"
          type="button"
          disabled={
            busy ||
            !status ||
            status.status === "not_invited" ||
            status.status === "completed" ||
            status.status === "revoked"
          }
          onClick={() => action("DELETE")}
        >
          Revogar acesso local
        </button>{" "}
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => load().catch((e) => setError(e.message))}
        >
          Atualizar estado
        </button>
      </form>
    </section>
  );
}

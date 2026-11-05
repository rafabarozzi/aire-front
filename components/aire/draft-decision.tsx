"use client";
import { useEffect, useState } from "react";
import { draftReasons } from "@/lib/aire/customer-report";
import { request } from "@/lib/aire/client";

export type DraftStatus = {
  state:
    | "unavailable"
    | "proposed"
    | "approved"
    | "declined"
    | "submitting"
    | "applied";
  eligible: boolean;
  revision: string | null;
  reason: string | null;
  monitor_id: string | null;
};
export function DraftDecision({
  base,
  permissions,
  onStatus,
}: {
  base: string;
  permissions: string[];
  onStatus: (s: DraftStatus) => void;
}) {
  const path = base + "/entry-draft";
  const [status, setStatus] = useState<DraftStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const approver = permissions.includes("readiness:approve");
  const executor = permissions.includes("readiness:execute");
  useEffect(() => {
    let active = true;
    request<DraftStatus>(path)
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {
        if (active)
          setError("Não foi possível consultar o estado do rascunho.");
      });
    return () => {
      active = false;
    };
  }, [path, refresh]);
  useEffect(() => {
    if (status) onStatus(status);
  }, [onStatus, status]);
  async function decide(action: "approve" | "decline" | "apply") {
    if (!status?.revision || busy) return;
    setBusy(true);
    setError("");
    try {
      const send = (a: string, revision: string) =>
        request<DraftStatus>(path + "/" + a, {
          method: "POST",
          body: JSON.stringify({ revision }),
        });
      let next = await send(action, status.revision);
      setStatus(next);
      if (
        action === "approve" &&
        executor &&
        next.state === "approved" &&
        next.revision
      )
        next = await send("apply", next.revision);
      setStatus(next);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Falha ao atualizar o rascunho.",
      );
      setRefresh((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div aria-live="polite">
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setError("");
              setRefresh((v) => v + 1);
            }}
          >
            Atualizar
          </button>
        </p>
      )}
      {status?.state === "applied" ? (
        <p>Rascunho confirmado no Datadog · monitor {status.monitor_id}</p>
      ) : status?.state === "declined" ? (
        <p>Criação recusada.</p>
      ) : status?.state === "submitting" ? (
        <p>
          Aplicação em conferência.{" "}
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() =>
              executor ? void decide("apply") : setRefresh((v) => v + 1)
            }
          >
            Conferir resultado
          </button>
        </p>
      ) : !status ? (
        !error && <p>Consultando disponibilidade…</p>
      ) : !status.eligible ? (
        <p>
          {draftReasons[status.reason || ""] ||
            "A aplicação aguarda a verificação de elegibilidade pelo motor."}
        </p>
      ) : status.state === "approved" ? (
        <p>
          Aprovado.{" "}
          {executor && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void decide("apply")}
            >
              Criar rascunho
            </button>
          )}
        </p>
      ) : approver && status.state === "proposed" ? (
        <div className="obs-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void decide("approve")}
          >
            {executor ? "Aprovar e criar rascunho" : "Aprovar rascunho"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void decide("decline")}
          >
            Recusar
          </button>
        </div>
      ) : (
        <p>Aguardando aprovação de um responsável.</p>
      )}
    </div>
  );
}

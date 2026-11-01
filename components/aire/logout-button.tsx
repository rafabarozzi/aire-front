"use client";

import { useState } from "react";
import { LoaderCircle, LogOut } from "lucide-react";
import { request } from "@/lib/aire/client";

export function LogoutButton({
  onError,
  compact = false,
}: {
  onError: (message: string) => void;
  compact?: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function logout() {
    if (pending) return;
    setPending(true);
    try {
      await request("logout", { method: "POST" });
      window.location.replace("/");
    } catch {
      onError("Não foi possível encerrar a sessão. Tente novamente.");
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className={`button secondary logout-button${compact ? " compact" : ""}`}
      onClick={logout}
      disabled={pending}
      aria-busy={pending}
      title="Encerrar sessão do AIRE"
    >
      {pending ? (
        <LoaderCircle size={16} className="spin" aria-hidden="true" />
      ) : (
        <LogOut size={16} aria-hidden="true" />
      )}
      {pending ? "Saindo…" : "Sair"}
    </button>
  );
}

import { AppError } from "./config.ts";
export async function providerFetch(url: string, init: RequestInit = {}) {
  let r: Response;
  try {
    r = await fetch(url, {
      ...init,
      headers: {
        "User-Agent": "AIRE-Console",
        ...Object.fromEntries(new Headers(init.headers)),
      },
      redirect: "error",
      signal: AbortSignal.timeout(25000),
      cache: "no-store",
    });
  } catch {
    throw new AppError(
      502,
      "provider_unavailable",
      "Não foi possível conectar ao provedor. Tente novamente.",
    );
  }
  if (!r.ok) {
    await r.body?.cancel();
    const limited =
      r.status === 429 ||
      (r.status === 403 &&
        (r.headers.get("x-ratelimit-remaining") === "0" ||
          r.headers.has("retry-after")));
    throw new AppError(
      limited ? 429 : r.status === 404 ? 404 : 502,
      "provider_rejected",
      limited
        ? "Limite de consultas atingido. Aguarde."
        : r.status === 401 || r.status === 403
          ? "O provedor recusou a credencial ou suas permissões."
          : r.status === 404
            ? "Recurso não encontrado ou sem acesso."
            : "O provedor não concluiu a consulta.",
    );
  }
  return r;
}
export async function providerJson(r: Response) {
  const reader = r.body?.getReader();
  if (!reader) throw new AppError(502, "provider_response", "Resposta vazia.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new AppError(
          502,
          "provider_response",
          "Resposta excedeu o limite.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(502, "provider_response", "Resposta inválida.");
  }
}

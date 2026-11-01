export class ApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/console/" + path, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(
      "Não foi possível alcançar o AIRE. Confira sua conexão e tente novamente.",
      "network_error",
    );
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: unknown;
      code?: unknown;
    } | null;
    throw new ApiError(
      typeof data?.error === "string"
        ? data.error
        : "Não foi possível concluir. Tente novamente.",
      typeof data?.code === "string" ? data.code : "service_error",
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

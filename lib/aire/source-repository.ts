export type SourceProvider = "github" | "gitlab";

/** Provider is explicit: identical paths on different hosts are distinct identities. */
export function sourceRepository(provider: SourceProvider, input: string) {
  const host = provider === "github" ? "github.com" : "gitlab.com";
  let path = input.trim();
  if (
    /[\\%\x00-\x20]/.test(path) ||
    path.split("/").some((p) => p === "." || p === "..")
  )
    throw new Error("Caminho de repositório inválido.");
  if (path.startsWith("https://")) {
    const url = new URL(path);
    if (
      url.hostname !== host ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("URL incompatível com o provedor selecionado.");
    path = url.pathname.slice(1);
  }
  path = path.replace(/\/$/, "").replace(/\.git$/, "");
  const parts = path.split("/");
  if (
    parts.length < 2 ||
    (provider === "github" && parts.length !== 2) ||
    parts.some(
      (p) => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(p) || p === "." || p === "..",
    )
  )
    throw new Error("Caminho de repositório inválido.");
  return {
    provider,
    path,
    url: `https://${host}/${path}`,
    identity: `${host}/${path}`,
  };
}

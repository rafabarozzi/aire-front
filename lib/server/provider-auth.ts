import { createPrivateKey, createHash } from "node:crypto";
import { SignJWT } from "jose";
import { z } from "zod";
import { AppError, type Tenant } from "./config.ts";
import { integration, type Integration } from "./integrations.ts";
import { providerFetch, providerJson } from "./provider-http.ts";
async function issueInstallationToken(
  c: Extract<Integration, { kind: "github-app" }>,
) {
  let jwt: string;
  try {
    const key = createPrivateKey(c.privateKey);
    if (key.asymmetricKeyType !== "rsa") throw new Error();
    jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(c.appId)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 540)
      .sign(key);
  } catch {
    throw new AppError(
      422,
      "github_app_key",
      "Informe uma chave privada RSA PEM válida do GitHub App.",
    );
  }
  const r = await providerFetch(
    "https://api.github.com/app/installations/" +
      c.installationId +
      "/access_tokens",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + jwt,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        permissions: { contents: "read", metadata: "read" },
      }),
    },
  );
  const issued = z
    .object({ token: z.string().min(1), expires_at: z.string().datetime() })
    .parse(await providerJson(r));
  const expires = Date.parse(issued.expires_at);
  if (expires <= Date.now() + 60000)
    throw new AppError(
      502,
      "github_app_expired",
      "O GitHub retornou um token expirado. Tente novamente.",
    );
  return { token: issued.token, expires };
}
// Bounded process-local cache; plaintext installation tokens never go to disk.
const tokens = new Map<
  string,
  {
    fingerprint: string;
    expires: number;
    value: Promise<{ token: string; expires: number }>;
  }
>();
async function installationToken(
  t: Tenant,
  c: Extract<Integration, { kind: "github-app" }>,
) {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(c))
    .digest("hex");
  const saved = tokens.get(t.id);
  if (saved?.fingerprint === fingerprint && saved.expires > Date.now() + 60000)
    return (await saved.value).token;
  if (tokens.size >= 200) tokens.delete(tokens.keys().next().value!);
  const entry = {
    fingerprint,
    expires: Date.now() + 120000,
    value: issueInstallationToken(c),
  };
  tokens.set(t.id, entry);
  try {
    const result = await entry.value;
    entry.expires = result.expires;
    return result.token;
  } catch (e) {
    if (tokens.get(t.id) === entry) tokens.delete(t.id);
    throw e;
  }
}
export async function modernGithubCredential(t: Tenant) {
  const c = await integration(t, "github");
  if (c === undefined) return undefined;
  if (c === null) return null;
  if (c.kind === "github-token") return c.token;
  if (c.kind === "github-app") return installationToken(t, c);
  throw new AppError(503, "integration_provider", "Conexão GitHub inválida.");
}
export async function gitlabToken(t: Tenant) {
  const c = await integration(t, "gitlab");
  if (c?.kind !== "gitlab-token")
    throw new AppError(
      503,
      "gitlab_unconfigured",
      "Cadastre a credencial GitLab em Conexões.",
    );
  return c.token;
}
export async function testProvider(
  t: Tenant,
  p: "gitlab" | "datadog" | "dynatrace",
) {
  const c = await integration(t, p);
  if (!c)
    throw new AppError(
      422,
      "integration_missing",
      "Salve a conexão antes de testar.",
    );
  if (c.kind === "gitlab-token")
    await providerJson(
      await providerFetch(
        "https://gitlab.com/api/v4/projects?membership=true&per_page=1",
        { headers: { "PRIVATE-TOKEN": c.token } },
      ),
    );
  else if (c.kind === "datadog") {
    const d = await providerJson(
      await providerFetch("https://api." + c.site + "/api/v2/validate_keys", {
        headers: {
          "DD-API-KEY": c.apiKey,
          "DD-APPLICATION-KEY": c.applicationKey,
        },
      }),
    );
    if (d.status !== "ok")
      throw new AppError(
        422,
        "integration_invalid",
        "O Datadog não confirmou as chaves.",
      );
  } else if (c.kind === "dynatrace")
    await providerJson(
      await providerFetch(
        c.environment.replace(/\/$/, "") + "/api/v2/entities?pageSize=1",
        { headers: { Authorization: "Api-Token " + c.token } },
      ),
    );
  return {
    ok: true,
    message:
      "Conexão validada para a leitura testada. A cobertura operacional será avaliada na Etapa 2.",
  };
}

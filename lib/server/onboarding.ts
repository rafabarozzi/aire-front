import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  open,
  appendFile,
} from "node:fs/promises";
import {
  randomBytes,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { join } from "node:path";
import { z } from "zod";
import {
  AppError,
  appOrigin,
  isDemo,
  tenants,
  managedRegistry,
  type Identity,
  type Tenant,
} from "./config.ts";
import {
  cookie,
  readCookie,
  seal,
  unseal,
  platformContext,
} from "./session.ts";
import { saveTenant } from "./platform.ts";
import { boundedBody } from "./upstream.ts";

export const SETUP_COOKIE = "__Host-aire-setup";
export const SETUP_FLOW_COOKIE = "__Host-aire-setup-flow";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const email = z.string().trim().email().max(254).toLowerCase();
const password = z.string().min(15).max(128);
const scrypt = promisify(scryptCallback);
const configSchema = z
  .object({
    provider: z.enum(["microsoft", "google"]),
    microsoftTenantId: z.string().uuid().toLowerCase().optional(),
    googleDomain: z
      .string()
      .toLowerCase()
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/)
      .optional(),
    adminGroup: z.string().uuid().optional(),
    engineerGroup: z.string().uuid().optional(),
    viewerGroup: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      (c.provider === "microsoft" && !c.microsoftTenantId) ||
      (c.provider === "google" && !c.googleDomain)
    )
      ctx.addIssue({
        code: "custom",
        message: "Informe o diretório Microsoft ou domínio Google.",
      });
    if (
      (c.provider === "google" &&
        (c.microsoftTenantId ||
          c.adminGroup ||
          c.engineerGroup ||
          c.viewerGroup)) ||
      (c.provider === "microsoft" && c.googleDomain)
    )
      ctx.addIssue({
        code: "custom",
        message: "Informe somente campos do provedor selecionado.",
      });
    const groups = [c.adminGroup, c.engineerGroup, c.viewerGroup].filter(
      Boolean,
    );
    if (new Set(groups).size !== groups.length)
      ctx.addIssue({
        code: "custom",
        message: "Use grupos diferentes para cada perfil.",
      });
  });
type SetupConfig = z.infer<typeof configSchema>;
type State = {
  generation: string;
  email: string;
  status: "invited" | "configuring" | "completed" | "revoked";
  inviteHash?: string;
  inviteExpires: number;
  deadline: number;
  delivery: "pending" | "accepted" | "failed";
  sentAt: number;
  account?: { username: string; salt: string; passwordHash: string };
  sessions: Array<{ hash: string; expires: number }>;
  attempts: number;
  attemptWindow: number;
  config?: SetupConfig;
  configRevision: number;
  verified?: { identity: Identity; revision: number; at: number };
};
function root() {
  return join(process.env.AIRE_DATA_DIR || "/data", "onboarding");
}
function tenant(id: string) {
  slug.parse(id);
  const t = tenants().find((t) => t.id === id);
  if (!t)
    throw new AppError(
      404,
      "setup_missing",
      "Convite ou organização indisponível.",
    );
  return t;
}
async function read(id: string): Promise<State | undefined> {
  slug.parse(id);
  try {
    return JSON.parse(await readFile(join(root(), id + ".json"), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
async function transaction<T>(
  id: string,
  action: (s: State | undefined) => Promise<{ state: State; result: T }>,
): Promise<T> {
  slug.parse(id);
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const path = join(root(), id + ".json"),
    lockPath = path + ".lock";
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch {
    throw new AppError(
      409,
      "setup_busy",
      "Configuração em andamento. Tente novamente.",
    );
  }
  const tmp = path + "." + token() + ".tmp";
  try {
    const { state, result } = await action(await read(id));
    await writeFile(tmp, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    await rename(tmp, path);
    return result;
  } finally {
    await unlink(tmp).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
async function audit(id: string, action: string) {
  await appendFile(
    join(root(), "audit.jsonl"),
    JSON.stringify({ tenant: id, action, at: new Date().toISOString() }) + "\n",
    { mode: 0o600 },
  );
}
function central(request: Request, mutation = false) {
  if (isDemo())
    throw new AppError(
      409,
      "demo",
      "Onboarding disponível no ambiente integrado.",
    );
  const expected = appOrigin();
  if (
    (request.headers.get("host") || new URL(request.url).host) !==
      new URL(expected).host ||
    (mutation && request.headers.get("origin") !== expected)
  )
    throw new AppError(403, "origin", "Use o endereço original do convite.");
}
function active(s: State | undefined): asserts s is State {
  if (
    !s ||
    s.status === "completed" ||
    s.status === "revoked" ||
    s.deadline <= Date.now()
  )
    throw new AppError(
      401,
      "setup_expired",
      "Acesso de configuração expirado ou encerrado. Solicite um novo convite.",
    );
}
function limited(s: State) {
  if (Date.now() - s.attemptWindow > 15 * 60_000) {
    s.attemptWindow = Date.now();
    s.attempts = 0;
  }
  return ++s.attempts > 10;
}
export async function setupContext(request: Request) {
  central(request);
  let p;
  try {
    p = await unseal(readCookie(request, SETUP_COOKIE), "setup-session");
  } catch {
    throw new AppError(
      401,
      "setup_login",
      "Entre com seu acesso de configuração.",
    );
  }
  const id = slug.parse(p.tenant),
    t = tenant(id),
    s = await read(id);
  active(s);
  if (
    t.enabled !== false ||
    p.origin !== appOrigin() ||
    p.generation !== s.generation ||
    typeof p.sid !== "string" ||
    !s.sessions.some(
      (v) => v.hash === hash(p.sid as string) && v.expires > Date.now(),
    )
  )
    throw new AppError(
      401,
      "setup_login",
      "Entre novamente com seu acesso de configuração.",
    );
  return { id, tenant: t, state: s, sessionHash: hash(p.sid) };
}
export function candidate(t: Tenant, c: SetupConfig): Tenant {
  return {
    ...t,
    enabled: true,
    members: [],
    groups:
      c.provider === "microsoft"
        ? (["admin", "engineer", "viewer"] as const).flatMap((role) => {
            const id = c[`${role}Group`];
            return id ? [{ id, role }] : [];
          })
        : [],
    sso:
      c.provider === "microsoft"
        ? {
            microsoftClientIdEnv: t.sso?.microsoftClientIdEnv,
            microsoftClientSecretEnv: t.sso?.microsoftClientSecretEnv,
            microsoftTenantId: c.microsoftTenantId,
            googleDomains: [],
          }
        : {
            googleClientIdEnv: t.sso?.googleClientIdEnv,
            googleClientSecretEnv: t.sso?.googleClientSecretEnv,
            googleDomains: [c.googleDomain!],
          },
  };
}
export async function recordVerified(
  request: Request,
  revision: number,
  identity: Identity,
) {
  const c = await setupContext(request);
  return transaction(c.id, async (s) => {
    active(s);
    if (
      s.generation !== c.state.generation ||
      s.configRevision !== revision ||
      !s.config ||
      identity.workspace !== c.id
    )
      throw new AppError(
        409,
        "setup_changed",
        "A configuração mudou. Repita o teste SSO.",
      );
    const expected = candidate(c.tenant, s.config);
    if (
      identity.provider !== s.config.provider ||
      (identity.provider === "microsoft"
        ? identity.issuer !==
          `https://login.microsoftonline.com/${s.config.microsoftTenantId}/v2.0`
        : identity.issuer !== "https://accounts.google.com" ||
          identity.domain !== s.config.googleDomain)
    )
      throw new AppError(
        403,
        "setup_identity",
        "A identidade não pertence ao diretório configurado.",
      );
    if (
      s.config.adminGroup &&
      !expected.groups.some(
        (g) => g.role === "admin" && identity.groups.includes(g.id),
      )
    )
      throw new AppError(
        403,
        "setup_admin",
        "O usuário testado não pertence ao grupo de administradores.",
      );
    s.verified = { identity, revision, at: Date.now() };
    await audit(c.id, "sso.tested");
    return { state: s, result: undefined };
  });
}
export async function onboardingOperator(
  request: Request,
  id: string,
  data?: unknown,
) {
  await platformContext(request);
  const t = tenant(id);
  if (request.method === "GET") {
    const s = await read(id);
    return s
      ? {
          status: s.status,
          email: s.email,
          delivery: s.delivery,
          inviteExpires: s.inviteExpires,
          deadline: s.deadline,
        }
      : { status: "not_invited" };
  }
  if (request.method === "DELETE")
    return transaction(id, async (s) => {
      if (!s)
        throw new AppError(404, "setup_missing", "Nenhum convite encontrado.");
      s.status = "revoked";
      s.sessions = [];
      delete s.inviteHash;
      delete s.account;
      delete s.verified;
      await audit(id, "invite.revoked");
      return { state: s, result: { revoked: true } };
    });
  if (request.method !== "POST")
    throw new AppError(405, "method", "Método não permitido.");
  const parsedRecipient = z.object({ email }).strict().safeParse(data);
  if (!parsedRecipient.success)
    throw new AppError(
      422,
      "invite_email",
      "Informe um e-mail válido para o responsável pelo SSO.",
    );
  const recipient = parsedRecipient.data.email;
  if (t.enabled !== false)
    throw new AppError(
      409,
      "setup_active",
      "Convites de configuração são exclusivos de organizações em rascunho.",
    );
  if (!process.env.AIRE_RESEND_API_KEY || !process.env.AIRE_EMAIL_FROM)
    throw new AppError(
      503,
      "email_configuration",
      "Configure AIRE_RESEND_API_KEY e AIRE_EMAIL_FROM no servidor antes de enviar convites.",
    );
  const secret = token(),
    generation = token(),
    now = Date.now();
  await transaction(id, async (old) => {
    if (old && now - old.sentAt < 60_000)
      throw new AppError(
        429,
        "invite_rate",
        "Aguarde um minuto antes de reenviar.",
      );
    await audit(id, "invite.created");
    return {
      state: {
        generation,
        email: recipient,
        status: "invited",
        inviteHash: hash(secret),
        inviteExpires: now + 86400_000,
        deadline: now + 7 * 86400_000,
        delivery: "pending",
        sentAt: now,
        sessions: [],
        attempts: 0,
        attemptWindow: now,
        configRevision: 0,
      },
      result: undefined,
    };
  });
  // Fragment avoids placing activation credentials in HTTP access logs and referrers.
  const link = `${appOrigin()}/onboarding?organization=${id}#invite=${secret}`;
  let accepted = false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${process.env.AIRE_RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": generation,
      },
      body: JSON.stringify({
        from: process.env.AIRE_EMAIL_FROM,
        to: [recipient],
        subject: `Configure o acesso da ${t.name} ao AIRE`,
        text: `Você foi convidado para configurar o Single Sign-On da organização ${t.name}.\n\nAbra este endereço para criar seu acesso local de configuração:\n${link}\n\nO convite é de uso único e vence em 24 horas. O acesso local permite somente configurar o SSO, por até 7 dias, e será encerrado após a confirmação do login corporativo.\n\nAIRE by Northeia`,
      }),
    });
    accepted = r.ok;
  } catch {
    /* Never return provider bodies, credentials or activation links. */
  }
  await transaction(id, async (s) => {
    if (!s || s.generation !== generation)
      throw new AppError(409, "invite_changed", "O convite foi substituído.");
    s.delivery = accepted ? "accepted" : "failed";
    if (!accepted) delete s.inviteHash;
    await audit(id, accepted ? "email.accepted" : "email.failed");
    return { state: s, result: undefined };
  });
  if (!accepted)
    throw new AppError(
      502,
      "email_failed",
      "Organização preservada. Não foi possível confirmar o envio; confira o provedor e reenvie o convite.",
    );
  return { status: "invited", delivery: "accepted", email: recipient };
}
async function parseBody(request: Request) {
  try {
    return JSON.parse(
      new TextDecoder().decode(
        await boundedBody(new Response(request.body), 12000),
      ),
    );
  } catch {
    throw new AppError(400, "body", "Dados inválidos.");
  }
}
export async function setupApi(request: Request, action: string) {
  const json = (
    data: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ) =>
    Response.json(data, {
      status,
      headers: { "Cache-Control": "no-store", ...headers },
    });
  try {
    central(request, request.method !== "GET");
    if (["activate", "login"].includes(action) && request.method === "POST") {
      const input = z
        .object({
          organization: slug,
          username: email,
          password,
          invite: z
            .string()
            .regex(/^[A-Za-z0-9_-]{43}$/)
            .optional(),
        })
        .strict()
        .parse(await parseBody(request));
      const t = tenant(input.organization);
      if (t.enabled !== false)
        throw new AppError(
          401,
          "setup_login",
          "Acesso de configuração indisponível.",
        );
      const result = await transaction(t.id, async (s) => {
        active(s);
        const failed = () => ({
          state: s!,
          result: { error: true, sid: "", generation: "" },
        });
        if (limited(s)) return failed();
        if (action === "activate") {
          if (
            s.status !== "invited" ||
            !input.invite ||
            s.inviteHash !== hash(input.invite) ||
            s.inviteExpires <= Date.now() ||
            s.email !== input.username
          )
            return failed();
          const salt = token();
          s.account = {
            username: input.username,
            salt,
            passwordHash: (
              (await scrypt(input.password, salt, 64)) as Buffer
            ).toString("hex"),
          };
          s.status = "configuring";
          delete s.inviteHash;
        } else {
          if (!s.account || s.account.username !== input.username)
            return failed();
          const computed = (await scrypt(
            input.password,
            s.account.salt,
            64,
          )) as Buffer;
          if (
            !timingSafeEqual(
              computed,
              Buffer.from(s.account.passwordHash, "hex"),
            )
          )
            return failed();
        }
        s.attempts = 0;
        const sid = token();
        s.sessions = [
          ...s.sessions.filter((v) => v.expires > Date.now()).slice(-4),
          { hash: hash(sid), expires: Date.now() + 1800_000 },
        ];
        await audit(
          t.id,
          action === "activate" ? "account.activated" : "account.login",
        );
        return {
          state: s,
          result: { error: false, sid, generation: s.generation },
        };
      });
      if (result.error)
        throw new AppError(
          401,
          "setup_login",
          "Credenciais ou convite inválidos. Confira os dados ou solicite um novo convite.",
        );
      return json({ authenticated: true }, 200, {
        "Set-Cookie": cookie(
          SETUP_COOKIE,
          await seal(
            {
              tenant: t.id,
              sid: result.sid,
              generation: result.generation,
              origin: appOrigin(),
            },
            "setup-session",
            1800,
          ),
          1800,
        ),
      });
    }
    const c = await setupContext(request);
    if (action === "session" && request.method === "GET")
      return json({
        organization: c.id,
        name: c.tenant.name,
        email: c.state.email,
        config: c.state.config,
        configRevision: c.state.configRevision,
        verified: c.state.verified
          ? {
              name: c.state.verified.identity.name,
              provider: c.state.verified.identity.provider,
              subject:
                c.state.verified.identity.objectId ||
                c.state.verified.identity.sub,
              at: c.state.verified.at,
            }
          : null,
        deadline: c.state.deadline,
        callback: `${appOrigin()}/onboarding/auth/`,
        portal: c.tenant.publicOrigin,
      });
    if (action === "logout" && request.method === "POST") {
      await transaction(c.id, async (s) => {
        active(s);
        s.sessions = s.sessions.filter((v) => v.hash !== c.sessionHash);
        return { state: s, result: undefined };
      });
      return json({ signedOut: true }, 200, {
        "Set-Cookie": cookie(SETUP_COOKIE, "", 0),
      });
    }
    if (action === "config" && request.method === "PUT") {
      const input = z
        .object({
          revision: z.number().int().nonnegative(),
          config: configSchema,
        })
        .strict()
        .parse(await parseBody(request));
      await transaction(c.id, async (s) => {
        active(s);
        if (
          s.generation !== c.state.generation ||
          s.configRevision !== input.revision
        )
          throw new AppError(
            409,
            "setup_changed",
            "Atualize a tela antes de salvar.",
          );
        s.config = input.config;
        s.configRevision++;
        delete s.verified;
        await audit(c.id, "sso.configured");
        return { state: s, result: undefined };
      });
      return json({ saved: true });
    }
    if (action === "complete" && request.method === "POST") {
      z.object({ confirm: z.literal(true) })
        .strict()
        .parse(await parseBody(request));
      await transaction(c.id, async (s) => {
        active(s);
        if (
          s.generation !== c.state.generation ||
          !s.config ||
          !s.verified ||
          s.verified.revision !== s.configRevision ||
          Date.now() - s.verified.at > 600_000
        )
          throw new AppError(
            409,
            "setup_test",
            "Realize um teste SSO antes de confirmar (válido por 10 minutos).",
          );
        const registryRevision = managedRegistry().revision;
        const current = tenant(c.id);
        if (current.enabled !== false)
          throw new AppError(
            409,
            "setup_active",
            "A organização já foi ativada.",
          );
        const next = candidate(current, s.config),
          identity = s.verified.identity;
        if (!s.config.adminGroup)
          next.members = [
            {
              provider: identity.provider,
              subject:
                identity.provider === "microsoft"
                  ? identity.objectId || identity.sub
                  : identity.sub,
              role: "admin",
            },
          ];
        // SSO readiness does not bypass engine activation or provision infrastructure.
        next.enabled = false;
        await saveTenant(next, registryRevision, identity);
        s.status = "completed";
        s.sessions = [];
        delete s.account;
        delete s.inviteHash;
        delete s.verified;
        await audit(c.id, "sso.completed");
        return { state: s, result: undefined };
      });
      return json({ completed: true }, 200, {
        "Set-Cookie": cookie(SETUP_COOKIE, "", 0),
      });
    }
    throw new AppError(404, "not_found", "Ação indisponível.");
  } catch (e) {
    return json(
      {
        error:
          e instanceof AppError
            ? e.message
            : e instanceof z.ZodError
              ? "Revise os campos informados. A senha deve ter de 15 a 128 caracteres."
              : "Não foi possível concluir a configuração.",
        code: e instanceof AppError ? e.code : "setup_error",
      },
      e instanceof AppError ? e.status : e instanceof z.ZodError ? 422 : 500,
    );
  }
}

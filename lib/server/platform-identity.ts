import { z } from "zod";
import type { Identity } from "./config.ts";
export function isPlatformAdmin(identity: Identity) {
  const admins = z
    .array(
      z
        .object({
          provider: z.enum(["microsoft", "google"]),
          issuer: z.string().url(),
          subject: z.string().min(1),
        })
        .strict(),
    )
    .parse(JSON.parse(process.env.AIRE_PLATFORM_ADMINS_JSON || "[]"));
  return admins.some(
    (a) =>
      a.provider === identity.provider &&
      a.issuer === identity.issuer &&
      a.subject === identity.sub,
  );
}

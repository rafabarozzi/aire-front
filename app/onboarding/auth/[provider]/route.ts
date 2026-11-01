import { setupAuth } from "@/lib/server/onboarding-oidc";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (provider !== "microsoft" && provider !== "google")
    return new Response(null, { status: 404 });
  return setupAuth(request, provider);
}

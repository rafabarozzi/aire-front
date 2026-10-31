import { auth } from "@/lib/server/oidc";
import { AppError, isDemo } from "@/lib/server/config";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (provider !== "google" && provider !== "microsoft")
    return new Response("Provedor inválido", { status: 404 });
  if (isDemo())
    return Response.json(
      {
        error:
          "SSO está disponível no ambiente integrado. Esta prévia é demonstrativa.",
      },
      { status: 503 },
    );
  try {
    return await auth(request, provider);
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof AppError
            ? e.message
            : "Não foi possível iniciar o login. Tente novamente.",
      },
      {
        status: e instanceof AppError ? e.status : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

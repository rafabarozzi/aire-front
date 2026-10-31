import { demoSession } from "@/lib/aire/demo";
import { isDemo, AppError } from "@/lib/server/config";
import { sessionResponse } from "@/lib/server/session";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return Response.json(
      isDemo() ? demoSession : await sessionResponse(request),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof AppError
            ? e.message
            : "Falha ao carregar a organização.",
      },
      {
        status: e instanceof AppError ? e.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

import { setupApi } from "@/lib/server/onboarding";
export const runtime = "nodejs";
async function handle(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  return setupApi(request, (await params).action);
}
export { handle as GET, handle as POST, handle as PUT };

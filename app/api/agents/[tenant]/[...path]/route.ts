import { agentGateway } from "@/lib/server/agent-gateway";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(
  request: Request,
  { params }: { params: Promise<{ tenant: string; path: string[] }> },
) {
  const { tenant, path } = await params;
  return agentGateway(request, tenant, path);
}
export { handle as POST, handle as PUT };

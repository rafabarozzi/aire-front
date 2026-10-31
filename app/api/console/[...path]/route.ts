import { api } from "@/lib/server/api";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return api(request, (await params).path);
}
export { handle as GET, handle as POST, handle as PUT };

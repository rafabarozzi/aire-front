export function GET() {
  return Response.json(
    { status: "ok", service: "aire-front" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export function GET() {
  return Response.json(
    { status: "ok", service: "aire-front", version: "0.2.0", journeyTabs: 2 },
    { headers: { "Cache-Control": "no-store" } },
  );
}

import type { projectManifest } from "./manifest.ts";

export type JourneyManifest = ReturnType<typeof projectManifest>;

// IDs are generated locally; all source labels are escaped as Mermaid entities.
function label(text: string) {
  return text
    .slice(0, 160)
    .replace(/[^\p{L}\p{N} _.,:/()·-]/gu, (c) => `#${c.codePointAt(0)};`);
}

/** Aggregate repeated relationships, preserving every node, direction and type. */
export function journeyOverview(manifest: JourneyManifest) {
  const nodes = [...manifest.services, ...manifest.resources];
  const ids = new Map(nodes.map((node, i) => [node.id, `N${i}`]));
  const names = new Map(nodes.map((node) => [node.id, node.name]));
  const lines = ["flowchart LR"];
  for (const node of nodes) {
    const service = "role" in node;
    const owner =
      !service && node.ownedBy ? names.get(node.ownedBy) : undefined;
    const detail = service
      ? node.role === "entry_service"
        ? "Entrada da jornada"
        : "Serviço"
      : node.type === "database"
        ? "Acesso a dados"
        : node.type === "cache"
          ? "Cache"
          : node.type;
    lines.push(
      `${ids.get(node.id)}["${label(node.name)}<br/>${label(owner ? `${detail} · ${owner}` : detail)}"]:::${service ? (node.role === "entry_service" ? "entry" : "service") : "resource"}`,
    );
  }
  const edges = new Map<
    string,
    { from: string; to: string; type: string; count: number }
  >();
  for (const dependency of manifest.dependencies) {
    const key = JSON.stringify([
      dependency.from,
      dependency.to,
      dependency.type,
    ]);
    const edge = edges.get(key);
    if (edge) edge.count++;
    else edges.set(key, { ...dependency, count: 1 });
  }
  const types: Record<string, string> = {
    http: "HTTP",
    database: "Dados",
    cache: "Cache",
    messaging: "Eventos",
  };
  for (const edge of edges.values()) {
    const text = `${types[edge.type] || edge.type}${edge.count > 1 ? ` · ${edge.count}` : ""}`;
    lines.push(
      `${ids.get(edge.from)} -->|"${label(text)}"| ${ids.get(edge.to)}`,
    );
  }
  lines.push(
    "classDef entry fill:#dbeafe,stroke:#2563eb,stroke-width:3px,color:#172f52",
    "classDef service fill:#f0f5ff,stroke:#8ca9ce,stroke-width:1.5px,color:#172f52",
    "classDef resource fill:#f3f4f6,stroke:#99a5b5,color:#334155",
  );
  return {
    source: lines.join("\n"),
    nodeCount: nodes.length,
    relationCount: edges.size,
    entryId: ids.get(
      manifest.services.find((s) => s.role === "entry_service")?.id || "",
    ),
  };
}

"use client";
import { useMemo, useState } from "react";
import {
  Network,
  Code2,
  Database,
  ArrowRight,
  FileText,
  CircleAlert,
} from "lucide-react";
import { projectManifest } from "@/lib/aire/manifest";
export function CanonicalMap({
  manifest,
  analysisId,
}: {
  manifest: unknown;
  analysisId: string;
}) {
  const result = useMemo(() => {
    try {
      return { data: projectManifest(manifest, analysisId), error: "" };
    } catch {
      return {
        data: null,
        error:
          "Este manifesto não atende ao contrato de visualização v1 ou contém referências inconsistentes. Consulte o artefato original.",
      };
    }
  }, [manifest, analysisId]);
  const [selected, setSelected] = useState<string>("");
  if (!result.data)
    return (
      <div className="empty">
        <CircleAlert />
        <h3>Não foi possível apresentar o mapa</h3>
        <p>{result.error}</p>
      </div>
    );
  const m = result.data,
    all = [
      ...m.services.map((s) => ({
        ...s,
        kind: "service",
        description:
          s.role === "entry_service"
            ? "Serviço de entrada"
            : "Serviço participante",
      })),
      ...m.resources.map((r) => ({
        ...r,
        kind: r.type,
        description: r.detail,
        role: "resource",
      })),
    ];
  const shown = all,
    node = shown.find((n) => n.id === selected) || shown[0],
    ids = new Set(shown.map((n) => n.id));
  const edges = m.dependencies.filter((d) => ids.has(d.from) && ids.has(d.to));
  const related = m.dependencies.filter(
    (d) => d.from === node?.id || d.to === node?.id,
  );
  const refs = new Set(related.flatMap((d) => d.evidenceRefs));
  const evidence = m.evidence.filter((e) => refs.has(e.id));
  const positions = new Map(
    shown.map((n, i) => [
      n.id,
      { x: 35 + (i % 3) * 250, y: 35 + Math.floor(i / 3) * 110 },
    ]),
  );
  const height = Math.max(260, Math.ceil(shown.length / 3) * 110 + 30);
  return (
    <div className="canonical-map">
      <div className="canonical-summary">
        <span>
          <Network size={15} />
          {m.services.length} serviços
        </span>
        <span>
          <Database size={15} />
          {m.resources.length} recursos lógicos
        </span>
        <span>{m.dependencies.length} dependências</span>
      </div>
      <div className="graph-viewport" style={{ height: Math.min(height, 440) }}>
        <div className="graph-canvas" style={{ height }}>
          <svg
            className="graph-wires"
            style={{ height }}
            width="800"
            height={height}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="canonical-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {edges.map((e) => {
              const a = positions.get(e.from)!,
                b = positions.get(e.to)!;
              return (
                <path
                  key={e.id}
                  d={`M ${a.x + 195} ${a.y + 31} C ${a.x + 230} ${a.y + 31}, ${b.x - 30} ${b.y + 31}, ${b.x} ${b.y + 31}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeDasharray={e.conditional ? "5 4" : undefined}
                  markerEnd="url(#canonical-arrow)"
                />
              );
            })}
          </svg>
          {shown.map((n) => (
            <button
              key={n.id}
              style={{
                left: positions.get(n.id)!.x,
                top: positions.get(n.id)!.y,
              }}
              onClick={() => setSelected(n.id)}
              className={"graph-node " + (node?.id === n.id ? "selected" : "")}
              title={n.name}
            >
              <span className="node-icon">
                {n.kind === "service" ? (
                  <Code2 size={17} />
                ) : (
                  <Database size={17} />
                )}
              </span>
              <span className="canonical-node-name">
                <strong>{n.name}</strong>
                <small>
                  {n.role === "entry_service"
                    ? "Entrada"
                    : n.kind === "service"
                      ? "Serviço lógico"
                      : n.kind}
                </small>
              </span>
            </button>
          ))}
        </div>
      </div>
      {node && (
        <div className="canonical-evidence">
          <h3>{node.name}</h3>
          <p>{node.description}</p>
          <small>
            Identidade lógica. A posição no desenho não indica ordem de
            execução.
          </small>
          <div className="canonical-relations">
            {related.map((d) => (
              <div key={d.id}>
                <code>{all.find((n) => n.id === d.from)?.name}</code>
                <ArrowRight size={12} />
                <code>{all.find((n) => n.id === d.to)?.name}</code>
                <span>
                  {d.type}
                  {d.conditional ? " · condicional" : ""}
                  {d.asynchronous ? " · assíncrona" : ""}
                </span>
              </div>
            ))}
          </div>
          {evidence.map((e) => (
            <div className="canonical-reference" key={e.id}>
              <FileText size={13} />
              <code>
                {e.path}
                {e.line ? ":" + e.line : ""}
              </code>
            </div>
          ))}
          {!evidence.length && (
            <small>
              Nenhuma referência de arquivo nas dependências deste elemento.
            </small>
          )}
        </div>
      )}
    </div>
  );
}

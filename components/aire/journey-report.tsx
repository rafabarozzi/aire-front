"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import DOMPurify from "dompurify";
import {
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  Network,
  FileText,
  ChevronDown,
  Search,
  Crosshair,
} from "lucide-react";
import {
  assertSafeFlowchart,
  splitJourneyReport,
} from "@/lib/aire/journey-report";

import { projectManifest } from "@/lib/aire/manifest";
import {
  journeyOverview,
  type JourneyManifest,
} from "@/lib/aire/journey-overview";

let renderer: Promise<(typeof import("mermaid"))["default"]> | undefined;
function getRenderer() {
  return (renderer ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      htmlLabels: false,
      themeVariables: { fontSize: "18px" },
      maxTextSize: 200000,
      maxEdges: 10000,
      flowchart: {
        htmlLabels: false,
        useMaxWidth: false,
        nodeSpacing: 20,
        rankSpacing: 60,
        wrappingWidth: 280,
      },
    });
    return mermaid;
  }));
}

function JourneyDiagram({
  source,
  index,
  overview,
}: {
  source: string;
  index: number;
  overview?: ReturnType<typeof journeyOverview>;
}) {
  const id = "journey-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const viewport = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<"overview" | "detail">(
    overview ? "overview" : "detail",
  );
  const displaySource =
    mode === "overview" && overview ? overview.source : source;
  const [rendered, setRendered] = useState({
    source: "",
    svg: "",
    error: "",
    nodes: [] as { id: string; label: string }[],
  });
  const svg = rendered.source === displaySource ? rendered.svg : "";
  const error = rendered.source === displaySource ? rendered.error : "";
  const nodes = rendered.source === displaySource ? rendered.nodes : [];
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ width: 1000, height: 600 });
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      const mermaid = await getRenderer();
      const { svg: output } = await mermaid.render(
        id,
        assertSafeFlowchart(displaySource).replace(/<\/?b>/gi, ""),
      );
      const clean = DOMPurify.sanitize(output, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ["foreignObject", "image", "a"],
      });
      const element = new DOMParser().parseFromString(
        clean,
        "image/svg+xml",
      ).documentElement;
      const box = element.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
      if (active) {
        setSize({ width: box?.[2] || 1000, height: box?.[3] || 600 });
        setScale(1);
        setQuery("");
        setSelected("");
        setRendered({
          source: displaySource,
          svg: clean,
          error: "",
          nodes: Array.from(element.querySelectorAll("g.node")).map((node) => ({
            id: node.id,
            label:
              Array.from(node.querySelectorAll("tspan"))
                .filter((span) => !span.querySelector("tspan"))
                .map((span) => span.textContent?.trim())
                .filter(Boolean)
                .join(" ") ||
              node.textContent ||
              "",
          })),
        });
      }
    })().catch(() => {
      if (active)
        setRendered({
          source: displaySource,
          svg: "",
          nodes: [],
          error:
            "Não foi possível desenhar este diagrama. O relatório e o código do mapa continuam disponíveis abaixo.",
        });
    });
    return () => {
      active = false;
    };
  }, [id, displaySource]);
  useEffect(() => {
    const onFullScreen = () =>
      setExpanded(document.fullscreenElement === panel.current);
    document.addEventListener("fullscreenchange", onFullScreen);
    return () => document.removeEventListener("fullscreenchange", onFullScreen);
  }, []);
  useEffect(() => {
    if (!svg) return;
    const area = viewport.current;
    if (!area) return;
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      const entryId = mode === "overview" ? overview?.entryId : "S1";
      if (mode === "overview") {
        // Keep labels readable on narrow screens; navigation remains scrollable.
        setScale(
          Math.max(0.8, Math.min(1, (area.clientWidth - 48) / size.width)),
        );
      }
      frame = requestAnimationFrame(() => {
        const entry =
          area.querySelector(`g.node[id^="flowchart-${entryId}-"]`) ||
          area.querySelector("g.node");
        if (entry) center(entry);
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(area);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [svg, mode, size.width, overview?.entryId]);
  function center(element: Element) {
    const area = viewport.current;
    if (!area) return;
    const box = element.getBoundingClientRect(),
      view = area.getBoundingClientRect();
    area.scrollLeft += box.left - view.left - (view.width - box.width) / 2;
    area.scrollTop += box.top - view.top - (view.height - box.height) / 2;
  }
  function focusNode(nodeId: string) {
    setSelected(nodeId);
    setScale((value) => Math.max(0.8, value));
    requestAnimationFrame(() => {
      const area = viewport.current;
      area
        ?.querySelectorAll(".map-node-selected")
        .forEach((el) => el.classList.remove("map-node-selected"));
      const node = area?.querySelector(`#${CSS.escape(nodeId)}`);
      if (node) {
        node.classList.add("map-node-selected");
        center(node);
      }
    });
  }
  function zoom(next: number) {
    const area = viewport.current;
    const left = area ? area.scrollLeft + area.clientWidth / 2 - 24 : 0;
    const top = area ? area.scrollTop + area.clientHeight / 2 - 24 : 0;
    const ratio = next / scale;
    setScale(next);
    requestAnimationFrame(() => {
      if (area)
        area.scrollTo(
          left * ratio - area.clientWidth / 2 + 24,
          top * ratio - area.clientHeight / 2 + 24,
        );
    });
  }
  function fit() {
    setScale(
      Math.max(
        0.03,
        Math.min(
          1,
          ((viewport.current?.clientWidth || 1000) - 48) / size.width,
        ),
      ),
    );
    viewport.current?.scrollTo(0, 0);
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panel.current?.requestFullscreen();
    } catch {
      setExpanded((value) => !value);
    }
  }
  const filtered = nodes.filter((node) =>
    node.label
      .toLocaleLowerCase("pt-BR")
      .includes(query.toLocaleLowerCase("pt-BR")),
  );
  return (
    <section
      ref={panel}
      className={"panel journey-diagram" + (expanded ? " expanded" : "")}
      aria-label={`Mapa da jornada ${index + 1}`}
    >
      <div className="panel-heading">
        <div>
          <h2>
            <Network size={20} /> O caminho da jornada
            {index > 0 ? ` · ${index + 1}` : ""}
          </h2>
          <p>
            {mode === "overview" && overview
              ? `${overview.nodeCount} componentes · ${overview.relationCount} conexões agrupadas. Explore o fluxo completo para consultar a sequência e as ramificações.`
              : "Todos os passos e ramificações. Busque um passo para ir direto ao ponto ou arraste o mapa para navegar."}
          </p>
        </div>
        {overview && (
          <div
            className="diagram-mode"
            role="group"
            aria-label="Visualização do mapa"
          >
            <button
              className={mode === "overview" ? "active" : ""}
              aria-pressed={mode === "overview"}
              onClick={() => setMode("overview")}
            >
              Visão geral
            </button>
            <button
              className={mode === "detail" ? "active" : ""}
              aria-pressed={mode === "detail"}
              onClick={() => setMode("detail")}
            >
              Fluxo completo
            </button>
          </div>
        )}
      </div>
      <div className="diagram-toolbar">
        <div className="diagram-controls">
          <button
            type="button"
            className="icon-button"
            aria-label="Diminuir mapa"
            onClick={() => zoom(Math.max(0.03, scale / 1.25))}
          >
            <Minus size={17} />
          </button>
          <output aria-label="Escala do mapa">
            {Math.round(scale * 100)}%
          </output>
          <button
            type="button"
            className="icon-button"
            aria-label="Ampliar mapa"
            onClick={() => zoom(Math.min(2, scale * 1.25))}
          >
            <Plus size={17} />
          </button>
          <button
            type="button"
            className="button secondary small"
            onClick={fit}
          >
            Ajustar largura
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Tamanho original"
            onClick={() => zoom(1)}
          >
            <RotateCcw size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Ir para o início da jornada"
            onClick={() => {
              const entryId = mode === "overview" ? overview?.entryId : "S1";
              const entry =
                nodes.find((node) =>
                  node.id.startsWith(`flowchart-${entryId}-`),
                ) || nodes[0];
              if (entry) focusNode(entry.id);
            }}
          >
            <Crosshair size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={
              expanded ? "Sair da tela cheia" : "Abrir mapa em tela cheia"
            }
            onClick={fullscreen}
          >
            {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
        </div>
        <div className="diagram-search">
          <label>
            <Search size={17} />
            <input
              type="search"
              aria-label="Buscar no mapa"
              placeholder="Buscar passo ou componente"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Ir para um passo ou componente"
            value={
              filtered.some((node) => node.id === selected) ? selected : ""
            }
            onChange={(e) => {
              if (e.target.value) focusNode(e.target.value);
            }}
          >
            <option value="">
              {query
                ? `${filtered.length} resultados — selecione`
                : "Ir para um passo ou componente"}
            </option>
            {filtered.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? (
        <div className="empty" role="alert">
          <p>{error}</p>
          <details>
            <summary>Código do diagrama</summary>
            <pre>{displaySource}</pre>
          </details>
        </div>
      ) : !svg ? (
        <div className="empty" role="status">
          Preparando o mapa…
        </div>
      ) : (
        <div
          ref={viewport}
          className="journey-diagram-viewport"
          tabIndex={0}
          aria-label="Área de rolagem do mapa"
          onPointerDown={(event) => {
            if (event.button !== 0 || event.pointerType === "touch") return;
            const area = event.currentTarget;
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              left: area.scrollLeft,
              top: area.scrollTop,
              moved: false,
            };
            area.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            const dx = event.clientX - start.x,
              dy = event.clientY - start.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
            if (start.moved) {
              event.currentTarget.scrollLeft = start.left - dx;
              event.currentTarget.scrollTop = start.top - dy;
            }
          }}
          onPointerUp={(event) => {
            if (drag.current && !drag.current.moved) {
              const node = document
                .elementFromPoint(event.clientX, event.clientY)
                ?.closest("g.node");
              if (node && event.currentTarget.contains(node))
                focusNode(node.id);
            }
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        >
          <div
            className="journey-diagram-canvas"
            style={{ width: size.width * scale, height: size.height * scale }}
          >
            <div
              className="journey-diagram-svg"
              style={{
                width: size.width,
                height: size.height,
                transform: `scale(${scale})`,
              }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      )}
      <div className="graph-foot" aria-live="polite">
        {selected
          ? nodes.find((node) => node.id === selected)?.label
          : mode === "overview"
            ? "As setas agrupam relações entre componentes; os números indicam ocorrências no fluxo. A sequência de execução está no fluxo completo."
            : "Arraste para navegar ou use as setas do teclado com o mapa em foco. Selecione um elemento para ler seu conteúdo."}
      </div>
    </section>
  );
}

// Preserve the engine's inline line breaks without enabling raw HTML.
function reportLineBreaks() {
  type Node = { type: string; value?: string; children?: Node[] };
  return (tree: Node) => {
    const visit = (node: Node) => {
      if (node.type === "html" && /^<br\s*\/?>$/i.test(node.value || "")) {
        node.type = "text";
        node.value = "\n";
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function MarkdownContent({ markdown }: { markdown: string }) {
  return (
    <div className="journey-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, reportLineBreaks]}
        skipHtml
        components={{
          table: ({ children }) => (
            <div
              className="journey-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Tabela do relatório; role horizontalmente para consultar todas as colunas"
            >
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => <span>{alt}</span>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export function ReportContent({
  markdown,
  manifest,
}: {
  markdown: string;
  manifest?: JourneyManifest | null;
}) {
  const report = useMemo(() => splitJourneyReport(markdown), [markdown]);
  const overview = useMemo(
    () => (manifest ? journeyOverview(manifest) : undefined),
    [manifest],
  );
  const mapId = "report-map-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <div className="journey-report-layout">
      <div id={mapId} className="journey-map-anchor" tabIndex={-1}>
        {report.diagrams.map((source, index) => (
          <JourneyDiagram
            key={index}
            source={source}
            index={index}
            overview={index === 0 ? overview : undefined}
          />
        ))}
      </div>
      {!report.diagrams.length && (
        <div className="notice">
          Este relatório não contém um macrofluxo visual. O conteúdo disponível
          está preservado abaixo.
        </div>
      )}
      <section className="panel journey-document">
        <div className="panel-heading">
          <div>
            <h2>
              <FileText size={20} /> Relatório da jornada
            </h2>
            <p>
              Identificação e visão de negócio sempre visíveis. Expanda as
              demais seções conforme precisar.
            </p>
          </div>
        </div>
        <article>
          {report.sections.map((section, index) => {
            const content = section.markdown
              .replace(/(?:^|\n)\s*---\s*$/, "")
              .trim();
            const body = (
              <>
                {content && <MarkdownContent markdown={content} />}
                {section.diagramIndexes.length > 0 && (
                  <div className="report-map-link">
                    <p>
                      O macrofluxo está no mapa acima, com a sequência de
                      passos, decisões e ramificações da jornada.
                    </p>
                    <a className="button secondary" href={`#${mapId}`}>
                      Consultar mapa da jornada
                    </a>
                  </div>
                )}
              </>
            );
            return section.number !== null && section.number > 3 ? (
              <details key={index} className="report-section expandable">
                <summary>
                  <h3>{section.title}</h3>
                  <span className="report-section-action">
                    <span className="when-closed">Expandir</span>
                    <span className="when-open">Recolher</span>
                    <ChevronDown size={20} />
                  </span>
                </summary>
                {body}
              </details>
            ) : (
              <section key={index} className="report-section">
                {section.title && <h3>{section.title}</h3>}
                {body}
              </section>
            );
          })}
        </article>
      </section>
    </div>
  );
}

export function JourneyReport({
  analysisId,
  ready,
  canRead,
  revision,
}: {
  analysisId: string;
  ready: boolean;
  canRead: boolean;
  revision: number;
}) {
  const [retry, setRetry] = useState(0);
  const requestKey = `${analysisId}:${revision}:${retry}:${ready}:${canRead}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    markdown: string | null;
    error: string;
    manifest?: JourneyManifest | null;
  }>({ key: "", markdown: null, error: "" });
  const markdown = loaded.key === requestKey ? loaded.markdown : null;
  const error = loaded.key === requestKey ? loaded.error : "";
  useEffect(() => {
    if (!ready || !canRead) return;
    const controller = new AbortController();
    const options = {
      credentials: "same-origin" as const,
      cache: "no-store" as const,
      signal: controller.signal,
    };
    const base = `/api/console/journeys/${encodeURIComponent(analysisId)}/artifacts/`;
    const markdownRequest = fetch(base + "markdown", options).then(
      async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 403
              ? "Sua permissão não permite acessar o relatório desta jornada."
              : "Não foi possível carregar o relatório. Tente novamente.",
          );
        const content = await response.text();
        if (!content.trim())
          throw new Error("O motor retornou um relatório vazio.");
        return content;
      },
    );
    // Overview is optional: the complete Markdown diagram remains available if
    // a legacy manifest is missing or fails its presentation schema validation.
    const manifestRequest = fetch(base + "manifest", options)
      .then(async (response) => {
        if (!response.ok) return null;
        return projectManifest(await response.json(), analysisId);
      })
      .catch(() => null);
    Promise.all([markdownRequest, manifestRequest])
      .then(([content, manifest]) => {
        if (!controller.signal.aborted)
          setLoaded({
            key: requestKey,
            markdown: content,
            manifest,
            error: "",
          });
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted)
          setLoaded({ key: requestKey, markdown: null, error: e.message });
      });
    return () => controller.abort();
  }, [analysisId, ready, canRead, requestKey]);
  if (!canRead)
    return (
      <div className="panel empty">
        <h3>Acesso ao relatório restrito</h3>
        <p>
          Seu administrador pode conceder a permissão de acesso aos artefatos da
          jornada.
        </p>
      </div>
    );
  if (!ready)
    return (
      <div className="panel empty">
        <Network />
        <h3>Aguardando o mapeamento</h3>
        <p>
          O mapa e o relatório aparecerão aqui quando a análise for concluída.
        </p>
      </div>
    );
  if (error)
    return (
      <div className="panel empty" role="alert">
        <p>{error}</p>
        <button
          className="button secondary"
          onClick={() => setRetry((v) => v + 1)}
        >
          Tentar novamente
        </button>
      </div>
    );
  if (markdown === null)
    return (
      <div className="panel empty" role="status">
        Carregando mapa e relatório…
      </div>
    );
  return (
    <ReportContent
      key={requestKey}
      markdown={markdown}
      manifest={loaded.manifest}
    />
  );
}

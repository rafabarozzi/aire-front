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
} from "lucide-react";
import {
  assertSafeFlowchart,
  splitJourneyReport,
} from "@/lib/aire/journey-report";

let renderer: Promise<(typeof import("mermaid"))["default"]> | undefined;
function getRenderer() {
  return (renderer ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      htmlLabels: false,
      maxTextSize: 200000,
      maxEdges: 10000,
      flowchart: { htmlLabels: false, useMaxWidth: false },
    });
    return mermaid;
  }));
}

function JourneyDiagram({ source, index }: { source: string; index: number }) {
  const id = "journey-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const viewport = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [rendered, setRendered] = useState({ source: "", svg: "", error: "" });
  const svg = rendered.source === source ? rendered.svg : "";
  const error = rendered.source === source ? rendered.error : "";
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ width: 1000, height: 600 });
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      const mermaid = await getRenderer();
      const { svg: output } = await mermaid.render(
        id,
        assertSafeFlowchart(source).replace(/<\/?b>/gi, ""),
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
        setScale(
          Math.max(
            0.03,
            Math.min(
              1,
              ((panel.current?.clientWidth || 1000) - 48) / (box?.[2] || 1000),
            ),
          ),
        );
        setRendered({ source, svg: clean, error: "" });
      }
    })().catch(() => {
      if (active)
        setRendered({
          source,
          svg: "",
          error:
            "Não foi possível desenhar este diagrama. O relatório e o código do mapa continuam disponíveis abaixo.",
        });
    });
    return () => {
      active = false;
    };
  }, [id, source]);
  useEffect(() => {
    const onFullScreen = () =>
      setExpanded(document.fullscreenElement === panel.current);
    document.addEventListener("fullscreenchange", onFullScreen);
    return () => document.removeEventListener("fullscreenchange", onFullScreen);
  }, []);
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
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panel.current?.requestFullscreen();
    } catch {
      setExpanded((value) => !value);
    }
  }
  return (
    <section
      ref={panel}
      className={"panel journey-diagram" + (expanded ? " expanded" : "")}
      aria-label={`Mapa da jornada ${index + 1}`}
    >
      <div className="panel-heading">
        <div>
          <h2>
            <Network size={18} /> O caminho da jornada
            {index > 0 ? ` · ${index + 1}` : ""}
          </h2>
          <p>
            Todos os passos do macrofluxo, incluindo ramificações e chamadas
            entre serviços. Use a rolagem para percorrer o mapa.
          </p>
          <p>
            Ramos assíncronos continuam o processamento sem bloquear a resposta.
            Uma fronteira de análise indica até onde o código foi inspecionado;
            o funcionamento interno desse destino permanece em aberto.
          </p>
        </div>
        <div className="diagram-controls">
          <button
            type="button"
            className="icon-button"
            aria-label="Diminuir mapa"
            onClick={() => setScale((s) => Math.max(0.03, s / 1.25))}
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
            onClick={() => setScale((s) => Math.min(2, s * 1.25))}
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
            onClick={() => setScale(1)}
          >
            <RotateCcw size={16} />
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
      </div>
      {error ? (
        <div className="empty" role="alert">
          <p>{error}</p>
          <details>
            <summary>Código do diagrama</summary>
            <pre>{source}</pre>
          </details>
        </div>
      ) : !svg ? (
        <div className="empty" role="status">
          Preparando o mapa completo…
        </div>
      ) : (
        <div
          ref={viewport}
          className="journey-diagram-viewport"
          tabIndex={0}
          aria-label="Área de rolagem do mapa"
        >
          <div
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
      <div className="graph-foot">
        Fluxo previsto no código. Condições e limites da análise estão
        documentados no relatório.
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

export function ReportContent({ markdown }: { markdown: string }) {
  const report = useMemo(() => splitJourneyReport(markdown), [markdown]);
  return (
    <div className="journey-report-layout">
      {report.diagrams.map((source, index) => (
        <JourneyDiagram key={index} source={source} index={index} />
      ))}
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
              <FileText size={18} /> Relatório da jornada
            </h2>
            <p>
              Contexto, etapas, dependências e evidências reunidos em uma
              leitura contínua.
            </p>
          </div>
        </div>
        <article className="journey-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, reportLineBreaks]}
            skipHtml
            components={{
              table: ({ children }) => (
                <div className="journey-table-scroll" tabIndex={0}>
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
            {report.markdown}
          </ReactMarkdown>
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
  }>({ key: "", markdown: null, error: "" });
  const markdown = loaded.key === requestKey ? loaded.markdown : null;
  const error = loaded.key === requestKey ? loaded.error : "";
  useEffect(() => {
    if (!ready || !canRead) return;
    const controller = new AbortController();
    fetch(
      `/api/console/journeys/${encodeURIComponent(analysisId)}/artifacts/markdown`,
      {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 403
              ? "Sua permissão não permite acessar o relatório desta jornada."
              : "Não foi possível carregar o relatório. Tente novamente.",
          );
        const content = await response.text();
        if (!content.trim())
          throw new Error("O motor retornou um relatório vazio.");
        if (!controller.signal.aborted)
          setLoaded({ key: requestKey, markdown: content, error: "" });
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
  return <ReportContent markdown={markdown} />;
}

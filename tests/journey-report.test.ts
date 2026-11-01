import test from "node:test";
import assert from "node:assert/strict";
import {
  splitJourneyReport,
  assertSafeFlowchart,
} from "../lib/aire/journey-report.ts";

test("extracts the complete macroflow and preserves section 3 and all report content", () => {
  const graph =
    "flowchart TD\n" +
    Array.from({ length: 80 }, (_, i) => `S${i}["Passo ${i}"]`).join("\n");
  const source = `# Identificação\n\nDescrição\n\n# 3 - Macro Fluxo da Jornada\n\n\`\`\`mermaid\n${graph}\n\`\`\`\n\n# Evidências\n\n| Passo | Arquivo |\n|---|---|\n| 79 | Controller.cs:20 |`;
  const result = splitJourneyReport(source);
  assert.deepEqual(result.diagrams, [graph]);
  assert.ok(result.markdown.includes("Descrição"));
  assert.ok(result.markdown.includes("Controller.cs:20"));
  assert.ok(result.markdown.includes("3 - Macro Fluxo"));
  assert.equal(result.sections[1].number, 3);
  assert.deepEqual(result.sections[1].diagramIndexes, [0]);
  assertSafeFlowchart(result.diagrams[0]);
});

test("section grouping keeps 1–6 in order, ignores code headings and preserves nested headings", () => {
  const source = `# 1 - Identificação\nNome\n# 2 - Descrição\nResumo\n# 3 - Macro Fluxo\n\n\`\`\`mermaid\ngraph TD\nA --> B\n\`\`\`\n# 4 - Passos\n## Detalhes\n\`\`\`text\n# 9 - Dentro do código\n\`\`\`\n| Passo | Ação |\n|---|---|\n| 111 | Fim |\n# 5 - Componentes\nAPIs\n# 6 - Alcance\nLimites`;
  const report = splitJourneyReport(source);
  assert.deepEqual(
    report.sections.map((s) => s.number),
    [1, 2, 3, 4, 5, 6],
  );
  assert.ok(report.sections[3].markdown.includes("# 9 - Dentro do código"));
  assert.ok(report.sections[3].markdown.includes("## Detalhes"));
  assert.ok(report.sections[3].markdown.includes("| 111 | Fim |"));
  assert.equal(report.sections[5].markdown, "Limites");
});

test("preserves non-diagram blocks, unclosed fences and multiple diagrams", () => {
  const result = splitJourneyReport(
    "```text\n```mermaid\nnot a graph\n```\n\n~~~mermaid\ngraph LR\nA --> B\n~~~\n\n```mermaid\nflowchart TD\nB --> C\n```\n\n```mermaid\nunclosed",
  );
  assert.equal(result.diagrams.length, 2);
  assert.ok(result.markdown.includes("not a graph"));
  assert.ok(result.markdown.endsWith("unclosed"));
});

for (const value of [
  '%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\nA --> B',
  'flowchart TD\nclick A "https://example.org"',
  "flowchart TD\nclassDef a fill:url(https://example.org)",
  'flowchart TD\nA["<img src=x>"]',
  "---\nconfig: {}\n---\nflowchart TD\nA --> B",
])
  test("rejects active diagram configuration: " + value.slice(0, 30), () => {
    assert.throws(() => assertSafeFlowchart(value));
  });

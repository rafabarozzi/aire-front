import test from "node:test";
import assert from "node:assert/strict";
import {
  splitJourneyReport,
  assertSafeFlowchart,
} from "../lib/aire/journey-report.ts";

test("moves the complete macroflow above the report without cutting steps or evidence", () => {
  const graph =
    "flowchart TD\n" +
    Array.from({ length: 80 }, (_, i) => `S${i}["Passo ${i}"]`).join("\n");
  const source = `# Identificação\n\nDescrição\n\n# 3 - Macro Fluxo da Jornada\n\n\`\`\`mermaid\n${graph}\n\`\`\`\n\n# Evidências\n\n| Passo | Arquivo |\n|---|---|\n| 79 | Controller.cs:20 |`;
  const result = splitJourneyReport(source);
  assert.deepEqual(result.diagrams, [graph]);
  assert.ok(result.markdown.includes("Descrição"));
  assert.ok(result.markdown.includes("Controller.cs:20"));
  assert.ok(!result.markdown.includes("Macro Fluxo"));
  assertSafeFlowchart(result.diagrams[0]);
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

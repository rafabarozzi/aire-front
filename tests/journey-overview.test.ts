import test from "node:test";
import assert from "node:assert/strict";
import { projectManifest } from "../lib/aire/manifest.ts";
import { journeyOverview } from "../lib/aire/journey-overview.ts";
import { assertSafeFlowchart } from "../lib/aire/journey-report.ts";

test("overview aggregates repeated edges without losing nodes, direction, type or owner", () => {
  const edges = [
    ["entry", "pay", "http"],
    ["entry", "pay", "http"],
    ["pay", "entry", "http"],
    ["entry", "pay", "messaging"],
    ["pay", "db", "database"],
  ];
  const manifest = projectManifest(
    {
      documentType: "journey_structural_manifest",
      profile: "aire.journey-structural-manifest.v1",
      schemaVersion: "1.0",
      analysis: { id: "analysis", status: "COMPLETED" },
      services: [
        { id: "entry", name: "Orders", role: "entry_service" },
        { id: "pay", name: "Payments", role: "participant" },
        { id: "isolated", name: "Other", role: "participant" },
      ],
      resources: [
        {
          id: "db",
          name: 'Jdbc"<img src=x>\\n',
          type: "database",
          ownedBy: "pay",
          detail: "Logical code resource",
        },
      ],
      dependencies: edges.map(([from, to, type], i) => ({
        id: "edge" + i,
        from,
        to,
        type,
        conditional: i === 0,
        asynchronous: i === 3,
        evidenceRefs: [],
      })),
      evidence: [],
    },
    "analysis",
  );
  const overview = journeyOverview(manifest);
  assert.equal(overview.nodeCount, 4);
  assert.equal(overview.relationCount, 4);
  assert.equal(overview.entryId, "N0");
  assert.ok(
    overview.source.includes('N0 -->|"HTTP · 2"| N1') ||
      overview.source.includes('N0 -->|"HTTP #183; 2"| N1'),
  );
  assert.ok(overview.source.includes('N1 -->|"HTTP"| N0'));
  assert.ok(overview.source.includes('N0 -->|"Eventos"| N1'));
  assert.ok(overview.source.includes('N2["Other'));
  assert.ok(overview.source.includes("Payments"));
  assert.ok(!overview.source.includes("<img"));
  assertSafeFlowchart(overview.source);
  assert.equal(manifest.dependencies.length, 5);
});

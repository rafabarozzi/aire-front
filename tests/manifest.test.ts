import test from "node:test";
import assert from "node:assert/strict";
import { projectManifest } from "../lib/aire/manifest.ts";
const fixture = {
  documentType: "journey_structural_manifest",
  profile: "aire.journey-structural-manifest.v1",
  schemaVersion: "1.0",
  analysis: { id: "test-analysis", status: "COMPLETED" },
  services: [
    { id: "a", name: "checkout", role: "entry_service" },
    { id: "b", name: "payments", role: "participant" },
  ],
  resources: [],
  evidence: [
    { id: "ev1", path: "Checkout.java", line: 20, kind: "SOURCE_REFERENCE" },
  ],
  dependencies: [
    {
      id: "d1",
      from: "a",
      to: "b",
      type: "http",
      conditional: true,
      asynchronous: false,
      evidenceRefs: ["ev1"],
    },
  ],
};
test("canonical projection preserves directed edges, conditional status and source line", () => {
  const result = projectManifest(fixture, "test-analysis");
  assert.equal(result.dependencies[0].from, "a");
  assert.equal(result.dependencies[0].to, "b");
  assert.equal(result.dependencies[0].conditional, true);
  assert.equal(result.evidence[0].line, 20);
});
test("another analysis cannot be displayed under the selected journey", () => {
  assert.throws(() => projectManifest(fixture, "other-analysis"));
});
test("unknown graph or evidence references are not silently drawn", () => {
  assert.throws(() =>
    projectManifest(
      {
        ...fixture,
        dependencies: [{ ...fixture.dependencies[0], to: "missing" }],
      },
      "test-analysis",
    ),
  );
  assert.throws(() =>
    projectManifest({ ...fixture, evidence: [] }, "test-analysis"),
  );
});
test("unsupported schema and duplicated graph IDs are rejected", () => {
  assert.throws(() =>
    projectManifest({ ...fixture, schemaVersion: "2.0" }, "test-analysis"),
  );
  assert.throws(() =>
    projectManifest(
      { ...fixture, services: [fixture.services[0], fixture.services[0]] },
      "test-analysis",
    ),
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  manifestTechnologies,
  withTechnologies,
} from "../lib/server/journey-technologies.ts";
import type { Journey } from "../lib/aire/types.ts";
import type { Tenant } from "../lib/server/config.ts";

const manifest = (id: string) => ({
  documentType: "journey_structural_manifest",
  profile: "aire.journey-structural-manifest.v1",
  schemaVersion: "1.0",
  analysis: { id, status: "COMPLETED" },
  dependencies: [],
  services: [],
  resources: [
    {
      id: "queue",
      type: "queue",
      name: "events",
      ownedBy: null,
      detail: "",
      system: "RABBITMQ",
    },
    {
      id: "pseudo",
      type: "queue",
      name: "internal",
      detail: "",
      system: "IN_PROCESS",
    },
    { id: "store", type: "database", name: "ShippingStore", detail: "" },
  ],
  evidence: [
    "inventory.scala-doc",
    "apps/catalog/Main.java",
    "apps/catalog/Price.java",
    "service/Controller.cs",
    "src/handler.ts",
  ].map((path, i) => ({
    id: "e" + i,
    path,
    kind: "DECLARING_METHOD",
    line: 1,
  })),
});

test("extracts only evidenced language and explicit resources, accepts nullable owners", () => {
  assert.deepEqual(manifestTechnologies(manifest("a"), "a"), [
    "C#",
    "Java",
    "RabbitMQ",
    "TypeScript",
  ]);
  assert.throws(() => manifestTechnologies(manifest("b"), "a"));
});

test("summaries for legacy records are tenant scoped, cached and resilient", async () => {
  const original = globalThis.fetch,
    previous = process.env.STACK_TEST_URL;
  process.env.STACK_TEST_URL = "http://test";
  process.env.STACK_TEST_TOKEN = "synthetic";
  const id = crypto.randomUUID(),
    row: Journey = { id, name: "Checkout", tier: "Gold", endpoint: "POST /checkout",
      repository: "owner/repo", createdAt: new Date().toISOString(),
      revision: "r", status: "COMPLETED", stacks: [] };
  const tenant = {
    id: "lab-a",
    engineUrlEnv: "STACK_TEST_URL",
    engineTokenEnv: "STACK_TEST_TOKEN",
  } as Tenant;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (new Headers(init?.headers).get("X-AIRE-Tenant") !== "lab-a")
      return new Response(null, { status: 503 });
    return Response.json(manifest(id));
  };
  try {
    const [a] = await withTechnologies(tenant, [row]);
    assert.equal(a.stackEvidence, "verified");
    assert.equal((await withTechnologies(tenant, [row]))[0].stacks.length, 4);
    assert.equal(calls, 1);
    const [b] = await withTechnologies({ ...tenant, id: "lab-b" }, [row]);
    assert.equal(b.stackEvidence, "unavailable");
    assert.deepEqual(b.stacks, []);
    assert.deepEqual(row.stacks, []);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.STACK_TEST_URL;
    else process.env.STACK_TEST_URL = previous;
    delete process.env.STACK_TEST_TOKEN;
  }
});

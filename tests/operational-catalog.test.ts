import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  catalogSchema,
  emptyCatalog,
  emptyResponseSelection,
  responseContext,
  resolveDestination,
} from "../lib/aire/operational-catalog.ts";
import {
  readOperationalCatalog,
  saveOperationalCatalog,
} from "../lib/server/observability-store.ts";
const team = { id: "81ec72d0-3101-49f6-a514-4ab1ad9be831", name: "Commerce" };
const ert = { id: "81ec72d0-3101-49f6-a514-4ab1ad9be832", name: "ERT" };
const room = {
  id: "81ec72d0-3101-49f6-a514-4ab1ad9be833",
  name: "Varejo",
  provider: "teams" as const,
  kind: "room" as const,
  reference: "room-varejo",
};
const window = {
  id: "81ec72d0-3101-49f6-a514-4ab1ad9be834",
  name: "Noturna",
  timezone: "America/Sao_Paulo",
  days: [1, 2, 3, 4, 5],
  start: "22:00",
  end: "06:00",
};
function fixture() {
  return {
    ...emptyCatalog(),
    teams: [team, ert],
    windows: [window],
    destinations: [room],
    alwaysTeamIds: [ert.id],
    routes: [
      {
        id: "81ec72d0-3101-49f6-a514-4ab1ad9be835",
        key: "bu",
        value: "varejo",
        destinationId: room.id,
      },
    ],
  };
}
test("overnight windows are valid; duplicate days, invalid timezone and missing route targets are rejected", () => {
  assert.equal(catalogSchema.safeParse(fixture()).success, true);
  const bad = fixture();
  bad.windows[0] = { ...window, timezone: "not/a/zone" };
  assert.equal(catalogSchema.safeParse(bad).success, false);
  bad.windows[0] = { ...window, days: [1, 1] };
  assert.equal(catalogSchema.safeParse(bad).success, false);
  bad.windows = [];
  bad.destinations = [];
  assert.equal(catalogSchema.safeParse(bad).success, false);
});
test("routing resolves one destination, uses explicit fallback and blocks conflicting tags", () => {
  const c = fixture();
  assert.equal(resolveDestination(c, { bu: "varejo" })?.id, room.id);
  assert.equal(resolveDestination(c, {}), null);
  c.defaultDestinationId = room.id;
  assert.equal(resolveDestination(c, {})?.id, room.id);
  const other = { ...room, id: crypto.randomUUID() };
  c.destinations.push(other);
  c.routes.push({
    id: crypto.randomUUID(),
    key: "team",
    value: "platform",
    destinationId: other.id,
  });
  assert.throws(
    () => resolveDestination(c, { bu: "varejo", team: "platform" }),
    /salas diferentes/,
  );
});
test("response context preserves independent windows and does not mutate catalog", () => {
  const c = fixture();
  const before = JSON.stringify(c);
  const result = responseContext(
    c,
    team.id,
    { ...emptyResponseSelection(), warRoomWindowId: window.id },
    { bu: "varejo" },
  );
  assert.equal(result.notificationWindow, null);
  assert.equal(result.warRoomWindow?.start, "22:00");
  assert.deepEqual(result.additionalTeams, [ert]);
  assert.equal(result.destination?.reference, "room-varejo");
  assert.throws(
    () => responseContext(c, crypto.randomUUID(), emptyResponseSelection(), {}),
    /equipe/,
  );
  assert.equal(JSON.stringify(c), before);
});
test("catalog persistence is tenant scoped and rejects stale revisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aire-catalog-"));
  const old = process.env.AIRE_DATA_DIR;
  process.env.AIRE_DATA_DIR = dir;
  try {
    const saved = await saveOperationalCatalog("alpha", 0, fixture(), "alice");
    assert.equal(saved.revision, 1);
    assert.equal(
      (await readOperationalCatalog("beta")).catalog.teams.length,
      0,
    );
    assert.equal(
      (await readOperationalCatalog("alpha")).catalog.windows[0].name,
      "Noturna",
    );
    await assert.rejects(
      saveOperationalCatalog("alpha", 0, fixture(), "bob"),
      /outra pessoa/,
    );
  } finally {
    if (old === undefined) delete process.env.AIRE_DATA_DIR;
    else process.env.AIRE_DATA_DIR = old;
    await rm(dir, { recursive: true, force: true });
  }
});

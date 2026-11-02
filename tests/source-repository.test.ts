import test from "node:test";
import assert from "node:assert/strict";
import { sourceRepository } from "../lib/aire/source-repository.ts";

test("GitLab subgroups are preserved and provider identities cannot collide", () => {
  assert.equal(sourceRepository("gitlab", "https://gitlab.com/company/team/api.git").path, "company/team/api");
  assert.notEqual(sourceRepository("github", "team/api").identity, sourceRepository("gitlab", "team/api").identity);
});
test("source paths reject credentials, other hosts, traversal and query parameters", () => {
  for (const path of ["https://gitlab.com@evil.test/a/b", "https://user@gitlab.com/a/b", "https://gitlab.com/a/b?token=x", "a/../b", "https://github.com/a/b", "https://gitlab.com:8443/a/b"])
    assert.throws(() => sourceRepository("gitlab", path));
  assert.throws(() => sourceRepository("github", "company/team/api"));
  assert.throws(() => sourceRepository("gitlab", "https://gitlab.com/a/../team/api"));
  assert.throws(() => sourceRepository("gitlab", "https://gitlab.com/a/%2e%2e/team/api"));
});

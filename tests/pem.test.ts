import test from "node:test";
import assert from "node:assert/strict";
import { importedPem } from "../lib/aire/pem.ts";
test("PEM imports accept PKCS1 and PKCS8, preserve content and reject unrelated files", () => {
  for (const prefix of ["RSA ", ""]) {
    const value = `-----BEGIN ${prefix}PRIVATE KEY-----\nU1lOVEhFVElD\n-----END ${prefix}PRIVATE KEY-----`;
    assert.equal(importedPem("test.pem", value + "\n"), value);
    assert.equal(importedPem("test.PEM", value.replaceAll("\n", "\r\n")), value.replaceAll("\n", "\r\n"));
    assert.throws(() => importedPem("test.txt", value));
  }
  assert.throws(() => importedPem("test.pem", "x".repeat(8193)));
  assert.throws(() => importedPem("test.pem", "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----"));
  assert.throws(() => importedPem("test.pem", "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"));
});

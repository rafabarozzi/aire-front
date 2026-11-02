import test from "node:test";
import assert from "node:assert/strict";
import { invitationEmail } from "../lib/server/invitation-email.ts";
const link =
  "https://aire.example/onboarding?organization=lab#invite=synthetic-token";
test("branded multipart invitation preserves activation fragment and fallback", () => {
  const mail = invitationEmail("Northeia Lab", link);
  assert.match(mail.html, /Configurar meu acesso/);
  assert.match(mail.html, /lang="pt-BR"/);
  assert.equal(mail.html.split(`href="${link}"`).length - 1, 2);
  assert.ok(mail.text.includes(link));
  for (const content of [mail.html, mail.text]) {
    assert.match(content, /24 horas/);
    assert.match(content, /7 dias/);
    assert.match(content, /somente configurar o SSO/);
    assert.match(content, /Northeia Lab/);
  }
  assert.doesNotMatch(mail.html, /<script|<iframe|<form|<img|@import/i);
});
test("organization and URL are escaped in HTML and subject has no line breaks", () => {
  const mail = invitationEmail(
    '<img src=x onerror="bad"> & Client\r\nInjected',
    link + '&other="value"',
  );
  assert.doesNotMatch(mail.html, /<img/);
  assert.match(mail.html, /&lt;img/);
  assert.match(mail.html, /&amp; Client/);
  assert.match(mail.html, /&amp;other=&quot;value&quot;/);
  assert.doesNotMatch(mail.subject, /[\r\n]/);
  assert.throws(() => invitationEmail("Lab", "javascript:alert(1)"));
  assert.throws(() =>
    invitationEmail("Lab", "https://user:secret@example.com"),
  );
});

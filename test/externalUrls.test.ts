import assert from "node:assert/strict";
import test from "node:test";
import { isSafeClickUpTicketUrl, isSafeExternalUrl } from "../src/externalUrls";

test("allows normal http links but restricts ClickUp actions to task URLs", () => {
  assert.equal(isSafeExternalUrl("https://example.com/docs"), true);
  assert.equal(isSafeExternalUrl("http://localhost:3000"), true);
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalUrl("not a URL"), false);

  assert.equal(isSafeClickUpTicketUrl("https://app.clickup.com/t/86d3tzb0g"), true);
  assert.equal(isSafeClickUpTicketUrl("https://app.clickup.com/t/ABC_123-xy/"), true);
  assert.equal(isSafeClickUpTicketUrl("https://app.clickup.com/t/86d3tzb0g/comments"), false);
  assert.equal(isSafeClickUpTicketUrl("https://clickup.com/t/86d3tzb0g"), false);
});

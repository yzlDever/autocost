import assert from "node:assert/strict";
import test from "node:test";
import { getDingTalkAuthorizationCode } from "../src/lib/dingtalk-oauth";

test("reads DingTalk's documented authCode callback parameter", () => {
  const params = new URLSearchParams({ authCode: "ding-auth-code" });
  assert.equal(getDingTalkAuthorizationCode(params), "ding-auth-code");
});

test("keeps compatibility with the standard OAuth code parameter", () => {
  const params = new URLSearchParams({ code: "oauth-code" });
  assert.equal(getDingTalkAuthorizationCode(params), "oauth-code");
});

test("prefers DingTalk authCode when both callback parameters are present", () => {
  const params = new URLSearchParams({
    authCode: "ding-auth-code",
    code: "oauth-code",
  });
  assert.equal(getDingTalkAuthorizationCode(params), "ding-auth-code");
});

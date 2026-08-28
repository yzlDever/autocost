import assert from "node:assert/strict";
import test from "node:test";
import {
  isDingTalkUserAllowed,
  parseDingTalkAllowedUserIds,
} from "../src/lib/dingtalk-login-scope";

test("allows any current enterprise userId when the wildcard is configured", () => {
  const allowedUserIds = parseDingTalkAllowedUserIds("*");
  assert.equal(isDingTalkUserAllowed(allowedUserIds, "enterprise-user-1"), true);
  assert.equal(isDingTalkUserAllowed(allowedUserIds, "enterprise-user-2"), true);
});

test("wildcard never accepts an empty userId", () => {
  const allowedUserIds = parseDingTalkAllowedUserIds("*");
  assert.equal(isDingTalkUserAllowed(allowedUserIds, ""), false);
  assert.equal(isDingTalkUserAllowed(allowedUserIds, "   "), false);
});

test("keeps exact userId allowlists available", () => {
  const allowedUserIds = parseDingTalkAllowedUserIds("user-1, user-2");
  assert.equal(isDingTalkUserAllowed(allowedUserIds, "user-2"), true);
  assert.equal(isDingTalkUserAllowed(allowedUserIds, "user-3"), false);
});

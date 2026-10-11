import assert from "node:assert/strict";
import test from "node:test";
import { LIVE_SESSION_MAX_MESSAGES, LIVE_SESSION_MILLISECONDS, parseLiveSender } from "../src/live-session.js";

test("live session requires an explicit E.164 sender", () => {
  assert.equal(parseLiveSender(["--live", "--sender", "+12025550123"]), "+12025550123");
  assert.equal(parseLiveSender([]), undefined);
  assert.equal(parseLiveSender(["--live"]), undefined);
  assert.equal(parseLiveSender(["--sender", "+12025550123", "--live"]), undefined);
  assert.equal(parseLiveSender(["--live", "--sender", "12025550123"]), undefined);
  assert.equal(parseLiveSender(["--live", "--sender", "+0123456789"]), undefined);
  assert.equal(parseLiveSender(["--live", "--sender", "+12025550123", "--unbounded"]), undefined);
});

test("live session has a finite duration and message cap", () => {
  assert.equal(LIVE_SESSION_MILLISECONDS, 30 * 60_000);
  assert.equal(LIVE_SESSION_MAX_MESSAGES, 20);
});

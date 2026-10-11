import assert from "node:assert/strict";
import test from "node:test";
import { PrivateCheckAgent } from "../src/agent.js";
import { toIncomingEvent } from "../src/sdk-boundary.js";
import { FakeService, PRIVATE_SENTINEL, PRIVATE_URL, SYNTHETIC_MESSAGE } from "./helpers.js";

const NOW = 1_000_000;
const STARTED_AT = NOW - 60_000;
const space = { id: "synthetic-cloud-dm", type: "dm" };
function cloudMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    platform: "imessage", direction: "inbound", id: "synthetic-cloud-message",
    timestamp: new Date(NOW), content: { type: "text", text: SYNTHETIC_MESSAGE },
    reply: async (_text: string) => {}, ...overrides,
  };
}

test("the SDK boundary maps a fresh explicit inbound DM without retaining the provider object", async () => {
  const replies: string[] = [];
  const sdk = cloudMessage({ sender: PRIVATE_SENTINEL, reply: async (text: string) => replies.push(text) });
  const mapped = toIncomingEvent(space, sdk, STARTED_AT, NOW)!;
  assert.deepEqual(Object.keys(mapped).sort(), ["content", "direction", "messageID", "platform", "reply", "spaceID", "spaceType"]);
  assert.deepEqual(mapped.content, { type: "text", text: SYNTHETIC_MESSAGE });
  await mapped.reply("Synthetic response");
  assert.deepEqual(replies, ["Synthetic response"]);
  assert.equal("sender" in mapped, false);
  assert.notEqual(mapped.content, sdk.content);
});

test("live routing accepts only the configured sender in that sender's direct chat", () => {
  const sender = "+12025550123";
  const ownSpace = { id: `any;-;${sender}`, type: "dm" };
  const ownMessage = cloudMessage({ sender: { address: sender } });
  assert.ok(toIncomingEvent(ownSpace, ownMessage, STARTED_AT, NOW, sender));
  assert.equal(toIncomingEvent(ownSpace, cloudMessage({ sender: { address: "+12025550124" } }), STARTED_AT, NOW, sender), undefined);
  assert.equal(toIncomingEvent({ id: "any;-;+12025550124", type: "dm" }, ownMessage, STARTED_AT, NOW, sender), undefined);
  assert.equal(toIncomingEvent(ownSpace, cloudMessage(), STARTED_AT, NOW, sender), undefined);
});

for (const [name, overrides] of [
  ["outbound", { direction: "outbound" }],
  ["unknown direction", { direction: undefined }],
  ["SMS", { platform: "sms" }],
  ["automatic reply", { isAutoReply: true }],
  ["system message", { isSystemMessage: true }],
  ["service message", { isServiceMessage: true }],
  ["non-normal item", { itemType: "reaction" }],
  ["before agent startup", { timestamp: new Date(STARTED_AT - 1) }],
  ["stale backlog", { timestamp: new Date(NOW - 5 * 60_000 - 1) }],
  ["excessive future time", { timestamp: new Date(NOW + 30_001) }],
  ["invalid date", { timestamp: new Date(Number.NaN) }],
  ["string date", { timestamp: "2026-10-10T00:00:00Z" }],
  ["missing timestamp", { timestamp: undefined }],
  ["missing reply method", { reply: undefined }],
  ["unknown content", { content: { type: "unknown", text: PRIVATE_SENTINEL } }],
  ["malformed text", { content: { type: "text", text: 123 } }],
  ["malformed rich link", { content: { type: "richlink", url: null } }],
] as const) {
  test(`SDK ${name} is skipped before check or reply`, async () => {
    const service = new FakeService();
    const candidate = toIncomingEvent(space, cloudMessage(overrides), STARTED_AT, NOW);
    assert.equal(candidate, undefined);
    if (candidate) await new PrivateCheckAgent(service).handle(candidate);
    assert.equal(service.calls.length, 0);
  });
}

test("group and malformed spaces are rejected even when the message is fresh inbound text", () => {
  for (const badSpace of [{ id: "group", type: "group" }, { id: 123, type: "dm" }, null, undefined]) {
    assert.equal(toIncomingEvent(badSpace, cloudMessage(), STARTED_AT, NOW), undefined);
  }
  assert.equal(toIncomingEvent(space, null, STARTED_AT, NOW), undefined);
});

test("attachment mapping does not access media readers or provider identities", async () => {
  const message = cloudMessage({ content: { type: "attachment" } });
  for (const name of ["attachments", "sender", "getAttachments", "getAttachmentData", "history"]) {
    Object.defineProperty(message, name, { get() { assert.fail(`SDK accessed forbidden ${name}`); } });
  }
  const mapped = toIncomingEvent(space, message, STARTED_AT, NOW)!;
  assert.deepEqual(mapped.content, { type: "attachment" });
  const service = new FakeService();
  await new PrivateCheckAgent(service).handle(mapped);
  assert.equal(service.calls.length, 0);
});

test("SDK rich-link mapping preserves only the explicitly sent URL", () => {
  const mapped = toIncomingEvent(space, cloudMessage({
    content: { type: "richlink", url: PRIVATE_URL, title: PRIVATE_SENTINEL, previewImage: PRIVATE_SENTINEL },
  }), STARTED_AT, NOW)!;
  assert.deepEqual(mapped.content, { type: "richlink", url: PRIVATE_URL });
});

import assert from "node:assert/strict";
import test from "node:test";
import { PrivateCheckAgent, type IncomingEvent } from "../src/agent.js";
import type { CheckService } from "../src/contracts.js";
import { CheckFailure, MAX_TEXT_SCALARS } from "../src/ravel-client.js";
import {
  ATTACHMENT_REPLY, HELP_REPLY, PRIVACY_REPLY, REPORT_REPLY,
} from "../src/replies.js";
import {
  deferred, event, FakeService, fixtureResponse, PRIVATE_SENTINEL, PRIVATE_URL,
  SYNTHETIC_MESSAGE, urlResponse,
} from "./helpers.js";

test("an explicit inbound DM submits only its selected text and returns a labeled private result", async () => {
  const service = new FakeService();
  const incoming = event();
  await new PrivateCheckAgent(service).handle(incoming.event);
  assert.deepEqual(service.calls.map((call) => call.submission), [{ content_type: "text", text: SYNTHETIC_MESSAGE }]);
  assert.equal(incoming.replies.length, 1);
  assert.match(incoming.replies[0]!, /Fixture demo: simulated assessment/);
  assert.match(incoming.replies[0]!, /Suspicious: verify before acting/);
  assert.match(incoming.replies[0]!, /no community report was created/);
  assert.doesNotMatch(incoming.replies[0]!, /verified fraud|known malicious|99%|100%/i);
});

for (const content of [
  { type: "text", text: PRIVATE_URL },
  { type: "richlink", url: PRIVATE_URL },
] satisfies IncomingEvent["content"][]) {
  test(`standalone ${content.type} URL preserves the selected input but replies with local-only limitations`, async () => {
    const service = new FakeService(urlResponse());
    const incoming = event({ content });
    await new PrivateCheckAgent(service).handle(incoming.event);
    assert.deepEqual(service.calls[0]!.submission, { content_type: "url", url: PRIVATE_URL });
    assert.match(incoming.replies[0]!, /link parsed locally/);
    assert.match(incoming.replies[0]!, /not visited, analyzed by AI, or checked against reputation data/);
    assert.doesNotMatch(incoming.replies[0]!, /private-query-token|private-fragment|tickets\.example/);
  });
}

test("a message containing a link remains a text check rather than losing its context", async () => {
  const selected = SYNTHETIC_MESSAGE + " " + PRIVATE_URL;
  const service = new FakeService();
  await new PrivateCheckAgent(service).handle(event({ content: { type: "text", text: selected } }).event);
  assert.deepEqual(service.calls[0]!.submission, { content_type: "text", text: selected });
});

for (const [command, expected] of [
  ["/help", HELP_REPLY], [" HELP ", HELP_REPLY], ["/START", HELP_REPLY],
  ["/privacy", PRIVACY_REPLY], ["privacy", PRIVACY_REPLY],
  ["/report", REPORT_REPLY], ["report this message", REPORT_REPLY],
] as const) {
  test(`command ${JSON.stringify(command)} does not analyze or create a report`, async () => {
    const service = new FakeService();
    const incoming = event({ content: { type: "text", text: command } });
    await new PrivateCheckAgent(service).handle(incoming.event);
    assert.equal(service.calls.length, 0);
    assert.deepEqual(incoming.replies, [expected]);
  });
}

test("attachments are refused without downloading or checking media", async () => {
  const service = new FakeService();
  const incoming = event({ content: { type: "attachment" } });
  await new PrivateCheckAgent(service).handle(incoming.event);
  assert.equal(service.calls.length, 0);
  assert.deepEqual(incoming.replies, [ATTACHMENT_REPLY]);
  assert.match(incoming.replies[0]!, /No attachment was downloaded or analyzed/);
});

for (const [name, overrides] of [
  ["outbound", { direction: "outbound" }],
  ["missing explicit inbound direction", { direction: undefined }],
  ["group", { spaceType: "group" }],
  ["unknown space", { spaceType: "unknown" }],
  ["other platform", { platform: "sms" }],
  ["unsupported content", { content: { type: "unsupported" } }],
  ["missing message ID", { messageID: "" }],
  ["oversized message ID", { messageID: "x".repeat(513) }],
  ["missing space ID", { spaceID: "" }],
] satisfies [string, Partial<IncomingEvent>][]) {
  test(`${name} events are ignored without reply or backend call`, async () => {
    const service = new FakeService();
    const incoming = event(overrides);
    await new PrivateCheckAgent(service).handle(incoming.event);
    assert.equal(service.calls.length, 0);
    assert.deepEqual(incoming.replies, []);
  });
}

test("the same event cannot cause duplicate backend calls or duplicate replies", async () => {
  const service = new FakeService();
  const incoming = event();
  const agent = new PrivateCheckAgent(service);
  await agent.handle(incoming.event);
  await agent.handle(incoming.event);
  assert.equal(service.calls.length, 1);
  assert.equal(incoming.replies.length, 1);
});

test("concurrent duplicates are suppressed before the first response completes", async () => {
  const pending = deferred<ReturnType<typeof fixtureResponse>>();
  let calls = 0;
  const service: CheckService = { check: async () => { calls++; return pending.promise; } };
  const agent = new PrivateCheckAgent(service);
  const incoming = event();
  const first = agent.handle(incoming.event);
  await agent.handle(incoming.event);
  assert.equal(calls, 1);
  assert.equal(incoming.replies.length, 0);
  pending.resolve(fixtureResponse());
  await first;
  assert.equal(incoming.replies.length, 1);
});

test("identical message IDs in separate DMs do not suppress an independent check", async () => {
  const service = new FakeService();
  const agent = new PrivateCheckAgent(service);
  await agent.handle(event({ spaceID: "synthetic-dm-a" }).event);
  await agent.handle(event({ spaceID: "synthetic-dm-b" }).event);
  assert.equal(service.calls.length, 2);
});

test("dedupe expires without requiring persistent content retention", async () => {
  let now = 1_000_000;
  const service = new FakeService();
  const agent = new PrivateCheckAgent(service, () => now);
  const incoming = event();
  await agent.handle(incoming.event);
  now += 10 * 60_000;
  await agent.handle(incoming.event);
  assert.equal(service.calls.length, 2);
});

test("oversized and empty selected messages receive fixed errors without analysis", async () => {
  const service = new FakeService();
  const agent = new PrivateCheckAgent(service);
  const oversized = event({ content: { type: "text", text: PRIVATE_SENTINEL + "😀".repeat(MAX_TEXT_SCALARS) } });
  await agent.handle(oversized.event);
  assert.equal(service.calls.length, 0);
  assert.match(oversized.replies[0]!, /exceeds the check limit/);
  assert.doesNotMatch(oversized.replies[0]!, new RegExp(PRIVATE_SENTINEL));
  const empty = event({ messageID: "empty-message", content: { type: "text", text: " \n " } });
  await agent.handle(empty.event);
  assert.match(empty.replies[0]!, /Send one message/);
  assert.equal(service.calls.length, 0);
});

test("the per-DM check limit refuses further analysis rather than queuing content", async () => {
  const service = new FakeService();
  const agent = new PrivateCheckAgent(service, () => 1_000_000);
  for (let index = 0; index < 3; index++) await agent.handle(event({ messageID: `message-${index}` }).event);
  const refused = event({ messageID: "message-4" });
  await agent.handle(refused.event);
  assert.equal(service.calls.length, 3);
  assert.match(refused.replies[0]!, /limit was reached.*no analysis was performed/);
});

test("command reply rate limits prevent an unlimited response loop", async () => {
  const service = new FakeService();
  const agent = new PrivateCheckAgent(service, () => 1_000_000);
  let replies = 0;
  for (let index = 0; index < 9; index++) {
    const incoming = event({ messageID: `help-${index}`, content: { type: "text", text: "/help" } });
    await agent.handle(incoming.event);
    replies += incoming.replies.length;
  }
  assert.equal(replies, 8);
  assert.equal(service.calls.length, 0);
});

test("a global minute cap bounds checks across distinct conversations", async () => {
  const service = new FakeService();
  const agent = new PrivateCheckAgent(service, () => 1_000_000);
  for (let index = 0; index < 20; index++) await agent.handle(event({ spaceID: `dm-${index}` }).event);
  const refused = event({ spaceID: "dm-over-limit" });
  await agent.handle(refused.event);
  assert.equal(service.calls.length, 20);
  assert.match(refused.replies[0]!, /no analysis was performed/);
});

test("only two active checks can run and busy inputs are not queued", async () => {
  const pending = deferred<ReturnType<typeof fixtureResponse>>();
  let calls = 0;
  const service: CheckService = { check: async () => { calls++; return pending.promise; } };
  const agent = new PrivateCheckAgent(service);
  const first = agent.handle(event({ spaceID: "dm-first" }).event);
  const second = agent.handle(event({ spaceID: "dm-second" }).event);
  const busy = event({ spaceID: "dm-third" });
  await agent.handle(busy.event);
  assert.equal(calls, 2);
  assert.match(busy.replies[0]!, /not queued or analyzed/);
  pending.resolve(fixtureResponse());
  await Promise.all([first, second]);
  assert.equal(calls, 2);
});

test("provider errors and SDK reply failures expose fixed status codes without raw content", async () => {
  const statuses: string[] = [];
  const incoming = event();
  const service = new FakeService(fixtureResponse(), new Error(PRIVATE_SENTINEL + PRIVATE_URL));
  await new PrivateCheckAgent(service, Date.now, (code) => statuses.push(code)).handle(incoming.event);
  assert.deepEqual(statuses, ["service_unavailable"]);
  assert.match(incoming.replies[0]!, /check service is unavailable/i);
  assert.doesNotMatch(incoming.replies[0]!, /private-message-sentinel|private-query-token|private-fragment/);
  const failedReply = event({ reply: async () => { throw new Error(PRIVATE_SENTINEL + PRIVATE_URL); } });
  await new PrivateCheckAgent(new FakeService(), Date.now, (code) => statuses.push(code)).handle(failedReply.event);
  assert.deepEqual(statuses, ["service_unavailable", "reply_unavailable"]);
});

test("typed incomplete-evidence errors are truthful and do not substitute a fixture result", async () => {
  const service = new FakeService(fixtureResponse(), new CheckFailure("provider_invalid_output"));
  const incoming = event();
  await new PrivateCheckAgent(service).handle(incoming.event);
  assert.match(incoming.replies[0]!, /AI extraction returned incomplete evidence/);
  assert.doesNotMatch(incoming.replies[0]!, /Fixture|Suspicious|known threat/i);
});

test("cancellation suppresses pre-cancelled calls and stale result replies", async () => {
  const controller = new AbortController();
  const pending = deferred<ReturnType<typeof fixtureResponse>>();
  let calls = 0;
  const service: CheckService = { check: async (_submission, signal) => {
    calls++; assert.equal(signal, controller.signal); return pending.promise;
  } };
  const incoming = event();
  const agent = new PrivateCheckAgent(service);
  const checking = agent.handle(incoming.event, controller.signal);
  controller.abort();
  pending.resolve(fixtureResponse());
  await checking;
  await agent.handle(event({ messageID: "already-cancelled" }).event, controller.signal);
  assert.equal(calls, 1);
  assert.deepEqual(incoming.replies, []);
});

test("content reflected in backend prose is never echoed in an outbound assessment", async () => {
  const result = fixtureResponse();
  result.assessment.summary = PRIVATE_SENTINEL + PRIVATE_URL;
  result.assessment.recommended_action = PRIVATE_URL;
  result.assessment.indicators[0]!.description = PRIVATE_SENTINEL;
  result.limitations = [PRIVATE_SENTINEL];
  const incoming = event({ content: { type: "text", text: PRIVATE_SENTINEL + " " + PRIVATE_URL } });
  await new PrivateCheckAgent(new FakeService(result)).handle(incoming.event);
  assert.match(incoming.replies[0]!, /A payment before delivery is indicated/);
  assert.doesNotMatch(incoming.replies[0]!, /private-message-sentinel|private-query-token|private-fragment|tickets\.example/);
});

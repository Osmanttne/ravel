import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { getEventListeners } from "node:events";
import test from "node:test";

const scriptURL = new URL("../../../scripts/receive_photon_test.mjs", import.meta.url);
const script = await import(scriptURL.href) as ReceiveScript;
const SENDER = "+12025550123";
const OTHER = "+12025550124";
const START = 1_700_000_000_000;
const SECRET = "synthetic-private-provider-secret";

interface ReceiveResult {
  code: string;
  incoming_message_verified: boolean;
  matching_messages: number;
  messages_sent: number;
  text?: string;
}
interface Client {
  messages: { subscribeEvents(filter: { chat: string }): AsyncIterable<unknown> & { close(): Promise<void> } };
  close(): Promise<void>;
}
interface RejectionDiagnostic {
  reason: string;
  multipart?: boolean;
  attachments?: boolean;
  mini_app?: boolean;
  balloon?: boolean;
  known_url_preview_bundle?: boolean;
  standalone_url_text?: boolean;
  text_kind?: "invalid_text" | "standalone_http_url" | "other_text";
}
interface WindowDiagnostic { terminal_code: string; events_seen: number; rejected_message_events: number }
interface ObserverCallbacks {
  onRejected?: (diagnostic: RejectionDiagnostic) => void;
  onDiagnostics?: (diagnostic: WindowDiagnostic) => void;
}
interface ReceiveScript {
  TEST_MARKER: string;
  parseArguments(args: string[]): { sender: string; listen: boolean };
  matchesFreshMarker(event: unknown, sender: string, startedAt: number, currentTime: number): boolean;
  matchesFreshText(event: unknown, sender: string, startedAt: number, currentTime: number, expectedText: string): boolean;
  observeOneText(sender: string, options: { client: Client; expectedText: string; durationMilliseconds?: number;
    now?: () => number } & ObserverCallbacks): Promise<ReceiveResult>;
  observePrivateText(sender: string, options: { client: Client; durationMilliseconds?: number;
    now?: () => number; signal?: AbortSignal; onSubscribed?: () => void } & ObserverCallbacks): Promise<ReceiveResult>;
  listenForPrivateTextLive(sender: string, output?: (value: string) => void,
    options?: { signal?: AbortSignal }): Promise<ReceiveResult>;
  listenForExactTextLive(sender: string, expectedText: string, output: (value: string) => void): Promise<ReceiveResult>;
  observeOneTest(sender: string, options: { client: Client; durationMilliseconds?: number;
    now?: () => number; signal?: AbortSignal; onSubscribed?: () => void } & ObserverCallbacks): Promise<ReceiveResult>;
  main(args: string[], options?: { listen?: (sender: string, output: (value: string) => void) => Promise<ReceiveResult>;
    output?: (value: string) => void }): Promise<number>;
}

function freshEvent() {
  return {
    type: "message.received", chatGuid: `any;-;${SENDER}`, isFromMe: false,
    occurredAt: new Date(START), actor: { address: SENDER },
    message: {
      guid: "synthetic-private-message-id", chatGuids: [`any;-;${SENDER}`],
      dateCreated: new Date(START), sender: { address: SENDER }, isFromMe: false,
      itemType: "normal", isAutoReply: false, isSystemMessage: false,
      isServiceMessage: false, isCorrupt: false,
      content: { text: script.TEST_MARKER, attachments: [] as unknown[] },
    },
  };
}

function mockClient(events: unknown[] = [], options: { pending?: boolean; subscribeFailure?: unknown;
  nextFailure?: unknown; cleanupFailure?: boolean; pendingCleanup?: boolean } = {}) {
  const calls = { filters: [] as { chat: string }[], next: 0, streamClose: 0, clientClose: 0, forbidden: 0 };
  const forbidden = () => { calls.forbidden++; throw new Error(SECRET); };
  const stream = {
    [Symbol.asyncIterator]() {
      return { async next(): Promise<IteratorResult<unknown>> {
        const index = calls.next++;
        if (options.nextFailure) throw options.nextFailure;
        if (index < events.length) return { done: false, value: events[index] };
        if (options.pending) return new Promise<IteratorResult<unknown>>(() => {});
        return { done: true, value: undefined };
      } };
    },
    async close() {
      calls.streamClose++;
      if (options.cleanupFailure) throw new Error(SECRET);
      if (options.pendingCleanup) return new Promise<void>(() => {});
    },
  };
  const client = {
    messages: {
      subscribeEvents(filter: { chat: string }) {
        calls.filters.push(filter);
        if (options.subscribeFailure) throw options.subscribeFailure;
        return stream;
      },
      get sendText() { return forbidden(); }, get list() { return forbidden(); }, get get() { return forbidden(); },
    },
    async close() { calls.clientClose++; },
    get chats() { return forbidden(); }, get events() { return forbidden(); }, get attachments() { return forbidden(); },
  } as Client;
  return { client, calls };
}

test("default preview shows only the reviewed sender and marker, without listening", async () => {
  assert.equal(script.TEST_MARKER, "Ravel receive test 01");
  assert.deepEqual(script.parseArguments(["--sender", SENDER]), { sender: SENDER, listen: false });
  const output: string[] = [];
  let listened = 0;
  assert.equal(await script.main(["--sender", SENDER], { output: value => output.push(value),
    listen: async () => { listened++; throw new Error(SECRET); } }), 0);
  assert.equal(listened, 0);
  assert.deepEqual(JSON.parse(output[0]!), { code: "preview_only_receive_disabled", sender: SENDER,
    marker: script.TEST_MARKER, window_seconds: 60, messages_sent: 0, network_connected: false });
});

test("preview blocks SDK imports, environment files and network", () => {
  const child = `
    import fs from "node:fs";
    import { registerHooks, syncBuiltinESMExports } from "node:module";
    const read = fs.readFileSync;
    fs.readFileSync = (path, ...args) => {
      if (String(path).endsWith("/.env")) throw new Error("Credential access forbidden");
      return read(path, ...args);
    };
    syncBuiltinESMExports();
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier.includes("@spectrum") || specifier.includes("@photon-ai") || specifier.endsWith("/config.js")) {
        throw new Error("SDK/config import forbidden");
      }
      return nextResolve(specifier, context);
    } });
    globalThis.fetch = async () => { throw new Error("Network forbidden"); };
    const { main } = await import(${JSON.stringify(scriptURL.href)});
    process.exitCode = await main(["--sender", ${JSON.stringify(SENDER)}]);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", child], {
    encoding: "utf8", env: {}, timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).network_connected, false);
});

for (const args of [[], ["--sender"], ["--sender", "2025550123"], ["--sender", `${SENDER} `],
  ["--sender", "+01234567"], ["--sender", SENDER, "--send"],
  ["--sender", SENDER, "--listen", "--listen"], ["--sender", SENDER, "--sender", OTHER]]) {
  test(`invalid receive arguments cannot listen: ${JSON.stringify(args)}`, async () => {
    let listened = 0;
    const output: string[] = [];
    assert.equal(await script.main(args, { output: value => output.push(value),
      listen: async () => { listened++; throw new Error(SECRET); } }), 1);
    assert.equal(listened, 0);
    assert.equal(JSON.parse(output[0]!).messages_sent, 0);
    assert.doesNotMatch(output.join(""), /\+1202555|synthetic-private/);
  });
}

test("matching fresh marker uses one exact server-filtered DM and cleans up without other SDK methods", async () => {
  const mock = mockClient([freshEvent(), freshEvent()]);
  let subscribed = 0;
  const result = await script.observeOneTest(SENDER, { client: mock.client, now: () => START,
    onSubscribed: () => { subscribed++; } });
  assert.deepEqual(result, { code: "fresh_marker_received", incoming_message_verified: true,
    matching_messages: 1, messages_sent: 0 });
  assert.deepEqual(mock.calls, { filters: [{ chat: `any;-;${SENDER}` }], next: 1,
    streamClose: 1, clientClose: 1, forbidden: 0 });
  assert.equal(subscribed, 1);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private|\+1202555|Ravel receive test/);
});

const rejectedEvents: [string, () => unknown][] = [
  ["edited", () => ({ ...freshEvent(), type: "message.edited" })],
  ["outbound event", () => ({ ...freshEvent(), isFromMe: true })],
  ["group", () => ({ ...freshEvent(), chatGuid: `any;+;${SENDER}` })],
  ["different sender", () => ({ ...freshEvent(), message: { ...freshEvent().message, sender: { address: OTHER } } })],
  ["conflicting actor", () => ({ ...freshEvent(), actor: { address: OTHER } })],
  ["old event", () => ({ ...freshEvent(), occurredAt: new Date(START - 1) })],
  ["old message", () => ({ ...freshEvent(), message: { ...freshEvent().message, dateCreated: new Date(START - 1) } })],
  ["invalid date", () => ({ ...freshEvent(), occurredAt: new Date(NaN) })],
  ["far future", () => ({ ...freshEvent(), occurredAt: new Date(START + 30_001) })],
  ["outbound message", () => ({ ...freshEvent(), message: { ...freshEvent().message, isFromMe: true } })],
  ["auto reply", () => ({ ...freshEvent(), message: { ...freshEvent().message, isAutoReply: true } })],
  ["system", () => ({ ...freshEvent(), message: { ...freshEvent().message, isSystemMessage: true } })],
  ["service", () => ({ ...freshEvent(), message: { ...freshEvent().message, isServiceMessage: true } })],
  ["wrong message chat", () => ({ ...freshEvent(), message: { ...freshEvent().message, chatGuids: [`any;-;${OTHER}`] } })],
  ["non-normal", () => ({ ...freshEvent(), message: { ...freshEvent().message, itemType: "chatAction" } })],
  ["wrong marker", () => ({ ...freshEvent(), message: { ...freshEvent().message,
    content: { text: `${script.TEST_MARKER} ${SECRET}`, attachments: [] } } })],
  ["attachment", () => ({ ...freshEvent(), message: { ...freshEvent().message,
    content: { text: script.TEST_MARKER, attachments: [{ privateData: SECRET }] } } })],
  ["multiple parts", () => ({ ...freshEvent(), message: { ...freshEvent().message, partCount: 2 } })],
  ["hostile getter", () => ({ get message() { throw new Error(SECRET); } })],
];
for (const [label, event] of rejectedEvents) {
  test(`receive boundary rejects ${label} without claiming application receipt`, () => {
    assert.equal(script.matchesFreshMarker(event(), SENDER, START, START), false);
  });
}

test("ignored events do not prevent a subsequent exact marker", async () => {
  const mock = mockClient([...rejectedEvents.map(([, create]) => create()), freshEvent()]);
  assert.equal((await script.observeOneTest(SENDER, { client: mock.client, now: () => START })).code,
    "fresh_marker_received");
  assert.equal(mock.calls.next, rejectedEvents.length + 1);
  assert.equal(mock.calls.forbidden, 0);
});

test("clock rollback cannot establish a fresh marker", () => {
  assert.equal(script.matchesFreshMarker(freshEvent(), SENDER, START, START - 1), false);
});

test("pending next times out and closes both resources", async () => {
  const mock = mockClient([], { pending: true });
  const result = await script.observeOneTest(SENDER, { client: mock.client, durationMilliseconds: 1 });
  assert.equal(result.code, "receive_window_elapsed");
  assert.equal(result.incoming_message_verified, false);
  assert.equal(mock.calls.streamClose, 1);
  assert.equal(mock.calls.clientClose, 1);
});

test("cancellation interrupts pending next and removes its handler", async () => {
  const mock = mockClient([], { pending: true });
  const controller = new AbortController();
  const result = await script.observeOneTest(SENDER, { client: mock.client, signal: controller.signal,
    onSubscribed: () => controller.abort() });
  assert.equal(result.code, "receive_cancelled");
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(mock.calls.streamClose, 1);
  assert.equal(mock.calls.clientClose, 1);
});

test("already cancelled observer does not subscribe", async () => {
  const mock = mockClient();
  assert.equal((await script.observeOneTest(SENDER, { client: mock.client,
    signal: AbortSignal.abort() })).code, "receive_cancelled");
  assert.equal(mock.calls.filters.length, 0);
  assert.equal(mock.calls.clientClose, 1);
});

test("subscription and stream errors are fixed, redacted, close resources and never retry", async () => {
  for (const failureAt of ["subscribeFailure", "nextFailure"] as const) {
    const failure = Object.assign(new Error(`${SECRET} ${SENDER}`), {
      name: "AuthenticationError", code: "internalError", grpcCode: 7,
    });
    const mock = mockClient([], { [failureAt]: failure });
    const output: string[] = [];
    assert.equal(await script.main(["--sender", SENDER, "--listen"], {
      output: value => output.push(value), listen: sender => script.observeOneTest(sender, { client: mock.client }),
    }), 1);
    assert.deepEqual(JSON.parse(output[0]!), { code: "receive_failed",
      failure_stage: failureAt === "subscribeFailure" ? "subscription" : "event_stream",
      error_type: "AuthenticationError", provider_code: "internalError", http_status: null, grpc_status: 7,
      messages_sent: 0, incoming_message_verified: false });
    assert.equal(mock.calls.filters.length, 1);
    assert.equal(mock.calls.clientClose, 1);
    assert.equal(mock.calls.forbidden, 0);
    assert.doesNotMatch(output.join(""), /synthetic-private|\+1202555/);
  }
});

test("broken cleanup cannot expose raw errors or stall a completed observation", async () => {
  const failed = mockClient([freshEvent()], { cleanupFailure: true });
  assert.equal((await script.observeOneTest(SENDER, { client: failed.client, now: () => START })).code,
    "fresh_marker_received");
  const pending = mockClient([freshEvent()], { pendingCleanup: true });
  const before = Date.now();
  assert.equal((await script.observeOneTest(SENDER, { client: pending.client, now: () => START })).code,
    "fresh_marker_received");
  assert.ok(Date.now() - before < 3_000);
  assert.equal(pending.calls.clientClose, 1);
});

test("receive flood terminates at bounded count", async () => {
  const mock = mockClient(Array.from({ length: 1_001 }, () => ({ type: "message.read" })));
  assert.equal((await script.observeOneTest(SENDER, { client: mock.client })).code, "receive_event_limit_reached");
  assert.equal(mock.calls.next, 1_000);
  assert.equal(mock.calls.clientClose, 1);
});

test("invalid durations fail before stream creation", async () => {
  for (const durationMilliseconds of [0, -1, 60_001, NaN, Infinity, 1.5]) {
    const mock = mockClient();
    await assert.rejects(script.observeOneTest(SENDER, { client: mock.client, durationMilliseconds }),
      { message: "invalid_duration" });
    assert.equal(mock.calls.filters.length, 0);
    assert.equal(mock.calls.clientClose, 1);
  }
});

test("one exact reviewed text matches without weakening marker or sender guards", async () => {
  const expectedText = "Synthetic offer: pay a fee before delivery.";
  const original = freshEvent();
  const actual = { ...original, message: { ...original.message, content: { text: expectedText, attachments: [] } } };
  assert.equal(script.matchesFreshMarker(actual, SENDER, START, START), false);
  assert.equal(script.matchesFreshText(actual, SENDER, START, START, expectedText), true);
  assert.equal(script.matchesFreshText(actual, OTHER, START, START, expectedText), false);
  assert.equal(script.matchesFreshText(original, SENDER, START, START, expectedText), false);
  const mock = mockClient([original, actual]);
  assert.equal((await script.observeOneText(SENDER, { client: mock.client, expectedText, now: () => START })).incoming_message_verified, true);
  assert.equal(mock.calls.next, 2);
  assert.equal(mock.calls.streamClose, 1);
  assert.equal(mock.calls.clientClose, 1);
  assert.equal(mock.calls.forbidden, 0);
});

test("invalid expected text never opens a stream", async () => {
  for (const expectedText of ["", " ", "x".repeat(10_001), "\uD800"]) {
    const mock = mockClient();
    await assert.rejects(script.observeOneText(SENDER, { client: mock.client, expectedText }), { message: "invalid_expected_text" });
    assert.equal(mock.calls.filters.length, 0);
    assert.equal(mock.calls.clientClose, 1);
  }
});

function eventWithText(text: unknown) {
  const original = freshEvent();
  return { ...original, message: { ...original.message, content: { text, attachments: [] } } };
}

test("generic receipt returns one exact private text only after both resources close", async () => {
  const text = `A private message with a link https://tickets.example/private?token=${SECRET}\nPay before delivery.`;
  const mock = mockClient([eventWithText(text), eventWithText("A second message must not be read.")]);
  const subscribeEvents = mock.client.messages.subscribeEvents.bind(mock.client.messages);
  const closeClient = mock.client.close.bind(mock.client);
  let streamClosed = false;
  let clientClosed = false;
  mock.client.messages.subscribeEvents = filter => {
    const stream = subscribeEvents(filter);
    const closeStream = stream.close.bind(stream);
    stream.close = async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
      await closeStream();
      streamClosed = true;
    };
    return stream;
  };
  mock.client.close = async () => {
    await new Promise<void>(resolve => setImmediate(resolve));
    await closeClient();
    clientClosed = true;
  };
  const operationalOutput: string[] = [];
  const result = await script.observePrivateText(SENDER, { client: mock.client, now: () => START,
    onSubscribed: () => operationalOutput.push(JSON.stringify({ code: "receive_subscription_requested", messages_sent: 0 })) });
  assert.deepEqual(result, { code: "fresh_text_received", incoming_message_verified: true,
    matching_messages: 1, messages_sent: 0, text });
  assert.equal(streamClosed, true);
  assert.equal(clientClosed, true);
  assert.deepEqual(mock.calls, { filters: [{ chat: `any;-;${SENDER}` }], next: 1,
    streamClose: 1, clientClose: 1, forbidden: 0 });
  assert.deepEqual(operationalOutput, ['{"code":"receive_subscription_requested","messages_sent":0}']);
  assert.doesNotMatch(operationalOutput.join(""), /synthetic-private|tickets\.example|\+1202555/);
});

test("generic filtering preserves every direction, owner, date, plain-message and attachment guard", async () => {
  const additional = [
    { ...freshEvent(), message: { ...freshEvent().message, chatGuids: [`any;-;${SENDER}`, `any;-;${OTHER}`] } },
    { ...freshEvent(), message: { ...freshEvent().message, isCorrupt: true } },
    { ...freshEvent(), message: { ...freshEvent().message, partCount: 0 } },
    { ...freshEvent(), message: { ...freshEvent().message,
      content: { text: SECRET, attachments: [], miniApp: { privateData: SECRET } } } },
    { ...freshEvent(), message: { ...freshEvent().message,
      content: { text: SECRET, attachments: [], balloonBundleId: "private-app-id" } } },
  ];
  const rejected = rejectedEvents.filter(([label]) => label !== "wrong marker").map(([, create]) => create());
  const mock = mockClient([...rejected, ...additional, eventWithText("This is arbitrary fresh plaintext.")]);
  const result = await script.observePrivateText(SENDER, { client: mock.client, now: () => START });
  assert.equal(result.code, "fresh_text_received");
  assert.equal(result.text, "This is arbitrary fresh plaintext.");
  assert.equal(mock.calls.next, rejected.length + additional.length + 1);
  assert.equal(mock.calls.forbidden, 0);
});

test("generic receipt accepts normal absent actor and an explicit single message part", async () => {
  const original = eventWithText("Fresh text from the selected owner.");
  const { actor: _actor, ...withoutActor } = original;
  const mock = mockClient([{ ...withoutActor, message: { ...original.message, partCount: 1 } }]);
  assert.equal((await script.observePrivateText(SENDER, { client: mock.client, now: () => START })).code,
    "fresh_text_received");
});

test("generic text limits use Unicode scalars and preserve the received string exactly", async () => {
  const maximum = "😀".repeat(10_000);
  const mock = mockClient([eventWithText(maximum)]);
  const result = await script.observePrivateText(SENDER, { client: mock.client, now: () => START });
  assert.equal(result.text, maximum);
  assert.equal(script.matchesFreshText(eventWithText(maximum), SENDER, START, START, maximum), true);
  const exact = mockClient([eventWithText(maximum)]);
  assert.equal((await script.observeOneText(SENDER, { client: exact.client, expectedText: maximum,
    now: () => START })).code, "fresh_marker_received");
});

test("generic receipt discards empty, malformed, non-string and excessive plaintext", async () => {
  const invalid = ["", " \t\r\n", "\uD800", "\uDC00", "x\uD800y", "x".repeat(10_001),
    "😀".repeat(10_001), "😀".repeat(5_000) + "x".repeat(5_001), null, undefined, 42, { toString: () => SECRET }];
  const mock = mockClient(invalid.map(eventWithText));
  const result = await script.observePrivateText(SENDER, { client: mock.client, now: () => START });
  assert.deepEqual(result, { code: "receive_stream_ended", incoming_message_verified: false,
    matching_messages: 0, messages_sent: 0 });
  assert.equal(mock.calls.next, invalid.length + 1);
  assert.equal(mock.calls.forbidden, 0);
});

test("invalid exact Unicode scalar bound still rejects before subscription", async () => {
  const mock = mockClient();
  await assert.rejects(script.observeOneText(SENDER, { client: mock.client, expectedText: "😀".repeat(10_001) }),
    { message: "invalid_expected_text" });
  assert.equal(mock.calls.filters.length, 0);
});

test("generic invalid sender and duration fail before subscription and close the supplied client", async () => {
  for (const sender of ["", "2025550123", `${SENDER} `, "+01234567"]) {
    const mock = mockClient();
    await assert.rejects(script.observePrivateText(sender, { client: mock.client }), { message: "invalid_sender" });
    assert.equal(mock.calls.filters.length, 0);
    assert.equal(mock.calls.clientClose, 1);
  }
  for (const durationMilliseconds of [0, -1, 60_001, NaN, Infinity, 1.5]) {
    const mock = mockClient();
    await assert.rejects(script.observePrivateText(SENDER, { client: mock.client, durationMilliseconds }),
      { message: "invalid_duration" });
    assert.equal(mock.calls.filters.length, 0);
    assert.equal(mock.calls.clientClose, 1);
  }
});

test("invalid live generic sender and exact text fail before any SDK, credential or network access", () => {
  const child = `
    import fs from "node:fs";
    import { registerHooks, syncBuiltinESMExports } from "node:module";
    const read = fs.readFileSync;
    fs.readFileSync = (path, ...args) => {
      if (String(path).endsWith("/.env")) throw new Error("Credential access forbidden");
      return read(path, ...args);
    };
    syncBuiltinESMExports();
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier.includes("@spectrum") || specifier.includes("@photon-ai") || specifier.endsWith("/config.js")) {
        throw new Error("SDK/config import forbidden");
      }
      return nextResolve(specifier, context);
    } });
    globalThis.fetch = async () => { throw new Error("Network forbidden"); };
    const script = await import(${JSON.stringify(scriptURL.href)});
    const output = () => { throw new Error("Unexpected operational output"); };
    for (const operation of [() => script.listenForPrivateTextLive("invalid", output),
      () => script.listenForExactTextLive(${JSON.stringify(SENDER)}, "\\uD800", output)]) {
      try { await operation(); process.exitCode = 1; }
      catch (error) {
        if (!["invalid_sender", "invalid_expected_text"].includes(error.code)) process.exitCode = 1;
      }
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", child], {
    encoding: "utf8", env: {}, timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("live generic parent cancellation blocks late imports and removes its shutdown handlers", () => {
  const child = `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import { getEventListeners } from "node:events";
    import { registerHooks, syncBuiltinESMExports } from "node:module";
    const read = fs.readFileSync;
    fs.readFileSync = (path, ...args) => {
      if (String(path).endsWith("/.env")) throw new Error("Credential access forbidden");
      return read(path, ...args);
    };
    syncBuiltinESMExports();
    const network = async () => { throw new Error("Network forbidden"); };
    globalThis.fetch = network;
    let phase = "already_cancelled";
    let controller;
    let configurationImports = 0;
    globalThis.configurationCalls = 0;
    const configurationModule = "data:text/javascript," + encodeURIComponent(
      'export function loadConfiguration() { globalThis.configurationCalls++; throw new Error("synthetic-private-provider-secret"); }');
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier.includes("@spectrum") || specifier.includes("@photon-ai")) {
        throw new Error("SDK import forbidden");
      }
      if (specifier.endsWith("/config.js")) {
        configurationImports++;
        if (phase === "already_cancelled") throw new Error("Cancelled configuration import forbidden");
        if (phase === "cancel_during_import") controller.abort();
        return { url: configurationModule, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    } });
    const script = await import(${JSON.stringify(scriptURL.href)});
    const output = () => { throw new Error("Unexpected operational output"); };
    const beforeSignals = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    const cancelledReceipt = { code: "receive_cancelled", incoming_message_verified: false,
      matching_messages: 0, messages_sent: 0, heartbeat_observed: false };

    controller = new AbortController();
    controller.abort();
    assert.deepEqual(await script.listenForPrivateTextLive(${JSON.stringify(SENDER)}, output,
      { signal: controller.signal }), cancelledReceipt);
    assert.equal(configurationImports, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);

    phase = "cancel_during_import";
    controller = new AbortController();
    assert.deepEqual(await script.listenForPrivateTextLive(${JSON.stringify(SENDER)}, output,
      { signal: controller.signal }), cancelledReceipt);
    assert.equal(configurationImports, 1);
    assert.equal(globalThis.configurationCalls, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);

    phase = "configuration_failure";
    controller = new AbortController();
    await assert.rejects(script.listenForPrivateTextLive(${JSON.stringify(SENDER)}, output,
      { signal: controller.signal }), { message: "receive_failed" });
    assert.equal(globalThis.configurationCalls, 1);
    assert.equal(controller.signal.aborted, false);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], beforeSignals);
    assert.equal(globalThis.fetch, network);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", child], {
    encoding: "utf8", env: {}, timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("generic receive timeout, cancellation and early stream end never return text", async () => {
  const timed = mockClient([], { pending: true });
  const timeout = await script.observePrivateText(SENDER, { client: timed.client, durationMilliseconds: 1 });
  assert.equal(timeout.code, "receive_window_elapsed");
  assert.equal("text" in timeout, false);
  assert.equal(timed.calls.streamClose, 1);
  assert.equal(timed.calls.clientClose, 1);

  const cancelled = mockClient([eventWithText(SECRET)], { pending: true });
  const controller = new AbortController();
  const cancellation = await script.observePrivateText(SENDER, { client: cancelled.client,
    signal: controller.signal, onSubscribed: () => controller.abort() });
  assert.equal(cancellation.code, "receive_cancelled");
  assert.equal("text" in cancellation, false);
  assert.equal(cancelled.calls.next, 0);
  assert.equal(cancelled.calls.clientClose, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);

  const ended = mockClient();
  const end = await script.observePrivateText(SENDER, { client: ended.client });
  assert.equal(end.code, "receive_stream_ended");
  assert.equal("text" in end, false);
});

test("already cancelled generic receipt does not subscribe", async () => {
  const mock = mockClient();
  assert.equal((await script.observePrivateText(SENDER, { client: mock.client,
    signal: AbortSignal.abort() })).code, "receive_cancelled");
  assert.equal(mock.calls.filters.length, 0);
  assert.equal(mock.calls.clientClose, 1);
});

test("generic stream flood remains bounded and returns no text", async () => {
  const mock = mockClient(Array.from({ length: 1_001 }, () => ({ type: "message.read" })));
  const result = await script.observePrivateText(SENDER, { client: mock.client });
  assert.equal(result.code, "receive_event_limit_reached");
  assert.equal("text" in result, false);
  assert.equal(mock.calls.next, 1_000);
  assert.equal(mock.calls.clientClose, 1);
});

test("generic resource errors stay fixed, redacted and never retry", async () => {
  for (const failureAt of ["subscribeFailure", "nextFailure"] as const) {
    const mock = mockClient([], { [failureAt]: Object.assign(new Error(`${SECRET} ${SENDER}`), {
      name: "AuthenticationError", code: "internalError", grpcCode: 7,
    }) });
    let caught: unknown;
    try { await script.observePrivateText(SENDER, { client: mock.client }); }
    catch (error) { caught = error; }
    assert.ok(caught instanceof Error);
    assert.equal(caught.message, "receive_failed");
    assert.doesNotMatch(JSON.stringify(caught), /synthetic-private|\+1202555/);
    assert.equal(mock.calls.filters.length, 1);
    assert.equal(mock.calls.clientClose, 1);
    assert.equal(mock.calls.forbidden, 0);
  }
});

test("generic receipt withholds private text if either cleanup fails or stalls", async () => {
  for (const options of [{ cleanupFailure: true }, { pendingCleanup: true }]) {
    const mock = mockClient([eventWithText(SECRET)], options);
    const before = Date.now();
    await assert.rejects(script.observePrivateText(SENDER, { client: mock.client, now: () => START }),
      { message: "receive_cleanup_failed", code: "receive_cleanup_failed", stage: "cleanup" });
    assert.ok(Date.now() - before < 3_000);
    assert.equal(mock.calls.clientClose, 1);
    assert.equal(mock.calls.forbidden, 0);
  }
  const clientFailure = mockClient([eventWithText(SECRET)]);
  clientFailure.client.close = async () => { throw new Error(SECRET); };
  await assert.rejects(script.observePrivateText(SENDER, { client: clientFailure.client, now: () => START }),
    { message: "receive_cleanup_failed" });
  assert.equal(clientFailure.calls.streamClose, 1);
});

test("URL preview metadata is still rejected and diagnosed by exact reviewed-text checks", async () => {
  const original = eventWithText(`https://tickets.example/private?token=${SECRET}`);
  const preview = { ...original, message: { ...original.message,
    content: { ...original.message.content, balloonBundleId: "com.apple.messages.URLBalloonProvider" } } };
  const diagnostics: RejectionDiagnostic[] = [];
  const windows: WindowDiagnostic[] = [];
  const mock = mockClient([preview]);
  const result = await script.observeOneText(SENDER, { client: mock.client,
    expectedText: original.message.content.text as string, now: () => START,
    onRejected: value => diagnostics.push(value), onDiagnostics: value => windows.push(value) });
  assert.deepEqual(result, { code: "receive_stream_ended", incoming_message_verified: false,
    matching_messages: 0, messages_sent: 0 });
  assert.equal(script.matchesFreshText(preview, SENDER, START, START, original.message.content.text as string), false);
  assert.deepEqual(diagnostics, [{ reason: "balloon_present", multipart: false, attachments: false,
    mini_app: false, balloon: true, known_url_preview_bundle: true, standalone_url_text: true,
    text_kind: "standalone_http_url" }]);
  assert.deepEqual(windows, [{ terminal_code: "receive_stream_ended", events_seen: 1, rejected_message_events: 1 }]);
  assert.doesNotMatch(JSON.stringify({ diagnostics, windows }), /synthetic-private|tickets\.example|\+1202555|URLBalloonProvider/);
  assert.equal(mock.calls.forbidden, 0);
});

function nativeURLPreview(text: unknown = `https://campus.example/events?token=${SECRET}`) {
  const original = eventWithText(text);
  return { ...original, message: { ...original.message,
    content: { ...original.message.content, balloonBundleId: "com.apple.messages.URLBalloonProvider" } } };
}

test("generic receipt accepts only the confirmed native standalone URL preview and closes before returning", async () => {
  const event = nativeURLPreview();
  const mock = mockClient([event, eventWithText("A second message must not be read.")]);
  const rejections: RejectionDiagnostic[] = [];
  const windows: WindowDiagnostic[] = [];
  const result = await script.observePrivateText(SENDER, { client: mock.client, now: () => START,
    onRejected: value => rejections.push(value), onDiagnostics: value => windows.push(value) });
  assert.deepEqual(result, { code: "fresh_text_received", incoming_message_verified: true,
    matching_messages: 1, messages_sent: 0, text: event.message.content.text });
  assert.equal(mock.calls.next, 1);
  assert.equal(mock.calls.streamClose, 1);
  assert.equal(mock.calls.clientClose, 1);
  assert.equal(mock.calls.forbidden, 0);
  assert.deepEqual(rejections, []);
  assert.deepEqual(windows, [{ terminal_code: "fresh_text_received", events_seen: 1, rejected_message_events: 0 }]);
  assert.doesNotMatch(JSON.stringify(windows), /synthetic-private|campus\.example|\+1202555|URLBalloonProvider/);
  assert.equal(script.matchesFreshText(event, SENDER, START, START, event.message.content.text as string), false);
  assert.equal(script.matchesFreshMarker(event, SENDER, START, START), false);
});

test("native URL preview exception rejects credentials, controls, format characters, backslashes and non-URL text", async () => {
  for (const text of ["A message containing https://campus.example/events", "https://user:secret@campus.example/events",
    "https://campus.example/events\u0000", "https://campus.example/events\u200b",
    "https://campus.example\\events", "https://[bad", "ftp://campus.example/events",
    "https://campus.example/events" + "x".repeat(2_048), "", " \n\t", "\uD800"]) {
    const mock = mockClient([nativeURLPreview(text)]);
    const result = await script.observePrivateText(SENDER, { client: mock.client, now: () => START });
    assert.equal(result.code, "receive_stream_ended");
    assert.equal("text" in result, false);
    assert.equal(mock.calls.forbidden, 0);
  }
});

test("only the exact native URL preview bundle can use the generic exception", async () => {
  for (const balloonBundleId of ["com.apple.messages.URLBalloonProvider.extra",
    "com.apple.messages.URLBalloonProvider ", "com.apple.messages.urlballoonprovider", "", SECRET, null]) {
    const original = nativeURLPreview();
    const event = { ...original, message: { ...original.message,
      content: { ...original.message.content, balloonBundleId } } };
    const result = await script.observePrivateText(SENDER, { client: mockClient([event]).client, now: () => START });
    assert.equal(result.incoming_message_verified, false);
    assert.equal("text" in result, false);
  }
});

test("native URL previews preserve owner, chat, direction, freshness, ordinary flags and single-part guards", async () => {
  const preview = nativeURLPreview();
  const blocked = [
    { ...preview, chatGuid: `any;-;${OTHER}` },
    { ...preview, chatGuid: `any;+;${SENDER}` },
    { ...preview, actor: { address: OTHER } },
    { ...preview, isFromMe: true },
    { ...preview, occurredAt: new Date(START - 1) },
    { ...preview, message: { ...preview.message, sender: { address: OTHER } } },
    { ...preview, message: { ...preview.message, chatGuids: [`any;-;${SENDER}`, `any;-;${OTHER}`] } },
    { ...preview, message: { ...preview.message, isFromMe: true } },
    { ...preview, message: { ...preview.message, dateCreated: new Date(START - 1) } },
    { ...preview, message: { ...preview.message, itemType: "chatAction" } },
    { ...preview, message: { ...preview.message, isAutoReply: true } },
    { ...preview, message: { ...preview.message, isSystemMessage: true } },
    { ...preview, message: { ...preview.message, isServiceMessage: true } },
    { ...preview, message: { ...preview.message, isCorrupt: true } },
    { ...preview, message: { ...preview.message, partCount: 0 } },
    { ...preview, message: { ...preview.message, partCount: 2 } },
    { ...preview, message: { ...preview.message,
      content: { ...preview.message.content, attachments: [{ guid: SECRET }] } } },
    { ...preview, message: { ...preview.message,
      content: { ...preview.message.content, miniApp: { url: "https://campus.example/events" } } } },
  ];
  const result = await script.observePrivateText(SENDER, { client: mockClient(blocked).client, now: () => START });
  assert.deepEqual(result, { code: "receive_stream_ended", incoming_message_verified: false,
    matching_messages: 0, messages_sent: 0 });
});

test("native URL preview acceptance retains cancellation and fail-closed cleanup", async () => {
  const cancelled = mockClient([nativeURLPreview()]);
  const controller = new AbortController();
  assert.equal((await script.observePrivateText(SENDER, { client: cancelled.client, now: () => START,
    signal: controller.signal, onSubscribed: () => controller.abort() })).code, "receive_cancelled");
  assert.equal(cancelled.calls.next, 0);
  const failed = mockClient([nativeURLPreview()], { cleanupFailure: true });
  await assert.rejects(script.observePrivateText(SENDER, { client: failed.client, now: () => START }),
    { message: "receive_cleanup_failed" });
  assert.equal(failed.calls.streamClose, 1);
  assert.equal(failed.calls.clientClose, 1);
});

test("rejection flags reconstruct content shape without copying unknown metadata or text", async () => {
  const original = eventWithText(SECRET);
  const event = { ...original, message: { ...original.message, partCount: 2,
    content: { ...original.message.content, attachments: [{ guid: SECRET, fileName: SECRET }],
      miniApp: { url: `https://private.example/${SECRET}` }, balloonBundleId: SECRET } } };
  const diagnostics: RejectionDiagnostic[] = [];
  await script.observePrivateText(SENDER, { client: mockClient([event]).client, now: () => START,
    onRejected: value => diagnostics.push(value) });
  assert.deepEqual(diagnostics, [{ reason: "part_count_not_single", multipart: true, attachments: true,
    mini_app: true, balloon: true, known_url_preview_bundle: false, standalone_url_text: false,
    text_kind: "other_text" }]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /synthetic-private|private\.example|\+1202555/);
});

test("content shape is not inspected for another owner or an old message", async () => {
  let contentReads = 0;
  const wrongOwner = { ...freshEvent(), message: { ...freshEvent().message, sender: { address: OTHER } } };
  // Define getters after spreading to ensure the inspection, not this setup,
  // is the only opportunity to read the private content field.
  Object.defineProperty(wrongOwner.message, "content", { get() { contentReads++; throw new Error(SECRET); } });
  const old = { ...freshEvent(), occurredAt: new Date(START - 1) };
  Object.defineProperty(old.message, "content", { get() { contentReads++; throw new Error(SECRET); } });
  const diagnostics: RejectionDiagnostic[] = [];
  await script.observePrivateText(SENDER, { client: mockClient([wrongOwner, old]).client, now: () => START,
    onRejected: value => diagnostics.push(value) });
  assert.equal(contentReads, 0);
  assert.deepEqual(diagnostics, [{ reason: "owner_or_chat_mismatch" }, { reason: "not_fresh" }]);
});

test("diagnostic URL classification stays local, bounded and independent from receipt acceptance", async () => {
  const candidates: [unknown, boolean, RejectionDiagnostic["text_kind"]][] = [
    [" https://campus.example/events\n", true, "standalone_http_url"],
    ["https://user:secret@campus.example/events", false, "other_text"],
    ["https://campus.example\\events", false, "other_text"],
    ["https://campus.example/\u200b", false, "other_text"],
    ["https://[bad", false, "other_text"],
    ["https://campus.example/events More context", false, "other_text"],
    ["https://campus.example/" + "x".repeat(2_048), false, "other_text"],
    ["\uD800", false, "invalid_text"],
    ["x".repeat(10_001), false, "invalid_text"],
  ];
  for (const [text, standaloneURL, kind] of candidates) {
    const original = eventWithText(text);
    const event = { ...original, message: { ...original.message,
      content: { ...original.message.content, balloonBundleId: SECRET } } };
    const diagnostics: RejectionDiagnostic[] = [];
    const result = await script.observePrivateText(SENDER, { client: mockClient([event]).client, now: () => START,
      onRejected: value => diagnostics.push(value) });
    assert.equal(result.incoming_message_verified, false);
    assert.equal(diagnostics[0]?.standalone_url_text, standaloneURL);
    assert.equal(diagnostics[0]?.text_kind, kind);
    assert.doesNotMatch(JSON.stringify(diagnostics), /synthetic-private|campus\.example|user:secret/);
  }
});

test("terminal counts distinguish an empty window, ignored events and successful receipt", async () => {
  const windows: WindowDiagnostic[] = [];
  const empty = mockClient([], { pending: true });
  await script.observePrivateText(SENDER, { client: empty.client, durationMilliseconds: 1,
    onDiagnostics: value => windows.push(value) });
  assert.deepEqual(windows.shift(), { terminal_code: "receive_window_elapsed", events_seen: 0,
    rejected_message_events: 0 });
  const events = mockClient([{ type: "message.read", privateData: SECRET },
    { ...freshEvent(), occurredAt: new Date(START - 1) }, eventWithText(SECRET)]);
  await script.observePrivateText(SENDER, { client: events.client, now: () => START,
    onDiagnostics: value => windows.push(value) });
  assert.deepEqual(windows.shift(), { terminal_code: "fresh_text_received", events_seen: 3,
    rejected_message_events: 1 });
  assert.equal(windows.length, 0);
});

test("rejection diagnostics preserve strict marker matching and report bounded event counts", async () => {
  const diagnostics: RejectionDiagnostic[] = [];
  const windows: WindowDiagnostic[] = [];
  const events = mockClient([eventWithText(SECRET), freshEvent()]);
  assert.equal((await script.observeOneTest(SENDER, { client: events.client, now: () => START,
    onRejected: value => diagnostics.push(value), onDiagnostics: value => windows.push(value) })).code,
    "fresh_marker_received");
  assert.equal(diagnostics[0]?.reason, "unexpected_text");
  assert.doesNotMatch(JSON.stringify(diagnostics), /synthetic-private|\+1202555/);
  assert.deepEqual(windows, [{ terminal_code: "fresh_marker_received", events_seen: 2, rejected_message_events: 1 }]);
  const floodWindows: WindowDiagnostic[] = [];
  await script.observePrivateText(SENDER, { client: mockClient(Array.from({ length: 1_001 },
    () => ({ ...freshEvent(), isFromMe: true }))).client,
    now: () => START, onDiagnostics: value => floodWindows.push(value) });
  assert.deepEqual(floodWindows, [{ terminal_code: "receive_event_limit_reached", events_seen: 1_000,
    rejected_message_events: 1_000 }]);
});

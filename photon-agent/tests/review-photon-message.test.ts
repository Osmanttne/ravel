import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import type { CheckResponse, CheckSubmission } from "../src/contracts.js";
import { RavelClient } from "../src/ravel-client.js";
import { formatAssessment, HELP_REPLY, PRIVACY_REPLY, REPORT_REPLY } from "../src/replies.js";
import { geminiResponse, fixtureResponse, urlResponse, jsonResponse, PRIVATE_SENTINEL, PRIVATE_URL } from "./helpers.js";

const scriptURL = new URL("../../../scripts/review_photon_message.mjs", import.meta.url);
interface Options {
  receive?: (sender: string, output: (value: string) => void, signal?: AbortSignal) => Promise<unknown>;
  check?: (submission: CheckSubmission, signal?: AbortSignal) => Promise<unknown>;
  output?: (value: string) => void;
  signal?: AbortSignal;
}
interface Script {
  PROCESSING_DISCLOSURE: string;
  main(args: string[], options?: Options): Promise<number>;
}
const script = await import(scriptURL.href) as Script;
const sender = "+12025550123";
const listenArgs = ["--sender", sender, "--listen"];
const receipt = (text: unknown) => ({
  code: "fresh_text_received", incoming_message_verified: true,
  matching_messages: 1, messages_sent: 0, text,
});
const prefix = "Ravel private check\n\n";

async function run(text: unknown, response: unknown = geminiResponse()) {
  const output: string[] = [];
  const submissions: CheckSubmission[] = [];
  const status = await script.main(listenArgs, {
    receive: async () => receipt(text),
    check: async submission => { submissions.push(submission); return response; },
    output: line => output.push(line),
  });
  return { status, output, submissions, result: JSON.parse(output[output.length - 1]!) };
}

test("general review preview cannot load credentials, provider, receiver, client or network", () => {
  const child = `
    import fs from "node:fs";
    import { registerHooks, syncBuiltinESMExports } from "node:module";
    const original = fs.readFileSync;
    fs.readFileSync = (path, ...rest) => {
      if (String(path).endsWith("/.env")) throw new Error("Credential access forbidden");
      return original(path, ...rest);
    };
    syncBuiltinESMExports();
    registerHooks({ resolve(specifier, context, next) {
      if (specifier.includes("@spectrum") || specifier.includes("@photon-ai")
        || specifier.endsWith("/config.js") || specifier.endsWith("/ravel-client.js")
        || specifier.endsWith("/receive_photon_test.mjs")) throw new Error("Live access forbidden");
      return next(specifier, context);
    } });
    globalThis.fetch = async () => { throw new Error("Network forbidden"); };
    const { main } = await import(${JSON.stringify(scriptURL.href)});
    process.exitCode = await main(["--sender", ${JSON.stringify(sender)}]);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", child], {
    env: {}, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const preview = JSON.parse(result.stdout);
  assert.equal(preview.sender, sender);
  assert.equal(preview.window_seconds, 60);
  assert.equal(preview.network_connected, false);
  assert.equal(preview.backend_checks, 0);
  assert.equal(preview.messages_sent, 0);
  assert.equal(preview.processing_disclosure, script.PROCESSING_DISCLOSURE);
  assert.match(preview.processing_disclosure, /Photon and Ravel's backend; text is sent to Google Gemini/);
  assert.match(preview.processing_disclosure, /standalone HTTP\(S\) link is parsed locally, never opened/);
  assert.match(preview.processing_disclosure, /No other chats are scanned and no community report is created/);
  assert.equal(preview.reply, undefined);
});

for (const args of [[], ["--sender"], ["--sender", "2025550123"], ["--sender", sender + " "],
  ["--sender", sender, "--send"], [...listenArgs, "--listen"], [...listenArgs, "--sender", sender]]) {
  test(`invalid general review arguments have no effects ${JSON.stringify(args)}`, async () => {
    let calls = 0;
    const output: string[] = [];
    const forbidden = async () => { calls++; throw new Error(PRIVATE_SENTINEL); };
    assert.equal(await script.main(args, { receive: forbidden, check: forbidden, output: line => output.push(line) }), 1);
    assert.equal(calls, 0);
    assert.equal(JSON.parse(output[0]!).backend_checks, 0);
    assert.equal(JSON.parse(output[0]!).messages_sent, 0);
    assert.doesNotMatch(output.join(""), /private-message-sentinel|\+1202555/);
  });
}

test("actual received text is checked once after receive closure and model prose is never copied", async () => {
  const text = `  ${PRIVATE_SENTINEL}: Pay before delivery. ${PRIVATE_URL}  `;
  const response = geminiResponse();
  response.check_id = "chk_private_response_identifier";
  response.assessment.summary = PRIVATE_SENTINEL;
  response.assessment.recommended_action = PRIVATE_SENTINEL;
  response.assessment.indicators[0]!.description = PRIVATE_SENTINEL;
  response.assessment.indicators.push({ code: PRIVATE_SENTINEL, description: PRIVATE_SENTINEL,
    evidence_source: "gemini", verification_level: "unverified_inference" });
  response.limitations = [PRIVATE_SENTINEL];
  const calls: string[] = [];
  const output: string[] = [];
  assert.equal(await script.main(listenArgs, {
    receive: async actualSender => { assert.equal(actualSender, sender); calls.push("closed"); return receipt(text); },
    check: async (submission, signal) => {
      assert.deepEqual(submission, { content_type: "text", text });
      assert.equal(signal?.aborted, false);
      calls.push("check");
      return response;
    }, output: line => output.push(line),
  }), 0);
  assert.deepEqual(calls, ["closed", "check"]);
  const preview = JSON.parse(output[0]!);
  assert.equal(preview.reply, prefix + formatAssessment(response, { content_type: "text", text }));
  assert.equal(preview.recipient, sender);
  assert.deepEqual(preview.indicator_codes, ["advance_fee"]);
  assert.equal(preview.backend_checks, 1);
  assert.equal(preview.reply_requires_user_approval, true);
  assert.equal(preview.messages_sent, 0);
  assert.equal(preview.report_created, false);
  assert.equal(preview.verified_fraud, false);
  assert.equal(preview.known_threat, false);
  assert.equal(preview.related_report_count, 0);
  assert.doesNotMatch(output.join(""), /private-message-sentinel|private-query-token|private-fragment|private_response_identifier|tickets\.example/);
});

test("only an entire trimmed complete HTTP(S) link becomes a URL submission", async () => {
  const result = await run(` \n${PRIVATE_URL}\t `, urlResponse("gemini"));
  assert.equal(result.status, 0);
  assert.deepEqual(result.submissions, [{ content_type: "url", url: PRIVATE_URL }]);
  assert.equal(result.result.input_kind, "url");
  assert.equal(result.result.reply, prefix + formatAssessment(urlResponse("gemini"), { content_type: "url", url: PRIVATE_URL }));
  assert.match(result.result.reply, /this link was not analyzed by AI/);
  assert.match(result.result.reply, /destination was not visited/);
  assert.doesNotMatch(result.output.join(""), /private-query-token|private-fragment|tickets\.example/);
});

for (const text of [`Can you check ${PRIVATE_URL}?`, `${PRIVATE_URL} Pay now`, `${PRIVATE_URL}\nThis says my account is locked.`]) {
  test("message context accompanying a link remains an exact text submission", async () => {
    const result = await run(text);
    assert.equal(result.status, 0);
    assert.deepEqual(result.submissions, [{ content_type: "text", text }]);
  });
}

for (const [label, text] of [
  ["missing", undefined], ["nonstring", {}], ["empty", " \n\t"], ["unpaired surrogate", "\ud800"],
  ["text size", "x".repeat(10_001)], ["URL size", "https://tickets.example/" + "x".repeat(2_048)],
  ["URL credentials", "https://user:secret@tickets.example/"], ["URL backslash", "https://tickets.example\\path"],
  ["URL format control", "https://tickets.example/\u200bsecret"], ["malformed URL", "https://[bad"],
] as const) {
  test(`invalid received ${label} has no backend effect`, async () => {
    const result = await run(text);
    assert.equal(result.status, 1);
    assert.equal(result.submissions.length, 0);
    assert.equal(result.result.backend_checks, 0);
    assert.equal(result.result.reply, undefined);
    assert.equal(result.result.messages_sent, 0);
    assert.doesNotMatch(result.output.join(""), /secret|tickets\.example/);
  });
}

for (const badReceipt of [undefined, {}, { ...receipt(PRIVATE_SENTINEL), code: "receive_window_elapsed" },
  { ...receipt(PRIVATE_SENTINEL), incoming_message_verified: false },
  { ...receipt(PRIVATE_SENTINEL), matching_messages: 2 }, { ...receipt(PRIVATE_SENTINEL), messages_sent: 1 },
  { code: "attachment_unsupported", text: PRIVATE_SENTINEL }]) {
  test("unverified, timed out or attachment receive cannot trigger a backend check", async () => {
    let checks = 0;
    const output: string[] = [];
    assert.equal(await script.main(listenArgs, {
      receive: async () => badReceipt,
      check: async () => { checks++; return geminiResponse(); }, output: line => output.push(line),
    }), 1);
    assert.equal(checks, 0);
    assert.equal(JSON.parse(output[0]!).backend_checks, 0);
    assert.equal(JSON.parse(output[0]!).messages_sent, 0);
    assert.doesNotMatch(output.join(""), /private-message-sentinel/);
  });
}

for (const code of ["receive_window_elapsed", "receive_stream_ended", "receive_event_limit_reached",
  "receive_cancelled", "receive_failed", "receive_cleanup_failed"]) {
  test(`receive terminal diagnostic ${code} is preserved with zero backend checks or sends`, async () => {
    let checks = 0;
    const output: string[] = [];
    assert.equal(await script.main(listenArgs, {
      receive: async () => ({ code, heartbeat_observed: true, text: PRIVATE_SENTINEL,
        incoming_message_verified: false, matching_messages: 0, messages_sent: 0 }),
      check: async () => { checks++; return geminiResponse(); }, output: line => output.push(line),
    }), 1);
    const result = JSON.parse(output[0]!);
    assert.equal(result.code, "private_text_not_received");
    assert.equal(result.receive_code, code);
    assert.equal(result.heartbeat_observed, true);
    assert.equal(result.backend_checks, 0);
    assert.equal(result.messages_sent, 0);
    assert.equal(checks, 0);
    assert.doesNotMatch(output.join(""), /private-message-sentinel|\+1202555/);
  });
}

test("unknown receiver fields and throwing getters cannot become output or trigger a backend check", async () => {
  for (const badReceipt of [
    { code: PRIVATE_SENTINEL, heartbeat_observed: PRIVATE_URL, text: PRIVATE_SENTINEL,
      rejection_counts: { [PRIVATE_SENTINEL]: 1 }, event: { sender, guid: PRIVATE_SENTINEL } },
    { get code() { throw new Error(PRIVATE_SENTINEL); },
      get heartbeat_observed() { throw new Error(PRIVATE_URL); } },
    { code: "fresh_text_received", get incoming_message_verified() { throw new Error(PRIVATE_SENTINEL); },
      heartbeat_observed: 1 },
  ]) {
    let checks = 0;
    const output: string[] = [];
    assert.equal(await script.main(listenArgs, {
      receive: async () => badReceipt,
      check: async () => { checks++; return geminiResponse(); }, output: line => output.push(line),
    }), 1);
    const result = JSON.parse(output[0]!);
    assert.equal(result.code, "private_text_not_received");
    assert.equal(result.receive_code, "invalid_receive_result");
    assert.equal(result.heartbeat_observed, false);
    assert.equal(result.backend_checks, 0);
    assert.equal(result.messages_sent, 0);
    assert.equal(checks, 0);
    assert.equal(result.rejection_counts, undefined);
    assert.doesNotMatch(output.join(""), /private-message-sentinel|private-query-token|tickets\.example|\+1202555/);
  }
});

const invalidTextResults: [string, () => unknown][] = [
  ["fixture", fixtureResponse],
  ["report created", () => ({ ...geminiResponse(), report_created: true })],
  ["verified fraud", () => { const r = geminiResponse(); return { ...r, assessment: { ...r.assessment, verified_fraud: true } }; }],
  ["known threat", () => { const r = geminiResponse(); return { ...r, assessment: { ...r.assessment, known_threat: true } }; }],
  ["community count", () => { const r = geminiResponse(); return { ...r, assessment: { ...r.assessment, related_report_count: 1 } }; }],
  ["null observations", () => ({ ...geminiResponse(), observations: null })],
  ["fixture observations", () => { const r = geminiResponse(); return { ...r, observations: { ...r.observations, evidence_source: "fixture_provider" } }; }],
  ["unassessed observations", () => { const r = geminiResponse(); return { ...r, observations: { ...r.observations, verification_level: "not_assessed" } }; }],
  ["observed indicator", () => { const r = geminiResponse(); r.assessment.indicators[0]!.verification_level = "observed_claim"; return r; }],
  ["fixture indicator", () => { const r = geminiResponse(); r.assessment.indicators[0]!.evidence_source = "fixture_provider"; return r; }],
  ["extra raw field", () => ({ ...geminiResponse(), raw_model_output: PRIVATE_SENTINEL })],
  ["coerced credential flag", () => { const r = geminiResponse(); return { ...r, observations: { ...r.observations, credentials_requested: "true" } }; }],
  ["raw verification code", () => { const r = geminiResponse(); return { ...r, observations: { ...r.observations, verification_code: "091283" } }; }],
  ["incomplete response", () => ({ mode: "gemini", summary: PRIVATE_SENTINEL })],
];
for (const [label, response] of invalidTextResults) {
  test(`invalid text result ${label} cannot produce a reply or fixture fallback`, async () => {
    const result = await run(PRIVATE_SENTINEL, response());
    assert.equal(result.status, 1);
    assert.equal(result.submissions.length, 1);
    assert.equal(result.result.backend_checks, 1);
    assert.equal(result.result.reply, undefined);
    assert.equal(result.result.messages_sent, 0);
    assert.doesNotMatch(result.output.join(""), /private-message-sentinel|\+1202555/);
  });
}

const invalidURLResults: [string, (response: CheckResponse) => void][] = [
  ["fixture mode", r => { r.mode = "fixture"; }],
  ["null observations", r => { r.observations = null; }],
  ["AI observations", r => { r.observations!.evidence_source = "gemini"; }],
  ["AI inference", r => { r.observations!.verification_level = "unverified_inference"; }],
  ["category claim", r => { r.observations!.category = "ticket_offer"; }],
  ["payment flag", r => { r.observations!.payment_requested = false; }],
  ["urgency flag", r => { r.observations!.urgency_indicated = true; }],
  ["secrecy flag", r => { r.observations!.secrecy_requested = false; }],
  ["credential request", r => { r.observations!.credentials_requested = true; }],
  ["credential denial", r => { r.observations!.credentials_requested = false; }],
  ["verification code request", r => { r.observations!.verification_code_requested = true; }],
  ["verification code denial", r => { r.observations!.verification_code_requested = false; }],
  ["account threat", r => { r.observations!.account_threat_indicated = true; }],
  ["account threat denial", r => { r.observations!.account_threat_indicated = false; }],
  ["payment reason", r => { r.observations!.payment_reason = "advance_fee"; }],
  ["destination claim", r => { r.observations!.destinations = ["https://tickets.example"]; }],
  ["tactic indicator", r => { r.assessment.indicators = geminiResponse().assessment.indicators; }],
  ["suspicion category", r => { r.assessment.category = "suspicious_verify"; }],
];
for (const [label, change] of invalidURLResults) {
  test(`URL-only ${label} fails closed`, async () => {
    const response = urlResponse("gemini");
    change(response);
    const result = await run(PRIVATE_URL, response);
    assert.equal(result.status, 1);
    assert.equal(result.submissions.length, 1);
    assert.equal(result.result.reply, undefined);
    assert.equal(result.result.messages_sent, 0);
  });
}

for (const [command, reply] of [["/help", HELP_REPLY], ["/privacy", PRIVACY_REPLY], ["/report", REPORT_REPLY]]) {
  test(`${command} previews approved fixed copy with no backend call`, async () => {
    const result = await run(` ${command}\n`);
    assert.equal(result.status, 0);
    assert.equal(result.submissions.length, 0);
    assert.equal(result.result.reply, prefix + reply);
    assert.equal(result.result.input_kind, "command");
    assert.equal(result.result.backend_checks, 0);
    assert.equal(result.result.reply_requires_user_approval, true);
    assert.equal(result.result.messages_sent, 0);
    assert.equal(result.result.mode, undefined);
  });
}

test("unsupported command has fixed status and no backend or outgoing reply", async () => {
  const result = await run(`/report ${PRIVATE_SENTINEL}`);
  assert.equal(result.status, 1);
  assert.equal(result.result.code, "unsupported_command");
  assert.equal(result.submissions.length, 0);
  assert.equal(result.result.reply, undefined);
  assert.doesNotMatch(result.output.join(""), /private-message-sentinel/);
});

test("uncertain valid Gemini results preserve uncertainty and unknown observation flags", async () => {
  const response = geminiResponse();
  response.assessment.category = "needs_human_review";
  response.assessment.indicators = [];
  response.observations!.category = "unknown";
  response.observations!.payment_requested = null;
  response.observations!.payment_reason = null;
  response.observations!.uncertainty_codes = ["conflicting_evidence"];
  const result = await run(PRIVATE_SENTINEL, response);
  assert.equal(result.status, 0);
  assert.match(result.result.reply, /Needs human review/);
  assert.match(result.result.reply, /Missing evidence does not establish safety/);
  assert.doesNotMatch(result.result.reply, /Suspicious —|safe message/i);
});

const accountCases = [
  { flag: "credentials_requested", code: "credential_request", text: "Send your account password SYNTHETIC_SECRET to avoid suspension.", reason: /A request to share a password or account credentials is indicated/ },
  { flag: "verification_code_requested", code: "verification_code_request", text: "Reply with your verification code 091283.", reason: /A request to share a verification or account reset code is indicated/ },
  { flag: "account_threat_indicated", code: "account_threat", text: "Your account may close today; pay to prevent suspension.", reason: /A claim that an account is at risk or may be suspended is indicated/ },
] as const;

for (const { flag, code, text, reason } of accountCases) {
  test(`fresh ${code} text produces one private check and a fixed unverified approval preview`, async () => {
    const response = geminiResponse();
    response.observations![flag] = true;
    response.assessment.summary = text;
    response.assessment.recommended_action = PRIVATE_URL;
    response.assessment.indicators = [{ ...response.assessment.indicators[0]!, code, description: text },
      { ...response.assessment.indicators[0]!, code: "constructor" },
      { ...response.assessment.indicators[0]!, code: PRIVATE_SENTINEL }];
    const result = await run(text, response);
    assert.equal(result.status, 0);
    assert.deepEqual(result.submissions, [{ content_type: "text", text }]);
    assert.equal(result.result.backend_checks, 1);
    assert.equal(result.result.category, "suspicious_verify");
    assert.deepEqual(result.result.indicator_codes, [code]);
    assert.match(result.result.reply, reason);
    assert.match(result.result.reply, /Gemini AI observations — unverified/);
    assert.match(result.result.reply, /Open the official app yourself/);
    assert.equal(result.result.messages_sent, 0);
    assert.equal(result.result.reply_requires_user_approval, true);
    assert.equal(result.result.report_created, false);
    assert.equal(result.result.verified_fraud, false);
    assert.equal(result.result.known_threat, false);
    assert.equal(result.result.related_report_count, 0);
    assert.doesNotMatch(result.output.join(""), /SYNTHETIC_SECRET|091283|private-query-token|private-message-sentinel|constructor/);
  });
}

test("fresh benign code notification stays insufficient and has no account-request wording", async () => {
  const text = "Your sign-in code is 091283. Never share it. We will never ask for your password.";
  const response = geminiResponse();
  response.assessment.category = "insufficient_evidence";
  response.assessment.indicators = [];
  response.observations!.category = "unknown";
  response.observations!.payment_requested = false;
  response.observations!.payment_reason = null;
  response.observations!.urgency_indicated = false;
  response.observations!.credentials_requested = false;
  response.observations!.verification_code_requested = false;
  response.observations!.account_threat_indicated = false;
  const result = await run(text, response);
  assert.equal(result.status, 0);
  assert.equal(result.result.category, "insufficient_evidence");
  assert.deepEqual(result.result.indicator_codes, []);
  assert.match(result.result.reply, /No sufficiently supported tactic indicators/);
  assert.doesNotMatch(result.result.reply, /A request to share|Suspicious —|091283/);
  assert.equal(result.result.messages_sent, 0);
});

test("account threat plus urgency cannot promote the backend's insufficient category", async () => {
  const response = geminiResponse();
  response.assessment.category = "insufficient_evidence";
  response.assessment.indicators = ["account_threat", "urgency"].map(code => ({ ...response.assessment.indicators[0]!, code }));
  response.observations!.category = "unknown";
  response.observations!.payment_requested = false;
  response.observations!.payment_reason = null;
  response.observations!.account_threat_indicated = true;
  const result = await run("Your account may close today.", response);
  assert.equal(result.status, 0);
  assert.equal(result.result.category, "insufficient_evidence");
  assert.match(result.result.reply, /Insufficient evidence/);
  assert.doesNotMatch(result.result.reply, /Suspicious —/);
});

test("uncertainty remains review-first even with new tactic flags and indicators", async () => {
  const response = geminiResponse();
  response.assessment.category = "needs_human_review";
  response.observations!.credentials_requested = true;
  response.observations!.verification_code_requested = true;
  response.observations!.account_threat_indicated = true;
  response.observations!.uncertainty_codes = ["content_unclear"];
  response.assessment.indicators = ["credential_request", "verification_code_request", "account_threat"]
    .map(code => ({ ...response.assessment.indicators[0]!, code }));
  const result = await run(PRIVATE_SENTINEL, response);
  assert.equal(result.status, 0);
  assert.match(result.result.reply, /Needs human review/);
  assert.match(result.result.reply, /unclear or inconsistent/);
  assert.doesNotMatch(result.result.reply, /A request to share|A claim that an account|Suspicious —/);
  assert.equal(result.result.messages_sent, 0);
});

for (const contentType of ["text", "url"] as const) {
  test(`real RavelClient ${contentType} boundary posts only the selected private input and never visits links`, async () => {
    const text = contentType === "url" ? PRIVATE_URL : `${PRIVATE_SENTINEL} ${PRIVATE_URL}`;
    const response = contentType === "url" ? urlResponse("gemini") : geminiResponse();
    const calls: { target: string; body: unknown }[] = [];
    const client = new RavelClient({ baseURL: "https://backend.example" }, async (input, init) => {
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.credentials, "omit");
      calls.push({ target: String(input), body: JSON.parse(String(init?.body)) });
      return jsonResponse(response);
    });
    const output: string[] = [];
    assert.equal(await script.main(listenArgs, { receive: async () => receipt(text),
      check: (submission, signal) => client.check(submission, signal), output: line => output.push(line) }), 0);
    assert.deepEqual(calls, [{ target: "https://backend.example/v1/check", body: {
      content_type: contentType, [contentType]: text, source_channel: "photon_imessage", privacy_mode: "private_check",
    } }]);
    assert.doesNotMatch(output.join(""), /private-message-sentinel|private-query-token|private-fragment/);
  });
}

test("native standalone URL preview closes the actual receiver before one private URL check and fixed reply preview", async () => {
  interface ReceiveScript {
    observePrivateText(sender: string, options: {
      client: {
        messages: { subscribeEvents(filter: { chat: string }): AsyncIterable<unknown> & { close(): Promise<void> } };
        close(): Promise<void>;
      };
      now: () => number;
      signal: AbortSignal;
    }): Promise<unknown>;
  }
  const receiverURL = new URL("../../../scripts/receive_photon_test.mjs", import.meta.url);
  const receiver = await import(receiverURL.href) as ReceiveScript;
  const startedAt = 1_700_000_000_000;
  const guid = `any;-;${sender}`;
  const event = {
    type: "message.received", chatGuid: guid, isFromMe: false,
    occurredAt: new Date(startedAt), actor: { address: sender, service: "imessage" },
    message: {
      guid: PRIVATE_SENTINEL, chatGuids: [guid], dateCreated: new Date(startedAt),
      sender: { address: sender, service: "imessage" }, isFromMe: false,
      itemType: "normal", isAutoReply: false, isSystemMessage: false,
      isServiceMessage: false, isCorrupt: false, partCount: 1,
      content: { text: PRIVATE_URL, attachments: [], balloonBundleId: "com.apple.messages.URLBalloonProvider" },
    },
  };
  let streamClosed = false;
  let clientClosed = false;
  let forbiddenCalls = 0;
  const forbidden = () => { forbiddenCalls++; throw new Error("Forbidden SDK or network access"); };
  const order: string[] = [];
  const filters: { chat: string }[] = [];
  const stream = {
    [Symbol.asyncIterator]() {
      let yielded = false;
      return { async next(): Promise<IteratorResult<unknown>> {
        if (yielded) return { done: true, value: undefined };
        yielded = true;
        order.push("event");
        return { done: false, value: event };
      } };
    },
    async close() { await Promise.resolve(); streamClosed = true; order.push("stream_closed"); },
  };
  const photonClient = {
    messages: {
      subscribeEvents(filter: { chat: string }) { filters.push(filter); return stream; },
      get send() { return forbidden(); }, get history() { return forbidden(); },
      get getMessage() { return forbidden(); }, get markRead() { return forbidden(); },
    },
    get attachments() { return forbidden(); }, get profile() { return forbidden(); },
    get typing() { return forbidden(); },
    async close() { await Promise.resolve(); clientClosed = true; order.push("client_closed"); },
  };
  const response = urlResponse("gemini");
  const wireCalls: { target: string; body: unknown }[] = [];
  const backend = new RavelClient({ baseURL: "https://backend.example" }, async (input, init) => {
    assert.equal(streamClosed, true);
    assert.equal(clientClosed, true);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.cache, "no-store");
    order.push("backend");
    wireCalls.push({ target: String(input), body: JSON.parse(String(init?.body)) });
    return jsonResponse(response);
  });
  const output: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => forbidden();
  try {
    assert.equal(await script.main(listenArgs, {
      receive: async (selectedSender, _output, signal) => {
        assert.ok(signal);
        return receiver.observePrivateText(selectedSender, { client: photonClient, now: () => startedAt, signal });
      },
      check: (submission, signal) => backend.check(submission, signal), output: line => output.push(line),
    }), 0);
  } finally { globalThis.fetch = originalFetch; }
  assert.deepEqual(filters, [{ chat: guid }]);
  assert.deepEqual(order, ["event", "stream_closed", "client_closed", "backend"]);
  assert.equal(forbiddenCalls, 0);
  assert.deepEqual(wireCalls, [{ target: "https://backend.example/v1/check", body: {
    content_type: "url", url: PRIVATE_URL, source_channel: "photon_imessage", privacy_mode: "private_check",
  } }]);
  assert.equal(response.observations!.evidence_source, "not_analyzed");
  assert.equal(response.observations!.verification_level, "not_assessed");
  const preview = JSON.parse(output[0]!);
  assert.equal(preview.code, "reply_preview_ready");
  assert.equal(preview.reply, prefix + formatAssessment(response, { content_type: "url", url: PRIVATE_URL }));
  assert.match(preview.reply, /link was not analyzed by AI/);
  assert.equal(preview.input_kind, "url");
  assert.equal(preview.category, "insufficient_evidence");
  assert.deepEqual(preview.indicator_codes, []);
  assert.equal(preview.incoming_message_verified, true);
  assert.equal(preview.backend_checks, 1);
  assert.equal(preview.messages_sent, 0);
  assert.equal(preview.report_created, false);
  assert.equal(preview.known_threat, false);
  assert.equal(preview.verified_fraud, false);
  assert.doesNotMatch(output.join(""), /private-message-sentinel|private-query-token|private-fragment|tickets\.example|URLBalloonProvider|any;-;/);
});

test("receive failure and backend failure retain fixed codes without raw error details or retry", async () => {
  for (const failReceive of [true, false]) {
    let checks = 0;
    const output: string[] = [];
    const error = Object.assign(new Error(PRIVATE_SENTINEL + PRIVATE_URL), {
      code: "provider_timeout", details: PRIVATE_SENTINEL, context: PRIVATE_SENTINEL,
    });
    assert.equal(await script.main(listenArgs, {
      receive: async () => { if (failReceive) throw error; return receipt(PRIVATE_SENTINEL); },
      check: async () => { checks++; throw error; }, output: line => output.push(line),
    }), 1);
    assert.equal(checks, failReceive ? 0 : 1);
    assert.equal(JSON.parse(output[0]!).messages_sent, 0);
    assert.equal(JSON.parse(output[0]!).reply, undefined);
    assert.doesNotMatch(output.join(""), /private-message-sentinel|private-query-token|tickets\.example/);
  }
});

test("cancellation before or just after receipt prevents a backend check", async () => {
  for (const before of [true, false]) {
    const controller = new AbortController();
    if (before) controller.abort();
    let checks = 0;
    let receives = 0;
    const output: string[] = [];
    assert.equal(await script.main(listenArgs, {
      signal: controller.signal,
      receive: async (_sender, _output, signal) => {
        receives++;
        assert.equal(signal?.aborted, false);
        controller.abort();
        assert.equal(signal?.aborted, true);
        return receipt(PRIVATE_SENTINEL);
      },
      check: async () => { checks++; return geminiResponse(); }, output: line => output.push(line),
    }), 1);
    assert.equal(receives, before ? 0 : 1);
    assert.equal(checks, 0);
    assert.equal(JSON.parse(output[0]!).code, "cancelled");
    assert.equal(JSON.parse(output[0]!).messages_sent, 0);
  }
});

test("backend cancellation uses its signal and cannot publish a late result", async () => {
  const controller = new AbortController();
  const output: string[] = [];
  const originalSIGINT = process.listenerCount("SIGINT");
  const originalSIGTERM = process.listenerCount("SIGTERM");
  assert.equal(await script.main(listenArgs, {
    signal: controller.signal, receive: async () => receipt(PRIVATE_SENTINEL),
    check: async (_submission, signal) => {
      controller.abort();
      assert.equal(signal?.aborted, true);
      return geminiResponse();
    }, output: line => output.push(line),
  }), 1);
  assert.equal(JSON.parse(output[0]!).code, "cancelled");
  assert.equal(JSON.parse(output[0]!).backend_checks, 1);
  assert.equal(JSON.parse(output[0]!).reply, undefined);
  assert.equal(process.listenerCount("SIGINT"), originalSIGINT);
  assert.equal(process.listenerCount("SIGTERM"), originalSIGTERM);
});

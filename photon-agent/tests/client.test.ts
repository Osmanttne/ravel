import assert from "node:assert/strict";
import test from "node:test";
import { CheckResponseSchema, type CheckSubmission } from "../src/contracts.js";
import {
  backendEndpoint, CheckFailure, MAX_RESPONSE_BYTES, MAX_TEXT_SCALARS,
  MAX_URL_SCALARS, RavelClient,
} from "../src/ravel-client.js";
import {
  expectFailure, fixtureResponse, geminiResponse, jsonResponse, PRIVATE_SENTINEL,
  PRIVATE_URL, SYNTHETIC_MESSAGE, urlResponse,
} from "./helpers.js";

for (const [baseURL, expected] of [
  ["https://api.example", "https://api.example/v1/check"],
  ["https://api.example/private/", "https://api.example/private/v1/check"],
]) {
  test(`backend path is anchored to configured base: ${baseURL}`, () => {
    assert.equal(backendEndpoint({ baseURL: baseURL! }).href, expected);
  });
}

for (const baseURL of [
  "http://localhost:8002", "http://127.0.0.1:8002", "http://10.0.0.8:8002",
  "http://172.16.0.8:8002", "http://192.168.0.8:8002", "http://[::1]:8002",
]) {
  test(`local HTTP requires an explicit development opt-in: ${baseURL}`, () => {
    assert.throws(() => new RavelClient({ baseURL }), CheckFailure);
    assert.ok(new RavelClient({ baseURL, allowLocalHTTP: true }));
  });
}

for (const baseURL of [
  "http://public.example", "http://172.32.0.8", "https://user:private-message-sentinel@api.example",
  "https://api.example/?token=private-query-token", "https://api.example/#private-fragment",
  "file:///tmp/check", "https://api.example/\nprivate", "not a URL",
]) {
  test(`unsafe backend configuration is rejected without exposing it: ${JSON.stringify(baseURL)}`, () => {
    assert.throws(() => new RavelClient({ baseURL, allowLocalHTTP: true }), (error: unknown) => {
      assert.ok(error instanceof CheckFailure);
      assert.equal(error.code, "configuration");
      assert.doesNotMatch(error.message, /private-message-sentinel|private-query-token|private-fragment/);
      return true;
    });
  });
}

for (const timeoutSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 121]) {
  test(`invalid timeout is rejected: ${timeoutSeconds}`, () => {
    assert.throws(() => new RavelClient({ baseURL: "https://api.example", timeoutSeconds }), CheckFailure);
  });
}

for (const submission of [
  { content_type: "text", text: SYNTHETIC_MESSAGE },
  { content_type: "url", url: PRIVATE_URL },
] satisfies CheckSubmission[]) {
  test(`wire request is one private Photon ${submission.content_type} submission`, async () => {
    const calls: { input: RequestInfo | URL; init: RequestInit | undefined }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse(submission.content_type === "url" ? urlResponse() : fixtureResponse());
    };
    const result = await new RavelClient({ baseURL: "https://api.example/base/" }, fetcher).check(submission);
    assert.equal(calls.length, 1);
    assert.equal(String(calls[0]!.input), "https://api.example/base/v1/check");
    const options = calls[0]!.init!;
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    assert.deepEqual(options.headers, { "Content-Type": "application/json", Accept: "application/json" });
    assert.deepEqual(JSON.parse(options.body as string), {
      ...submission, source_channel: "photon_imessage", privacy_mode: "private_check",
    });
    assert.equal(result.report_created, false);
    assert.equal(result.assessment.related_report_count, 0);
  });
}

test("submission limits count Unicode scalars instead of UTF-16 code units", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return jsonResponse(fixtureResponse()); };
  const client = new RavelClient({ baseURL: "https://api.example" }, fetcher);
  await client.check({ content_type: "text", text: "😀".repeat(MAX_TEXT_SCALARS) });
  assert.equal(calls, 1);
  await expectFailure(() => client.check({ content_type: "text", text: "😀".repeat(MAX_TEXT_SCALARS + 1) }), "too_large");
  await expectFailure(() => client.check({ content_type: "text", text: "a\u0301".repeat(MAX_TEXT_SCALARS / 2 + 1) }), "too_large");
  await expectFailure(() => client.check({ content_type: "url", url: "https://links.example/" + "x".repeat(MAX_URL_SCALARS) }), "too_large");
  assert.equal(calls, 1);
});

test("empty and malformed runtime submissions never reach fetch", async () => {
  let calls = 0;
  const client = new RavelClient({ baseURL: "https://api.example" }, async () => {
    calls++; return jsonResponse(fixtureResponse());
  });
  await expectFailure(() => client.check({ content_type: "text", text: " \n " }), "insufficient_input");
  for (const bad of [
    { content_type: "image", image: PRIVATE_SENTINEL },
    { content_type: "text", text: 123 },
  ]) {
    await expectFailure(() => client.check(bad as unknown as CheckSubmission));
  }
  assert.equal(calls, 0);
});

test("extra runtime metadata cannot be forwarded or override private Photon fields", async () => {
  const client = new RavelClient({ baseURL: "https://api.example" }, async (_input, init) => {
    const payload = JSON.parse(init!.body as string);
    assert.deepEqual(payload, {
      content_type: "text", text: SYNTHETIC_MESSAGE,
      source_channel: "photon_imessage", privacy_mode: "private_check",
    });
    return jsonResponse(fixtureResponse());
  });
  await client.check({
    content_type: "text", text: SYNTHETIC_MESSAGE, private_metadata: PRIVATE_SENTINEL,
    source_channel: "web", privacy_mode: "report",
  } as unknown as CheckSubmission);
});

for (const url of [
  "mailto:person@example.com", "https://user:secret@tickets.example/", "https://tickets.example/a b",
  "https://tickets.example\\private", "https://tickets.example/\u0000private", "https://tickets.example/\u200bprivate",
]) {
  test(`invalid selected URL does not reach the backend: ${JSON.stringify(url)}`, async () => {
    const client = new RavelClient({ baseURL: "https://api.example" }, async () => {
      assert.fail("fetch must not run for invalid selected URL");
    });
    await expectFailure(() => client.check({ content_type: "url", url }), "unsafe_url");
  });
}

const responseMutations: [string, (value: Record<string, any>) => void][] = [
  ["report created", (v) => { v.report_created = true; }],
  ["verified fraud", (v) => { v.assessment.verified_fraud = true; }],
  ["known threat", (v) => { v.assessment.known_threat = true; }],
  ["related reports", (v) => { v.assessment.related_report_count = 1; }],
  ["unavailable verified category", (v) => { v.assessment.category = "known_malicious_evidence"; }],
  ["string false", (v) => { v.report_created = "false"; }],
  ["extra top-level raw content", (v) => { v.raw_input = PRIVATE_SENTINEL; }],
  ["extra indicator quote", (v) => { v.assessment.indicators[0].quote = PRIVATE_SENTINEL; }],
  ["missing verification flag", (v) => { delete v.assessment.verified_fraud; }],
  ["unsafe evidence source", (v) => { v.assessment.indicators[0].evidence_source = "opt_in_reports"; }],
  ["oversized summary", (v) => { v.assessment.summary = "x".repeat(2001); }],
];
for (const [name, mutate] of responseMutations) {
  test(`response rejects unsupported claims: ${name}`, async () => {
    const payload = structuredClone(fixtureResponse());
    mutate(payload);
    const client = new RavelClient({ baseURL: "https://api.example" }, async () => jsonResponse(payload));
    await expectFailure(() => client.check({ content_type: "text", text: SYNTHETIC_MESSAGE }), "invalid_response");
  });
}

test("nullable observations remain unknown rather than false", () => {
  const payload = geminiResponse();
  payload.observations!.payment_requested = null;
  payload.observations!.payment_reason = null;
  const parsed = CheckResponseSchema.parse(payload);
  assert.equal(parsed.observations!.payment_requested, null);
  assert.equal(parsed.observations!.secrecy_requested, null);
});

const accountFlags = ["credentials_requested", "verification_code_requested", "account_threat_indicated"] as const;

test("older connected responses decode omitted account flags as unknown", async () => {
  const payload = JSON.parse(JSON.stringify(geminiResponse()));
  for (const key of accountFlags) delete payload.observations[key];
  const client = new RavelClient({ baseURL: "https://api.example" }, async () => jsonResponse(payload));
  const result = await client.check({ content_type: "text", text: SYNTHETIC_MESSAGE });
  for (const key of accountFlags) assert.equal(result.observations![key], null);
});

for (const key of accountFlags) {
  test(`${key} preserves true, false and unknown without coercion`, () => {
    for (const value of [true, false, null]) {
      const payload = geminiResponse();
      payload.observations![key] = value;
      assert.equal(CheckResponseSchema.parse(payload).observations![key], value);
    }
    for (const invalid of ["true", "false", 0, 1, {}, []]) {
      const payload = JSON.parse(JSON.stringify(geminiResponse()));
      payload.observations[key] = invalid;
      assert.equal(CheckResponseSchema.safeParse(payload).success, false);
    }
  });
}

test("extended observations retain strict categories, uncertainty codes and raw-content exclusions", () => {
  for (const mutate of [
    (v: Record<string, any>) => { v.observations.category = "credential_phishing"; },
    (v: Record<string, any>) => { v.observations.uncertainty_codes = ["credential_request"]; },
    (v: Record<string, any>) => { v.observations.password = PRIVATE_SENTINEL; },
    (v: Record<string, any>) => { v.observations.verification_code = "091283"; },
    (v: Record<string, any>) => { v.observations.evidence_spans = [{ text: PRIVATE_SENTINEL }]; },
  ]) {
    const payload = JSON.parse(JSON.stringify(geminiResponse()));
    mutate(payload);
    assert.equal(CheckResponseSchema.safeParse(payload).success, false);
  }
});

for (const destination of [PRIVATE_URL, "https://user:secret@tickets.example", "https://tickets.example/path", "file:///private"]) {
  test(`public observation destinations must be origins: ${destination}`, async () => {
    const payload = geminiResponse();
    payload.observations!.destinations = [destination];
    const client = new RavelClient({ baseURL: "https://api.example" }, async () => jsonResponse(payload));
    await expectFailure(() => client.check({ content_type: "text", text: SYNTHETIC_MESSAGE }), "invalid_response");
  });
}

test("Gemini text responses require unverified Gemini observation and indicator provenance", async () => {
  for (const mutate of [
    (r: ReturnType<typeof geminiResponse>) => { r.observations = null; },
    (r: ReturnType<typeof geminiResponse>) => { r.observations!.evidence_source = "fixture_provider"; },
    (r: ReturnType<typeof geminiResponse>) => { r.observations!.verification_level = "not_assessed"; },
    (r: ReturnType<typeof geminiResponse>) => { r.assessment.indicators[0]!.evidence_source = "submitted_content"; },
  ]) {
    const response = geminiResponse();
    mutate(response);
    const client = new RavelClient({ baseURL: "https://api.example" }, async () => jsonResponse(response));
    await expectFailure(() => client.check({ content_type: "text", text: SYNTHETIC_MESSAGE }), "invalid_response");
  }
});

test("URL-only responses cannot contain model observations or payment/offer claims", async () => {
  for (const mutate of [
    (r: ReturnType<typeof urlResponse>) => { r.assessment.category = "suspicious_verify"; },
    (r: ReturnType<typeof urlResponse>) => { r.observations!.evidence_source = "gemini"; },
    (r: ReturnType<typeof urlResponse>) => { r.observations!.payment_requested = true; },
    (r: ReturnType<typeof urlResponse>) => { r.observations!.payment_reason = "advance_fee"; },
    (r: ReturnType<typeof urlResponse>) => { r.observations!.category = "ticket_offer"; },
    (r: ReturnType<typeof urlResponse>) => { r.observations!.destinations = ["https://tickets.example"]; },
  ]) {
    const response = urlResponse("gemini");
    mutate(response);
    const client = new RavelClient({ baseURL: "https://api.example" }, async () => jsonResponse(response));
    await expectFailure(() => client.check({ content_type: "url", url: PRIVATE_URL }), "invalid_response");
  }
});

for (const key of accountFlags) {
  for (const value of [true, false]) {
    test(`URL-only ${key} must remain unknown, not ${value}`, async () => {
      const response = urlResponse("gemini");
      response.observations![key] = value;
      const client = new RavelClient({ baseURL: "https://api.example" }, async () => jsonResponse(response));
      await expectFailure(() => client.check({ content_type: "url", url: PRIVATE_URL }), "invalid_response");
    });
  }
}

test("older URL-only responses omit account flags without inventing analysis", async () => {
  const payload = JSON.parse(JSON.stringify(urlResponse("gemini")));
  for (const key of accountFlags) delete payload.observations[key];
  const result = await new RavelClient({ baseURL: "https://api.example" }, async () => jsonResponse(payload))
    .check({ content_type: "url", url: PRIVATE_URL });
  assert.equal(result.observations!.evidence_source, "not_analyzed");
  for (const key of accountFlags) assert.equal(result.observations![key], null);
});

test("declared oversized response is cancelled before reading", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const client = new RavelClient({ baseURL: "https://api.example" }, async () => new Response(stream, {
    headers: { "Content-Type": "application/json", "Content-Length": String(MAX_RESPONSE_BYTES + 1) },
  }));
  await expectFailure(() => client.check({ content_type: "text", text: SYNTHETIC_MESSAGE }), "too_large");
  assert.equal(cancelled, true);
});

test("chunked body is bounded without trusting content length", async () => {
  let cancelled = false;
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { pulled++; controller.enqueue(new Uint8Array(32 * 1024)); },
    cancel() { cancelled = true; },
  });
  const client = new RavelClient({ baseURL: "https://api.example" }, async () => new Response(stream, {
    headers: { "Content-Type": "application/json", "Content-Length": "1" },
  }));
  await expectFailure(() => client.check({ content_type: "text", text: SYNTHETIC_MESSAGE }), "too_large");
  assert.equal(cancelled, true);
  assert.ok(pulled <= 6);
});

test("an exact-cap valid JSON body and split UTF-8 chunks decode successfully", async () => {
  const result = fixtureResponse();
  result.limitations = ["Synthetic café control."];
  const data = new TextEncoder().encode(JSON.stringify(result));
  const offset = data.findIndex((byte) => byte === 0xc3);
  assert.ok(offset >= 0);
  const prefix = new TextEncoder().encode(" ".repeat(MAX_RESPONSE_BYTES - data.length));
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(prefix); controller.enqueue(data.slice(0, offset + 1));
    controller.enqueue(data.slice(offset + 1)); controller.close();
  } });
  const client = new RavelClient({ baseURL: "https://api.example" }, async () => new Response(stream, {
    headers: { "Content-Type": "application/json" },
  }));
  assert.deepEqual(await client.check({ content_type: "text", text: SYNTHETIC_MESSAGE }), result);
});

for (const code of ["provider_timeout", "provider_invalid_output", "unsafe_url", "too_large"] as const) {
  test(`backend ${code} errors expose only a fixed local message`, async () => {
    const client = new RavelClient({ baseURL: "https://api.example" }, async () => jsonResponse({
      error: { code, message: PRIVATE_SENTINEL + PRIVATE_URL, request_id: PRIVATE_SENTINEL },
    }, 502));
    await expectFailure(() => client.check({ content_type: "text", text: SYNTHETIC_MESSAGE }), code);
  });
}

test("unknown provider codes and transport exceptions are scrubbed", async () => {
  const unexpected = new RavelClient({ baseURL: "https://api.example" }, async () => jsonResponse({
    error: { code: PRIVATE_SENTINEL, message: PRIVATE_URL },
  }, 503));
  await expectFailure(() => unexpected.check({ content_type: "text", text: SYNTHETIC_MESSAGE }), "service_unavailable");
  const transport = new RavelClient({ baseURL: "https://api.example" }, async () => {
    throw new Error(PRIVATE_SENTINEL + PRIVATE_URL);
  });
  await expectFailure(() => transport.check({ content_type: "text", text: SYNTHETIC_MESSAGE }), "service_unavailable");
});

test("redirects are rejected without following the alternate destination", async () => {
  let calls = 0;
  const client = new RavelClient({ baseURL: "https://api.example" }, async (_input, init) => {
    calls++; assert.equal(init!.redirect, "error");
    return new Response(null, { status: 302, headers: { Location: PRIVATE_URL } });
  });
  await expectFailure(() => client.check({ content_type: "text", text: SYNTHETIC_MESSAGE }), "service_unavailable");
  assert.equal(calls, 1);
});

test("timeouts abort the request once without retry", async () => {
  let calls = 0;
  const client = new RavelClient({ baseURL: "https://api.example", timeoutSeconds: 0.01 }, async (_input, init) => {
    calls++;
    return await new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error(PRIVATE_SENTINEL)), { once: true });
    });
  });
  await expectFailure(() => client.check({ content_type: "text", text: SYNTHETIC_MESSAGE }), "provider_timeout");
  assert.equal(calls, 1);
});

test("caller cancellation is distinct from timeout and prevents pre-cancelled fetches", async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = new RavelClient({ baseURL: "https://api.example" }, async (_input, init) => {
    calls++;
    controller.abort();
    assert.equal(init!.signal!.aborted, true);
    throw new Error(PRIVATE_SENTINEL);
  });
  await expectFailure(() => client.check({ content_type: "text", text: SYNTHETIC_MESSAGE }, controller.signal), "cancelled");
  await expectFailure(() => client.check({ content_type: "text", text: SYNTHETIC_MESSAGE }, controller.signal), "cancelled");
  assert.equal(calls, 1);
});

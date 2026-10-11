import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { geminiResponse, fixtureResponse, PRIVATE_SENTINEL } from "./helpers.js";

const url = new URL("../../../scripts/check_photon_test.mjs", import.meta.url);
interface Script {
  TEST_INPUT: string;
  main(args: string[], options?: {
    receive?: (sender: string, text: string, output: (value: string) => void) => Promise<unknown>;
    check?: (submission: { content_type: string; text: string }) => Promise<unknown>;
    output?: (value: string) => void;
  }): Promise<number>;
}
const script = await import(url.href) as Script;
const sender = "+12025550123";
const receipt = { code: "fresh_marker_received", incoming_message_verified: true, matching_messages: 1, messages_sent: 0 };

test("check preview loads no credentials, SDK, network, receive or backend", () => {
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
      if (specifier.includes("@spectrum") || specifier.includes("@photon-ai") || specifier.endsWith("/config.js")) throw new Error("Provider access forbidden");
      return next(specifier, context);
    } });
    globalThis.fetch = async () => { throw new Error("Network forbidden"); };
    const { main } = await import(${JSON.stringify(url.href)});
    process.exitCode = await main(["--sender", ${JSON.stringify(sender)}]);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", child], { env: {}, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const preview = JSON.parse(result.stdout);
  assert.equal(preview.network_connected, false);
  assert.equal(preview.messages_sent, 0);
  assert.equal(preview.backend_checks, 0);
});

for (const args of [[], ["--sender"], ["--sender", "2025550123"], ["--sender", sender, "--send"],
  ["--sender", sender, "--listen", "--listen"], ["--sender", sender, "--sender", sender]]) {
  test(`invalid check arguments have zero effects ${JSON.stringify(args)}`, async () => {
    const output: string[] = [];
    const forbidden = async () => { throw new Error(PRIVATE_SENTINEL); };
    assert.equal(await script.main(args, { receive: forbidden, check: forbidden, output: line => output.push(line) }), 1);
    assert.equal(JSON.parse(output[0]!).backend_checks, 0);
    assert.equal(JSON.parse(output[0]!).messages_sent, 0);
    assert.doesNotMatch(output.join(""), /private-message-sentinel|\+1202555/);
  });
}

test("fresh exact synthetic receipt precedes one Gemini check and a private reply preview", async () => {
  const calls: string[] = [];
  const output: string[] = [];
  const response = geminiResponse();
  response.assessment.summary = PRIVATE_SENTINEL;
  response.assessment.recommended_action = PRIVATE_SENTINEL;
  const result = await script.main(["--sender", sender, "--listen"], {
    receive: async (actualSender, input) => {
      calls.push("receive_closed");
      assert.equal(actualSender, sender);
      assert.equal(input, "Free concert tickets. Pay a $20 transfer fee before delivery: https://tickets.example/offer. Act now!");
      return receipt;
    },
    check: async submission => {
      calls.push("check");
      assert.deepEqual(submission, { content_type: "text", text: script.TEST_INPUT });
      return response;
    }, output: line => output.push(line),
  });
  assert.equal(result, 0);
  assert.deepEqual(calls, ["receive_closed", "check"]);
  const preview = JSON.parse(output[0]!);
  assert.equal(preview.code, "reply_preview_ready");
  assert.equal(preview.recipient, sender);
  assert.match(preview.reply, /^Ravel private check\n\nGemini AI observations — unverified/);
  assert.match(preview.reply, /Suspicious — verify before acting/);
  assert.match(preview.reply, /no community report was created/);
  assert.doesNotMatch(preview.reply, /private-message-sentinel|tickets\.example/);
  assert.equal(preview.messages_sent, 0);
  assert.equal(preview.reply_requires_user_approval, true);
  assert.equal(preview.report_created, false);
  assert.equal(preview.verified_fraud, false);
  assert.equal(preview.related_report_count, 0);
});

for (const badReceipt of [undefined, {}, { ...receipt, incoming_message_verified: false },
  { ...receipt, matching_messages: 2 }, { ...receipt, messages_sent: 1 }, { ...receipt, code: "receive_window_elapsed" }]) {
  test(`unverified receive cannot trigger backend ${JSON.stringify(badReceipt)}`, async () => {
    let checks = 0;
    const output: string[] = [];
    assert.equal(await script.main(["--sender", sender, "--listen"], {
      receive: async () => badReceipt, check: async () => { checks++; return geminiResponse(); }, output: line => output.push(line),
    }), 1);
    assert.equal(checks, 0);
    assert.equal(JSON.parse(output[0]!).messages_sent, 0);
  });
}

const badResults: [string, () => unknown][] = [
  ["fixture", fixtureResponse],
  ["report creation", () => ({ ...geminiResponse(), report_created: true })],
  ["verified fraud", () => { const r = geminiResponse(); return { ...r, assessment: { ...r.assessment, verified_fraud: true } }; }],
  ["community count", () => { const r = geminiResponse(); return { ...r, assessment: { ...r.assessment, related_report_count: 1 } }; }],
  ["missing observations", () => ({ ...geminiResponse(), observations: null })],
  ["bad provenance", () => { const r = geminiResponse(); return { ...r, observations: { ...r.observations, evidence_source: "fixture_provider" } }; }],
  ["invalid account flag", () => { const r = geminiResponse(); return { ...r, observations: { ...r.observations, account_threat_indicated: "false" } }; }],
  ["raw password field", () => { const r = geminiResponse(); return { ...r, observations: { ...r.observations, password: PRIVATE_SENTINEL } }; }],
  ["incomplete response", () => ({ mode: "gemini", summary: PRIVATE_SENTINEL })],
];
for (const [label, response] of badResults) {
  test(`invalid ${label} produces no outgoing preview or fallback`, async () => {
    let checks = 0;
    const output: string[] = [];
    assert.equal(await script.main(["--sender", sender, "--listen"], {
      receive: async () => receipt, check: async () => { checks++; return response(); }, output: line => output.push(line),
    }), 1);
    assert.equal(checks, 1);
    assert.equal(JSON.parse(output[0]!).reply, undefined);
    assert.equal(JSON.parse(output[0]!).messages_sent, 0);
    assert.doesNotMatch(output.join(""), /private-message-sentinel|\+1202555/);
  });
}

test("uncertain valid Gemini response remains uncertain in the reviewed reply", async () => {
  const response = geminiResponse();
  response.assessment.category = "needs_human_review";
  const output: string[] = [];
  assert.equal(await script.main(["--sender", sender, "--listen"], {
    receive: async () => receipt, check: async () => response, output: line => output.push(line),
  }), 0);
  assert.match(JSON.parse(output[0]!).reply, /Needs human review/);
  assert.doesNotMatch(JSON.parse(output[0]!).reply, /Suspicious —/);
});

test("fixed check diagnostic lists new supported codes without reflecting model strings or unknown codes", async () => {
  const response = geminiResponse();
  response.observations!.credentials_requested = true;
  response.observations!.verification_code_requested = true;
  response.observations!.account_threat_indicated = true;
  response.assessment.indicators = ["credential_request", "verification_code_request", "account_threat", "__proto__", PRIVATE_SENTINEL]
    .map(code => ({ ...response.assessment.indicators[0]!, code, description: "Password SYNTHETIC_SECRET; code 091283." }));
  response.assessment.summary = "SYNTHETIC_SECRET";
  response.assessment.recommended_action = "091283";
  const output: string[] = [];
  let checks = 0;
  assert.equal(await script.main(["--sender", sender, "--listen"], {
    receive: async () => receipt, check: async () => { checks++; return response; }, output: line => output.push(line),
  }), 0);
  const preview = JSON.parse(output[0]!);
  assert.equal(checks, 1);
  assert.deepEqual(preview.indicator_codes, ["credential_request", "verification_code_request", "account_threat"]);
  assert.match(preview.reply, /A request to share a password or account credentials/);
  assert.match(preview.reply, /A request to share a verification or account reset code/);
  assert.equal(preview.messages_sent, 0);
  assert.equal(preview.reply_requires_user_approval, true);
  assert.doesNotMatch(output.join(""), /SYNTHETIC_SECRET|091283|private-message-sentinel|__proto__/);
});

test("provider error is redacted and backend is never retried", async () => {
  let checks = 0;
  const output: string[] = [];
  assert.equal(await script.main(["--sender", sender, "--listen"], {
    receive: async () => receipt,
    check: async () => { checks++; throw Object.assign(new Error(PRIVATE_SENTINEL), { code: "provider_timeout" }); },
    output: line => output.push(line),
  }), 1);
  assert.equal(checks, 1);
  assert.equal(JSON.parse(output[0]!).code, "backend_provider_timeout");
  assert.equal(JSON.parse(output[0]!).incoming_message_verified, true);
  assert.doesNotMatch(output.join(""), /private-message-sentinel/);
});

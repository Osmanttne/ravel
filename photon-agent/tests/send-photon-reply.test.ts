import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { formatAssessment, HELP_REPLY, PRIVACY_REPLY, REPORT_REPLY, SUPPORTED_INDICATOR_CODES } from "../src/replies.js";
import { geminiResponse, PRIVATE_SENTINEL, urlResponse } from "./helpers.js";

const url = new URL("../../../scripts/send_photon_reply.mjs", import.meta.url);
interface Script {
  approvalHash(recipient: string, message: string): string;
  main(args: string[], options?: { send?: (recipient: string, message: string) => Promise<unknown>;
    output?: (value: string) => void }): Promise<number>;
}
const script = await import(url.href) as Script;
const recipient = "+12025550123";
const other = "+12025550124";
const message = "Ravel private check\n\n" + formatAssessment(geminiResponse(), { content_type: "text", text: "synthetic" });
const args = ["--recipient", recipient, "--message", message];

test("reviewed reply preview is disconnected and bound to the exact recipient and body", async () => {
  const output: string[] = [];
  assert.equal(await script.main(args, { send: async () => { throw new Error(PRIVATE_SENTINEL); }, output: value => output.push(value) }), 0);
  const preview = JSON.parse(output[0]!);
  assert.equal(preview.recipient, recipient);
  assert.equal(preview.message, message);
  assert.equal(preview.approval_sha256, script.approvalHash(recipient, message));
  assert.equal(preview.messages_sent, 0);
  assert.equal(preview.network_connected, false);
});

test("reviewed reply preview loads no secrets, SDK or network", () => {
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
    process.exitCode = await main(${JSON.stringify(args)});
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", child], { encoding: "utf8", env: {}, timeout: 10_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).messages_sent, 0);
});

for (const invalidArgs of [[], ["--recipient", recipient], ["--recipient", recipient, "--message", PRIVATE_SENTINEL],
  [...args, "--send"], [...args, "--send", "--approval-sha256", "0".repeat(64)],
  ["--recipient", other, "--message", message, "--send", "--approval-sha256", script.approvalHash(recipient, message)],
  [...args, "--send", "--send"], [...args, "--listen"], [...args, "--approval-sha256", script.approvalHash(recipient, message)]]) {
  test(`invalid reply approval prevents all sends ${JSON.stringify(invalidArgs.slice(-2))}`, async () => {
    let sends = 0;
    const output: string[] = [];
    assert.equal(await script.main(invalidArgs, { send: async () => { sends++; throw new Error(PRIVATE_SENTINEL); }, output: value => output.push(value) }), 1);
    assert.equal(sends, 0);
    assert.equal(JSON.parse(output[0]!).messages_sent, 0);
    assert.doesNotMatch(output.join(""), /private-message-sentinel|\+1202555/);
  });
}

test("one explicitly approved target/body makes one send and outputs a redacted acknowledgement", async () => {
  const calls: unknown[] = [];
  const output: string[] = [];
  assert.equal(await script.main([...args, "--send", "--approval-sha256", script.approvalHash(recipient, message)], {
    send: async (target, body) => { calls.push([target, body]); return { code: "send_accepted", recipient: target, message: body, messages_sent: 1 }; },
    output: value => output.push(value),
  }), 0);
  assert.deepEqual(calls, [[recipient, message]]);
  assert.deepEqual(JSON.parse(output[0]!), { code: "reply_send_accepted", messages_sent: 1, delivery_verified: false });
});

test("send failure remains delivery unknown and never triggers a second attempt", async () => {
  let sends = 0;
  const output: string[] = [];
  assert.equal(await script.main([...args, "--send", "--approval-sha256", script.approvalHash(recipient, message)], {
    send: async () => { sends++; throw new Error(PRIVATE_SENTINEL); }, output: value => output.push(value),
  }), 1);
  assert.equal(sends, 1);
  assert.equal(JSON.parse(output[0]!).messages_sent, null);
  assert.equal(JSON.parse(output[0]!).delivery_verified, false);
  assert.doesNotMatch(output.join(""), /private-message-sentinel/);
});

test("hash cannot be reused after changing the exact reply body", async () => {
  const response = geminiResponse();
  response.assessment.category = "needs_human_review";
  const altered = "Ravel private check\n\n" + formatAssessment(response, { content_type: "text", text: "synthetic" });
  let sends = 0;
  assert.equal(await script.main(["--recipient", recipient, "--message", altered, "--send", "--approval-sha256", script.approvalHash(recipient, message)], {
    send: async () => { sends++; return {}; }, output: () => {},
  }), 1);
  assert.equal(sends, 0);
});

test("URL limitations and help/privacy/report fixed replies also require exact approval", async () => {
  const copies = [formatAssessment(urlResponse("gemini"), { content_type: "url", url: "https://campus.example/events" }),
    HELP_REPLY, PRIVACY_REPLY, REPORT_REPLY];
  for (const copy of copies) {
    const body = "Ravel private check\n\n" + copy;
    let sends = 0;
    const selectedArgs = ["--recipient", recipient, "--message", body];
    assert.equal(await script.main(selectedArgs, { send: async () => { sends++; return {}; }, output: () => {} }), 0);
    assert.equal(await script.main([...selectedArgs, "--send"], { send: async () => { sends++; return {}; }, output: () => {} }), 1);
    assert.equal(sends, 0);
  }
});

function tacticMessage(codes: readonly string[]) {
  const response = geminiResponse();
  response.assessment.indicators = codes.map(code => ({ ...response.assessment.indicators[0]!, code }));
  return "Ravel private check\n\n" + formatAssessment(response, { content_type: "text", text: "synthetic" });
}

for (const code of ["credential_request", "verification_code_request", "account_threat"]) {
  test(`new ${code} fixed reply requires its own exact approval and makes one mock send`, async () => {
    const body = tacticMessage([code]);
    const selected = ["--recipient", recipient, "--message", body, "--send", "--approval-sha256"];
    const calls: unknown[] = [];
    const output: string[] = [];
    const send = async (target: string, text: string) => {
      calls.push([target, text]);
      return { code: "send_accepted", recipient: target, message: text, messages_sent: 1 };
    };
    assert.equal(await script.main([...selected, script.approvalHash(recipient, message)], { send, output: () => {} }), 1);
    assert.deepEqual(calls, []);
    assert.equal(await script.main([...selected, script.approvalHash(recipient, body)], { send, output: line => output.push(line) }), 0);
    assert.deepEqual(calls, [[recipient, body]]);
    assert.deepEqual(JSON.parse(output[0]!), { code: "reply_send_accepted", messages_sent: 1, delivery_verified: false });
    assert.doesNotMatch(output[0]!, /password|verification|\+1202555/);
  });
}

test("all six mixed curated reasons preview offline while an exact hash cannot approve arbitrary copy", async () => {
  const body = tacticMessage([...SUPPORTED_INDICATOR_CODES].reverse());
  let sends = 0;
  const output: string[] = [];
  const send = async () => { sends++; return {}; };
  assert.equal(await script.main(["--recipient", recipient, "--message", body], { send, output: line => output.push(line) }), 0);
  assert.equal(JSON.parse(output[0]!).message, body);
  assert.equal(sends, 0);

  const credential = "A request to share a password or account credentials is indicated.";
  const verification = "A request to share a verification or account reset code is indicated.";
  for (const changed of [
    body.replace(credential, "Your password is SYNTHETIC_SECRET."),
    body.replace(verification, "Your verification code is 091283."),
    body.replace(credential, "__proto__"),
    body.replace(credential, credential + " " + credential),
    body.replace(credential + " " + verification, verification + " " + credential),
    body.replace("Do not share passwords", "Send your passwords"),
    body + "\n", body.replace("Ravel private check\n\n", "Ravel private check\n"),
  ]) {
    const rejected: string[] = [];
    assert.equal(await script.main(["--recipient", recipient, "--message", changed, "--send", "--approval-sha256",
      script.approvalHash(recipient, changed)], { send, output: line => rejected.push(line) }), 1);
    assert.equal(JSON.parse(rejected[0]!).code, "invalid_reviewed_reply");
    assert.doesNotMatch(rejected[0]!, /SYNTHETIC_SECRET|091283|\+1202555|password/);
  }
  assert.equal(sends, 0);
});

test("bounded reason subsets stay accepted by send preview without activating sending", async () => {
  let sends = 0;
  for (let selection = 0; selection < 2 ** SUPPORTED_INDICATOR_CODES.length; selection++) {
    const body = tacticMessage(SUPPORTED_INDICATOR_CODES.filter((_, index) => selection & (1 << index)));
    const output: string[] = [];
    assert.equal(await script.main(["--recipient", recipient, "--message", body], {
      send: async () => { sends++; return {}; }, output: line => output.push(line),
    }), 0);
    assert.equal(JSON.parse(output[0]!).approval_sha256, script.approvalHash(recipient, body));
  }
  assert.equal(sends, 0);
});

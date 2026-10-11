import assert from "node:assert/strict";
import test from "node:test";
import { formatAssessment, HELP_REPLY, isCuratedAssessmentReply, PRIVACY_REPLY, REPORT_REPLY, SUPPORTED_INDICATOR_CODES } from "../src/replies.js";
import { fixtureResponse, geminiResponse, PRIVATE_SENTINEL, PRIVATE_URL, urlResponse } from "./helpers.js";

test("Gemini assessments end with an observation label without fraud or safety guarantees", () => {
  const reply = formatAssessment(geminiResponse(), { content_type: "text", text: PRIVATE_SENTINEL });
  assert.match(reply, /Gemini observations\.$/);
  assert.doesNotMatch(reply, /unverified|—/i);
  assert.match(reply, /observations do not establish fraud/);
  assert.match(reply, /Missing evidence does not establish safety/);
  assert.match(reply, /no community report was created/);
  assert.doesNotMatch(reply, /private-message-sentinel|99%|100%|guaranteed safe/i);
});

test("benign controls remain insufficient evidence rather than being called safe", () => {
  const result = fixtureResponse();
  result.assessment.category = "insufficient_evidence";
  result.assessment.indicators = [];
  const reply = formatAssessment(result, { content_type: "text", text: "Campus club registration opens tomorrow." });
  assert.match(reply, /Fixture demo: simulated assessment/);
  assert.match(reply, /Insufficient evidence/);
  assert.match(reply, /No sufficiently supported tactic indicators/);
  assert.doesNotMatch(reply, /Suspicious:|Known malicious|\bSafe\b/);
});

for (const mode of ["fixture", "gemini"] as const) {
  test(`${mode} URL replies explicitly disclose local parsing and no destination/reputation analysis`, () => {
    const reply = formatAssessment(urlResponse(mode), { content_type: "url", url: PRIVATE_URL });
    assert.match(reply, /The link was parsed locally/);
    assert.match(reply, /not visited, analyzed by AI, or checked against reputation data/);
    assert.match(reply, /Paste the accompanying message/);
    assert.doesNotMatch(reply, /tickets\.example|private-query-token|private-fragment|payment before delivery/);
  });
}

test("unclear evidence requests review without transforming model uncertainty into a verdict", () => {
  const result = geminiResponse();
  result.assessment.category = "needs_human_review";
  const reply = formatAssessment(result, { content_type: "text", text: PRIVATE_SENTINEL });
  assert.match(reply, /Needs human review/);
  assert.match(reply, /unclear or inconsistent/);
  assert.doesNotMatch(reply, /private-message-sentinel|A payment before delivery/);
});

test("unknown tactic codes and all free-form backend strings remain unreflected", () => {
  const result = fixtureResponse();
  result.assessment.summary = PRIVATE_SENTINEL;
  result.assessment.recommended_action = PRIVATE_URL;
  result.assessment.indicators = [{
    code: PRIVATE_URL, description: PRIVATE_SENTINEL,
    evidence_source: "submitted_content", verification_level: "observed_claim",
  }];
  result.limitations = [PRIVATE_SENTINEL];
  const reply = formatAssessment(result, { content_type: "text", text: PRIVATE_SENTINEL });
  assert.doesNotMatch(reply, /private-message-sentinel|private-query-token|private-fragment|tickets\.example/);
  assert.match(reply, /No sufficiently supported tactic indicators/);
});

test("repeated indicators produce a bounded, deduplicated explanation", () => {
  const result = fixtureResponse();
  const indicator = result.assessment.indicators[0]!;
  result.assessment.indicators = Array.from({ length: 20 }, () => ({ ...indicator }));
  const reply = formatAssessment(result, { content_type: "text", text: PRIVATE_SENTINEL });
  assert.equal(reply.match(/A payment before delivery is indicated\./g)?.length, 1);
  assert.ok(reply.length < 2000);
});

test("prototype property names cannot become tactic explanations", () => {
  const result = geminiResponse();
  const indicator = result.assessment.indicators[0]!;
  result.assessment.indicators = ["constructor", "toString", "__proto__"].map(code => ({ ...indicator, code }));
  const reply = formatAssessment(result, { content_type: "text", text: PRIVATE_SENTINEL });
  assert.match(reply, /No sufficiently supported tactic indicators/);
  assert.doesNotMatch(reply, /function|native code|\[object Object\]/);
});

function withCodes(codes: readonly string[]) {
  const result = geminiResponse();
  const indicator = result.assessment.indicators[0]!;
  result.assessment.indicators = codes.map(code => ({ ...indicator, code, description: PRIVATE_SENTINEL }));
  return result;
}

test("historically approved payment and urgency copy preserves its encountered reason order", () => {
  const reply = formatAssessment(withCodes(["urgency", "advance_fee", "payment_request"]),
    { content_type: "text", text: PRIVATE_SENTINEL });
  assert.equal(reply, [
    "Suspicious: verify before acting",
    "Pressure to act quickly is indicated. A payment before delivery is indicated. A payment request is indicated.",
    "These observations do not establish fraud. Missing evidence does not establish safety.",
    "Verify through an independently obtained official contact before sending money or sensitive information.",
    "Checked privately; no community report was created.",
    "Gemini observations.",
  ].join("\n\n"));
  assert.equal(isCuratedAssessmentReply(reply), true);
});

test("account tactics use fixed reasons and independent verification without echoing credentials or codes", () => {
  const result = withCodes(["account_threat", "verification_code_request", "credential_request"]);
  result.observations!.credentials_requested = true;
  result.observations!.verification_code_requested = true;
  result.observations!.account_threat_indicated = true;
  result.assessment.summary = "Your password is SYNTHETIC_SECRET and your code is 091283.";
  result.assessment.recommended_action = "Reply with 091283 to https://private.example/reset?token=secret";
  result.limitations = ["SYNTHETIC_SECRET"];
  const reply = formatAssessment(result, { content_type: "text", text: result.assessment.summary });
  assert.equal(reply.split("\n\n")[1], "A request to share a password or account credentials is indicated. A request to share a verification or account reset code is indicated. A claim that an account is at risk or may be suspended is indicated.");
  assert.match(reply, /Open the official app yourself or use an independently obtained official contact/);
  assert.match(reply, /Do not share passwords, verification codes, or account reset codes, or send money/);
  assert.doesNotMatch(reply, /SYNTHETIC_SECRET|091283|private\.example|private-message-sentinel|token=secret/);
  assert.equal(isCuratedAssessmentReply(reply), true);
});

test("mixed tactics are deduplicated with canonical new reason order and bounded copy", () => {
  const codes = ["account_threat", "urgency", "verification_code_request", "payment_request", "credential_request", "advance_fee", "credential_request"];
  const reply = formatAssessment(withCodes(codes), { content_type: "text", text: PRIVATE_SENTINEL });
  assert.equal(reply.split("\n\n")[1], "Pressure to act quickly is indicated. A payment request is indicated. A payment before delivery is indicated. A request to share a password or account credentials is indicated. A request to share a verification or account reset code is indicated. A claim that an account is at risk or may be suspended is indicated.");
  assert.equal(reply.match(/A request to share a password/g)?.length, 1);
  assert.ok(reply.length < 3_000);
  assert.equal(isCuratedAssessmentReply(reply), true);
});

for (const text of ["Your sign-in code is 091283. Never share this code.", "Never share your password or verification codes with anyone."]) {
  test(`benign account notification does not invent a request: ${text}`, () => {
    const result = withCodes([]);
    result.assessment.category = "insufficient_evidence";
    result.observations!.credentials_requested = false;
    result.observations!.verification_code_requested = false;
    result.observations!.account_threat_indicated = false;
    const reply = formatAssessment(result, { content_type: "text", text });
    assert.match(reply, /Insufficient evidence/);
    assert.match(reply, /No sufficiently supported tactic indicators were returned/);
    assert.doesNotMatch(reply, /A request to share|A claim that an account|Suspicious:|091283/);
  });
}

test("account threat alone remains insufficient while a paired payment retains backend suspicion", () => {
  const result = withCodes(["account_threat", "urgency"]);
  result.assessment.category = "insufficient_evidence";
  result.observations!.account_threat_indicated = true;
  result.observations!.urgency_indicated = true;
  const neutral = formatAssessment(result, { content_type: "text", text: "Your account may close today." });
  assert.match(neutral, /Insufficient evidence/);
  assert.doesNotMatch(neutral, /Suspicious:|Known malicious|\bSafe\b/);
  result.assessment.category = "suspicious_verify";
  result.assessment.indicators.push({ ...result.assessment.indicators[0]!, code: "payment_request" });
  assert.match(formatAssessment(result, { content_type: "text", text: "Pay now to avoid account closure." }), /Suspicious: verify/);
});

test("human review still suppresses strong tactic wording for all new indicators", () => {
  const result = withCodes(["credential_request", "verification_code_request", "account_threat"]);
  result.assessment.category = "needs_human_review";
  result.observations!.uncertainty_codes = ["conflicting_evidence"];
  const reply = formatAssessment(result, { content_type: "text", text: PRIVATE_SENTINEL });
  assert.match(reply, /Needs human review/);
  assert.match(reply, /unclear or inconsistent/);
  assert.doesNotMatch(reply, /A request to share|A claim that an account|Open the official app yourself/);
  assert.equal(isCuratedAssessmentReply(reply), true);
});

test("curated validation handles each bounded tactic subset without generating a permutation allowlist", () => {
  for (let selection = 0; selection < 2 ** SUPPORTED_INDICATOR_CODES.length; selection++) {
    const codes = SUPPORTED_INDICATOR_CODES.filter((_, index) => selection & (1 << index));
    for (const category of ["suspicious_verify", "insufficient_evidence", "needs_human_review"] as const) {
      const result = withCodes(codes);
      result.assessment.category = category;
      const reply = formatAssessment(result, { content_type: "text", text: PRIVATE_SENTINEL });
      assert.equal(isCuratedAssessmentReply(reply), true, `${category}/${codes.join(",")}`);
    }
  }
});

test("curated validation rejects arbitrary wording, formatting, prototype keys and noncanonical account order", () => {
  const valid = formatAssessment(withCodes(["credential_request", "verification_code_request"]),
    { content_type: "text", text: PRIVATE_SENTINEL });
  const password = "A request to share a password or account credentials is indicated.";
  const code = "A request to share a verification or account reset code is indicated.";
  const altered = [valid + "\n", valid.replace("Suspicious: verify before acting", "Guaranteed fraud"),
    valid.replace(password, "Password: SYNTHETIC_SECRET"), valid.replace(password, "constructor"),
    valid.replace(password, password + " " + password), valid.replace(password + " " + code, code + " " + password),
    valid.replace("Checked privately; no community report was created.", "No report was created. 091283"),
    valid.replace("Do not share passwords", "Please share passwords"), valid.replace(password, password + "\u0000"),
    valid.replace(password, password + "\ud800"), valid.replace("Gemini observations.", "Fixture demo: simulated assessment."),
    "x".repeat(3_001), PRIVATE_SENTINEL];
  for (const reply of altered) assert.equal(isCuratedAssessmentReply(reply), false);
});

test("help/privacy/report copy describes the actual private and deferred feature boundary", () => {
  assert.match(HELP_REPLY, /Photos and other attachments are not supported/);
  assert.match(HELP_REPLY, /Community reporting is unavailable/);
  assert.match(PRIVACY_REPLY, /only the text or link you explicitly send/);
  assert.match(PRIVACY_REPLY, /never opened or sent to Gemini/);
  assert.match(PRIVACY_REPLY, /do not scan your other chats/);
  assert.match(PRIVACY_REPLY, /photon\.codes\/privacy-policy/);
  assert.match(REPORT_REPLY, /saved report matching are unavailable/);
  assert.match(REPORT_REPLY, /does not create reports/);
});

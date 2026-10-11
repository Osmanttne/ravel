/** Synthetic TypeScript-client -> real fixture FastAPI smoke. No Photon connection. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { RavelClient } from "../photon-agent/dist/src/ravel-client.js";
import { formatAssessment } from "../photon-agent/dist/src/replies.js";

const baseURL = "http://127.0.0.1:8002";
try {
  const health = await fetch(`${baseURL}/health`, { redirect: "error", signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).mode, "fixture", "Run a fixture server on localhost:8002 first.");
  const client = new RavelClient({ baseURL, allowLocalHTTP: true });
  const cases = [
    {
      name: "advance_fee",
      submission: { content_type: "text", text: "Free concert tickets. Pay a $20 transfer fee before delivery: https://tickets.example/offer" },
      expected: "suspicious_verify",
    },
    {
      name: "benign_promotion",
      submission: { content_type: "text", text: "Campus club concert this Friday. Registration is at https://campus.example/events" },
      expected: "insufficient_evidence",
    },
    {
      name: "url_only",
      submission: { content_type: "url", url: "https://campus.example/events" },
      expected: "insufficient_evidence",
    },
  ];
  const results = [];
  for (const item of cases) {
    const result = await client.check(item.submission);
    assert.equal(result.mode, "fixture");
    assert.equal(result.assessment.category, item.expected);
    assert.equal(result.report_created, false);
    assert.equal(result.assessment.related_report_count, 0);
    assert.equal(result.assessment.known_threat, false);
    assert.equal(result.assessment.verified_fraud, false);
    const reply = formatAssessment(result, item.submission);
    assert.match(reply, /Fixture/);
    if (item.name === "url_only") assert.match(reply, /not visited/);
    results.push({
      case: item.name,
      content_type: item.submission.content_type,
      mode: result.mode,
      category: result.assessment.category,
      report_created: result.report_created,
      related_report_count: result.assessment.related_report_count,
      verified_fraud: result.assessment.verified_fraud,
      known_threat: result.assessment.known_threat,
      fixture_label_verified: true,
    });
  }
  const proof = {
    recorded_at: new Date().toISOString(),
    verification: "typescript_client_to_fixture_fastapi",
    inputs: "synthetic_only",
    backend: baseURL,
    cases: results,
    photon_messages_sent: 0,
    photon_cloud_session_opened: false,
    google_generation_requests: 0,
  };
  const directory = new URL("../docs/artifacts/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  writeFileSync(new URL("photon-backend-smoke.json", directory), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify({ code: "fixture_backend_smoke_passed", cases: results.length, photon_messages_sent: 0 }));
} catch {
  // No provider response, submitted text, destinations, or exception messages in logs.
  console.error(JSON.stringify({ code: "fixture_backend_smoke_failed", photon_messages_sent: 0 }));
  process.exitCode = 1;
}

import { CheckResponseSchema, type CheckService } from "./contracts.js";
import { PrivateCheckAgent } from "./agent.js";
import { CheckFailure } from "./ravel-client.js";

// Explicit synthetic values: no environment loading, SDK imports, HTTP, or live model calls.
const ticket = CheckResponseSchema.parse({
  check_id: "chk_offline_fixture", mode: "fixture", report_created: false, observations: null,
  assessment: { category: "suspicious_verify", summary: "Synthetic advance-fee ticket example.",
    verified_fraud: false, known_threat: false, related_report_count: 0,
    indicators: [{ code: "advance_fee", description: "A fee is requested before delivery.",
      evidence_source: "submitted_content", verification_level: "observed_claim" }],
    recommended_action: "Verify independently before paying." },
  limitations: ["OFFLINE FIXTURE DEMO: synthetic deterministic response; no provider or backend calls."],
});
const service: CheckService = { async check(submission) {
  return submission.content_type === "text" ? ticket : { ...ticket,
    assessment: { ...ticket.assessment, category: "insufficient_evidence", indicators: [] } };
} };
const agent = new PrivateCheckAgent(service);
console.log("OFFLINE FIXTURE DEMO: no Photon, backend, or Gemini connection. Synthetic examples only.\n");
for (const [index, text] of [
  "Free concert tickets. Pay a $20 transfer fee before delivery: https://tickets.example/offer. Act now!",
  "https://campus.example/events", "/privacy", "/report",
].entries()) {
  await agent.handle({ platform: "imessage", direction: "inbound", spaceType: "dm",
    spaceID: "synthetic-demo", messageID: `synthetic-${index}`, content: { type: "text", text },
    reply: async (reply) => { console.log(reply + "\n"); } });
}

const timeoutAgent = new PrivateCheckAgent(
  { async check() { throw new CheckFailure("provider_timeout"); } },
  Date.now,
  (code) => console.log(`agent_status=${code}`),
);
console.log("OFFLINE FAILURE DEMO: simulated provider timeout; no network request was made.\n");
await timeoutAgent.handle({
  platform: "imessage",
  direction: "inbound",
  spaceType: "dm",
  spaceID: "synthetic-timeout-demo",
  messageID: "synthetic-timeout",
  content: { type: "text", text: "SYNTHETIC provider-timeout example" },
  reply: async (reply) => { console.log(reply + "\n"); },
});

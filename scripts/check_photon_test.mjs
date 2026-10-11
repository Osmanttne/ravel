/** One exact synthetic inbound check and a reply preview. This script cannot send. */
import { pathToFileURL } from "node:url";
import { listenForExactTextLive } from "./receive_photon_test.mjs";
import { classifyFailure } from "./send_photon_test.mjs";
import { CheckResponseSchema } from "../photon-agent/dist/src/contracts.js";
import { formatAssessment, SUPPORTED_INDICATOR_CODES } from "../photon-agent/dist/src/replies.js";

export const TEST_INPUT = "Free concert tickets. Pay a $20 transfer fee before delivery: https://tickets.example/offer. Act now!";
const e164 = /^\+[1-9][0-9]{6,14}$/;
const backendCodes = new Set(["configuration", "insufficient_input", "too_large", "unsafe_url",
  "invalid_response", "provider_invalid_output", "provider_timeout", "service_unavailable", "cancelled"]);
class PreviewFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function parseArguments(args) {
  let sender;
  let listen = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--sender" && sender === undefined) sender = args[++index];
    else if (args[index] === "--listen" && !listen) listen = true;
    else throw new PreviewFailure("invalid_arguments");
  }
  if (typeof sender !== "string" || !e164.test(sender)) throw new PreviewFailure("invalid_sender");
  return { sender, listen };
}

async function liveCheck(submission) {
  const { loadConfiguration } = await import("../photon-agent/dist/src/config.js");
  const { RavelClient } = await import("../photon-agent/dist/src/ravel-client.js");
  const client = new RavelClient(loadConfiguration().backend);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try { return await client.check(submission, controller.signal); }
  finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

export async function main(args, { receive = listenForExactTextLive, check = liveCheck, output = console.log } = {}) {
  let stage = "arguments";
  let incomingVerified = false;
  let checks = 0;
  try {
    const options = parseArguments(args);
    if (!options.listen) {
      output(JSON.stringify({ code: "preview_only_check_disabled", sender: options.sender,
        input: TEST_INPUT, window_seconds: 60, network_connected: false,
        backend_checks: 0, messages_sent: 0 }));
      return 0;
    }
    stage = "receive";
    const receipt = await receive(options.sender, TEST_INPUT, output);
    if (receipt?.code !== "fresh_marker_received" || receipt.incoming_message_verified !== true
      || receipt.matching_messages !== 1 || receipt.messages_sent !== 0) {
      output(JSON.stringify({ code: "synthetic_input_not_received", incoming_message_verified: false,
        backend_checks: 0, messages_sent: 0 }));
      return 1;
    }
    incomingVerified = true;
    // The direct Photon stream has closed before this single backend request.
    stage = "backend";
    const submission = { content_type: "text", text: TEST_INPUT };
    checks = 1;
    const parsed = CheckResponseSchema.safeParse(await check(submission));
    if (!parsed.success) throw new PreviewFailure("invalid_backend_response");
    const result = parsed.data;
    if (result.mode !== "gemini") throw new PreviewFailure("connected_gemini_required");
    if (result.observations?.evidence_source !== "gemini"
      || result.observations.verification_level !== "unverified_inference"
      || result.assessment.indicators.some(item => item.evidence_source !== "gemini"
        || item.verification_level !== "unverified_inference")) {
      throw new PreviewFailure("invalid_backend_provenance");
    }
    stage = "reply_preview";
    const reply = "Ravel private check\n\n" + formatAssessment(result, submission);
    output(JSON.stringify({ code: "reply_preview_ready", recipient: options.sender, reply,
      incoming_message_verified: true, backend_checks: checks, mode: result.mode,
      category: result.assessment.category,
      indicator_codes: result.assessment.indicators.map(item => item.code)
        .filter(code => SUPPORTED_INDICATOR_CODES.includes(code)),
      report_created: result.report_created, related_report_count: result.assessment.related_report_count,
      known_threat: result.assessment.known_threat, verified_fraud: result.assessment.verified_fraud,
      reply_requires_user_approval: true, messages_sent: 0 }));
    return 0;
  } catch (error) {
    let code = "controlled_check_failed";
    if (error instanceof PreviewFailure) code = error.code;
    else { try { if (backendCodes.has(error?.code)) code = `backend_${error.code}`; } catch { /* fixed fallback */ } }
    output(JSON.stringify({ code, failure_stage: stage, ...classifyFailure(error),
      incoming_message_verified: incomingVerified, backend_checks: checks, messages_sent: 0 }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}

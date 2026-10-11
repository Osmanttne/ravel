/** Receive one selected private message and preview a reviewed reply. No send API exists here. */
import { pathToFileURL } from "node:url";
import { classifyFailure } from "./send_photon_test.mjs";
import { CheckResponseSchema } from "../photon-agent/dist/src/contracts.js";
import { formatAssessment, HELP_REPLY, PRIVACY_REPLY, REPORT_REPLY, SUPPORTED_INDICATOR_CODES } from "../photon-agent/dist/src/replies.js";

export const PROCESSING_DISCLOSURE = "Only the one message you explicitly send in the selected Photon chat is received. It passes through Photon and Ravel's backend; text is sent to Google Gemini. A standalone HTTP(S) link is parsed locally, never opened, and never sent to Gemini. No other chats are scanned and no community report is created. The receive window is 60 seconds. Any reply is previewed for your approval; this command sends nothing.";
const e164 = /^\+[1-9][0-9]{6,14}$/;
const commands = new Map([["/help", HELP_REPLY], ["/privacy", PRIVACY_REPLY], ["/report", REPORT_REPLY]]);
const backendCodes = new Set(["configuration", "insufficient_input", "too_large", "unsafe_url",
  "invalid_response", "provider_invalid_output", "provider_timeout", "service_unavailable", "cancelled"]);
const indicatorCodes = new Set(SUPPORTED_INDICATOR_CODES);
const receiveFailureCodes = new Set(["receive_window_elapsed", "receive_stream_ended",
  "receive_event_limit_reached", "receive_cancelled", "receive_failed", "receive_cleanup_failed"]);
class ReviewFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function parseArguments(args) {
  let sender;
  let listen = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--sender" && sender === undefined) sender = args[++index];
    else if (args[index] === "--listen" && !listen) listen = true;
    else throw new ReviewFailure("invalid_arguments");
  }
  if (typeof sender !== "string" || !e164.test(sender)) throw new ReviewFailure("invalid_sender");
  return { sender, listen };
}

export function classifyInput(text) {
  if (typeof text !== "string" || !text.isWellFormed() || !text.trim()) {
    throw new ReviewFailure("invalid_received_text");
  }
  if ([...text].length > 10_000) throw new ReviewFailure("received_text_too_large");
  const trimmed = text.trim();
  if (commands.has(trimmed)) return { kind: "command", reply: commands.get(trimmed) };
  if (/^\/[a-z][a-z0-9_-]*(?:\s|$)/i.test(trimmed)) throw new ReviewFailure("unsupported_command");
  if (/^https?:\/\/\S+$/iu.test(trimmed)) {
    if ([...trimmed].length > 2_048) throw new ReviewFailure("received_url_too_large");
    if (/[\p{Cc}\p{Cf}\\]/u.test(trimmed)) throw new ReviewFailure("unsafe_url");
    let url;
    try { url = new URL(trimmed); } catch { throw new ReviewFailure("unsafe_url"); }
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new ReviewFailure("unsafe_url");
    }
    return { content_type: "url", url: trimmed };
  }
  return { content_type: "text", text };
}

async function liveReceive(sender, output, signal) {
  if (signal?.aborted) throw new ReviewFailure("cancelled");
  const { listenForPrivateTextLive } = await import("./receive_photon_test.mjs");
  if (signal?.aborted) throw new ReviewFailure("cancelled");
  return listenForPrivateTextLive(sender, output, { signal });
}

async function liveCheck(submission, signal) {
  const { loadConfiguration } = await import("../photon-agent/dist/src/config.js");
  const { RavelClient } = await import("../photon-agent/dist/src/ravel-client.js");
  return new RavelClient(loadConfiguration().backend).check(submission, signal);
}

function validateResult(raw, submission) {
  const parsed = CheckResponseSchema.safeParse(raw);
  if (!parsed.success) throw new ReviewFailure("invalid_backend_response");
  const result = parsed.data;
  if (result.mode !== "gemini") throw new ReviewFailure("connected_gemini_required");
  const observations = result.observations;
  if (submission.content_type === "url") {
    if (result.assessment.category !== "insufficient_evidence" || result.assessment.indicators.length !== 0
      || !observations || observations.evidence_source !== "not_analyzed"
      || observations.verification_level !== "not_assessed" || observations.category !== "unknown"
      || observations.payment_requested !== null || observations.payment_reason !== null
      || observations.urgency_indicated !== null || observations.secrecy_requested !== null
      || observations.credentials_requested !== null || observations.verification_code_requested !== null
      || observations.account_threat_indicated !== null
      || observations.destinations.length !== 0) throw new ReviewFailure("invalid_backend_provenance");
  } else if (observations?.evidence_source !== "gemini"
    || observations.verification_level !== "unverified_inference"
    || result.assessment.indicators.some(item => item.evidence_source !== "gemini"
      || item.verification_level !== "unverified_inference")) {
    throw new ReviewFailure("invalid_backend_provenance");
  }
  return result;
}

function safeProperty(value, key) {
  try { return value?.[key]; } catch { return undefined; }
}

export async function main(args, { receive = liveReceive, check = liveCheck, output = console.log, signal } = {}) {
  let stage = "arguments";
  let incomingVerified = false;
  let checks = 0;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  let listening = false;
  try {
    const options = parseArguments(args);
    if (!options.listen) {
      output(JSON.stringify({ code: "preview_only_review_disabled", sender: options.sender,
        processing_disclosure: PROCESSING_DISCLOSURE, window_seconds: 60,
        network_connected: false, backend_checks: 0, messages_sent: 0 }));
      return 0;
    }
    listening = true;
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    if (controller.signal.aborted) throw new ReviewFailure("cancelled");
    stage = "receive";
    const receipt = await receive(options.sender, output, controller.signal);
    if (controller.signal.aborted) throw new ReviewFailure("cancelled");
    const receiveCode = safeProperty(receipt, "code");
    if (receiveCode !== "fresh_text_received" || safeProperty(receipt, "incoming_message_verified") !== true
      || safeProperty(receipt, "matching_messages") !== 1 || safeProperty(receipt, "messages_sent") !== 0) {
      output(JSON.stringify({ code: "private_text_not_received",
        receive_code: receiveFailureCodes.has(receiveCode) ? receiveCode : "invalid_receive_result",
        heartbeat_observed: safeProperty(receipt, "heartbeat_observed") === true, incoming_message_verified: false,
        backend_checks: 0, messages_sent: 0 }));
      return 1;
    }
    incomingVerified = true;
    stage = "received_text";
    const submission = classifyInput(safeProperty(receipt, "text"));
    // The receive helper has closed the stream and client before returning the text.
    if (submission.kind === "command") {
      output(JSON.stringify({ code: "reply_preview_ready", recipient: options.sender,
        reply: "Ravel private check\n\n" + submission.reply, input_kind: "command",
        incoming_message_verified: true, backend_checks: 0,
        reply_requires_user_approval: true, messages_sent: 0 }));
      return 0;
    }
    stage = "backend";
    checks = 1;
    const raw = await check(submission, controller.signal);
    if (controller.signal.aborted) throw new ReviewFailure("cancelled");
    const result = validateResult(raw, submission);
    stage = "reply_preview";
    output(JSON.stringify({ code: "reply_preview_ready", recipient: options.sender,
      reply: "Ravel private check\n\n" + formatAssessment(result, submission),
      input_kind: submission.content_type, incoming_message_verified: true, backend_checks: checks,
      mode: result.mode, category: result.assessment.category,
      indicator_codes: [...new Set(result.assessment.indicators.map(item => item.code))]
        .filter(code => indicatorCodes.has(code)), report_created: result.report_created,
      related_report_count: result.assessment.related_report_count, known_threat: result.assessment.known_threat,
      verified_fraud: result.assessment.verified_fraud, reply_requires_user_approval: true, messages_sent: 0 }));
    return 0;
  } catch (error) {
    let code = "private_review_failed";
    if (error instanceof ReviewFailure) code = error.code;
    else { try { if (backendCodes.has(error?.code)) code = `backend_${error.code}`; } catch { /* fixed fallback */ } }
    output(JSON.stringify({ code, failure_stage: stage, ...classifyFailure(error),
      incoming_message_verified: incomingVerified, backend_checks: checks, messages_sent: 0 }));
    return 1;
  } finally {
    if (listening) {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
      signal?.removeEventListener("abort", cancel);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}

/** Bounded receive-only diagnostic. Preview never loads credentials or the SDK. */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { classifyFailure } from "./send_photon_test.mjs";

export const TEST_MARKER = "Ravel receive test 01";
const officialOrigin = "https://spectrum.photon.codes";
const e164 = /^\+[1-9][0-9]{6,14}$/;
const emptyDiagnostics = () => classifyFailure(undefined);
class ReceiveFailure extends Error {
  constructor(code, stage, diagnostics = emptyDiagnostics()) {
    super(code); this.code = code; this.stage = stage; this.diagnostics = diagnostics;
  }
}

export function parseArguments(args) {
  let sender;
  let listen = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--sender" && sender === undefined) sender = args[++index];
    else if (args[index] === "--listen" && !listen) listen = true;
    else throw new ReceiveFailure("invalid_arguments", "arguments");
  }
  if (typeof sender !== "string" || !e164.test(sender)) {
    throw new ReceiveFailure("invalid_sender", "arguments");
  }
  return { sender, listen };
}

const validPrivateText = text => typeof text === "string" && text.trim().length > 0
  && text.length <= 20_000 && text.isWellFormed() && [...text].length <= 10_000;

/** Local shape classification only. This does not resolve, fetch or accept a URL. */
function standaloneHttpURLText(text) {
  try {
    if (!validPrivateText(text)) return false;
    const trimmed = text.trim();
    if ([...trimmed].length > 2_048 || !/^https?:\/\/\S+$/iu.test(trimmed)
      || /[\p{Cc}\p{Cf}\\]/u.test(trimmed)) return false;
    const url = new URL(trimmed);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

/** Return text or a fixed rejection reason. Never retain or return the event. */
function inspectPrivateText(event, sender, startedAt, currentTime, allowURLPreview = false) {
  let received = false;
  try {
    received = event?.type === "message.received";
    if (!received) return { received, reason: "event_type_not_received" };
    const guid = `any;-;${sender}`;
    const message = event?.message;
    const fresh = value => value instanceof Date && Number.isFinite(value.getTime())
      && value.getTime() >= startedAt && value.getTime() <= currentTime + 30_000;
    if (typeof sender !== "string" || !e164.test(sender) || event.chatGuid !== guid
      || message?.sender?.address !== sender || (event.actor !== undefined && event.actor?.address !== sender)
      || !Array.isArray(message.chatGuids) || message.chatGuids.length !== 1 || message.chatGuids[0] !== guid) {
      return { received, reason: "owner_or_chat_mismatch" };
    }
    if (event.isFromMe !== false || message.isFromMe !== false) return { received, reason: "not_inbound" };
    if (!Number.isFinite(startedAt) || !Number.isFinite(currentTime) || currentTime < startedAt
      || !fresh(event.occurredAt) || !fresh(message.dateCreated)) return { received, reason: "not_fresh" };
    if (message.itemType !== "normal" || message.isAutoReply !== false || message.isSystemMessage !== false
      || message.isServiceMessage !== false || message.isCorrupt !== false) {
      return { received, reason: "not_plain_normal" };
    }
    // Content diagnostics are reconstructed only for the selected owner's
    // fresh ordinary incoming message. No raw field value can leave here.
    const content = message.content;
    const text = content?.text;
    const attachments = content?.attachments;
    const miniApp = content?.miniApp;
    const balloonBundleId = content?.balloonBundleId;
    const validText = validPrivateText(text);
    const standaloneURL = standaloneHttpURLText(text);
    const diagnostics = {
      multipart: message.partCount !== undefined && message.partCount !== 1,
      attachments: Array.isArray(attachments) && attachments.length > 0,
      mini_app: miniApp !== undefined,
      balloon: balloonBundleId !== undefined,
      known_url_preview_bundle: balloonBundleId === "com.apple.messages.URLBalloonProvider",
      standalone_url_text: standaloneURL,
      text_kind: !validText ? "invalid_text" : standaloneURL ? "standalone_http_url" : "other_text",
    };
    let reason;
    if (diagnostics.multipart) reason = "part_count_not_single";
    else if (!validText) reason = "invalid_text";
    else if (!Array.isArray(attachments)) reason = "invalid_attachment_shape";
    else if (diagnostics.attachments) reason = "attachments_present";
    else if (diagnostics.mini_app) reason = "mini_app_present";
    // Live owner-only diagnostics confirmed this native URL preview has just
    // the standalone URL text: no attachment, mini-app, or multipart content.
    // Accept its text only for generic private receipt. Exact tests stay strict.
    else if (diagnostics.balloon && !(allowURLPreview && diagnostics.known_url_preview_bundle
      && diagnostics.standalone_url_text)) reason = "balloon_present";
    return reason ? { received, reason, diagnostics } : { received, text, diagnostics };
  } catch { return { received, reason: "unreadable_event" }; }
}

/** Exact reviewed-text matching remains separate from generic private receipt. */
export function matchesFreshText(event, sender, startedAt, currentTime, expectedText) {
  return validPrivateText(expectedText) && inspectPrivateText(event, sender, startedAt, currentTime).text === expectedText;
}

export function matchesFreshMarker(event, sender, startedAt, currentTime) {
  return matchesFreshText(event, sender, startedAt, currentTime, TEST_MARKER);
}

const resultFor = (code, text) => {
  const received = code === "fresh_marker_received" || code === "fresh_text_received";
  return { code, incoming_message_verified: received, matching_messages: received ? 1 : 0,
    messages_sent: 0, ...(code === "fresh_text_received" ? { text } : {}) };
};

/** Direct stream only: no Spectrum, history replay, read receipt, profile, or sends. */
async function observeText(sender, { client, expectedText, privateText = false, durationMilliseconds = 60_000,
  now = Date.now, signal, onSubscribed = () => {}, onRejected = () => {}, onDiagnostics = () => {} }) {
  let stream;
  let timer;
  let abort;
  let stage = "configuration";
  let eventsSeen = 0;
  let rejectedMessageEvents = 0;
  let terminalCode = "receive_failed";
  const finish = (code, text) => { terminalCode = code; return resultFor(code, text); };
  try {
    if (typeof sender !== "string" || !e164.test(sender)) throw new ReceiveFailure("invalid_sender", stage);
    if (!privateText && !validPrivateText(expectedText)) throw new ReceiveFailure("invalid_expected_text", stage);
    if (!Number.isInteger(durationMilliseconds) || durationMilliseconds < 1 || durationMilliseconds > 60_000) {
      throw new ReceiveFailure("invalid_duration", stage);
    }
    if (signal?.aborted) return finish("receive_cancelled");
    const startedAt = now();
    stage = "subscription";
    stream = client.messages.subscribeEvents({ chat: `any;-;${sender}` });
    const iterator = stream[Symbol.asyncIterator]();
    const stopped = new Promise(resolve => {
      timer = setTimeout(() => resolve("receive_window_elapsed"), durationMilliseconds);
      abort = () => resolve("receive_cancelled");
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
    // The request alone does not prove a live/authenticated stream. Heartbeats do.
    onSubscribed();
    stage = "event_stream";
    for (let count = 0; count < 1_000; count++) {
      if (signal?.aborted) return finish("receive_cancelled");
      const next = await Promise.race([iterator.next(), stopped]);
      if (typeof next === "string") return finish(next);
      if (next.done) return finish("receive_stream_ended");
      eventsSeen++;
      const inspected = inspectPrivateText(next.value, sender, startedAt, now(), privateText);
      if (inspected.text !== undefined && (privateText || inspected.text === expectedText)) {
        return finish(privateText ? "fresh_text_received" : "fresh_marker_received", inspected.text);
      }
      if (inspected.received) rejectedMessageEvents++;
      onRejected({ reason: inspected.reason ?? "unexpected_text", ...inspected.diagnostics });
    }
    return finish("receive_event_limit_reached");
  } catch (error) {
    if (error instanceof ReceiveFailure) { terminalCode = error.code; throw error; }
    throw new ReceiveFailure("receive_failed", stage, classifyFailure(error));
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
    // Closing the stream aborts its RPC and interrupts next(); closing the
    // client closes both channels. A broken cleanup cannot extend the window.
    let cleanupTimer;
    try {
      const cleaned = await Promise.race([Promise.allSettled([
        Promise.resolve().then(() => stream?.close()), Promise.resolve().then(() => client?.close()),
      ]), new Promise(resolve => { cleanupTimer = setTimeout(resolve, 1_000); })]);
      // Generic callers may send received content to the backend only after
      // both resources actually close. Preserve diagnostic marker behavior.
      if (privateText && (!Array.isArray(cleaned) || cleaned.some(item => item.status === "rejected"))) {
        terminalCode = "receive_cleanup_failed";
        throw new ReceiveFailure("receive_cleanup_failed", "cleanup");
      }
    } finally {
      clearTimeout(cleanupTimer);
      onDiagnostics({ terminal_code: terminalCode, events_seen: eventsSeen,
        rejected_message_events: rejectedMessageEvents });
    }
  }
}

export async function observeOneText(sender, options) {
  return observeText(sender, { ...options, privateText: false });
}

/** Receive at most one owner's fresh plaintext. Text stays in returned memory. */
export async function observePrivateText(sender, options) {
  return observeText(sender, { ...options, privateText: true });
}

export async function observeOneTest(sender, options) {
  return observeOneText(sender, { ...options, expectedText: TEST_MARKER });
}

async function listenForTextLive(sender, expectedText, output, privateText, { signal } = {}) {
  if (typeof sender !== "string" || !e164.test(sender)) throw new ReceiveFailure("invalid_sender", "configuration");
  if (!privateText && !validPrivateText(expectedText)) throw new ReceiveFailure("invalid_expected_text", "configuration");
  const agentRequire = createRequire(new URL("../photon-agent/package.json", import.meta.url));
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  let client;
  let ownedByObserver = false;
  let stage = "configuration";
  let heartbeatObserved = false;
  const emittedRejections = new Set();
  const ensureActive = () => {
    if (controller.signal.aborted) throw new ReceiveFailure("receive_cancelled", stage);
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    ensureActive();
    const { loadConfiguration } = await import(new URL("../photon-agent/dist/src/config.js", import.meta.url));
    ensureActive();
    const configuration = loadConfiguration();
    ensureActive();
    process.env.SPECTRUM_CLOUD_URL = officialOrigin;
    globalThis.fetch = (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== officialOrigin) throw new ReceiveFailure("unexpected_provider_endpoint", "token_issuance");
      return originalFetch(input, { ...init, redirect: "error",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
    };
    stage = "sdk_import";
    const { setLogLevel } = await import(pathToFileURL(agentRequire.resolve("@spectrum-ts/core/authoring")));
    ensureActive();
    setLogLevel("silent");
    const { cloud } = await import(pathToFileURL(agentRequire.resolve("@spectrum-ts/core")));
    ensureActive();
    const { createGrpcClient } = await import(pathToFileURL(agentRequire.resolve("@photon-ai/advanced-imessage/grpc")));
    ensureActive();
    stage = "token_issuance";
    const tokens = await cloud.issueImessageTokens(configuration.projectId, configuration.projectSecret);
    ensureActive();
    if (tokens?.type !== "shared" || typeof tokens.token !== "string" || !tokens.token
      || tokens.token.length > 16_384 || /[\s\p{Cc}\p{Cf}]/u.test(tokens.token)) {
      throw new ReceiveFailure("shared_token_unavailable", stage);
    }
    stage = "client_creation";
    client = createGrpcClient({ address: "imessage.spectrum.photon.codes:443", token: tokens.token,
      tls: true, retry: false, autoIdempotency: false, timeout: 10_000,
      onHeartbeat: () => {
        if (!controller.signal.aborted && !heartbeatObserved) {
          heartbeatObserved = true;
          output(JSON.stringify({ code: "receive_stream_heartbeat_observed", messages_sent: 0 }));
        }
      } });
    ensureActive();
    ownedByObserver = true;
    const result = await observeText(sender, { client, expectedText, privateText, signal: controller.signal,
      onSubscribed: () => output(JSON.stringify({ code: "receive_subscription_requested", messages_sent: 0 })),
      onRejected: diagnostic => {
        if (!emittedRejections.has(diagnostic.reason)) {
          emittedRejections.add(diagnostic.reason);
          output(JSON.stringify({ code: "receive_event_rejected", ...diagnostic, messages_sent: 0 }));
        }
      },
      onDiagnostics: diagnostic => output(JSON.stringify({ code: "receive_window_diagnostics",
        ...diagnostic, messages_sent: 0 })) });
    ensureActive();
    return { ...result, heartbeat_observed: heartbeatObserved };
  } catch (error) {
    if (controller.signal.aborted && !(error instanceof ReceiveFailure && error.code === "receive_cleanup_failed")) {
      return { ...resultFor("receive_cancelled"), heartbeat_observed: heartbeatObserved };
    }
    if (error instanceof ReceiveFailure) throw error;
    throw new ReceiveFailure("receive_failed", stage, classifyFailure(error));
  } finally {
    controller.abort();
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    signal?.removeEventListener("abort", cancel);
    globalThis.fetch = originalFetch;
    if (!ownedByObserver) { try { await client?.close(); } catch { /* no raw cleanup diagnostics */ } }
  }
}

export async function listenForExactTextLive(sender, expectedText, output) {
  return listenForTextLive(sender, expectedText, output, false);
}

/** Live generic receipt emits fixed stage codes, never the sender or text. */
export async function listenForPrivateTextLive(sender, output = console.log, options = {}) {
  return listenForTextLive(sender, undefined, output, true, options);
}

async function listenLive(sender, output) {
  return listenForExactTextLive(sender, TEST_MARKER, output);
}

export async function main(args, { listen = listenLive, output = console.log } = {}) {
  try {
    const options = parseArguments(args);
    if (!options.listen) {
      output(JSON.stringify({ code: "preview_only_receive_disabled", sender: options.sender,
        marker: TEST_MARKER, window_seconds: 60, messages_sent: 0, network_connected: false }));
      return 0;
    }
    const result = await listen(options.sender, output);
    output(JSON.stringify(result));
    return result.incoming_message_verified ? 0 : 1;
  } catch (error) {
    output(JSON.stringify({ code: error instanceof ReceiveFailure ? error.code : "receive_failed",
      failure_stage: error instanceof ReceiveFailure ? error.stage : "configuration",
      ...(error instanceof ReceiveFailure ? error.diagnostics : classifyFailure(error)),
      messages_sent: 0, incoming_message_verified: false }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}

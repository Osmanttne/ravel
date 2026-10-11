/** One approved logical test send. Preview is the default and never loads credentials. */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const TEST_MESSAGE = "Ravel test: Gemini + Photon setup check. No action is required.";
const officialOrigin = "https://spectrum.photon.codes";
const e164 = /^\+[1-9][0-9]{6,14}$/;
const errorTypes = new Set(["IMessageError", "AuthenticationError", "NotFoundError", "RateLimitError",
  "ValidationError", "ConnectionError", "SpectrumCloudError", "UnsupportedError", "ZodError",
  "TypeError", "TimeoutError", "AbortError"]);
const providerCodes = new Set(["unauthenticated", "tokenExpired", "tokenBlocked", "unauthorized",
  "dailyLimitExceeded", "recipientLimitExceeded", "uploadRateExceeded", "contentDuplicateExceeded",
  "recipientCoolingDown", "recipientLocked", "burstRateExceeded", "newContactThrottled",
  "sendReceiveRatioExceeded", "duplicateMessage", "chatNotFound", "messageNotFound", "attachmentNotFound",
  "addressNotFound", "sharedFriendLocationNotFound", "groupIconNotFound", "pollNotFound", "invalidArgument",
  "preconditionFailed", "operationNotSupported", "attachmentNotReady", "privateApiUnavailable",
  "serviceUnavailable", "timeout", "internalError", "databaseError", "networkError"]);
const readField = (error, name) => {
  try { return typeof error === "object" && error !== null ? error[name] : undefined; }
  catch { return undefined; }
};
const boundedStatus = (value, minimum, maximum) => Number.isInteger(value)
  && value >= minimum && value <= maximum ? value : null;

/** Copy only fixed names/codes and bounded numbers; never retain the original exception. */
export function classifyFailure(error) {
  const name = readField(error, "name");
  const code = readField(error, "code");
  return {
    error_type: errorTypes.has(name) ? name : "unclassified",
    provider_code: providerCodes.has(code) ? code : "unclassified",
    http_status: boundedStatus(readField(error, "httpStatus"), 100, 599)
      ?? boundedStatus(readField(error, "status"), 100, 599),
    grpc_status: boundedStatus(readField(error, "grpcCode"), 0, 16) ?? boundedStatus(code, 0, 16),
  };
}
class SafeFailure extends Error {
  constructor(code, attempted = false, stage = "arguments", diagnostics = classifyFailure(undefined)) {
    super(code); this.code = code; this.attempted = attempted;
    this.stage = stage; this.diagnostics = diagnostics;
  }
}

export function parseArguments(args) {
  let recipient;
  let send = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--recipient" && recipient === undefined) recipient = args[++index];
    else if (args[index] === "--send" && !send) send = true;
    else throw new SafeFailure("invalid_arguments");
  }
  if (typeof recipient !== "string" || !e164.test(recipient)) throw new SafeFailure("invalid_recipient");
  return { recipient, send };
}

/** Injected dependencies allow a fully offline test of target assertions and send count. */
export async function sendOneApprovedText(recipient, message, { Spectrum, imessage, configuration, sendTimeoutMilliseconds = 30_000 }) {
  if (!e164.test(recipient)) throw new SafeFailure("invalid_recipient");
  if (typeof message !== "string" || !message.trim() || message.length > 3_000 || !message.isWellFormed()) {
    throw new SafeFailure("invalid_message");
  }
  if (!Number.isFinite(sendTimeoutMilliseconds) || sendTimeoutMilliseconds <= 0
    || sendTimeoutMilliseconds > 30_000) throw new SafeFailure("invalid_timeout", false, "configuration");
  let application;
  let attempted = false;
  let stage = "sdk_initialization";
  try {
    application = await Spectrum({ projectId: configuration.projectId, projectSecret: configuration.projectSecret,
      providers: [imessage.config()], telemetry: false, options: { logLevel: "silent", flattenGroups: false } });
    // Do not subscribe to messages or invoke typing/responding/history methods.
    const platform = imessage(application);
    stage = "recipient_resolution";
    const user = await platform.user(recipient);
    if (user?.id !== recipient || (user.address !== undefined && user.address !== recipient)) {
      throw new SafeFailure("recipient_resolution_mismatch");
    }
    stage = "destination_route";
    const space = await platform.space.create(user);
    // This controlled script supports the verified shared-line account only.
    // DM getMembers() is unsupported by this SDK; its exact GUID is the route.
    if (space?.type !== "dm" || space.phone !== "shared" || space.id !== `any;-;${recipient}`) {
      throw new SafeFailure("unverified_destination_route");
    }
    attempted = true;
    stage = "send";
    // One logical call. The SDK uses idempotent transport retries internally;
    // there is no application retry, listener, or automatic reply here.
    let timer;
    let sent;
    try {
      sent = await Promise.race([space.send(message), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new SafeFailure("send_timeout_delivery_unknown", true)), sendTimeoutMilliseconds);
      })]);
    } finally { clearTimeout(timer); }
    stage = "acknowledgement_validation";
    if (!sent || typeof sent.id !== "string" || !sent.id || sent.platform !== "imessage"
      || sent.direction !== "outbound" || sent.space?.id !== space.id
      || sent.content?.type !== "text" || sent.content.text !== message) {
      throw new SafeFailure("send_acknowledgement_unverified", true);
    }
    return { code: "send_accepted", recipient, message, messages_sent: 1,
      delivery_verified: false, sender_routing: "photon_shared_line_recipient_dependent", sender_number: null };
  } catch (error) {
    const code = error instanceof SafeFailure ? error.code : "send_failed";
    throw new SafeFailure(code, attempted, stage,
      error instanceof SafeFailure ? error.diagnostics : classifyFailure(error));
  } finally {
    // A cleanup failure must not trigger a retry or obscure an accepted send.
    try { await application?.stop(); } catch { /* fixed result remains authoritative */ }
  }
}

export async function sendOneTest(recipient, options) {
  return sendOneApprovedText(recipient, TEST_MESSAGE, options);
}

export async function liveSendApprovedText(recipient, message) {
  if (typeof recipient !== "string" || !e164.test(recipient)) throw new SafeFailure("invalid_recipient");
  if (typeof message !== "string" || !message.trim() || message.length > 3_000 || !message.isWellFormed()) {
    throw new SafeFailure("invalid_message");
  }
  const agentRequire = createRequire(new URL("../photon-agent/package.json", import.meta.url));
  let configuration;
  try {
    const { loadConfiguration } = await import(new URL("../photon-agent/dist/src/config.js", import.meta.url));
    configuration = loadConfiguration();
  } catch (error) {
    throw new SafeFailure("configuration_or_cloud_unavailable", false, "configuration", classifyFailure(error));
  }
  process.env.SPECTRUM_CLOUD_URL = officialOrigin;
  process.env.SPECTRUM_IMESSAGE_ADDRESS = "imessage.spectrum.photon.codes:443";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== officialOrigin) throw new SafeFailure("unexpected_provider_endpoint");
    return originalFetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
  };
  try {
    const { setLogLevel } = await import(pathToFileURL(agentRequire.resolve("@spectrum-ts/core/authoring")));
    setLogLevel("silent");
    const { Spectrum } = await import(pathToFileURL(agentRequire.resolve("@spectrum-ts/core")));
    const { imessage } = await import(pathToFileURL(agentRequire.resolve("@spectrum-ts/imessage")));
    return await sendOneApprovedText(recipient, message, { Spectrum, imessage, configuration });
  } catch (error) {
    if (error instanceof SafeFailure) throw error;
    throw new SafeFailure("configuration_or_cloud_unavailable", false, "sdk_initialization", classifyFailure(error));
  } finally { globalThis.fetch = originalFetch; }
}

async function liveSend(recipient) {
  return liveSendApprovedText(recipient, TEST_MESSAGE);
}

export async function main(args, { send = liveSend, output = console.log } = {}) {
  let attempted = false;
  try {
    const options = parseArguments(args);
    if (!options.send) {
      output(JSON.stringify({ code: "preview_only_requires_user_approval", recipient: options.recipient,
        message: TEST_MESSAGE, messages_sent: 0, network_connected: false,
        sender_routing: "photon_shared_line_recipient_dependent", sender_number: null }));
      return 0;
    }
    const result = await send(options.recipient);
    output(JSON.stringify(result));
    return 0;
  } catch (error) {
    attempted = error instanceof SafeFailure && error.attempted;
    output(JSON.stringify({ code: error instanceof SafeFailure ? error.code : "configuration_or_cloud_unavailable",
      send_attempted: attempted, messages_sent: attempted ? null : 0, delivery_verified: false,
      failure_stage: error instanceof SafeFailure ? error.stage : "sdk_initialization",
      ...(error instanceof SafeFailure ? error.diagnostics : classifyFailure(error)) }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}

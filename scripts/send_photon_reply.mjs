/** A reviewed reply requires explicit human approval before --send is used. */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { liveSendApprovedText, classifyFailure } from "./send_photon_test.mjs";
import { isCuratedAssessmentReply, HELP_REPLY, PRIVACY_REPLY, REPORT_REPLY } from "../photon-agent/dist/src/replies.js";

const e164 = /^\+[1-9][0-9]{6,14}$/;
const prefix = "Ravel private check\n\n";
// Only fixed formatter output can be sent through this controlled text-check CLI.
// Neither a model summary nor arbitrary CLI text can become an outgoing reply.
const commandReplies = new Set([HELP_REPLY, PRIVACY_REPLY, REPORT_REPLY].map(copy => prefix + copy));
const validReviewedReply = message => typeof message === "string" && message.startsWith(prefix)
  && (commandReplies.has(message) || isCuratedAssessmentReply(message.slice(prefix.length)));
class ReplyFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function approvalHash(recipient, message) {
  return createHash("sha256").update(JSON.stringify([recipient, message]), "utf8").digest("hex");
}

export function parseArguments(args) {
  let recipient;
  let message;
  let approval;
  let send = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--recipient" && recipient === undefined) recipient = args[++index];
    else if (flag === "--message" && message === undefined) message = args[++index];
    else if (flag === "--approval-sha256" && approval === undefined) approval = args[++index];
    else if (flag === "--send" && !send) send = true;
    else throw new ReplyFailure("invalid_arguments");
  }
  if (typeof recipient !== "string" || !e164.test(recipient)) throw new ReplyFailure("invalid_recipient");
  if (!validReviewedReply(message)) throw new ReplyFailure("invalid_reviewed_reply");
  if (send && (typeof approval !== "string" || !/^[a-f0-9]{64}$/.test(approval)
    || approval !== approvalHash(recipient, message))) throw new ReplyFailure("approval_binding_mismatch");
  if (!send && approval !== undefined) throw new ReplyFailure("invalid_arguments");
  return { recipient, message, send };
}

export async function main(args, { send = liveSendApprovedText, output = console.log } = {}) {
  let attempted = false;
  try {
    const options = parseArguments(args);
    if (!options.send) {
      output(JSON.stringify({ code: "reply_preview_requires_user_approval", recipient: options.recipient,
        message: options.message, approval_sha256: approvalHash(options.recipient, options.message),
        messages_sent: 0, network_connected: false }));
      return 0;
    }
    // A matching hash binds the exact reviewed target/body; it does not substitute
    // for the user's human approval. The caller must obtain that approval first.
    attempted = true;
    const result = await send(options.recipient, options.message);
    if (result?.code !== "send_accepted" || result.recipient !== options.recipient
      || result.message !== options.message || result.messages_sent !== 1) {
      throw new ReplyFailure("send_acknowledgement_unverified");
    }
    output(JSON.stringify({ code: "reply_send_accepted", messages_sent: 1, delivery_verified: false }));
    return 0;
  } catch (error) {
    // The helper may fail before .send(); don't claim an attempt if it says so.
    try { if (typeof error?.attempted === "boolean") attempted = error.attempted; }
    catch { /* preserve unknown delivery without reading hostile fields */ }
    output(JSON.stringify({ code: error instanceof ReplyFailure ? error.code : "reply_send_failed",
      ...classifyFailure(error), send_attempted: attempted, messages_sent: attempted ? null : 0,
      delivery_verified: false }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}

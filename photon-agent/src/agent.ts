import { createHmac, randomBytes } from "node:crypto";
import type { CheckService, CheckSubmission } from "./contracts.js";
import { CheckFailure, validateSubmission } from "./ravel-client.js";
import { ATTACHMENT_REPLY, formatAssessment, HELP_REPLY, PRIVACY_REPLY, REPORT_REPLY } from "./replies.js";

/** Minimal event boundary; no history, attachment readers, identities, or provider objects retained. */
export interface IncomingEvent {
  platform: string;
  direction: string | undefined;
  spaceType: string;
  spaceID: string;
  messageID: string;
  content: { type: "text"; text: string } | { type: "richlink"; url: string } | { type: "attachment" } | { type: "unsupported" };
  reply: (text: string) => Promise<void>;
}
const MINUTE = 60_000;
const DEDUPE_TTL = 10 * MINUTE;
const MAX_KEYS = 1000;
export class PrivateCheckAgent {
  private readonly salt = randomBytes(32);
  private readonly seen = new Map<string, number>();
  private readonly conversations = new Map<string, { start: number; replies: number; checks: number }>();
  private readonly globalChecks: number[] = [];
  private active = 0;
  constructor(private readonly service: CheckService, private readonly now: () => number = Date.now,
              private readonly status: (code: string) => void = () => {}) {}
  private digest(value: string): string { return createHmac("sha256", this.salt).update(value).digest("hex"); }
  async handle(event: IncomingEvent, signal?: AbortSignal): Promise<void> {
    if (event.platform !== "imessage" || event.direction !== "inbound" || event.spaceType !== "dm"
      || event.content.type === "unsupported" || !event.messageID || event.messageID.length > 512
      || !event.spaceID || event.spaceID.length > 512 || signal?.aborted) return;
    const now = this.now();
    for (const [key, time] of this.seen) if (now - time >= DEDUPE_TTL) this.seen.delete(key);
    for (const [key, window] of this.conversations) if (now - window.start >= MINUTE) this.conversations.delete(key);
    const conversation = this.digest(event.spaceID);
    const id = this.digest(event.spaceID + "\0" + event.messageID);
    if (this.seen.has(id)) return;
    // Fail closed at capacity rather than evicting IDs and letting duplicates through.
    if (this.seen.size >= MAX_KEYS || (!this.conversations.has(conversation) && this.conversations.size >= MAX_KEYS)) return;
    this.seen.set(id, now);
    const window = this.conversations.get(conversation) ?? { start: now, replies: 0, checks: 0 };
    this.conversations.set(conversation, window);
    if (window.replies >= 8) return;
    window.replies += 1;
    const respond = async (text: string) => {
      if (signal?.aborted) return;
      try { await event.reply(text); }
      catch { this.status("reply_unavailable"); }
    };
    if (event.content.type === "attachment") { await respond(ATTACHMENT_REPLY); return; }
    const raw = event.content.type === "text" ? event.content.text : event.content.url;
    const text = raw.trim();
    if (/^\/?(?:help|start)$/i.test(text)) { await respond(HELP_REPLY); return; }
    if (/^\/?privacy$/i.test(text)) { await respond(PRIVACY_REPLY); return; }
    if (/^\/?report(?:\s|$)/i.test(text)) { await respond(REPORT_REPLY); return; }
    const submission: CheckSubmission = event.content.type === "richlink" || /^https?:\/\/\S+$/i.test(text)
      ? { content_type: "url", url: text } : { content_type: "text", text: raw };
    try { validateSubmission(submission); }
    catch (error) { await respond(error instanceof CheckFailure ? error.message : "This input could not be checked."); return; }
    while (this.globalChecks.length && now - this.globalChecks[0]! >= 60 * MINUTE) this.globalChecks.shift();
    if (window.checks >= 3 || this.globalChecks.filter((time) => now - time < MINUTE).length >= 20 || this.globalChecks.length >= 200) {
      await respond("The private-check limit was reached. Wait and try again later; no analysis was performed."); return;
    }
    if (this.active >= 2) { await respond("Two checks are already running. Try again shortly; this item was not queued or analyzed."); return; }
    window.checks += 1;
    this.globalChecks.push(now);
    this.active += 1;
    try { await respond(formatAssessment(await this.service.check(submission, signal), submission)); }
    catch (error) {
      const failure = error instanceof CheckFailure ? error : new CheckFailure("service_unavailable");
      this.status(failure.code);
      await respond(failure.message);
    } finally { this.active -= 1; }
  }
}

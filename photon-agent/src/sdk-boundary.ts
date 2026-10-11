import type { IncomingEvent } from "./agent.js";

/** Deliberately excludes attachment readers, sender identities, and history APIs. */
export interface CloudEvent {
  platform: string;
  direction: string | undefined;
  id: string;
  timestamp: Date;
  sender?: { address?: string };
  content: { type: string; text?: string; url?: string };
  isAutoReply?: boolean;
  isSystemMessage?: boolean;
  isServiceMessage?: boolean;
  itemType?: string;
  reply: (text: string) => Promise<unknown>;
}
export function toIncomingEvent(
  spaceValue: unknown, messageValue: unknown,
  startedAt: number, now = Date.now(), expectedSender?: string,
): IncomingEvent | undefined {
  if (typeof spaceValue !== "object" || spaceValue === null
    || typeof messageValue !== "object" || messageValue === null) return undefined;
  const space = spaceValue as Record<string, unknown>;
  const candidate = messageValue as Record<string, unknown>;
  if (typeof space.id !== "string" || typeof candidate.id !== "string"
    || !(candidate.timestamp instanceof Date) || typeof candidate.reply !== "function"
    || typeof candidate.content !== "object" || candidate.content === null) return undefined;
  const message = candidate as unknown as CloudEvent;
  if (expectedSender !== undefined) {
    const senderAddress = message.sender?.address;
    const ownerChatGuid = `any;-;${expectedSender}`;
    if (!/^\+[1-9][0-9]{6,14}$/.test(expectedSender) || senderAddress !== expectedSender
      || space.id !== ownerChatGuid) return undefined;
  }
  const timestamp = message.timestamp.getTime();
  // No backlog or replay analysis; only new, recent explicit inbound DMs.
  if (message.platform !== "imessage" || message.direction !== "inbound" || space.type !== "dm"
    || message.isAutoReply || message.isSystemMessage || message.isServiceMessage
    || (message.itemType !== undefined && message.itemType !== "normal")
    || !Number.isFinite(timestamp) || timestamp < startedAt || now - timestamp > 5 * 60_000
    || timestamp > now + 30_000) return undefined;
  let content: IncomingEvent["content"];
  if (message.content.type === "text" && typeof message.content.text === "string") {
    content = { type: "text", text: message.content.text };
  } else if (message.content.type === "richlink" && typeof message.content.url === "string") {
    content = { type: "richlink", url: message.content.url };
  } else if (message.content.type === "attachment") content = { type: "attachment" };
  else return undefined;
  return { platform: "imessage", direction: "inbound", spaceType: "dm", spaceID: space.id,
    messageID: message.id, content, reply: async (text) => { await message.reply(text); } };
}

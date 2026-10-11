const E164 = /^\+[1-9][0-9]{6,14}$/;

export const LIVE_SESSION_MILLISECONDS = 30 * 60_000;
export const LIVE_SESSION_MAX_MESSAGES = 20;

export function parseLiveSender(args: readonly string[]): string | undefined {
  if (args.length !== 3 || args[0] !== "--live" || args[1] !== "--sender"
    || typeof args[2] !== "string" || !E164.test(args[2])) return undefined;
  return args[2];
}

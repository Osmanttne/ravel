import { PrivateCheckAgent } from "./agent.js";
import { loadConfiguration } from "./config.js";
import { CheckFailure, RavelClient } from "./ravel-client.js";
import { toIncomingEvent } from "./sdk-boundary.js";
import { LIVE_SESSION_MAX_MESSAGES, LIVE_SESSION_MILLISECONDS, parseLiveSender } from "./live-session.js";
import type { PlatformProviderConfig } from "@spectrum-ts/core";

async function main(): Promise<void> {
  const allowedSender = parseLiveSender(process.argv.slice(2));
  if (!allowedSender) {
    console.error("Live replies require one explicitly allowlisted E.164 sender: npm start -- --live --sender +12025550123");
    process.exitCode = 1;
    return;
  }
  const configuration = loadConfiguration();
  const client = new RavelClient(configuration.backend);
  process.env.SPECTRUM_CLOUD_URL = "https://spectrum.photon.codes";
  process.env.SPECTRUM_IMESSAGE_ADDRESS = "imessage.spectrum.photon.codes:443";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "https://spectrum.photon.codes") throw new CheckFailure("configuration");
    return originalFetch(input, { ...init, redirect: "error",
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  };
  const [{ Spectrum }, { imessage }] = await Promise.all([
    import("@spectrum-ts/core"), import("@spectrum-ts/imessage"),
  ]);
  const startedAt = Date.now();
  const controller = new AbortController();
  const cloudProvider = imessage.config as unknown as (() => PlatformProviderConfig);
  const application = await Spectrum({ projectId: configuration.projectId, projectSecret: configuration.projectSecret,
    // SDK 12.10.1's exported conditional IMessageDefinition loses its config/space
    // fields under TypeScript 5.9. Keep the bridge confined to the provider boundary.
    providers: [cloudProvider()],
    telemetry: false, options: { logLevel: "silent", flattenGroups: false } });
  let stopPromise: Promise<void> | undefined;
  const stop = () => {
    controller.abort();
    stopPromise ??= application.stop().catch(() => {});
    return stopPromise;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const handler = new PrivateCheckAgent(client, Date.now, (code) => console.error(`agent_status=${code}`));
  let acceptedMessages = 0;
  const sessionTimer = setTimeout(() => {
    console.log("live_session_expired");
    void stop();
  }, LIVE_SESSION_MILLISECONDS);
  sessionTimer.unref();
  console.log(`live_session_ready; sender_allowlist=enabled; expires_in_seconds=${LIVE_SESSION_MILLISECONDS / 1000}; max_messages=${LIVE_SESSION_MAX_MESSAGES}`);
  try {
    // Serial consumption avoids creating an unbounded application work queue.
    for await (const [space, message] of application.messages) {
      if (controller.signal.aborted) break;
      if (message.platform !== "imessage") continue;
      const event = toIncomingEvent(imessage(space), imessage(message), startedAt, Date.now(), allowedSender);
      if (!event) continue;
      acceptedMessages += 1;
      await handler.handle(event, controller.signal);
      if (acceptedMessages >= LIVE_SESSION_MAX_MESSAGES) {
        console.log("live_session_message_limit_reached");
        await stop();
        break;
      }
    }
  } finally {
    clearTimeout(sessionTimer);
    controller.abort();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await (stopPromise ?? application.stop());
    globalThis.fetch = originalFetch;
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof CheckFailure ? "agent_start_failed: configuration" : "agent_start_failed: cloud_unavailable");
  process.exitCode = 1;
});

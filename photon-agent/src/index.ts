import { PrivateCheckAgent } from "./agent.js";
import { loadConfiguration } from "./config.js";
import { CheckFailure, RavelClient } from "./ravel-client.js";
import { toIncomingEvent } from "./sdk-boundary.js";
import type { PlatformProviderConfig } from "@spectrum-ts/core";

// Explicit activation keeps builds, tests, imports, and offline demos disconnected.
async function main(): Promise<void> {
  // The user requires approval of the exact recipient and outgoing text before
  // every Photon send. The unattended reply runner stays disabled in this slice.
  const liveRepliesApproved = false;
  if (!liveRepliesApproved) {
    console.error("Live Photon replies are disabled. Approve the exact recipient and outgoing message before any controlled send.");
    process.exitCode = 1;
    return;
  }
  if (process.argv.slice(2).length !== 1 || process.argv[2] !== "--live") {
    console.error("Cloud listening is disabled. After confirming a controlled DM test, run npm start -- --live.");
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
  const stop = () => { controller.abort(); void application.stop().catch(() => {}); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const handler = new PrivateCheckAgent(client, Date.now, (code) => console.error(`agent_status=${code}`));
  console.log("cloud_session_ready; waiting for new controlled inbound direct messages");
  try {
    // Serial consumption avoids creating an unbounded application work queue.
    for await (const [space, message] of application.messages) {
      if (controller.signal.aborted) break;
      if (message.platform !== "imessage") continue;
      const event = toIncomingEvent(imessage(space), imessage(message), startedAt);
      if (event) await handler.handle(event, controller.signal);
    }
  } finally {
    controller.abort();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await application.stop();
    globalThis.fetch = originalFetch;
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof CheckFailure ? "agent_start_failed: configuration" : "agent_start_failed: cloud_unavailable");
  process.exitCode = 1;
});

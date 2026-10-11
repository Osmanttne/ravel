/** Read-only Photon project verification. Never sends a message or issues a line token. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const agentRequire = createRequire(new URL("../photon-agent/package.json", import.meta.url));
const officialOrigin = "https://spectrum.photon.codes";
let cloudErrorType;
let stage = "configuration";
let authenticated = false;

try {
  const { parse } = agentRequire("dotenv");
  const readEnv = (url) => {
    try {
      return parse(readFileSync(fileURLToPath(url)));
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw new Error("configuration_unavailable");
    }
  };
  const values = {
    ...readEnv(new URL("../.env", import.meta.url)),
    ...readEnv(new URL("../photon-agent/.env", import.meta.url)),
    ...process.env,
  };
  const projectId = values.SPECTRUM_PROJECT_ID;
  const projectSecret = values.SPECTRUM_PROJECT_SECRET;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId)
      || typeof projectSecret !== "string" || !projectSecret.trim()
      || projectSecret.length > 4096 || /[\r\n]/.test(projectSecret)) {
    console.log(JSON.stringify({ code: "configuration_missing_or_invalid", messages_sent: 0 }));
    process.exitCode = 1;
  } else {
    // Credentials can only travel to the official endpoint, with bounded requests.
    process.env.SPECTRUM_CLOUD_URL = officialOrigin;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== officialOrigin) throw new Error("unexpected_provider_endpoint");
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
      // SDK 12.10.1's metadata getters omit auth; the live API requires it.
      // Attach it only to this authenticated project's own official routes.
      if (url.pathname.startsWith(`/projects/${projectId}/`) && !headers.has("Authorization")) {
        headers.set("Authorization", `Basic ${Buffer.from(`${projectId}:${projectSecret}`).toString("base64")}`);
      }
      return originalFetch(input, {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    };
    stage = "sdk_import";
    const { setLogLevel } = await import(pathToFileURL(agentRequire.resolve("@spectrum-ts/core/authoring")));
    setLogLevel("silent");
    const { cloud, SpectrumCloudError } = await import(pathToFileURL(agentRequire.resolve("@spectrum-ts/core")));
    cloudErrorType = SpectrumCloudError;
    stage = "project_authentication";
    const project = await cloud.getProject(projectId, projectSecret);
    authenticated = true;
    stage = "project_response_validation";
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      throw new Error("invalid_project_response");
    }
    stage = "project_metadata";
    const [subscription, platforms, imessage] = await Promise.all([
      cloud.getSubscription(projectId),
      cloud.getPlatforms(projectId),
      cloud.getImessageInfo(projectId),
    ]);
    const tier = typeof subscription?.tier === "string" ? subscription.tier.toLowerCase() : "";
    console.log(JSON.stringify({
      code: "project_authenticated",
      project_authenticated: true,
      sdk_project_id_field_present: typeof project.id === "string",
      sdk_project_id_matches_configured: project.id === projectId,
      subscription_tier: ["free", "pro", "business"].includes(tier) ? tier : "unrecognized",
      subscription_active: subscription?.status === "active",
      imessage_enabled: platforms?.imessage?.enabled === true,
      line_type: ["shared", "dedicated"].includes(imessage?.type) ? imessage.type : "unrecognized",
      messages_sent: 0,
      incoming_message_verified: false,
      reply_delivery_verified: false,
    }));
  }
} catch (error) {
  const status = cloudErrorType && error instanceof cloudErrorType && Number.isInteger(error.status)
    && error.status >= 100 && error.status <= 599 ? error.status : null;
  // Never print an exception message, provider body, project identifier, or token.
  const allowedCodes = new Set([
    "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT",
    "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED",
    "UND_ERR_CONNECT_TIMEOUT", "ERR_TLS_CERT_ALTNAME_INVALID", "SELF_SIGNED_CERT_IN_CHAIN",
  ]);
  const causeCode = [error?.code, error?.cause?.code].find((code) => allowedCodes.has(code));
  console.log(JSON.stringify({
    code: !authenticated && (status === 401 || status === 403)
      ? "authentication_rejected" : "project_verification_failed",
    project_authenticated: authenticated,
    stage,
    provider_http_status: status,
    diagnostic_code: causeCode ?? "unclassified",
    error_kind: ["TimeoutError", "AbortError", "TypeError", "SpectrumCloudError"].includes(error?.name)
      ? error.name : "unclassified",
    messages_sent: 0,
  }));
  process.exitCode = 1;
}

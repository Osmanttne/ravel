import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { backendEndpoint, CheckFailure, type BackendOptions } from "./ravel-client.js";

export interface AgentConfiguration {
  projectId: string;
  projectSecret: string;
  backend: BackendOptions;
}
function fileEnvironment(path: string): Record<string, string> {
  try { return parse(readFileSync(path)); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw new CheckFailure("configuration");
  }
}
/** Read only allowlisted configuration. Never print the merged environment or SDK errors. */
export function loadConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
  agentDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
): AgentConfiguration {
  const values = { ...fileEnvironment(resolve(agentDirectory, "../.env")),
    ...fileEnvironment(resolve(agentDirectory, ".env")), ...environment };
  const projectId = values.SPECTRUM_PROJECT_ID;
  const projectSecret = values.SPECTRUM_PROJECT_SECRET;
  if (!projectId || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId) || !projectSecret
    || /[\s\p{Cc}\p{Cf}]/u.test(projectSecret) || projectSecret.length > 4096) throw new CheckFailure("configuration");
  const allowHTTP = values.RAVEL_ALLOW_LOCAL_HTTP ?? "false";
  if (allowHTTP !== "true" && allowHTTP !== "false") throw new CheckFailure("configuration");
  const timeout = values.RAVEL_CHECK_TIMEOUT_SECONDS ?? "45";
  if (!/^\d+(?:\.\d+)?$/.test(timeout)) throw new CheckFailure("configuration");
  const timeoutSeconds = Number(timeout);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 120) throw new CheckFailure("configuration");
  const backend = { baseURL: values.RAVEL_API_BASE_URL ?? "https://localhost",
    allowLocalHTTP: allowHTTP === "true", timeoutSeconds };
  if (!values.RAVEL_API_BASE_URL) throw new CheckFailure("configuration");
  backendEndpoint(backend);
  return { projectId, projectSecret, backend };
}

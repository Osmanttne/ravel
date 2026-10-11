import { isIP } from "node:net";
import { CheckResponseSchema, type CheckResponse, type CheckService, type CheckSubmission } from "./contracts.js";

export const MAX_TEXT_SCALARS = 10_000;
export const MAX_URL_SCALARS = 2048;
export const MAX_RESPONSE_BYTES = 128 * 1024;
const messages = {
  configuration: "Configure an HTTPS backend or explicitly allow a local development server.",
  insufficient_input: "Send one message or complete HTTP(S) link to check.",
  too_large: "The selected message or response exceeds the check limit. Send a smaller item.",
  unsafe_url: "This link cannot be checked. Send a complete public HTTP(S) link without credentials.",
  invalid_response: "The backend returned incomplete evidence. No assessment was produced; please retry.",
  provider_invalid_output: "AI extraction returned incomplete evidence. Please retry or use clearer text.",
  provider_timeout: "The check timed out. Please retry.",
  service_unavailable: "The check service is unavailable. Please retry later.",
  cancelled: "The check was cancelled.",
} as const;
export type CheckFailureCode = keyof typeof messages;
export class CheckFailure extends Error {
  constructor(readonly code: CheckFailureCode) { super(messages[code]); this.name = "CheckFailure"; }
}
export interface BackendOptions { baseURL: string; allowLocalHTTP?: boolean; timeoutSeconds?: number }

function localHost(hostname: string): boolean {
  const name = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (name === "localhost" || name === "::1") return true;
  if (isIP(name) === 6) {
    const first = Number.parseInt(name.split(":")[0] ?? "", 16);
    return first >= 0xfc00 && first <= 0xfdff;
  }
  if (isIP(name) !== 4) return false;
  const [first = 0, second = 0] = name.split(".").map(Number);
  return first === 127 || first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
export function backendEndpoint(options: BackendOptions): URL {
  try {
    if (/[\\\s\p{Cc}\p{Cf}]/u.test(options.baseURL)) throw new Error();
    const base = new URL(options.baseURL);
    if (base.username || base.password || base.search || base.hash || !base.hostname) throw new Error();
    if (base.protocol !== "https:" && !(base.protocol === "http:" && options.allowLocalHTTP === true && localHost(base.hostname))) throw new Error();
    base.pathname = base.pathname.replace(/\/$/, "") + "/v1/check";
    return base;
  } catch { throw new CheckFailure("configuration"); }
}
export function validateSubmission(submission: CheckSubmission): void {
  if (typeof submission !== "object" || submission === null
    || (submission.content_type !== "text" && submission.content_type !== "url")) throw new CheckFailure("insufficient_input");
  const value = submission.content_type === "text" ? submission.text : submission.url;
  if (typeof value !== "string") throw new CheckFailure("insufficient_input");
  if (!value.trim()) throw new CheckFailure("insufficient_input");
  const cap = submission.content_type === "text" ? MAX_TEXT_SCALARS : MAX_URL_SCALARS;
  if ([...value].length > cap) throw new CheckFailure("too_large");
  if (submission.content_type === "url") {
    try {
      if (/[\\\s\p{Cc}\p{Cf}]/u.test(value)) throw new Error();
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    } catch { throw new CheckFailure("unsafe_url"); }
  }
}
async function boundedBody(response: Response): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && BigInt(length) > BigInt(MAX_RESPONSE_BYTES)) {
    await response.body?.cancel();
    throw new CheckFailure("too_large");
  }
  if (!response.body) throw new CheckFailure("invalid_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new CheckFailure("too_large"); }
      chunks.push(next.value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally { reader.releaseLock(); }
}
function providerFailure(payload: unknown): CheckFailure {
  const code = typeof payload === "object" && payload !== null && "error" in payload
    && typeof payload.error === "object" && payload.error !== null && "code" in payload.error ? payload.error.code : undefined;
  switch (code) {
    case "too_large": case "unsafe_url": case "insufficient_input": case "provider_invalid_output":
    case "provider_timeout": return new CheckFailure(code);
    default: return new CheckFailure("service_unavailable");
  }
}
export class RavelClient implements CheckService {
  private readonly endpoint: URL;
  private readonly timeoutMilliseconds: number;
  constructor(options: BackendOptions, private readonly fetcher: typeof fetch = globalThis.fetch) {
    this.endpoint = backendEndpoint(options);
    const timeout = options.timeoutSeconds ?? 45;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 120) throw new CheckFailure("configuration");
    this.timeoutMilliseconds = timeout * 1000;
  }
  async check(submission: CheckSubmission, signal?: AbortSignal): Promise<CheckResponse> {
    validateSubmission(submission);
    if (signal?.aborted) throw new CheckFailure("cancelled");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMilliseconds);
    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(submission.content_type === "text"
          ? { content_type: "text", text: submission.text, source_channel: "photon_imessage", privacy_mode: "private_check" }
          : { content_type: "url", url: submission.url, source_channel: "photon_imessage", privacy_mode: "private_check" }),
      });
      if (response.status >= 300 && response.status < 400) throw new CheckFailure("service_unavailable");
      if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new CheckFailure("invalid_response");
      let payload: unknown;
      try { payload = JSON.parse(await boundedBody(response)); }
      catch (error) { if (error instanceof CheckFailure) throw error; throw new CheckFailure("invalid_response"); }
      if (!response.ok) throw providerFailure(payload);
      if (response.status !== 200) throw new CheckFailure("invalid_response");
      const parsed = CheckResponseSchema.safeParse(payload);
      if (!parsed.success) throw new CheckFailure("invalid_response");
      const result = parsed.data;
      if (submission.content_type === "url") {
        if (result.assessment.category !== "insufficient_evidence" || result.assessment.indicators.length > 0
          || (result.observations !== null && (result.observations.evidence_source !== "not_analyzed"
            || result.observations.verification_level !== "not_assessed" || result.observations.payment_requested !== null
            || result.observations.urgency_indicated !== null || result.observations.secrecy_requested !== null
            || result.observations.credentials_requested !== null || result.observations.verification_code_requested !== null
            || result.observations.account_threat_indicated !== null
            || result.observations.payment_reason !== null || result.observations.category !== "unknown"
            || result.observations.destinations.length !== 0))) throw new CheckFailure("invalid_response");
      } else if (result.mode === "gemini" && (result.observations?.evidence_source !== "gemini"
        || result.observations.verification_level !== "unverified_inference"
        || result.assessment.indicators.some((item) => item.evidence_source !== "gemini" || item.verification_level !== "unverified_inference"))) throw new CheckFailure("invalid_response");
      return result;
    } catch (error) {
      if (timedOut) throw new CheckFailure("provider_timeout");
      if (signal?.aborted) throw new CheckFailure("cancelled");
      if (error instanceof CheckFailure) throw error;
      throw new CheckFailure("service_unavailable");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
}

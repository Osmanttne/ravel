import assert from "node:assert/strict";
import type { IncomingEvent } from "../src/agent.js";
import type { CheckResponse, CheckService, CheckSubmission } from "../src/contracts.js";
import { CheckFailure, type CheckFailureCode } from "../src/ravel-client.js";

export const SYNTHETIC_MESSAGE = "Free concert tickets. Pay a $20 transfer fee before delivery. Act now.";
export const PRIVATE_SENTINEL = "private-message-sentinel";
export const PRIVATE_URL = "https://tickets.example/offer?token=private-query-token#private-fragment";

export function fixtureResponse(): CheckResponse {
  return {
    check_id: "chk_synthetic_fixture",
    mode: "fixture",
    assessment: {
      category: "suspicious_verify",
      summary: "An advance fee is requested before delivery. This claim does not establish fraud.",
      verified_fraud: false,
      indicators: [{
        code: "advance_fee", description: "A payment is requested before delivery.",
        evidence_source: "submitted_content", verification_level: "observed_claim",
      }],
      recommended_action: "Verify the offer independently before paying.",
      related_report_count: 0,
      known_threat: false,
    },
    observations: null,
    report_created: false,
    limitations: ["MOCK / FIXTURE MODE: deterministic synthetic extraction."],
  };
}

export function geminiResponse(): CheckResponse {
  const result = fixtureResponse();
  result.mode = "gemini";
  result.assessment.indicators = result.assessment.indicators.map((item) => ({
    ...item, evidence_source: "gemini", verification_level: "unverified_inference",
  }));
  result.observations = {
    category: "ticket_offer", payment_requested: true, payment_reason: "advance_fee",
    secrecy_requested: null, urgency_indicated: null, destinations: ["https://tickets.example"],
    credentials_requested: null, verification_code_requested: null, account_threat_indicated: null,
    evidence_source: "gemini", verification_level: "unverified_inference",
    uncertainty_codes: ["identity_unverified", "external_verification_needed"],
  };
  return result;
}

export function urlResponse(mode: "fixture" | "gemini" = "fixture"): CheckResponse {
  const result = fixtureResponse();
  result.mode = mode;
  result.assessment.category = "insufficient_evidence";
  result.assessment.summary = "This URL was parsed locally. No model analysis was performed.";
  result.assessment.indicators = [];
  if (mode === "gemini") {
    result.observations = {
      category: "unknown", payment_requested: null, payment_reason: null,
      secrecy_requested: null, urgency_indicated: null, destinations: [],
      credentials_requested: null, verification_code_requested: null, account_threat_indicated: null,
      evidence_source: "not_analyzed", verification_level: "not_assessed",
      uncertainty_codes: ["external_verification_needed"],
    };
  }
  return result;
}

export function jsonResponse(payload: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { "Content-Type": "application/json", ...headers },
  });
}

export async function expectFailure(action: () => Promise<unknown>, code?: CheckFailureCode): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof CheckFailure);
    if (code !== undefined) assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /private-message-sentinel|private-query-token|private-fragment/);
    return true;
  });
}

export function event(
  overrides: Partial<IncomingEvent> = {},
): { event: IncomingEvent; replies: string[] } {
  const replies: string[] = [];
  return {
    replies,
    event: {
      platform: "imessage", direction: "inbound", spaceType: "dm",
      spaceID: "synthetic-dm", messageID: "synthetic-message-1",
      content: { type: "text", text: SYNTHETIC_MESSAGE },
      reply: async (text) => { replies.push(text); },
      ...overrides,
    },
  };
}

export class FakeService implements CheckService {
  readonly calls: { submission: CheckSubmission; signal: AbortSignal | undefined }[] = [];
  constructor(private readonly result = fixtureResponse(), private readonly error?: unknown) {}
  async check(submission: CheckSubmission, signal?: AbortSignal): Promise<CheckResponse> {
    this.calls.push({ submission, signal });
    if (this.error !== undefined) throw this.error;
    return this.result;
  }
}

export function deferred<T>(): {
  promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

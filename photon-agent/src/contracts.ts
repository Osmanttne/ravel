import { z } from "zod";

const boundedText = (max: number) => z.string().min(1).max(max);
const nullableFlag = z.boolean().nullable();
const origin = boundedText(2048).refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && value === url.origin;
  } catch { return false; }
});
const indicator = z.strictObject({
  code: boundedText(100),
  description: boundedText(1000),
  evidence_source: z.enum(["submitted_content", "fixture_provider", "gemini"]),
  verification_level: z.enum(["observed_claim", "unverified_inference"]),
});
const observations = z.strictObject({
  category: z.enum(["ticket_offer", "promotion", "unknown"]),
  payment_requested: nullableFlag,
  payment_reason: z.enum(["advance_fee", "transfer_fee", "upfront_payment", "deposit_before_delivery", "generic_payment"]).nullable(),
  secrecy_requested: nullableFlag,
  urgency_indicated: nullableFlag,
  credentials_requested: nullableFlag.default(null),
  verification_code_requested: nullableFlag.default(null),
  account_threat_indicated: nullableFlag.default(null),
  destinations: z.array(origin).max(20),
  evidence_source: z.enum(["fixture_provider", "gemini", "not_analyzed"]),
  verification_level: z.enum(["unverified_inference", "not_assessed"]),
  uncertainty_codes: z.array(z.enum(["identity_unverified", "ticket_ownership_unverified", "content_unclear", "incomplete_content", "conflicting_evidence", "external_verification_needed"])).max(6),
});

export const CheckResponseSchema = z.strictObject({
  check_id: boundedText(100).regex(/^chk_[A-Za-z0-9_-]+$/),
  mode: z.enum(["fixture", "gemini"]),
  assessment: z.strictObject({
    // Verified threat/community findings are unavailable in this bounded slice.
    category: z.enum(["suspicious_verify", "insufficient_evidence", "needs_human_review"]),
    summary: boundedText(2000),
    verified_fraud: z.literal(false),
    indicators: z.array(indicator).max(20),
    recommended_action: boundedText(2000),
    related_report_count: z.literal(0),
    known_threat: z.literal(false),
  }),
  observations: observations.nullable(),
  report_created: z.literal(false),
  limitations: z.array(boundedText(2000)).max(20),
});
export type CheckResponse = z.infer<typeof CheckResponseSchema>;
export type CheckSubmission =
  | { content_type: "text"; text: string }
  | { content_type: "url"; url: string };
export interface CheckService {
  check(submission: CheckSubmission, signal?: AbortSignal): Promise<CheckResponse>;
}

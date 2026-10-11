import type { CheckResponse, CheckSubmission } from "./contracts.js";

export const PRIVACY_REPLY = "Ravel checks only the text or link you explicitly send to this bot. Your message passes through Photon and Ravel's backend; in connected mode text is also sent to Google Gemini. A link alone is parsed locally and never opened or sent to Gemini. We do not scan your other chats or save checks as community reports. Photon and Google's handling follows their provider terms: https://photon.codes/privacy-policy and https://ai.google.dev/gemini-api/terms. Send synthetic examples during development.";
export const HELP_REPLY = "Send one message or complete HTTP(S) link for a private check. Text may be sent to Google Gemini for unverified AI observations. Links are parsed without visiting them; paste the accompanying message for context. Commands: /help, /privacy, /report. Photos and other attachments are not supported here; use Ravel's iPhone app. Community reporting is unavailable.";
export const REPORT_REPLY = "Community reporting and saved report matching are unavailable. This bot only checks privately and does not create reports.";
export const ATTACHMENT_REPLY = "This bot currently checks text and links only. Paste the readable message, or select the screenshot in Ravel's iPhone app. No attachment was downloaded or analyzed.";

const titles = {
  suspicious_verify: "Suspicious — verify before acting",
  insufficient_evidence: "Insufficient evidence",
  needs_human_review: "Needs human review",
} as const;
const legacyCodes = ["advance_fee", "payment_request", "urgency"] as const;
const accountCodes = ["credential_request", "verification_code_request", "account_threat"] as const;
export const SUPPORTED_INDICATOR_CODES = [...legacyCodes, ...accountCodes] as const;
type IndicatorCode = typeof SUPPORTED_INDICATOR_CODES[number];
const reasons: Record<IndicatorCode, string> = {
  advance_fee: "A payment before delivery is indicated.",
  payment_request: "A payment request is indicated.",
  urgency: "Pressure to act quickly is indicated.",
  credential_request: "A request to share a password or account credentials is indicated.",
  verification_code_request: "A request to share a verification or account reset code is indicated.",
  account_threat: "A claim that an account is at risk or may be suspended is indicated.",
};
const noIndicators = "No sufficiently supported tactic indicators were returned.";
const unclearContent = "The extracted content is unclear or inconsistent. Review the original message and verify independently.";
const accountAction = "Open the official app yourself or use an independently obtained official contact. Do not share passwords, verification codes, or account reset codes, or send money, in response to an unverified request.";

function orderedIndicatorCodes(codes: readonly string[]): IndicatorCode[] {
  const selected = new Set(codes.filter((code): code is IndicatorCode => Object.hasOwn(reasons, code)));
  // Keep historical payment/urgency wording in its existing encounter order.
  // New account tactics have one canonical order, independent of model order.
  return [...selected].filter(code => legacyCodes.some(legacy => legacy === code))
    .concat(accountCodes.filter(code => selected.has(code)));
}

function renderAssessment(mode: CheckResponse["mode"], category: CheckResponse["assessment"]["category"],
  codes: readonly string[], isURL: boolean): string {
  const selected = orderedIndicatorCodes(codes);
  const modeCopy = mode === "fixture"
    ? isURL ? "Fixture mode — link parsed locally." : "Fixture demo — simulated assessment."
    : isURL ? "Gemini mode — this link was not analyzed by AI." : "Gemini AI observations — unverified.";
  const detail = isURL
    ? "The link was parsed locally. Its destination was not visited, analyzed by AI, or checked against reputation data. Paste the accompanying message for useful context."
    : category === "needs_human_review" ? unclearContent : selected.map(code => reasons[code]).join(" ") || noIndicators;
  const action = !isURL && category !== "needs_human_review" && accountCodes.some(code => selected.includes(code))
    ? accountAction
    : "Verify through an independently obtained official contact before sending money or sensitive information.";
  return [modeCopy, titles[category], detail,
    "These observations do not establish fraud. Missing evidence does not establish safety.",
    action,
    "Checked privately; no community report was created."].join("\n\n");
}

export function formatAssessment(result: CheckResponse, submission: CheckSubmission): string {
  return renderAssessment(result.mode, result.assessment.category,
    result.assessment.indicators.map(item => item.code), submission.content_type === "url");
}

/** Accept only exact curated Gemini formatter output, never arbitrary prose.
 * Parse fixed sentences and re-render instead of enumerating permutations.
 */
export function isCuratedAssessmentReply(reply: string): boolean {
  if (typeof reply !== "string" || reply.length > 3_000) return false;
  if (reply === renderAssessment("gemini", "insufficient_evidence", [], true)) return true;
  const parts = reply.split("\n\n");
  if (parts.length !== 6) return false;
  const categories = ["suspicious_verify", "insufficient_evidence", "needs_human_review"] as const;
  const category = categories.find(candidate => titles[candidate] === parts[1]);
  if (!category) return false;
  const codes: IndicatorCode[] = [];
  let detail = parts[2]!;
  if (detail !== noIndicators && detail !== unclearContent) {
    for (let count = 0; count < SUPPORTED_INDICATOR_CODES.length && detail; count++) {
      const code = SUPPORTED_INDICATOR_CODES.find(candidate => detail === reasons[candidate]
        || detail.startsWith(reasons[candidate] + " "));
      if (!code || codes.includes(code)) return false;
      codes.push(code);
      detail = detail.slice(reasons[code].length);
      if (detail.startsWith(" ")) detail = detail.slice(1);
    }
    if (detail) return false;
  }
  return reply === renderAssessment("gemini", category, codes, false);
}

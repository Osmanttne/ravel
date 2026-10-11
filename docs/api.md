# Local API contract

This document describes the private-check backend, including Milestone 6's additive account-secret observations. Responses return the configured `mode: "fixture"` or `"gemini"`; no endpoint currently queries community reports or independently verified threat intelligence. Pydantic models are in `backend/app/schemas`, and `/docs` and `/openapi.json` expose the running API contract.

## `GET /health`

Returns process health and configured mode without credentials. This is local process health, not a live readiness check of Gemini, Tiger Data, or Photon.

## `POST /v1/check`

Accept exactly one primary input. JSON accepts text or a URL; multipart accepts one image plus optional user context. Unknown fields, unsupported `content_type` values, and attempts to change the privacy mode are rejected.

Common fields:

| Field | Accepted values | Default |
| --- | --- | --- |
| `source_channel` | `ios_share`, `ios_app`, `photon_imessage`, `web`, `fixture` | `ios_app` |
| `privacy_mode` | `private_check` | `private_check` |

`source_channel` is source metadata only. Choosing `fixture` does not select the fixture adapter or prevent a Google call in connected mode. The server's `RAVEL_FIXTURE_MODE` setting selects the provider.

JSON text:

```json
{
  "content_type": "text",
  "text": "Free concert tickets. Pay a $20 transfer fee before delivery: https://tickets.example/offer",
  "source_channel": "fixture",
  "privacy_mode": "private_check"
}
```

JSON URL:

```json
{
  "content_type": "url",
  "url": "https://campus.example/events",
  "source_channel": "fixture"
}
```

Text and URL fields must be nonblank strings. Text is limited to 10,000 characters and each URL to 2,048. At most 20 explicit HTTP(S) links are accepted in text. URL destinations are parsed without DNS resolution or fetching. Credentials, localhost/local destinations, and all IP literals are rejected, including private IPv4/IPv6 addresses. Public destination values contain only scheme, hostname, and an optional port; query tokens, fragments, and paths are omitted. Exact hostnames are preserved rather than merging unrelated subdomains or deriving registered domains.

URL-only input never calls Gemini. In connected mode its observations are marked `not_analyzed` / `not_assessed`; fixture responses leave observations `null`. The response-level `mode` identifies configuration and does not claim that every input was analyzed by a model.

Multipart fields:

| Field | Requirement |
| --- | --- |
| `image` | One file; actual PNG or JPEG matching its declared MIME type |
| `content_type` | `image`; defaults to `image` |
| `source_channel` | Same values/default as JSON |
| `privacy_mode` | `private_check` |
| `context` | Optional text, at most 2,000 characters |

Limits are 8 MiB per image, 9 MiB for the entire request including multipart overhead, 20 million decoded pixels, and 10,000 pixels per dimension. HEIC and other image types are not supported by the API. A filename does not authorize access to a local path, select a fixture, or override validation. Fixture replay recognizes bundled synthetic image contents; arbitrary images do not receive invented screenshot observations. Optional context is safety-validated but is not analyzed by the fixture image adapter. In Gemini mode, metadata-stripped, re-encoded images and accompanying context are sent inline to Google; the Files API is not used.

Response shape:

```json
{
  "check_id": "chk_example",
  "mode": "fixture",
  "assessment": {
    "category": "suspicious_verify",
    "summary": "An advance fee is requested before delivery. Verify the offer before paying; this claim does not establish fraud.",
    "verified_fraud": false,
    "indicators": [
      {
        "code": "advance_fee",
        "description": "The offer requests a fee or payment before delivery.",
        "evidence_source": "submitted_content",
        "verification_level": "observed_claim"
      }
    ],
    "recommended_action": "Verify the offer through an independently obtained official contact or ticket platform before sending money or payment credentials.",
    "related_report_count": 0,
    "known_threat": false
  },
  "observations": null,
  "report_created": false,
  "limitations": ["Fixture mode: no live provider or threat-intelligence verification."]
}
```

The identifier and limitation wording above are illustrative. Private checks return a non-identifying check ID and always `report_created: false`.

The stable assessment categories are `known_malicious_evidence`, `suspicious_verify`, `insufficient_evidence`, and `needs_human_review`; no new category was added. The current policy cannot produce a verified malicious finding. An explicit advance-fee request, payment combined with urgency, a request to disclose login secrets or authentication codes, or an account-access threat combined with payment can produce `suspicious_verify`. Account threats or urgency alone, a generic payment request, repeated URLs, and absent matches remain insufficient. Gemini extraction marked `content_unclear` or `conflicting_evidence` takes precedence and produces `needs_human_review` without strong tactic indicators.

Indicators separate provenance from verification. Fixture text observations use `submitted_content` / `observed_claim`; replayed image observations use `fixture_provider` / `unverified_inference`. Every Gemini indicator uses `gemini` / `unverified_inference` and cautious AI-extraction wording. The contract reserves `opt_in_reports`, `trusted_threat_intelligence`, `unreviewed_reports`, and `independently_verified` for later integrations.

### Public observations

`observations` is additive and nullable. Fixture responses may leave it `null`. Connected text/image checks expose controlled fields; this illustrative shape is a contract example, not a live provider result:

```json
{
  "category": "ticket_offer",
  "payment_requested": true,
  "payment_reason": "advance_fee",
  "secrecy_requested": null,
  "urgency_indicated": true,
  "credentials_requested": null,
  "verification_code_requested": null,
  "account_threat_indicated": null,
  "visual_regions": [],
  "destinations": ["https://tickets.example"],
  "evidence_source": "gemini",
  "verification_level": "unverified_inference",
  "uncertainty_codes": ["identity_unverified", "external_verification_needed"]
}
```

Category is `ticket_offer`, `promotion`, or `unknown`. Payment, secrecy, and urgency are nullable booleans: `null` preserves an unknown observation instead of converting it to false. Payment reason is nullable and limited to `advance_fee`, `transfer_fee`, `upfront_payment`, `deposit_before_delivery`, or `generic_payment`. Destinations are sanitized origins, with at most 20 values. Public evidence source is `fixture_provider`, `gemini`, or `not_analyzed`; verification is `unverified_inference` or `not_assessed`.

Three additive nullable booleans extend account-related observations. Missing
fields default to `null` in the backend and updated Swift/Photon clients, preserving
older responses. `true` requires supporting submitted evidence; `false` describes
an explicit negative claim, and `null` means absent, unclear, or unknown.

| Observation | Meaning | Indicator when true |
| --- | --- | --- |
| `credentials_requested` | A request to disclose/send a password, PIN, or login secret to someone else or an unverified destination supplied in the message. | `credential_request` |
| `verification_code_requested` | A request to share, reply with, or forward an authentication, password-reset, or one-time verification code to someone else. | `verification_code_request` |
| `account_threat_indicated` | A claim that account access will be locked, suspended, deleted, or restricted unless the recipient acts. | `account_threat` |

Ordinary sign-in in an independently opened official app, code-delivery notices,
never-share warnings, and coupon codes are not secret-sharing requests. A link
calling itself official does not authenticate its destination. A threat can
appear as an indicator while the category remains `insufficient_evidence`; its
presence alone is not proof of fraud. URL-only checks leave all three fields
`null`. The new indicator codes retain the same provenance/verification rules
and cannot alter private-check, fraud, threat, or community-report guarantees.

Uncertainty codes are controlled values: `identity_unverified`, `ticket_ownership_unverified`, `content_unclear`, `incomplete_content`, `conflicting_evidence`, and `external_verification_needed`. Internal evidence quotes support output validation but never appear in the response. Raw model claims, free-form model uncertainty text, URL paths/query tokens, and extracted identities are not returned.

Screenshot observations may include up to 12 `visual_regions`. Each region has
a `field` matching an affirmative signal and `box_2d` coordinates in normalized
`[ymin, xmin, ymax, xmax]` order from 0 to 1000. These are approximate Gemini
image pointers, not verified evidence, and can be misplaced. Text checks return
an empty list. The app overlays boxes on the locally held screenshot and lets
the user confirm, reject, or mark each extracted signal as unclear.

## `POST /v1/reassess`

Recomputes the existing deterministic assessment after an explicit user review.
The client sends sanitized Gemini observations and one or more decisions:

```json
{
  "input_kind": "image",
  "observations": {
    "payment_requested": true,
    "evidence_source": "gemini",
    "verification_level": "unverified_inference"
  },
  "decisions": [{ "field": "payment_requested", "choice": "not_present" }]
}
```

`field` must be a currently positive supported signal. `choice` is `confirm`,
`not_present`, or `unclear`. The endpoint performs no Gemini call, accepts no
raw screenshot or message, writes no state, and creates no report. Its response
is an `Assessment` produced by the same conservative policy; it does not
independently verify the model observation or establish safety.

## `POST /v1/reports`

This reserved endpoint validates the separate reporting contract, then returns `503 service_unavailable`. There is no persistence layer; a valid consented request is not a created report.

```json
{
  "related_check_id": "chk_example",
  "consent_to_contribute": true,
  "confirmed_fields": {
    "category": "ticket_offer",
    "normalized_destination": "tickets.example",
    "message_pattern": "Free tickets with advance transfer fee"
  }
}
```

`consent_to_contribute` must be the boolean `true`; false, strings, and numeric `1` fail with `422`. `related_check_id` must start with `chk_`, contain only letters, digits, underscores, or hyphens afterward, and be at most 100 characters. Confirmed fields are nonblank strings bounded at 100 characters for category, 2,048 for destination, and 1,000 for message pattern. Unknown fields are forbidden. Destinations must pass the same URL checks; bare hostnames use an HTTPS prefix for validation. These contracts do not implement consent storage, report sanitization, rate limiting, moderation, or binding a report to prior extracted facts.

The future typed response contains `report_id`, `status: "pending_review"`, and boolean `created`. No successful report-creation response is returned in this milestone.

## `GET /v1/campaigns/{id}`

Returns `503 service_unavailable`. No campaign records, historical matching, or public allegations are available.

## Errors

Errors use a scrubbed envelope:

```json
{
  "error": {
    "code": "service_unavailable",
    "message": "A concise explanation of the unavailable operation."
  },
  "request_id": "req_example"
}
```

Validation failures return `422`, size violations return `413`, and unsupported media return `415`. Gemini invalid output returns `502 provider_invalid_output`, timeout returns `504 provider_timeout`, and provider failure returns `503 service_unavailable`. Reserved integrations also return `503`. Malformed request bodies may return `400`. Responses do not echo submitted content, provider output, or stack traces. Provider failures never fall back to mocked results. Request IDs are for tracing and are distinct from successful check IDs. API responses use `Cache-Control: no-store`.

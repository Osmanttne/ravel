# Gemini extraction setup

Milestone 2 implements a Gemini Developer API adapter for selected text and screenshots; Milestone 6 adds bounded account-secret observations and controls. Fixture mode remains the default. Earlier real synthetic ticket text and screenshot checks passed with `gemini-3.8-flash` and SDK 2.29.0 on 2026-10-10 at 21:56 UTC. [Sanitized proof](artifacts/gemini-live-verification.json) records those two successful Google requests; mocked tests cover validation and failure paths. The expanded live coverage run initially had three mismatches; after the deterministic account-threat payment correction, the 2026-10-11 follow-up passed all ten synthetic controls with nine Gemini generations and one local-only URL check. This limited evaluation does not establish general fraud accuracy. See [the detailed control record](demo-script.md). A later physical-iPhone Photos Share check also succeeded with `gemini-3.5-flash-lite`; the current device result is recorded in [the sanitized acceptance artifact](artifacts/ios-gemini-share-acceptance.json).

## Server configuration

Install the backend dependencies using the root README. Copy `.env.example` to `.env` in the repository root and edit it locally:

```dotenv
APP_ENV=development
RAVEL_FIXTURE_MODE=false
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT_SECONDS=30
```

Fill the blank key in the server's local environment. Keep `.env` out of Git; credentials belong on the backend and never in the future iPhone client. Process environment values override `.env`. Restart the backend after configuration changes.

`GEMINI_MODEL` has no hard-coded default. The example `gemini-3.8-flash` is documented as a stable model supporting text/image input and structured output, with a September 2026 update. This model was verified with the configured local account on synthetic text and image inputs; availability for other accounts or future runs is not guaranteed by that check. [Official model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash).

On 2026-10-10, the configured account returned HTTP 429 `RESOURCE_EXHAUSTED`
for a harmless basic-generation diagnostic on `gemini-3.8-flash`. The same
diagnostic succeeded with `gemini-3.5-flash-lite`, and the physical-device
synthetic Photos Share check then completed. For this local account, `.env` now
selects `gemini-3.5-flash-lite`; model quotas and availability can vary, so
diagnose provider errors rather than treating a healthy `/health` response as
proof that generation is available.

`GEMINI_TIMEOUT_SECONDS` defaults to 30 and must be finite, greater than zero, and at most 120. `APP_ENV` accepts only `development` or `test`; this does not enable a public-production deployment. Missing key/model or invalid timeout fails startup. To return to fixture mode, set `RAVEL_FIXTURE_MODE=true` and restart. There is no automatic fallback after provider failures.

For exactly `gemini-3.8-flash` or `models/gemini-3.8-flash`, the adapter now sets
`ThinkingConfig(thinking_level="low")`, a documented option for reducing thinking
latency. Other models retain their provider defaults; model and environment
configuration are unchanged. Actual SDK wire tests cover this narrow setting.
It does not diagnose the timeout or establish a successful remedy. [Official
thinking documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking).

## Request and response boundary

The adapter uses `google-genai` 2.29.0 and a stateless `client.models.generate_content` request. It uses a bounded inline image part, not the Files API, and does not create a chat or server-side conversation. The application closes its owned client at lifespan shutdown. The SDK documents generation, inline content, typed configuration, and explicit client cleanup. [Official Python SDK documentation](https://googleapis.github.io/python-genai/).

Connected text checks send the selected text. Connected image checks send a decoded, metadata-stripped, re-encoded image plus optional selected context. The adapter honors image orientation, composites transparency onto white, prefers PNG for PNG screenshots, and can fall back to JPEG compression to fit the 5 MiB inline limit. Re-encoding removes embedded metadata; any visible private text remains in the submitted image. Google processes these inputs under its applicable provider terms. The application's ephemeral processing and client cleanup do not guarantee zero Google retention.

The adapter targets the Google Gemini Developer API explicitly. Redirects, automatic environment proxy/provider overrides, and SDK record/replay modes are disabled. A supplied test client remains owned by its caller; only a client created by the adapter is closed during application shutdown.

URL-only checks are local parsing in both modes: no Google call, no DNS resolution, and no destination fetch. A URL response can have `mode: "gemini"` because that is the configured mode while its observations remain `not_analyzed` / `not_assessed`.

The model is asked for typed observations about category, payment request/reason, urgency, secrecy, credential/code sharing, account-access threats, visible URLs, supporting evidence, and controlled uncertainty codes. The request declares JSON output and a schema; server-side strict parsing/validation still checks the response. Schema-constrained generation alone does not establish factual accuracy. [Official structured-output documentation](https://ai.google.dev/gemini-api/docs/structured-output).

Every affirmative boolean, payment reason, and visible URL must have supporting evidence. For text input, quoted evidence and URLs must occur in the submitted text. Image quotes cannot be independently matched to pixels without a separate OCR/verification system; they remain model inferences. The parser rejects oversized output, incomplete generation, extra fields, non-JSON/tool output, and unsafe model-supplied URLs.

Raw model quotes, free-form claims, identities, and uncertainty prose are internal and are not returned to callers. Public observations contain controlled values and sanitized URL origins. Paths, query strings, and fragments are omitted. Nullable booleans preserve unknowns instead of implying that an unobserved tactic is absent.

Model-backed indicators use `evidence_source: "gemini"` and `verification_level: "unverified_inference"`. The assessment uses cautious language such as “AI extraction suggests.” Advance-payment, payment-plus-urgency, secret-sharing requests, or account threats combined with payment can request verification; unclear/conflicting extraction takes precedence and requests human review. No extraction can set verified fraud, verified threat, or community-report counts.

The nullable fields are `credentials_requested`, `verification_code_requested`,
and `account_threat_indicated`; their indicator codes are `credential_request`,
`verification_code_request`, and `account_threat`. Password/PIN requests and
requests to send or forward authentication/reset codes are distinct from ordinary
sign-in in an independently opened official app, code delivery, coupon codes,
and never-share warnings. Account threat alone or threat plus urgency remains
`insufficient_evidence`. Public fields default to `null` when missing for older
responses; assessment categories remain unchanged. See the [API definitions](api.md).

## Failures and validation limits

| Failure | HTTP status / code |
| --- | --- |
| Malformed, unsupported, or invalid provider output | `502 provider_invalid_output` |
| Provider timeout | `504 provider_timeout` |
| Provider/transport failure | `503 service_unavailable` |

The API returns a scrubbed error and request ID, not raw provider output or exception details. Provider failure logs contain only bounded HTTP status codes or allowlisted exception classifications, without raw messages, credentials, submitted content, or traceback details. It does not fabricate an assessment or substitute fixture output.

Instructions explicitly treat submitted content as untrusted data. No search, URL context, function calling, or other tools are enabled. Structured output, bounded evidence fields, and server-side validation constrain what reaches assessment policy. Mocked prompt-injection cases verify configuration and output handling; neither those tests nor the two successful live examples prove general model robustness or detection quality. Provider-data-policy review remains necessary before testing with real user content.

Report storage and campaign matching still require Milestone 4. A connected private check cannot create a community report.

## Diagnose provider access

Run from the repository root:

```sh
.venv/bin/python scripts/diagnose_gemini.py
```

This command makes real Google requests for model metadata and a synthetic text generation attempt. It prints curated status codes and diagnostic classifications without printing credentials, raw provider messages, or model output. If model lookup fails, it can list supported model identifiers. It does not change `.env` or switch the running backend's mode.

To check generation access with a minimal prompt and no extraction schema or system instruction:

```sh
.venv/bin/python scripts/diagnose_gemini.py --basic
```

This variant checks metadata and basic text generation; it does not validate the extraction contract or create a live-verification artifact. Metadata access alone does not prove generation permission. `source_channel=fixture` is source metadata and does not enable fixture processing.

## Verify actual Gemini use

After adding the key and model locally, run from the repository root:

```sh
.venv/bin/python scripts/verify_gemini.py
```

This command uses an in-process FastAPI test client with the real Google adapter.
It attempts a real synthetic ticket-message check, then a bundled
screenshot check after the text result passes validation. A successful run makes
two real Google requests. It uses the real adapter even if the server is currently
in fixture mode and saves sanitized proof to
`docs/artifacts/gemini-live-verification.json` only after both checks pass.
It does not use mock responses or alter `.env`. Missing configuration or failed
provider checks produce an error without claiming successful live verification.

To make the running backend use Gemini, set `RAVEL_FIXTURE_MODE=false` in
the local `.env` and restart it after successful verification.

The latest successful run at `2026-10-10T21:56:08.600358+00:00` used SDK 2.29.0 and `gemini-3.8-flash`. Both in-process API checks returned HTTP 200 with ticket, payment, urgency, and `https://tickets.example` observations. Both assessments used `gemini` / `unverified_inference`, kept verified fraud/threat false and report count zero, and created no report. The [proof artifact](artifacts/gemini-live-verification.json) records this final pair without raw model quotes or URL tokens; it excludes the preceding timeout, diagnostic request, and user phone checks. It verifies the synthetic extraction path, not broad fraud-detection accuracy.

Separate HTTP smoke checks passed against the local backend now running in Gemini mode at <http://127.0.0.1:8001/docs>. Health, real synthetic text extraction, and real multipart screenshot extraction returned HTTP 200. Both content checks preserved the same private-check guarantees. URL-only input returned HTTP 200 with `not_analyzed` observations and no provider call. These running-server checks are additional verification and are not included in the artifact's count of two requests.

## Evaluate the broader synthetic controls

From the repository root, run the default fixture verification without provider
requests:

```sh
.venv/bin/python scripts/verify_gemini_coverage.py
```

It evaluates ten controls: seven texts, credential-request and benign-code images,
and one standalone fictional URL. It checks expected categories/indicators and
private-check flags, saving sanitized results to
`docs/artifacts/gemini-coverage-fixture.json`. Fixture replay is explicitly labeled
and does not verify Gemini behavior. All ten fixture controls pass.

To run against the locally configured Gemini account, explicitly use:

```sh
.venv/bin/python scripts/verify_gemini_coverage.py --live
```

This attempts nine real Google generations (seven texts and two images), plus a
URL-only check with zero provider or destination calls. It stops after a non-200
provider response and performs no application retries. It uses the real adapter
regardless of the running server's configured mode and does not change `.env`.
`docs/artifacts/gemini-coverage-live.json` records controlled categories, nullable
flags, provenance, and private-check guarantees without raw inputs, secret/code
values, evidence quotes, request IDs, or message sends. A failed run cannot claim
live success. The first expanded live attempt returned `504 provider_timeout`
on its first text check; successful expanded live validation remains pending.
The [initial timeout record](artifacts/gemini-coverage-timeout.json) preserves that
failed attempt separately from the next bounded verification run.
No timeout cause or successful remedy is inferred from that result. The existing
ticket proof is historical evidence, not validation of these new controls. Passing this
small synthetic set would not establish general phishing accuracy or calibration.

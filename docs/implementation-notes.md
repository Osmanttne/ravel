# Implementation notes

Milestones 0–2 provide a local development backend with credential-free fixture mode and an optional Gemini adapter. Milestone 3 remains in progress: renamed core tests, unsigned/signed builds, physical installation, and app launch pass; the user has now confirmed successful private Gemini analysis through both the app picker and Photos Share Extension with synthetic content. Device UI automation and direct text/URL sharing from the test host remain unverified. The user-approved focus is Gemini + Photon; Tiger Data/report storage is deferred. The specification remains [RAVEL_CONTEXT.md](../RAVEL_CONTEXT.md).

## Current boundaries

The FastAPI backend validates and minimizes explicitly submitted inputs, passes them through replaceable extraction adapters, and builds a deterministic assessment. Strict Pydantic contracts reject unexpected fields and preserve a common interface for future SwiftUI and Photon clients. Provider observations are separated from assessment policy.

Fixture text extraction is a bounded heuristic. Fixture image extraction recognizes hashes of bundled synthetic images and replays labeled observations; unknown images receive a limited result rather than invented OCR. The Gemini adapter sends selected text/images for strictly validated structured extraction. URL-only checks remain local parsing and never call Gemini. There is no embeddings or reputation service.

The policy flags explicit advance fees, payment combined with urgency, supported
requests to disclose passwords/PINs or authentication/reset codes, and account
threats combined with payment. A lone offer, generic payment, threat alone, or
threat plus urgency remains insufficient evidence. Ordinary sign-in in an
independently opened official app, code delivery, coupon codes, and never-share
warnings are controls rather than secret-sharing requests. Gemini observations
carry `gemini` / `unverified_inference` provenance and uncertain copy. Unclear or
conflicting model evidence takes precedence and requests human review. The policy
never sets `verified_fraud` or `known_threat` to true. Report count remains zero
because no report repository exists.

Private checks and reports are separate code paths. `/v1/check` does not call report creation. `/v1/reports` validates affirmative consent but returns an unavailable-service error; `/v1/campaigns/{id}` also remains unavailable. Tests verify behavior across repeated checks, source channels, supported content types, and failure paths. Repeating a fixture does not create corroborating evidence.

## Input handling and retention

The request guard bounds complete bodies at 6 MiB, including chunked bodies and multipart overhead, before parsing. Images are separately limited to 5 MiB, 20 million pixels, and 10,000 pixels per dimension. Only PNG and JPEG are accepted and decoded; declared MIME type alone is insufficient. Images are stripped of embedded metadata and re-encoded before inline Gemini submission. Uploads are data and are never executed.

Gemini instructions treat content as untrusted data, request a schema rather than a verdict, and enable no tools, URL fetching, or search. Strict typed output and evidence validation reject unsupported or malformed observations. Mocked tests verify these controls at the integration boundary; they cannot prove how a real model responds to every injected instruction.

Raw text/images remain ephemeral and are not stored as application data. Starlette multipart handling may spool an upload to a temporary file; request cleanup closes uploaded files, including exception paths. This is not a claim that no bytes can ever touch disk. In connected mode, Google receives selected content; local resource cleanup does not control Google's retention or data-use terms. Re-encoding removes embedded image metadata, not visible sensitive text.

URLs are parsed locally without DNS or network requests. Localhost/local names, IP literal destinations, and embedded credentials are rejected. Public observations include only sanitized origins containing scheme, host, and optional port. Query tokens, paths, and fragments are omitted. Exact hosts remain distinct; public-suffix normalization and campaign linkage are not implemented. Model quotes, raw claims/uncertainty text, and extracted identities stay outside public response contracts.

The recommended Uvicorn command disables access logging. Provider failure logs contain only bounded status codes or allowlisted exception classifications, without raw exception messages, submitted content, credentials, or traceback details. API errors omit raw inputs and provider details, and responses are marked `no-store`. A check ID or request ID contains no submitted content.

## Deployment and later work

Only `APP_ENV=development` or `test` is accepted. Fixture mode needs no credentials. Connected mode requires an explicit model and server-side key; missing configuration fails startup. Bad provider output, timeout, and failure return scrubbed errors rather than mocked fallback. The application closes its owned SDK client during lifespan shutdown. See [Gemini setup](gemini.md) for configuration and validation details.

This localhost server is not a public deployment. Proxy concurrency limits, slow-client protection, authentication, abuse rate limits, report moderation, retention/withdrawal controls, and provider data-use disclosures need implementation before public use. Request byte limits alone do not provide these controls.

Milestone 3 source implements manual PhotosPicker/text/URL intake and one-item
Share Extension intake, with explicit preview and Analyze privately before any
request. The common client always uses the private-check contract, bounds uploads
and responses, refuses redirects, and uses ephemeral sessions without cookie or
credential storage. Common image preparation re-encodes selected pixels and omits
source metadata. The containing app clears state on dismissal/backgrounding.
The extension cancels work on backgrounding and clears state on closing;
cancelling analysis retains the preview for retry. Operation guards suppress stale
results. Results show fixture/provider provenance and uncertainty;
community reporting and lookup are truthfully unavailable.

Development configuration uses iOS 17+, app ID `com.osmantaka.ravel`, extension
ID `com.osmantaka.ravel.share`, and results directly in the extension. No App
Group or shared persisted inbox is implemented. The ignored local
`ios/Configuration/Developer.xcconfig` supplies signing and the Debug backend
address across targets; the generator preserves it. The checked-in example uses
`localhost:8001`. Release overrides the address to empty and requires HTTPS before
use. Xcode 26.6 (build 17F113) is installed and selected. Renamed project
creation, unsigned generic-iOS app/extension/test-host builds, UI-test compilation,
and the signed physical-iPhone app/extension build pass. Built app/extension
plists confirm Ravel display names, new bundle IDs, and the Debug LAN Gemini
address on port 8001. The initial installation reached the free-profile
three-app limit. The user approved removing the old UI test runner; removal,
signed Ravel installation, and app launch succeeded on the physical iPhone.
The embedded extension is built and signed; the user has now confirmed a
successful private Photos Share check on the physical iPhone. New device UI
checks and direct test-host text/URL sharing remain pending. [iOS setup](../ios/README.md) supplies them.
Milestone 3 is not yet complete.

The backends were restarted from the renamed repository. Gemini on port 8001
and fixture mode on port 8002 pass all four localhost/LAN health checks. The
initial device retry exposed `RESOURCE_EXHAUSTED` on `gemini-3.8-flash`; the
local `.env` and running server now use `gemini-3.5-flash-lite`, after which the
synthetic Photos Share analysis succeeded. The sanitized device result is in
`docs/artifacts/ios-gemini-share-acceptance.json`.

Milestone 4 (Tiger Data reporting and matching) is deferred. Milestone 5's completed
bounded reviewed slice adds Photon cloud DMs for user-sent text/link checks. It calls `/v1/check`
without a database, report writes, attachment downloads, or local Messages access.
See [Photon setup](../photon-agent/README.md) for adapter and account verification.

The expanded Photon adapter compiles and passes 420 offline tests. Its real TypeScript
HTTP client passes three synthetic fixture-server checks; the
[sanitized HTTP proof](artifacts/photon-backend-smoke.json) records categories and
private-check guarantees without submitted text or addresses. Read-only account
verification confirms authenticated active Pro/shared iMessage. SDK 12.10.1's
metadata getters omit authorization, so the verifier attaches authentication only
to the configured project's official routes. The live project record also lacks
the SDK's declared `id` field.

Two separately approved outbound tests received validated provider acknowledgements,
and the user confirmed receipt on both phones. A later bounded owner-filtered
receive-only window verified one fresh matching marker and closed with zero sends.
The earlier no-marker window and permission failures remain historical diagnostic
evidence, not the current receipt result. See the
[sanitized Photon record](artifacts/photon-validation.json).

`scripts/review_photon_message.mjs` provides the general reviewed one-message
flow. Default invocation previews the selected E.164 sender and processing
disclosure without credentials or network. Explicit `--listen` for a ready user
receives one fresh bounded plaintext message from that sender's sole DM within
60 seconds. It rejects unrelated, outbound, automatic, system, service, corrupt,
attachment, and multi-part events. Both stream and client must close successfully
before any backend call; cleanup failure prevents analysis. Cancellation propagates
through receipt, cleanup, and the private RavelClient request and suppresses stale
previews. Selected raw text stays in ephemeral memory and is not echoed into the
formatted reply.

The generic receiver permits only the exact native iMessage URL-preview bundle
with entire trimmed, well-formed HTTP(S) URL text of at most 2,048 Unicode scalars,
no credentials, control/format characters, or backslashes, and no attachments,
mini-app, or multipart content. All sender/chat/freshness/inbound guards remain;
the fixed marker/input helpers keep stricter metadata checks. Sanitized live
rejection diagnostics identified that native preview metadata as the earlier
URL exclusion cause. Those rejected attempts made zero backend checks and sends.
Diagnostics contain fixed reason codes, counts, and shape classifications without
raw text, addresses, identifiers, or raw metadata. The subsequent live native-URL
retry passed: one fresh message, zero rejections, full stream closure before one
local backend URL check, and `insufficient_evidence` with no indicators, false
fraud/threat/report flags, and zero related reports. Configured backend mode was
`gemini`, but this URL-only check made zero Gemini and destination calls. The
review CLI sent zero messages. A separately approved exact URL reply received a
validated SDK acknowledgement from one logical send, and the user confirmed
handset receipt. The native-URL roundtrip is verified and that approval is
consumed. The [native-URL roundtrip proof](artifacts/photon-url-round-trip.json)
records this separate live case. General ordinary-text and command branches remain
offline-tested; live text evidence comes from the earlier fixed synthetic ticket
helper.

Ordinary text uses Gemini; a standalone HTTP(S) URL is parsed by the backend
without opening it or calling Gemini. Exact `/help`, `/privacy`, and `/report`
commands preview fixed explanations with zero backend checks; reporting remains
unavailable. Commands, URL limitations, and assessment copy use the same reviewed
send allowlist. The general CLI always sends zero messages and passes offline
tests. Live native-URL receipt/check/preview, separately approved send, and handset
receipt are verified.

`scripts/check_photon_test.mjs` defaults to an offline preview of its exact fixed
synthetic input and selected sender. When explicitly started for a ready user,
it listens only to that sender's DM for at most 60 seconds. It closes the stream
before one private RavelClient backend check, requires validated Gemini mode and
unverified provenance with false fraud/threat/report flags and zero report count,
and previews the actual formatted reply and recipient. It never sends a message.
The controlled live receipt-to-Gemini-preview path passed: one exact synthetic
offer was received, the stream closed, and one private Gemini backend check
returned `suspicious_verify` with `advance_fee` and `urgency` indicators. Fraud,
threat, and report flags were false, related-report count was zero, and the
script sent zero messages.

`scripts/send_photon_reply.mjs` separately previews the exact recipient/body
without connecting. It accepts only fixed formatter output, and `--send` requires
`--approval-sha256` matching SHA-256 of the UTF-8 JSON array `[recipient, message]`.
This binds the reviewed values; it does not replace fresh human approval. An
approved invocation makes one logical send without a listener or application
retry. Provider acknowledgement is distinct from handset receipt. Assessment
reply delivery is now verified for one controlled synthetic case. Its
disconnected preview verified the recipient/body hash binding; the user then
approved the exact destination and full reply. One logical send returned
`reply_send_accepted` with a validated SDK acknowledgement and `messages_sent: 1`.
The user explicitly confirmed handset receipt. That approval is consumed;
further sends require fresh approval, and the unattended runner remains disabled.
Milestone 5's bounded reviewed text-and-URL slice is complete. A separate live
benign account-safety control was received from the owner's assigned Texts on
route. Its first backend attempt returned `service_unavailable`; after the user
approved one retry of the same synthetic text, Gemini returned
`insufficient_evidence` with no supported indicators, no report, and no verified
threat. The user approved the exact reply and confirmed handset receipt after one
logical send. See the [sanitized benign-control proof](artifacts/photon-benign-control-round-trip.json).
Milestone 6 still covers remaining demo preparation, failure handling, and a
backup demonstration alongside manual Photos acceptance. These cases do not
establish general accuracy or unattended operation; Photon screenshot support remains future work. The
[fixed synthetic roundtrip proof](artifacts/photon-gemini-round-trip.json) records
that separate live case. [Controlled demo steps](demo-script.md) explain
the sequence and personal-handle versus assigned-line routing.

### Milestone 6 account-secret controls (implemented; live validation pending)

The additive nullable fields are `credentials_requested`,
`verification_code_requested`, and `account_threat_indicated`; corresponding
indicator codes are `credential_request`, `verification_code_request`, and
`account_threat`. Affirmative Gemini flags require supporting quoted evidence;
text quotes must occur in the submitted text, while image quotes remain unverified
model inferences. Secret/code values and evidence quotes are not public fields.
Missing new public fields default to `null` in backend, Swift, and Photon
contracts; existing category enums and private-check invariants are unchanged.
See [API definitions](api.md) for precise field/control boundaries.

`scripts/verify_gemini_coverage.py` defaults to ten labeled fixture controls and
passes 10/10 with zero provider requests. Explicit `--live` attempts seven text
and two image generations plus one local-only URL control, without retries,
destination requests, preview downloads, or Photon sends. The fixture proof is
`docs/artifacts/gemini-coverage-fixture.json`; the separate live proof is
`docs/artifacts/gemini-coverage-live.json`. The first expanded live attempt hit a
truthful provider timeout on its first text; the [timeout record](artifacts/gemini-coverage-timeout.json)
preserves that attempt. The subsequent live run passed all ten synthetic controls
with nine Gemini generations and one local-only URL check. For exactly
`gemini-3.8-flash` and its `models/` variant, the adapter sets the documented
`thinking_level="low"`; other models retain provider defaults and the selected
model/environment are unchanged. Ten actual SDK wire tests verify this narrow
setting. This adapter setting does not explain that earlier timeout; a separate
later quota diagnostic and model switch are documented in [Gemini setup](gemini.md).
[Official thinking documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking).
These bounded controls do not establish general phishing accuracy or calibration.
Manual Photos sharing and the offline failure demonstration are verified. The
backup recording remains pending. One live benign Photon control is verified but does not validate
account-secret detection or general accuracy; see the
[sanitized proof](artifacts/photon-benign-control-round-trip.json). Milestone 6
is in progress.

Malformed extraction remains a separate provider error. Missing evidence spans,
quote mismatches, unsupported URLs, missing fields, and incomplete generation can
all produce `provider_invalid_output`; the first user image failure has no
confirmed cause. Fixed diagnostic reason codes would aid debugging without
retaining provider text or weakening strict validation. Token-budget/thinking
changes require model-specific verification and do not establish a diagnosis.

## Verified results

The expanded backend passes 216 pytest cases and clean Ruff lint/format checks on Python 3.13. Tests include actual Google SDK serialization through mocked HTTP transport for text/images, nullable-field compatibility, account-secret positive/benign controls, strict response parsing, sanitized observations, provider failure handling, and log-redaction regressions. Default coverage verification passes all ten fixture controls. Earlier local HTTP smoke checks verify health, text, multipart screenshot, and URL routes in fixture mode; provider-backed expanded coverage remains separate.

At `2026-10-10T21:56:08.600358+00:00`, fresh live verification passed synthetic text and screenshot checks through an in-process FastAPI test client using real Google requests, `gemini-3.8-flash`, and SDK 2.29.0. Both checks returned HTTP 200, `suspicious_verify`, and extracted ticket, payment, urgency, and `https://tickets.example` observations. Both returned `report_created: false`, zero report count, and false verified fraud/threat fields. The [sanitized proof](artifacts/gemini-live-verification.json) records the final two successful provider requests; it does not cover separate diagnostics or phone checks.

Separate HTTP smoke checks also passed against the running local backend at <http://127.0.0.1:8001/docs>. Health reports `mode: "gemini"`; synthetic text and multipart image checks returned HTTP 200 using real Google extraction and preserved false verified fraud/threat/report flags with zero report count. URL-only input returned HTTP 200 with `not_analyzed` observations and no Google call. The proof artifact covers only its two in-process provider requests, not these additional HTTP checks.

These backend checks verify the configured extraction path on synthetic examples. They do not establish general detection accuracy, calibrated fraud probabilities, or model robustness against all injected instructions.

During the rebrand, all 17 RavelCore XCTest tests passed. Unsigned generic-iOS
builds of Ravel, its embedded extension, and RavelShareTestHost pass, and
RavelTests compiles with `build-for-testing`. The signed physical-iPhone
Ravel app/extension build passes. Built plists confirm display names, new bundle
IDs, and the Debug LAN Gemini backend address on port 8001. Approved removal
of the old UI test runner resolved the free-profile three-app installation
limit. Signed Ravel installed and launched successfully on the physical iPhone.
The embedded extension is built and signed. No new device UI test, runtime
Share-flow acceptance, or provider analysis occurred in these rebrand checks;
no simulator is running. The [rebrand record](artifacts/ravel-rebrand-validation.json)
records these fresh results.

The subsequent account-secret extension passes all 20 current RavelCore tests and
updated unsigned app/extension builds. Nullable new flags and older-response
decoding are covered. The updated signed app/extension build and physical-phone
installation also succeeded. Manual runtime and Photos Share acceptance remain
pending; those are separate from the earlier signed rebrand result.

The earlier ImageIO, standalone client runtime, and simulator SDK checks passed
before the rename. Previous signed-device installation and user-confirmed Share
availability/image assessment also precede the rename. The historical URL UI
test passed; four other synthetic UI cases remain unresolved after missing-element
and UI-authorization failures. The successful image's exact entry point (Photos
Share versus in-app picker) remains unconfirmed. No raw user content was captured.

Six UI tests are implemented. The Photos test skips on physical devices, with
its automated selection body compiled only for the simulator. The user must
select a synthetic screenshot manually to validate Photos sharing. No passing
full UI suite or completed Photos-flow acceptance is claimed. Builds and SDK
checks do not replace runtime acceptance. The [sanitized iOS record](artifacts/ios-source-validation.json)
tracks validation evidence and remaining limits.

`backend/requirements.lock` records the tested application/development dependency
snapshot. It does not contain secrets or machine-specific editable-package paths.

## Implementation references

Multipart field handling follows the [FastAPI request-file documentation](https://fastapi.tiangolo.com/tutorial/request-files/) and [Starlette request documentation](https://www.starlette.io/requests/), including uploaded-file lifecycle and form parsing. Image validation considers the [Pillow security documentation](https://pillow.readthedocs.io/en/stable/handbook/security.html), including decompression risks and decoded image limits. These references support the local implementation; they do not establish live vendor integrations.

# Ravel

Ravel checks deliberately shared screenshots, messages, and links on iPhone. The user-approved competition focus is **Gemini + Photon**: native iPhone checks and an iMessage entry point using the same backend. Tiger Data and community reporting are deferred. [RAVEL_CONTEXT.md](RAVEL_CONTEXT.md) is the product specification.

**Milestones 0–2 implement a local FastAPI backend with a default fixture mode and an optional Gemini extraction adapter.** Fixture mode runs without accounts, paid keys, or a database. Responses identify `mode: "fixture"` or `"gemini"`; extracted claims remain unverified and do not establish fraud.

Implemented:

- `GET /health`, JSON text/URL checks, and multipart PNG/JPEG checks.
- Strict request/response models, bounded inputs, safe URL parsing, and replaceable extraction adapters.
- Synthetic `.example` fixtures, conservative assessments, and privacy/validation tests.
- Gemini text/image extraction with strict structured-output validation, sanitized public observations, and truthful provider errors.
- Milestone 6 account-secret observations: credential/code-sharing requests and
  account-access threats, with conservative policy and benign controls. Categories
  remain unchanged and updated clients interpret missing additive flags as `null`.
- Typed opt-in report contracts. Report persistence and campaign lookup remain unavailable and return `503`.
- Milestone 3 iOS source: SwiftUI app, Share Extension, shared private-check client,
  image preparation, and a synthetic Share menu test host. Current RavelCore's
  20 tests and updated unsigned app/extension builds pass. Earlier renamed
  test-host/UI-target compilation and signed Ravel iPhone builds also pass. Ravel was
  installed and launched during the rebrand after approved removal of the
  old UI test runner resolved the free-profile app limit. New UI and Share-flow
  acceptance remain pending. The updated coverage build is signed and installed;
  its manual runtime checks remain pending. See
  [iOS setup](ios/README.md).
- Photon TypeScript private-check adapter: bounded text/URL HTTP client, strict
  response validation, conservative reply formatting, DM filtering, duplicate and
  rate guards, and a credential-free offline demo. Controlled scripts separate
  receipt/analysis/reply preview from a human-approved send; unattended replies
  remain disabled.

The expanded Photon adapter builds and passes 420 offline tests. Its actual TypeScript
client also passed three synthetic fixture-server checks. Read-only account
verification confirms active Pro/shared iMessage routing. Two separately approved
outbound tests received provider acknowledgements, and the user confirmed receipt
on both phones. A fresh owner-filtered receive-only test also verified one inbound
marker and closed with zero sends.

A controlled live check received the exact synthetic ticket offer, closed the
stream, performed one private Gemini backend check, and previewed the actual
formatted reply. It returned `suspicious_verify` with advance-fee and urgency
indicators, false fraud/threat/report flags, zero related reports, and zero
messages sent. The separate offline send preview verified the recipient/body
hash binding. The user approved the exact recipient and full assessment reply;
one logical send received a validated SDK acknowledgement, and the user confirmed
receipt on the owner's phone. The reviewed synthetic text roundtrip is verified.

`scripts/review_photon_message.mjs` now supports one arbitrary fresh bounded
plaintext DM, standalone HTTP(S) links, and fixed `/help`, `/privacy`, and `/report`
commands. Its default is an offline disclosure preview. For a ready selected
sender, `--listen` accepts one message in a 60-second window and fully closes the
stream/client before backend work. Text uses Gemini, URL-only checks parse
locally without visiting the destination or calling Gemini, and commands use
fixed copy without a backend call. Cancellation propagates through receipt and
analysis. A known native iMessage URL preview is accepted only when its text is
one bounded valid HTTP(S) URL with no attachments, mini-app, or multipart content;
all sender, chat, freshness, and message guards remain in force. Sanitized
rejection diagnostics identified that preview metadata as the earlier exclusion
cause; those attempts made zero backend checks and sends. The general CLI sends
nothing and has passed offline tests. A subsequent live native-URL retry received
one fresh message with zero rejections, closed the stream, and performed one local
backend URL check. It returned `insufficient_evidence`, no indicators, false
fraud/threat/report flags, and zero related reports, with no Gemini or destination
calls. The user separately approved the exact URL reply; one logical send received
a validated SDK acknowledgement, and the user confirmed handset receipt. The
native-URL roundtrip is verified and that approval is consumed. The general
ordinary-text and command branches remain offline-tested; live text evidence
comes from the earlier fixed synthetic ticket helper.

The live evidence covers controlled synthetic text and URL cases; it does not
establish general accuracy or unattended operation. **Milestone 5's bounded
reviewed text-and-URL slice is complete.** Milestone 6 covers demo preparation,
benign controls, failure handling, and a backup demonstration; Photon screenshot
support remains future work. Each further send requires fresh approval, and
the unattended runner remains disabled. The SHA-256 binding does not replace
human approval.
[Controlled demo steps](docs/demo-script.md), [Photon setup](photon-agent/README.md),
and the [sanitized record](docs/artifacts/photon-validation.json) distinguish
these stages. The [fixed synthetic roundtrip proof](docs/artifacts/photon-gemini-round-trip.json)
records the acknowledged, user-received assessment reply. The [native-URL roundtrip
proof](docs/artifacts/photon-url-round-trip.json) records the separate local-check
reply and confirmed receipt. Earlier permission
failures remain in the [diagnostic history](docs/photon-permission-troubleshooting.md).

There is no background scanning, live reputation lookup, or report database.
Synthetic text and screenshot verification passed through an in-process FastAPI
test client with `gemini-3.8-flash` and SDK 2.29.0 on 2026-10-10 at 21:56 UTC.
[Sanitized Gemini proof](docs/artifacts/gemini-live-verification.json) records the
final two successful Google requests and private-check guarantees, separately
from diagnostics and phone checks. Running-server HTTP smoke checks also passed.

## Run locally

Use Python **3.12 or newer**; the initial development environment uses Python 3.13. Run from the repository root:

```sh
cd /Users/osmantaka/Downloads/ravel_codex
python3 --version
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
.venv/bin/python -m pip install --no-deps -e './backend[dev]'
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

The lock file pins the application and development dependencies. Alternatively, `.venv/bin/python -m pip install -e './backend[dev]'` installs compatible versions directly from `backend/pyproject.toml`.

Configuration is optional for fixture mode. Copy `.env.example` to `.env` in the repository root to customize it; process environment variables take precedence. `APP_ENV` supports `development` or `test` only. Fixture mode defaults to `RAVEL_FIXTURE_MODE=true`.

For connected Gemini mode, set `RAVEL_FIXTURE_MODE=false`, a server-side `GEMINI_API_KEY`, an explicit `GEMINI_MODEL`, and optionally `GEMINI_TIMEOUT_SECONDS` (default 30, greater than zero and at most 120). Missing credentials/model fail startup; provider failures never fall back to fixture results. See [Gemini setup and data handling](docs/gemini.md) before enabling it.

Interactive API documentation is available at <http://127.0.0.1:8000/docs>. Keep this server local; access logging is disabled in the run command to avoid content-bearing request paths in logs.

If port 8000 is occupied, use `--port 8001` and update the URLs below.

The backends were restarted from the renamed repository. Gemini mode runs on
port 8001 and fixture mode on port 8002; health checks pass over both localhost
and the private LAN interface. Local Gemini API documentation is at
<http://127.0.0.1:8001/docs>. Earlier synthetic text and multipart screenshot
checks returned HTTP 200 with real Google extraction and no report creation.
URL-only checks returned HTTP 200 with `not_analyzed` observations and no Google
call. Ravel was installed and launched during the rebrand with the LAN Gemini backend configured;
renewed handset analysis and Share-flow checks remain pending.

## Try the fixtures

For deterministic fixture results, set `RAVEL_FIXTURE_MODE=true` and restart the backend first. `source_channel=fixture` labels the submitted source; it does not select a provider or override the server's configured mode. Then run in another terminal from the repository root:

```sh
curl -sS http://127.0.0.1:8000/health

curl -sS http://127.0.0.1:8000/v1/check \
  -H 'Content-Type: application/json' \
  --data '{"content_type":"text","text":"Free concert tickets. Pay a $20 transfer fee before delivery: https://tickets.example/offer","source_channel":"fixture","privacy_mode":"private_check"}'

curl -sS http://127.0.0.1:8000/v1/check \
  -F 'image=@backend/app/fixtures/ticket_offer.png;type=image/png' \
  -F 'content_type=image' \
  -F 'source_channel=fixture' \
  -F 'privacy_mode=private_check'

curl -sS http://127.0.0.1:8000/v1/check \
  -H 'Content-Type: application/json' \
  --data '{"content_type":"url","url":"https://campus.example/events","source_channel":"fixture"}'
```

The ticket example should return `suspicious_verify` with `verified_fraud: false`, `known_threat: false`, `related_report_count: 0`, and `report_created: false`. An unfamiliar URL returns `insufficient_evidence`; missing evidence never establishes safety.

In fixture mode, image understanding uses hashes of bundled synthetic images to replay known observations. Other valid images return a limited assessment. Fixture inputs are not sent to Google. Image fixture indicators identify `fixture_provider` as their evidence source.

In connected mode, text and metadata-stripped, re-encoded images are sent to Gemini for extraction. Indicators identify `gemini` / `unverified_inference`, and public observations expose controlled fields and sanitized URL origins rather than model quotes or identities. URL-only checks remain local parsing and never call Gemini, even when the configured mode is `gemini`.

## Verify

```sh
.venv/bin/python -m pytest backend/tests
.venv/bin/python -m ruff check --config backend/pyproject.toml backend scripts
.venv/bin/python scripts/verify_gemini_coverage.py
```

The backend suite passes 216 tests, with Ruff checks clean. It covers backend contracts, input safety, fixture behavior, mocked Gemini SDK calls, secret/code-sharing and account-threat controls, invalid provider output, timeouts, log redaction, and the invariant that private checks create no reports. The coverage verifier passes all ten fixture controls with zero provider requests; explicit `--live` attempts nine synthetic Google generations plus one local-only URL check. The first expanded live attempt timed out. A later run completed nine generations but missed three expected outcomes: account-threat payment was described as an advance fee, and benign code-delivery and ordinary sign-in controls requested human review. Account-threat payments now remain generic payment requests even if Gemini supplies an advance-fee reason. Successful live coverage and benign-control validation remain pending. Earlier live ticket text and image checks verified real Google extraction with `report_created: false`; those historical checks do not validate the new controls or establish representative accuracy. See [Gemini verification and diagnostics](docs/gemini.md).

During the rebrand, RavelCore's 17 XCTest tests passed. Xcode 26.6 generated the
project, built the renamed app, embedded extension, and test host for unsigned
generic iOS, and compiled RavelTests with `build-for-testing`. The signed Ravel
app/extension build also passed for the physical iPhone. Built plists verified the
Ravel display name, new bundle IDs, and Debug LAN Gemini address on port 8001.
The first installation reached the free-profile three-app limit. The user
approved removing the old UI test runner; that removal succeeded, and signed
Ravel installed and launched successfully on the physical iPhone. The embedded
extension is built and signed. No new device UI test, Share-flow acceptance, or
provider analysis was performed in this rebrand verification.

For the account-secret extension, all 20 current RavelCore tests and updated
unsigned app/extension builds pass. They verify additive nullable fields and
older-response compatibility. The updated signed app/extension build and physical
installation also succeeded. Manual runtime and Photos Share acceptance remain
pending; the earlier rebrand tests are separate historical evidence.

Before the rename, exactly one physical-device fixture URL UI test passed and
four other synthetic UI cases failed with missing elements or UI authorization
errors. The user also confirmed Share menu availability and a successful Gemini
image assessment, whose exact entry point remains unconfirmed. These are
historical results for the previous app identity. The Photos test's automation
is disabled on physical devices; manual Photos-flow acceptance remains pending.
No simulator is running. Builds do not replace runtime acceptance; see
[iOS validation](ios/README.md).

## Structure and privacy

`backend/app/schemas` defines shared contracts; `backend/app/services` separates ingestion, extraction, and assessment; `backend/app/fixtures` contains synthetic examples; `backend/tests` verifies behavior. `ios` contains the native client source and its shared Swift package; `photon-agent` is the Spectrum integration boundary; `infra` reserves deferred infrastructure. [API details](docs/api.md), [Gemini setup](docs/gemini.md), and [implementation notes](docs/implementation-notes.md) describe current limits and deferred work.

A private `/v1/check` processes only the submitted item and cannot create a report. Raw text and images are not saved as application data. Processing uses ephemeral request memory; the multipart library may spool uploads to a temporary file that is closed during request cleanup. In connected mode, Google also processes the selected content under its applicable provider terms; application cleanup does not control Google retention. The current report endpoint never persists even an explicitly consented submission.

**Current: Milestone 3 in progress**, native iOS app and the Share Extension. Development
defaults are iOS 17+, `com.osmantaka.ravel`, and results inside the extension
without an App Group. Local signing and Debug backend settings live in the ignored
`ios/Configuration/Developer.xcconfig`, which the generator preserves. Its example
uses `localhost:8001`; Release remains unconfigured. Renamed unsigned and signed
app/extension builds, physical installation, and app launch pass after approved
removal of the old UI test runner resolved the free-profile app limit. UI and
Photos-flow acceptance for the renamed app remain required.
[Setup and exact checks](ios/README.md) document them.
**Current: Milestone 5's bounded reviewed text-and-URL slice is complete; Milestone 6 is in progress**, alongside remaining iOS Photos acceptance. The earlier synthetic text → Gemini → assessment-reply and native-URL → local-check → reply roundtrips are verified on the owner's phone. The policy now covers supported password/PIN and authentication/reset-code sharing requests, account threats combined with payment, advance fees, and payment plus urgency. Account threats or urgency alone, ordinary sign-in, code-delivery notices, and never-share warnings remain insufficient evidence. Unclear/conflicting model evidence requests human review; these controls do not establish general phishing accuracy. [API definitions](docs/api.md), [Photon setup](photon-agent/README.md), and the [Gemini + Photon demo](docs/gemini-photon-demo.md) describe the boundaries. Tiger Data reporting (Milestone 4) remains deferred.

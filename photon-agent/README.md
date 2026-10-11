# Ravel Photon cloud agent

This Node 22 TypeScript adapter handles newly received direct messages on a Photon
Spectrum cloud project. It submits explicitly sent text or a complete HTTP(S) URL
to Ravel's `/v1/check` endpoint with `source_channel=photon_imessage` and
`privacy_mode=private_check`. Replies use validated API categories and fixed
tactic descriptions. There is no second model generating a verdict.

Text in a connected backend uses Gemini for unverified observations. A URL alone
is parsed locally: its destination is never fetched or sent to Gemini, and no
reputation lookup occurs. Paste the accompanying message for useful context.
Missing evidence does not establish safety, and AI observations do not establish
fraud. Community reporting, storage, matching, and Tiger Data are deferred.

## Build, test, and offline demo

From `photon-agent/`:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run demo
```

The demo uses fixed synthetic `.example` inputs and visibly labels its fixture
replies. It also shows a clearly labeled simulated provider timeout and the
agent's truthful retry message. It loads no environment files and makes no
Photon, backend, or Gemini requests. Tests inject HTTP transports and event
handlers; they do not verify live message receipt or delivery. The expanded
suite passes 423 offline tests.

## Configuration

Obtain the project ID and secret from the Photon dashboard. Configure them only
in the ignored repository `.env` or ignored `photon-agent/.env`; keep secrets out
of `.env.example`.

```dotenv
SPECTRUM_PROJECT_ID=
SPECTRUM_PROJECT_SECRET=
RAVEL_API_BASE_URL=http://127.0.0.1:8001
RAVEL_ALLOW_LOCAL_HTTP=true
RAVEL_CHECK_TIMEOUT_SECONDS=45
```

Process variables override the agent `.env`, which overrides the root `.env`.
Only these configuration values are returned to the agent. HTTPS is required
except for explicitly enabled localhost, loopback, or private LAN HTTP servers.
Base URLs cannot include credentials, query, or fragment. Backend checks default
to a 45-second timeout, bounded to at most 120 seconds.

The cloud agent may run beside the backend and reach it on localhost; this stream
setup does not require a public backend URL. Cloud HTTP credentials stay on the
official endpoint with redirects disabled. Arbitrary cloud endpoint environment
overrides are disabled. SDK logging and telemetry are off. Operational/error
status output uses fixed codes and bounded diagnostics, without provider bodies,
raw private content, project identifiers, or secrets. Controlled preview CLIs
intentionally display the selected recipient, fixed synthetic input, and formatted
reply for human review; keep that review output private.

## Bounded live demo session

The user approved real automatic replies to their own registered sender for a
demo. From `photon-agent/`, start the cloud listener with the owner's own E.164
number (not the Photon-managed **Texts on** number):

```sh
npm start -- --live --sender +12025550123
```

Replace the example with the owner's registered number. The session accepts only
fresh direct messages whose sender and chat both match that number, then stops
after 30 minutes or 20 accepted messages. Ctrl-C stops it sooner. Other senders,
groups, stale messages, and unsupported event types are ignored. Do not run this
for another user's number or leave it running unattended.

Ordinary message text goes through the live `/v1/check` backend and Gemini; the
reply is derived from the validated check result, not a canned demo response.
Standalone URLs are parsed locally and do not call Gemini. The backend must report
`mode: gemini` at `/health`; fixture mode is not acceptable for this live demo.
No reports are created. Keep the Mac, backend, and Photon process running; on a
check or cloud failure the agent sends a truthful fixed failure message rather
than substituting a fixture result. A Photon send acknowledgement is not proof
of handset delivery; confirm receipt on the phone.

The bounded automatic-response path has passed one benign and one suspicious
synthetic text check through Gemini, both with user-confirmed handset receipt.
See the sanitized [benign](../docs/artifacts/photon-auto-reply-benign-control.json)
and [suspicious](../docs/artifacts/photon-auto-reply-suspicious-control.json)
records. These controls do not establish general accuracy.

This narrow, time-limited approval does not authorize sends to other recipients,
long-running unattended service, or a different reply flow. The preview/send
scripts remain separate tools requiring fresh approval of their exact destination
and full body.

The root read-only verification script checks project authentication and account
metadata without issuing message tokens or sending. The
[cloud provider guide](https://photon.codes/docs/spectrum-ts/providers/imessage)
and [routing guide](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing)
describe account setup and shared/dedicated line selection. No paid line purchase
or upgrade is part of this slice.

## Receive-only routing diagnostic

From the repository root, preview a controlled receipt check:

```sh
node scripts/receive_photon_test.mjs --sender +12025550123
```

Replace the synthetic sender with the selected registered user's own number.
Preview loads no credentials and opens no connection. Add `--listen` only when
that user is ready to deliberately send `Ravel receive test 01` to the
matching **Texts on** line in Users. Shared routing varies by user; the line
displayed on Platforms may differ from that user's route.

The observer requests only that DM's live message-event stream through the
direct Advanced iMessage client. It makes no send, read-receipt, typing,
contact-sharing, attachment, history, backend, or Gemini calls. It stops after
one fresh matching inbound text, 60 seconds, cancellation, or a provider error.
Live output contains only fixed statuses and counts. A subscription request
alone does not establish readiness; `receive_stream_heartbeat_observed`
indicates that the server has emitted a heartbeat. `fresh_marker_received`
confirms receipt of the controlled marker, without implying reply delivery.
This diagnostic does not enable the unattended reply runner.

## Review one new message, then approve its reply

Build local TypeScript output first. From the repository root, preview the general
review workflow without loading credentials or making network requests:

```sh
npm --prefix photon-agent run build
node scripts/review_photon_message.mjs --sender +12025550123
```

The example number is synthetic. Replace it with the selected registered user's
own E.164 iMessage phone number, not the Photon-managed line. These CLIs accept
phone handles only. The user sends their deliberately selected message to their
own **Texts on** line in project Users; shared routing can vary across users.
Explain the previewed processing disclosure before connecting: selected text
passes through Photon, the backend, and Google Gemini; standalone links are
parsed locally, and no other chats or community reports are involved.

Add `--listen` only after the selected user is ready. The CLI accepts at most one
fresh bounded plaintext message from that user's single DM within 60 seconds.
It excludes unrelated, outbound, automatic, system, service, corrupt, attachment,
and multi-part events. The stream and client must fully close before backend
work; cleanup failure prevents analysis. Cancellation propagates to receipt and
the backend check and prevents stale previews. The workflow passes offline tests;
its native-URL receipt, local check, preview, separately approved send, and handset
receipt are verified. The general ordinary-text and command branches remain
offline-tested; live text evidence comes from the earlier fixed synthetic ticket
helper.

Generic intake also accepts the known native iMessage URL-preview bundle only
when the entire trimmed text is a valid HTTP(S) URL of at most 2,048 Unicode
scalars, without credentials, control/format characters, or backslashes. The
same sender, single-DM, freshness, ordinary-inbound, attachment, mini-app, and
single-part checks still apply; no preview content or destination is fetched.
Exact marker and fixed-input diagnostics retain their stricter metadata guards.
Sanitized rejection diagnostics identified native preview metadata as the prior
URL exclusion cause, with no backend checks or sends. Diagnostics expose fixed
reason codes, counts, and shape classifications rather than message text,
addresses, identifiers, or raw metadata. A subsequent live retry accepted one
fresh native-URL message with zero rejections, closed the stream, and performed
one local backend check: `insufficient_evidence`, no indicators, false
fraud/threat/report flags, and zero related reports. It made no Gemini or
destination calls and sent zero messages. After fresh approval of the exact
recipient/full URL reply, one separate logical send received a validated SDK
acknowledgement, and the user confirmed handset receipt. The native-URL roundtrip
is verified and that approval is consumed. [Native-URL roundtrip
proof](../docs/artifacts/photon-url-round-trip.json) records the separate live case.

- Ordinary text, including text with an accompanying link, uses one private
  Gemini backend check and produces an unverified evidence assessment.
- A standalone HTTP(S) link uses one local parsing check. The destination is
  never visited or sent to Gemini; no reputation service is used.
- Exact `/help`, `/privacy`, and `/report` commands produce fixed explanatory
  copy with zero backend checks. Reporting remains unavailable.

Successful output is `reply_preview_ready`, with the selected recipient and
actual `Ravel private check` reply. The CLI sends zero messages. Submitted text,
API prose, model quotes, and URLs are not copied into assessment replies. A
failed receive, cancelled operation, malformed response, or provider error must
remain a truthful failure, without a fixture replacement or forced verdict.

Use `scripts/send_photon_reply.mjs --recipient ... --message ...` with that exact
previewed recipient/body. Its default is a disconnected preview returning
`approval_sha256`. Show the human the exact destination and full text and obtain
fresh approval before using `--send --approval-sha256 ...`. The hash is SHA-256 of
the UTF-8 JSON array `[recipient, message]`; it binds the exact values and does not
constitute human approval. Only fixed assessment, URL-limitation, and command
copy is accepted. An approved invocation makes one logical send, opens no
listener, and validates the acknowledgement. Confirm handset receipt separately;
preserve literal newlines when passing the reviewed body. Every later send needs
fresh approval. The unattended runner remains disabled.

## Verified fixed synthetic roundtrip

The earlier fixed-case helper remains available as a separate preview:

```sh
node scripts/check_photon_test.mjs --sender +12025550123
```

It expects one exact synthetic ticket offer, then closes the receive stream and
performs one private Gemini check. A live controlled case returned
`suspicious_verify` with `advance_fee` and `urgency`, false fraud/threat/report
flags, zero related reports, and zero messages sent by the check helper. The user
then separately approved the exact recipient/full reply. One logical send received
a validated SDK acknowledgement and user-confirmed handset receipt. The approval
is consumed. [Fixed-case proof](../docs/artifacts/photon-gemini-round-trip.json)
verifies that one synthetic text roundtrip; it does not validate the new general
CLI, general accuracy, or unattended operation. See
[reviewed demo steps](../docs/demo-script.md).

## Supported private-check behavior

The updated observation contract accepts nullable `credentials_requested`,
`verification_code_requested`, and `account_threat_indicated`; missing fields in
older responses default to `null`. Formatter reasons use the corresponding
`credential_request`, `verification_code_request`, and `account_threat` codes and
fixed official-contact/secret-sharing guidance. Categories and private-check
invariants stay unchanged. Supported secret-sharing requests or account threats
combined with payment can produce `suspicious_verify`; threat/urgency alone and
ordinary sign-in/code notifications remain insufficient. Unclear/conflicting
Gemini extraction still requests human review. See the [API definitions](../docs/api.md).
Expanded formatter/client tests pass; live control results are recorded separately
from the earlier ticket and URL roundtrips. New live account-secret and benign
Photon coverage is not yet claimed.

The general reviewed CLI receives text, including a bounded standalone URL with
the known native URL-preview metadata described above. Attachments are excluded
without downloading or analysis, and no automatic unsupported-attachment reply
is sent; use the iOS app for screenshots. Other unsupported event types are
ignored. The prepared handler's command and attachment responses are tested
offline, but its unattended runner remains disabled. Neither flow uses macOS
Messages, `chat.db`, chat history, group scanning, report endpoints, or link
fetching. Eligible events are explicit inbound direct messages with timestamps
after startup; outbound, auto-reply, system, and service events are skipped.

The prepared handler's application state contains ephemeral keyed hashes for
duplicate and rate guards, not a report database. Duplicate IDs remain for 10 minutes (maximum 1,000).
Limits are three checks and eight replies per DM per minute, twenty checks per
process per minute, and two hundred per hour. The prepared stream consumes events
serially; the handler also bounds concurrent checks to two. No application retry
or check queue is created. Limits reset on restart and do not replace production
authentication, persistent abuse controls, or billing controls. The SDK manages
its own bounded in-memory recent-message cache and reconnects; provider content
handling follows [Photon's privacy policy](https://photon.codes/privacy-policy)
and [Gemini's API terms](https://ai.google.dev/gemini-api/terms).

The client accepts at most 10,000 Unicode scalars of text, 2,048 of URL, and
128 KiB of response data. It disables redirects, cookies, and HTTP caching;
accepts strict typed private-check responses; and refuses verified-fraud,
known-threat, report-creation, or community-count claims in this scope. Errors
become fixed messages. API summaries, evidence quotes, and URLs are never copied
into replies.

SDK dependencies are locked in `package-lock.json`. SDK 12.10.1 has a conditional
TypeScript declaration mismatch for the cloud provider's config and space types;
the adapter confines an interoperability assertion to that SDK boundary and
validates event shapes before creating a domain event. Application contracts and
HTTP responses retain strict types and runtime validation. Earlier controlled
sends failed with permission errors. Later two separately approved sends received
validated acknowledgements, and the user confirmed receipt on both registered
phones. A fresh owner-filtered receive-only diagnostic then verified one matching
inbound marker and closed with zero sends. These are separate outbound and inbound
checks. The controlled live synthetic-input/Gemini-preview path subsequently
passed with zero sends by the check script. One separately approved assessment
reply then received a validated acknowledgement and user-confirmed handset
receipt. This verifies one controlled synthetic case, not general accuracy or
unattended operation. The general native-URL receipt/backend/preview and separately
approved send acknowledgement and user-confirmed handset receipt are also
verified. Milestone 5's bounded reviewed text-and-URL slice is complete.
Milestone 6 covers demo preparation, benign controls, failure handling, and a
backup demonstration; Photon screenshots remain future work. The approval is
consumed. The automatic runner stays disabled; each further
send requires fresh approval of its exact recipient and text. See
[routing and delivery notes](../docs/photon-permission-troubleshooting.md) and the
[sanitized validation record](../docs/artifacts/photon-validation.json).

References: [Spectrum quickstart](https://photon.codes/docs/spectrum-ts/getting-started)
and [message types](https://photon.codes/docs/spectrum-ts/messages).


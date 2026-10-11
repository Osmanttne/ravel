# Reviewed Ravel Photon demo

The expanded Photon suite passes 420 offline tests. One controlled fixed synthetic
text → Gemini → assessment-reply roundtrip was verified on the owner's phone:
the exact input was received, the stream closed, one private backend check
returned advance-fee/urgency evidence, and a separately approved reply received
a validated acknowledgement and user-confirmed handset receipt. Its approval
is consumed. [Fixed-case proof](artifacts/photon-gemini-round-trip.json), the
[native-URL proof](artifacts/photon-url-round-trip.json), and the
[current validation record](artifacts/photon-validation.json) distinguish that
live result from the general CLI's native-URL receipt/check/preview, which also
passed live. Its exact URL reply was separately approved and received a validated
SDK acknowledgement from one logical send, and the user confirmed handset
receipt. That approval is consumed. The general ordinary-text and command branches
remain offline-tested; live text evidence comes from the fixed synthetic ticket
helper.
Milestone 5's bounded reviewed text-and-URL slice is complete. Milestone 6 covers
expanded account-secret evidence, demo preparation, benign controls, failure
handling, and a backup demonstration; it remains in progress.
General accuracy, unattended operation, and Photon screenshot support
are not established; automatic replies remain disabled.

## Preview the general review workflow

From the repository root:

```sh
npm --prefix photon-agent run build
node scripts/review_photon_message.mjs --sender +12025550123
```

The example number is synthetic. `--sender` identifies the selected registered
user's own E.164 iMessage phone number; these CLIs accept phone handles only.
The destination they text is their Photon-managed **Texts on** line in project
Users, a different role whose route can vary across users. A Platforms number
is not proof of that user's assigned route.

Default output previews the processing disclosure without credentials, network,
or sends. Explain that one deliberately selected message will pass through
Photon and the backend, with ordinary text sent to Google Gemini. Standalone
HTTP(S) links are parsed locally without visiting them or calling Gemini.
No other chats are scanned and no community report is created.

Once the selected user is ready, explicitly add `--listen` with their actual
sender. Start the bounded stream before they send one chosen message. The CLI
accepts one fresh bounded plaintext DM within 60 seconds and excludes unrelated,
outbound, automatic, system, service, corrupt, attachment, and multi-part events.
It requires the stream and client to fully close before any backend request.
Cancellation propagates through receipt and backend work; failed cleanup or
cancellation prevents a stale assessment preview. It never sends a reply.

A known native iMessage URL preview is supported only for one valid standalone
HTTP(S) URL of at most 2,048 Unicode scalars, without credentials, control/format
characters, or backslashes. Sender, chat, freshness, and ordinary-inbound guards
remain unchanged; attachments, mini-apps, and multipart content stay excluded.
No preview content or destination is fetched. Sanitized diagnostics identified
preview metadata as the earlier URL exclusion cause; those attempts made zero
backend checks and sends. A subsequent live retry received one fresh native-URL
message with zero rejections and closed the stream before one local backend
check. It returned `insufficient_evidence`, no indicators, false fraud/threat/report
flags, and zero related reports, with zero Gemini or destination calls. Receipt,
backend preview, approved send acknowledgement, and handset confirmation are
separate verified evidence for this URL case.

## Choose one input

| Input | Processing |
| --- | --- |
| A fresh message, including text with a link | One private Gemini backend check; evidence remains unverified. |
| `https://campus.example/events` alone | Local parsing; no destination visit, Gemini call, or reputation lookup. |
| Exact `/help`, `/privacy`, or `/report` | Fixed copy, zero backend checks; reports remain unavailable. |

Use invented content during development. For a representative synthetic text:

> Free concert tickets. Pay a $20 transfer fee before delivery: https://tickets.example/offer. Act now!

The fixed-case helper `scripts/check_photon_test.mjs` matches exactly that example;
it is separate from general intake. The updated policy also supports requests
to disclose passwords/PINs or authentication/reset codes, and account threats
combined with payment. Threat or urgency alone, ordinary sign-in, code delivery,
and never-share warnings remain insufficient evidence. Unclear/conflicting model
evidence requests human review. This bounded coverage does not establish broad
phishing accuracy. A failed receipt or provider check must remain
a truthful failure; never substitute fixtures or force a suspicious verdict.

## Complete the Milestone 6 controls

The backend passes 216 tests and the updated Swift core passes 20. From the
repository root, verify the ten fixture controls without provider requests:

```sh
.venv/bin/python scripts/verify_gemini_coverage.py
```

The fixture run passes 10/10. Explicit `--live` attempts nine Google generations
(seven texts and two images), plus one URL-only check with zero provider or
destination calls. The latest saved live run on 2026-10-11 completed all nine
generations, but three controls did not meet their expected outcomes: the
account-threat payment was described as an advance fee, and benign code delivery
and ordinary sign-in requested human review. The assessment now treats payments
paired with account threats as generic payment requests, even if Gemini supplies
an advance-fee reason. The benign text cases still need a successful live rerun;
do not report the saved run as a pass. Separate sanitized artifacts are
`docs/artifacts/gemini-coverage-fixture.json` and
`docs/artifacts/gemini-coverage-live.json`. These limited controls cannot establish
general fraud accuracy; see [field definitions](api.md) and [verification](gemini.md).

For device acceptance, deliberately select a synthetic credential-request and
benign-code screenshot through the iPhone picker/Photos Share flow. The updated
app/extension builds unsigned and signed, and is installed; manual runtime and
Photos acceptance remain pending. For the Photon benign control, start a new ready-user receive
window, inspect the actual preview, obtain fresh exact-reply approval, send once,
and separately confirm handset receipt. That live control is still pending.
Show an offline provider failure as a truthful error, and record a backup of the
reviewed demonstration; both presentation checks remain pending.

## Review and approve the actual reply

Successful review outputs `reply_preview_ready`, the recipient, and fixed
formatted assessment, URL-limitations, or command copy with `messages_sent: 0`.
Assessment responses require false fraud/threat/report flags and zero related
reports. Selected raw input, API prose, model quotes, and URLs are not copied
into the assessment reply.

Preview the returned body using `scripts/send_photon_reply.mjs` with `--recipient`
and `--message`, preserving exact text and literal newlines. Default execution
remains disconnected and returns `approval_sha256`. Show the user the actual
destination and full outgoing body and obtain fresh approval. Only afterward
may the caller add `--send --approval-sha256` with that preview hash. The hash is
SHA-256 of the UTF-8 JSON array `[recipient, message]`; it binds the exact values
and does not replace human approval. The send allowlist includes only fixed
assessment, local-URL, and command copy. An approved invocation makes one logical
send without opening a listener.

## Record separate evidence

Confirm provider acknowledgement and then handset receipt separately. Neither a
heartbeat nor an accepted outbound test validates a new general assessment flow.
Record received input type, backend provenance/private flags, exact reply approval,
and handset confirmation as separate sanitized evidence. Every later send needs
fresh approval; keep automatic replies disabled. Do not publish phone numbers,
credentials, message identifiers, or raw user input in shared proof artifacts.

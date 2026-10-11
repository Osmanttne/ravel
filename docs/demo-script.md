# Reviewed Ravel Photon demo

The expanded Photon suite passes 423 offline tests. One controlled fixed synthetic
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
The bounded real-Gemini automatic reply path has passed two synthetic controls
with handset confirmation: benign content returned insufficient evidence, and
a code-request/account-threat message returned suspicious with verification
guidance. Sanitized records: [benign](artifacts/photon-auto-reply-benign-control.json)
and [suspicious](artifacts/photon-auto-reply-suspicious-control.json).
General accuracy and Photon screenshot support are not established. For a live
demo, use the bounded real-Gemini session below; it is not a canned response or
a general unattended service.

## Start the live reply session

Start the backend in connected mode and confirm `/health` returns `mode: gemini`.
Then, from `photon-agent/`, run `npm start -- --live --sender <owner's E.164>`.
Use only the owner's own registered number, not the Photon **Texts on** number.
The listener accepts only that sender's fresh direct messages and exits after
30 minutes or 20 accepted messages. Keep the backend and listener running while
the owner sends a synthetic test message. Ordinary text uses live Gemini;
standalone links are local-only. Confirm the resulting reply on the handset.

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

The fixture run passes 10/10. The latest live run on 2026-10-11 passed all ten
synthetic controls using nine Gemini generations and one local-only URL check.
It made no Photon sends, destination requests, or provider retries. The successful
run follows a deterministic policy correction: payments paired with account
threats remain generic payment requests even if Gemini supplies an advance-fee
reason. Separate sanitized artifacts are
`docs/artifacts/gemini-coverage-fixture.json` and
`docs/artifacts/gemini-coverage-live.json`. These limited controls cannot establish
general fraud accuracy; see [field definitions](api.md) and [verification](gemini.md).

Device acceptance passed on 2026-10-10 using synthetic screenshots on the physical
iPhone: the containing-app picker returned `insufficient_evidence` for the benign
control, and **Photos → Share → Ravel** returned `suspicious_verify` for the
credential-request control. The latter showed Gemini mode, unverified
observations, and private-check/no-report status. The sanitized result is in
`docs/artifacts/ios-gemini-share-acceptance.json`. A live benign Photon control
also completed with exact-reply approval and confirmed handset receipt; see
`docs/artifacts/photon-benign-control-round-trip.json`. The offline failure demo
passed using `npm --prefix photon-agent run demo`; it simulated a provider timeout
without network calls. The backup recording remains pending; see the
[sanitized run record](docs/artifacts/offline-failure-demo.json).
`npm --prefix photon-agent run demo` now includes a clearly labeled simulated
provider timeout and the truthful fixed error reply without making a network
request. Recording a backup of the reviewed demonstration remains pending.

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
Record received input type, backend provenance/private flags, and handset
confirmation as separate sanitized evidence. Keep the automatic session limited
to the owner and its time/message bounds. Do not publish phone numbers,
credentials, message identifiers, or raw user input in shared proof artifacts.

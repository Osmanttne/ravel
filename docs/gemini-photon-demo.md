# Gemini + Photon demo

The current competition scope is private checking through iPhone and Photon
iMessage, using the same FastAPI assessment policy. Tiger Data, reports, campaign
matches, and a database dashboard are deferred. Do not claim community intelligence
or verified fraud in this demo.

## Account setup

1. Create/select the project at [Photon Dashboard](https://app.photon.codes/dashboard).
   The supplied HackNC Tracks PDF advertises `HACKWITHPHOTON` for free Pro access;
   actual redemption and entitlement must be confirmed in the account.
2. Copy the project's Settings values `PROJECT_ID` and `SECRET_KEY` into the ignored
   repository-root `.env` as `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET`.
   Keep the existing Gemini configuration. Never paste credentials into chat or
   place them in the iOS app.
3. Add the phone number or email used by your iMessage account under project
   **Users**. Free/Pro shared lines require registered recipients. The assigned
   number may vary per recipient; verify sponsor routing and judge registration
   rather than promising one public number.
4. Configure the agent's connection to the local Gemini backend:

   ```dotenv
   RAVEL_API_BASE_URL=http://127.0.0.1:8001
   RAVEL_ALLOW_LOCAL_HTTP=true
   RAVEL_CHECK_TIMEOUT_SECONDS=45
   ```

The owner's personal iMessage handle, the intended message recipient, and the
Photon-managed sender line are separate roles. Registering the owner does not
authorize a shared Pro line to message every other phone number. Add each
additional intended recipient under project **Users**; keep the owner's own
registration. Cloud messages originate from Photon's provisioned line, whose
number may vary by recipient. A recipient-registration entry is not approval to
send: the exact destination and outgoing text still require the owner's review.

The cloud Spectrum adapter uses an outbound connection; it does not need a public
inbound webhook or access to the Mac's personal Messages database. Keep the Mac,
backend, and agent running during a local demo. The iPhone app still needs its
configured LAN backend address; deploying the agent is a separate step.

**Local owner requirement:** before any live send or automatic reply, show the
exact recipient and outgoing text to the user and obtain approval. Use the
bounded receive/check/preview flow and a separately approved send. Keep the
unattended reply runner disabled. Credential/account verification alone does
not authorize a message.

See [Photon setup](../photon-agent/README.md) for the actual start and validation
commands. Current account behavior is documented in Photon's
[cloud provider guide](https://photon.codes/docs/spectrum-ts/providers/imessage),
[routing guide](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing),
and [recipient troubleshooting](https://photon.codes/docs/spectrum-ts/troubleshooting/imessage).

## Controlled examples

All inputs below are synthetic. The `.example` destinations are fictional; do not
open them or substitute real scam infrastructure.

| Input | What the current policy should show |
| --- | --- |
| `Free concert tickets. Pay a $20 transfer fee before delivery: https://tickets.example/offer` | Suspicious / verify before acting, supported by an advance-fee observation; no verified fraud claim. |
| `Campus club concert this Friday. Registration is at https://campus.example/events` | Insufficient evidence; no invented payment request or accusation. |
| `Your account will be suspended unless you act now. Reply with your password and PIN to verify your account.` | Suspicious / verify based on a credential-sharing request; the account claim and sender remain unverified. |
| `Reply with your authentication code to verify your account.` | Suspicious / verify based on a code-sharing request; never include an actual secret or code in a demo. |
| `Your account will be locked unless you pay a $10 verification fee.` | Suspicious / verify based on payment combined with an account threat. |
| An account-restriction warning asking only to review settings, with urgency | Insufficient evidence; account threat plus urgency alone does not establish fraud. |
| Code delivery with a never-share warning; sign-in in an independently opened official app | Insufficient evidence; these are benign controls rather than requests to disclose secrets. |
| `https://campus.example/events` | Limited URL-only assessment: parsed locally, page not visited, no Gemini or reputation lookup. |

The additive nullable fields are `credentials_requested`,
`verification_code_requested`, and `account_threat_indicated`, with indicators
`credential_request`, `verification_code_request`, and `account_threat`.
Missing public fields preserve compatibility as `null`; categories are unchanged.
Unclear/conflicting Gemini evidence takes precedence and requests human review.
Offline positive/benign controls pass, but expanded live validation is pending
after a truthful provider timeout. Do not advertise general phishing accuracy.

Run the fixture coverage checklist from the repository root:

```sh
.venv/bin/python scripts/verify_gemini_coverage.py
```

All ten fixture controls pass without provider requests. Explicit `--live`
attempts seven text and two image generations plus one local-only URL check.
The separate artifacts are `docs/artifacts/gemini-coverage-fixture.json` and
`docs/artifacts/gemini-coverage-live.json`; they omit raw inputs, secret/code values,
and evidence quotes. Provider failures are truthful errors with no mock fallback
or application retry. See [Gemini verification](gemini.md).

## Presentation sequence

1. On the physical iPhone, select a synthetic screenshot through the app's picker
   or Share menu. Use `backend/app/fixtures/ticket_offer.png`,
   `credential_request.png`, `benign_code_alert.png`, or the synthetic
   ShareTestHost image. Analyze privately and show the observed red flags and the
   next action. Do not grant broad photo or message access.
2. Start the bounded Photon receive window before sending the advance-fee text.
   Preview the reply derived from the backend, obtain approval of its exact
   recipient and body, then send once and confirm receipt. One synthetic text
   round trip has been verified this way; follow the
   [controlled demo instructions](demo-script.md).
3. Use `scripts/review_photon_message.mjs --sender <selected E.164 handle> --listen`
   from the repository root for separate reviewed checks of the benign control
   and standalone URL. Start the 60-second window only when the participant is
   ready; use the assigned **Texts on** line. This command previews a reply and
   sends nothing. It accepts one fresh plaintext message, closes the receive
   stream and client before checking, and supports cancellation throughout.
   Each outgoing reply needs fresh approval. Explain what evidence is available
   and what remains unknown. Missing evidence never means safe.
4. Show a controlled timeout/error in the offline test/demo path. The agent must
   display a truthful failure; it must not replace a failed live call with a mock
   positive result. Every fixture assessment must be visibly labeled.

The application does not persist submitted private checks as reports. Photon and
Google process selected content under their own provider terms; application
cleanup does not control those providers' retention. Report requests must receive
the reporting-unavailable response while Tiger Data work is deferred.

## Verification status

Read-only account checks confirmed authenticated active Pro/shared iMessage.
Two approved setup messages received provider acknowledgements, and the user
confirmed receipt on both phones. A subsequent exact synthetic ticket message
was received in the owner's direct chat, checked through Gemini, previewed,
approved, and sent once; the user confirmed receipt of the assessment reply.
That controlled reviewed text round trip is verified. The unattended reply
runner remains disabled, and further sends require fresh approval of the exact
recipient and text. See the [sanitized round-trip proof](artifacts/photon-gemini-round-trip.json)
and [Photon record](artifacts/photon-validation.json).

The general review CLI also received a standalone synthetic URL rendered as an
iMessage link preview, completed one local-only backend check, and produced a
separately approved reply that the user confirmed receiving. A prior attempt
exposed a content-filter bug: the URL carried Apple's native preview marker.
The receiver now accepts only that confirmed marker with complete URL text and
the existing sender, freshness, normal-message, single-part, and no-attachment
guards. It downloads no preview media. The expanded Photon suite passes 420
offline tests. The bounded
reviewed text/URL slice of Milestone 5 is complete; see the
[URL round-trip proof](artifacts/photon-url-round-trip.json).

Still required:

- Sponsor entitlement and routing/registration for each additional judge.
- Successful expanded live Gemini controls, a live benign Photon text control,
  and deliberate offline failure demonstration.
- Manual confirmation of the complete Photos Share flow on the physical iPhone.
- A screen recording backup and broader false-alert evaluation before general
  detection claims. Milestone 6 remains in progress.

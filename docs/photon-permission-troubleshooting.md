# Photon routing and authorization diagnostics

Two separately approved setup messages received validated Photon acknowledgements,
and the user confirmed receipt on both phones. A subsequent controlled synthetic
ticket message was received in the owner's exact direct chat, checked privately
through Gemini, and returned as a reply preview. After approval of the exact
recipient and body, one reply was sent and the user confirmed receipt. This
verifies that reviewed synthetic text round trip. The unattended reply runner
stays disabled. Further sends require fresh approval of the exact recipient and
outgoing text. The
[sanitized validation record](artifacts/photon-validation.json) contains the
current results without phone numbers or credentials.
The [round-trip proof](artifacts/photon-gemini-round-trip.json) records the fresh
incoming check and approved delivery separately from the earlier diagnostics.

A separate benign account-safety control was received from the owner's assigned
**Texts on** route with the registered phone handle. The first Gemini backend
attempt returned `service_unavailable`; after the user approved one retry of the
same synthetic text, the check returned `insufficient_evidence` with no supported
indicators and no report. The user approved the exact reply, Photon acknowledged
one logical send, and the user confirmed handset receipt. This single control is
not a general accuracy claim. See the [sanitized proof](artifacts/photon-benign-control-round-trip.json).

A standalone URL test identified a separate receiver-filter issue: iMessage
sent complete URL text with its native link-preview marker. Sanitized diagnostics
confirmed the selected owner's fresh normal direct message had no attachments,
mini-app payload, or extra parts; the former balloon guard rejected it before
any backend check. The generic receiver now accepts that precise URL-preview
form while preserving the other guards. A fresh retry passed the local URL
check, separately approved send, and user-confirmed receipt. The
[URL proof](artifacts/photon-url-round-trip.json) records that validation.

## Earlier diagnostic history

Read-only dashboard checks confirmed that the owner and separate intended
recipient were registered in the same project used by the local credentials.
Account metadata authenticated and reported active Pro, shared-line iMessage.

The initial approved send failed without a validated acknowledgement. A second
separately approved attempt on 2026-10-11 at 00:15:43 UTC failed with
`AuthenticationError`, gRPC status `7`, and provider code `internalError`. A third
approved attempt to the registered owner at 00:23:20 UTC returned the same
class/status/code. Those earlier attempts did not establish handset receipt.

At 00:19:15 UTC, one read-only `AddressService/GetIMessageAvailability` query for
the intended recipient returned the same permission status and the fixed reason
`Target not allowed for this project`. It used a fresh shared transport
credential, TLS, no retries, and a 10-second timeout; the client closed afterward.
The query sent no message and opened no listener or history. Spectrum
core/iMessage was `12.10.1`, Advanced iMessage `2.2.0`, and the shared endpoint
matched the installed SDK default. The SDK's `internalError` fallback does not
prove an internal server failure.

A manual greeting to the Platforms number received Photon's unrecognized-sender
response. A Users recheck showed that this tested line belonged to the separate
registered recipient; the owner had a different **Texts on** route. The actual
Apple sender handle was not verified. This identified a possible inbound route
mismatch, separate from the earlier outbound failures.

At 00:40 UTC, the owner-selected receive-only diagnostic observed a server
heartbeat. Its 60-second window closed with no confirmed fresh marker and zero
sends. The owner reported sending text, but its exact marker and timing remained
unverified; no history was retrieved. A subsequent read-only owner availability
query returned `true`. Later approved outbound tests then received acknowledgements
and the user's handset confirmation, as described above. The exact cause of the
earlier failures was not established.

## If a routing problem returns

Use the sending user's **Texts on** route from project Users. A Pro shared line
may vary by recipient, so the Platforms number alone does not identify every
user's route. Verify whether iMessage starts conversations from the registered
phone number or an Apple Account email. Apple's setting is **Settings → Apps →
Messages → Send & Receive → Start New Conversations From**; after changing the
sender identity, start a new conversation.

The bounded [receive-only diagnostic](../photon-agent/README.md#receive-only-routing-diagnostic)
can check a deliberately sent marker without enabling replies. A heartbeat or
absence of an automated rejection does not establish receipt of that marker.
Keep automatic application replies disabled. The successful reviewed test
authorizes no further send; obtain approval of each exact recipient and reply.

If authorization failures recur, share safe timestamps/statuses and the project
ID and affected recipient privately with Photon support. Never share project
secrets or the Gemini API key. No support message has been sent by this
implementation.

References: [Photon recipient troubleshooting](https://photon.codes/docs/spectrum-ts/troubleshooting/imessage),
[shared-line routing](https://photon.codes/docs/spectrum-ts/providers/imessage/connection-and-routing),
[Apple sender identity](https://support.apple.com/en-us/101744),
[shared transport source](https://github.com/photon-hq/spectrum-ts/blob/main/packages/imessage/src/auth.ts),
and [gRPC statuses](https://grpc.io/docs/guides/status-codes/).

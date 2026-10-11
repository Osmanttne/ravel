# Native iOS client — Milestone 3 in progress

Ravel implements a SwiftUI app, a Share Extension, and a shared Swift client.
Xcode 26.6 and XcodeGen 2.46.0 are installed. The account-secret extension's
current RavelCore suite passes 20 tests. Updated unsigned and signed app/extension
builds pass, and the signed coverage build is installed on the physical iPhone.
Earlier rebrand test-host builds and RavelTests `build-for-testing` compilation
also pass. Built plists verify the Ravel display name, new bundle IDs, and the
Debug LAN Gemini backend address on port 8001. The user has confirmed private
Gemini results from both the app picker and Photos Share Extension using
synthetic screenshots; see the [device acceptance proof](../docs/artifacts/ios-gemini-share-acceptance.json).

The initial installation reached Apple's free-profile three-app limit. The
user approved removing the old UI test runner; removal succeeded, and signed
Ravel installed and launched successfully on the physical iPhone. The embedded
extension is built and signed; the Photos Share flow now has a confirmed result.
New device UI tests and direct text/URL sharing from the test host remain
pending. Before the rename, the
user confirmed a successful Gemini image assessment and Share menu availability;
those results validate the previous app identity.
Milestone 3 remains in progress. Use only the physical iPhone; all test
simulators remain stopped, as requested.

Development defaults: iOS 17+, app ID `com.osmantaka.ravel`, extension ID
`com.osmantaka.ravel.share`, and results directly in the extension. There is
no App Group or app-launch handoff. Signing and the Debug backend address are
local developer settings, excluded from source control.

## Source and privacy

- `Ravel`: choose a screenshot through PhotosPicker or paste/type text or a
  link, inspect the preview and disclosure, then tap **Analyze privately**.
- `RavelShareExtension`: receive one explicitly shared image, plain-text item,
  or URL where the source app supports it. Local image files are read locally;
  unsupported files are rejected. Preview and consent precede networking.
- `SharedUI`: common results, bundle configuration, and image preparation.
  Results show provenance, uncertainty, next steps, and limitations. Fixture
  responses display a visible simulated-analysis label.
- `RavelCore`: typed contracts and a bounded ephemeral HTTP client. JSON
  text/URL and multipart PNG/JPEG requests always use `/v1/check`,
  `privacy_mode=private_check`, and `ios_app` or `ios_share` source metadata.
- `RavelShareTestHost`: a separate development app with synthetic text, link, image,
  and multiple-item Share menu examples. The host makes no network requests.

There is no automatic clipboard access, message scanning, local content database,
report submission, or opening of suspicious destinations. Credentials stay in
the backend's `.env`; never put a Gemini key in iOS settings or plists.

Image preparation bounds source size and pixels, downsamples to a maximum
2,000-pixel edge, and renders new PNG/JPEG pixels without copying source metadata.
Uploads are at most 5 MiB. The source supports PNG, JPEG, and single-frame HEIC/HEIF.
Provider temporary files are processed during their callback before expiration.
The extension requires a file representation for images; data-only image hosts
receive the manual fallback rather than an unbounded in-memory load.
Apple's providers may materialize temporary files; this does not promise that no
bytes ever touch system storage. Clearing or dismissing a check clears selected
app state; the containing app also clears it on backgrounding. Backgrounding the
extension cancels loading/analysis, while a paused preview can remain in memory
until the extension closes. Cancelling analysis retains the preview for retry.
Closing the extension clears it. Late results are ignored. A slow extension offers a
manual fallback: close it, open Ravel yourself, and select the same item again.

## Create and build the Xcode project

Install full [Xcode](https://developer.apple.com/xcode/) with iOS platform support
and complete its first launch. Install [XcodeGen](https://github.com/yonaskolb/XcodeGen)
2.42 or newer using its official instructions. `project.json` is reproducible
project input; `generate-project.sh` creates `Ravel.xcodeproj` locally.

From the repository root, adjust the Xcode path if its app name differs:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
sh ios/generate-project.sh
xcodebuild -project ios/Ravel.xcodeproj -scheme Ravel \
  -configuration Debug -destination 'generic/platform=iOS' \
  -derivedDataPath ios/DerivedDataRavel build
```

The generator requires the real iOS SDK, generates the project, then asks
`xcodebuild` to list targets. Open the generated project, choose **Ravel** and
the connected iPhone, and run. The app embeds its extension. Run **RavelShareTestHost**
on the same device for synthetic text/link/image examples.

The generator creates `Configuration/Developer.xcconfig` from its example only
when the local file is absent. Set `DEVELOPMENT_TEAM` and
`RAVEL_API_BASE_URL` there; all targets inherit them, and regeneration
preserves the file. Keep the slash-variable URL syntax from the example to avoid
xcconfig treating `//` as a comment. Never put a Gemini key in this file.
For a physical iPhone, use the team selected in Xcode's Apple Accounts settings.
Use bundle IDs registered to that team; keep the extension ID prefixed by the app
ID. Set the team on RavelShareTestHost if installing it too. No App Group is required.

## Backend address and provider mode

The example Debug `RAVEL_API_BASE_URL` is `http://localhost:8001`.
It substitutes `RavelAPIBaseURL` in both target plists.
It is a server address, not a key. Release has an empty backend address and fails
closed until an HTTPS service is configured. No public service is deployed.

On an iPhone, localhost means the phone. For device testing, configure the local
Debug address to the Mac's private LAN IP and bind a development server to that
interface. The renamed built plists point to the LAN Gemini server on port 8001.
After restarting from the renamed repository, Gemini on port 8001 and fixture
mode on port 8002 pass health checks over localhost and LAN. Ravel is installed
and launched. The latest device check completed through Photos Share after the
local model was changed to `gemini-3.5-flash-lite`; the earlier configured model
returned `RESOURCE_EXHAUSTED` on a harmless diagnostic. Open the containing app
first and make an explicit private check to grant any Local Network prompt
before trying the extension. Apple documents different permission behavior
for extensions: [Local Network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).

The plists allow local networking without arbitrary transport loads. The client
allows local HTTP only in Debug and refuses credentials, query strings, fragments,
and redirects in the backend configuration. Release requires HTTPS.

For deterministic demos, use a separate fixture server and leave the current
Gemini server untouched:

```sh
RAVEL_FIXTURE_MODE=true .venv/bin/python -m uvicorn app.main:app \
  --host 127.0.0.1 --port 8002 --no-access-log
```

For a phone, replace the host with the Mac's private LAN IP and use that same
address in `Developer.xcconfig`.
Rebuild the app and embedded extension after changing the address.
`source_channel` does not select fixture mode. Prepared/generated images may not
match exact bundled fixture hashes and truthfully receive a limited assessment.
Connected mode uses Gemini for text/images; URL-only checks do not visit their
destination or call Gemini. Read [Gemini data handling](../docs/gemini.md).

## Validation and remaining acceptance

The account-secret extension's current RavelCore suite passes 20 tests, including
the additive nullable fields and older-response compatibility. Updated unsigned
generic-iOS app and embedded-extension builds also pass. The latest coverage
build is signed and installed on the physical phone. The user confirmed a
private Gemini analysis from Photos Share with a synthetic credential-request
screenshot; it returned `suspicious_verify` and created no report. Builds alone
do not complete runtime acceptance; no simulator is running.

During the rebrand, RavelCore's 17 XCTest methods passed with Xcode 26.6. They covered sanitized
backend responses, wire formats, limits, privacy flags, cancellation, bounded
responses, redirects, and errors. To repeat:

```sh
swift test --package-path ios/RavelCore
```

The renamed app, embedded extension, and test host pass unsigned generic-iOS
builds; the UI test target passes `build-for-testing` compilation. The signed
Ravel app/extension build passes for the physical iPhone. Approved removal of
the old UI test runner resolved the free-profile three-app installation limit;
signed Ravel installed and launched successfully. The embedded extension is
built and signed. No new device UI test, Share-flow acceptance, or provider
analysis was performed. The [rebrand record](../docs/artifacts/ravel-rebrand-validation.json)
tracks these fresh checks separately from historical device results.

Before the rename, the native app, embedded extension, and synthetic test host
built with the iOS 26.5 SDK and were signed and installed on an iPhone 16 running
iOS 26.6.1. The manual URL UI test passed after focus dismissal and the explicit
URL-only result label were fixed. Four other automated UI cases remain unresolved:
their latest run failed with missing elements or UI automation authorization
errors. Phone automation was stopped when the user prioritized real Gemini
analysis. The user separately confirmed Share availability under Apps/More for
that previous build; renamed Share menu acceptance remains pending.

Six UI tests cover private app checks and system sharing through the synthetic
test host and Photos. Five use only fixed synthetic messages, links, and generated
images. The Photos automation is compiled out on physical devices so it cannot
select from a user's real photo library. On an iPhone, verify Photos and the
manual picker by explicitly selecting a synthetic screenshot yourself.
RavelShareTestHost's **View synthetic screenshot** presents invented content you can
capture using the iPhone's screenshot buttons. Select that screenshot in Photos
for **Share → Ravel**, and select it again with the app's **Check screenshot**.
The installed Ravel app is configured for Gemini. The user has now confirmed
the Photos Share flow and a separate picker check on the updated app; the result
and model-quota recovery are recorded in the [device proof](../docs/artifacts/ios-gemini-share-acceptance.json).
Keep automated UI acceptance on a
separate fixture backend using a command-line `RAVEL_API_BASE_URL`
override, then rebuild the normal Debug app to restore the saved Gemini address.
Fixture mode intentionally gives unfamiliar images a limited assessment; it
does not run image understanding on arbitrary uploads.

Fresh real Gemini text and image verification passed on 2026-10-10 at 21:56 UTC;
both synthetic examples returned `suspicious_verify` and `report_created: false`.
Before the rename, the user also confirmed a successful image assessment after one
incomplete-extraction error and retry. A later screenshot confirmed the exact
Photos Share entry point on the updated app. Incomplete provider output is rejected rather than used to
manufacture a result; the original Google timeout and later successful checks are
recorded in the sanitized validation record.

`Validation/CoreChecks.swift` separately compiled and ran against the actual Core
sources. It passed runtime checks for real sanitized fixture/Gemini response
contracts, private JSON/multipart wire fields, limits, shared-item selection,
Foundation URLSession behavior, redirect refusal, oversized responses, malformed
JSON, timeout mapping, and cancellation. HTTP transport is mocked; these checks
make no Google or real-server requests and supplement the passing XCTest suite.
With a working Xcode toolchain, repeat from the repository root:

```sh
mkdir -p ios/Validation/.build
swiftc -parse-as-library ios/RavelCore/Sources/RavelCore/*.swift \
  ios/Validation/CoreChecks.swift -o ios/Validation/.build/core-checks
ios/Validation/.build/core-checks
```

The actual shared `PlatformImagePreparation.swift` compiled and ran on macOS.
`Validation/main.swift` checked downsampling,
orientation, non-upscaling, decoded/output bounds, GPS/description removal, local
file intake, and rejection of empty, invalid, oversized, directory, and remote-URL
inputs. This verifies the ImageIO helper, not PhotosPicker or extension behavior.
With a working Xcode toolchain, repeat it from the repository root:

```sh
mkdir -p ios/Validation/.build
swiftc ios/SharedUI/PlatformImagePreparation.swift ios/Validation/main.swift \
  -o ios/Validation/.build/image-checks
ios/Validation/.build/image-checks
```

The [sanitized validation record](../docs/artifacts/ios-source-validation.json)
distinguishes passed checks from remaining acceptance. All three plists pass
`plutil -lint`; the generator passes `sh -n` and native project generation.
Device UI results and Share menu registration are tracked there. Real-device
image memory behavior, HEIC intake, Dynamic Type, and VoiceOver remain unverified.

Complete these acceptance checks with Xcode before marking Milestone 3 complete:

1. Build/run Ravel with its embedded extension. Check a selected screenshot,
   pasted synthetic text, and a `.example` URL in the containing app.
2. In Photos use **Share → Ravel** for one screenshot. In RavelShareTestHost share
   text and a URL; enable Ravel under More/Edit if initially hidden. Some
   source apps do not expose selected messages to the Share menu.
3. Confirm no request before Analyze privately. Check provenance, fixture labels,
   the URL-not-analyzed disclosure, and no community report creation.
4. Cancel while loading/checking, replace input, dismiss results, and background
   the host. Confirm no stale result. Test slow/unavailable backends, oversized or
   unsupported input, and multiple-item sharing (hidden or rejected gracefully).
5. Exercise Dynamic Type, VoiceOver, constrained extension layout, HEIC conversion,
   real-device image memory, and foreground Local Network permission.

Apple references: [Share Extensions](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html),
[PhotosPicker](https://developer.apple.com/documentation/photosui/photospicker),
[NSItemProvider](https://developer.apple.com/documentation/foundation/nsitemprovider),
[activation keys](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/AppExtensionKeys.html),
and [local transport exceptions](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking).


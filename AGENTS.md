# Codex instructions — Ravel

Read `RAVEL_CONTEXT.md` **fully** before changing any code; it is the canonical product and architecture specification.

## Default working behavior

- Implement the next **single milestone** from Section 14 unless the user specifies otherwise. The user-approved 2026-10-10 priority is Gemini + Photon: Milestone 5's bounded reviewed text/URL slice is complete; Milestone 6 adds account-secret evidence, benign controls, and demo hardening while manual iOS Photos acceptance remains pending. Milestone 4 is deferred.
- Inspect existing files first. Prefer working, testable vertical slices over wide scaffolds.
- Preserve the iOS-first product: SwiftUI app + Share Extension for **explicitly shared** screenshots, text, and URLs; Photon iMessage entry point; common FastAPI backend; Gemini understanding. Tiger Data, report persistence, and community matching are deferred until requested.
- Keep `POST /v1/check` private: **it must never create an opt-in report**. Reports require separate confirmation and a distinct endpoint.
- Never silently scan messages, clipboard, or notifications; never claim iOS permits blanket access to third-party conversations.
- Before any live Photon send or automatic reply, show the user the exact recipient and outgoing message and obtain approval. The user explicitly requires this because Photon uses their phone number. Account verification must remain read-only until approved; do not activate the reply listener without a reviewed send flow.
- Do not call shared URL destinations or execute uploaded content. Treat uploads as untrusted data and validate size/type.
- Model-provided fraud indicators are unverified until corroborated. Never label absence of matches as `safe`; never publicly accuse a named person from unreviewed reports.
- Use fixture mode with synthetic `.example` links for tests and demos. Visibly label mocked assessments.
- Keep service credentials off the iPhone and out of Git; use server-side environment variables.
- Check current official Apple, Gemini, Photon Spectrum, and Tiger Data docs before using version-specific APIs. Don't invent media support or API methods.
- Add tests for feature changes, run them, and summarize actual results plus any untested iOS/device/provider integrations.
- When Xcode or cloud credentials are missing, proceed with independent modules and state precisely what requires manual setup.

## First task

Implement **Milestone 0 + 1** of `RAVEL_CONTEXT.md`, with functioning local backend endpoints, typed schemas, fixture examples, and tests. Stop after a tested vertical slice and propose Milestone 2 next.

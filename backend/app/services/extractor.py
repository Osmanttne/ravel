"""Provider boundary and deterministic mock; never a live Gemini implementation."""

import hashlib
import json
import re
from importlib.resources import files
from typing import Protocol

from app.schemas import Extraction
from app.services.ingest import ImagePayload
from app.services.url_intelligence import ParsedURL


class Extractor(Protocol):
    """Milestone 2 can replace this adapter without changing the HTTP contract."""

    def extract_text(self, text: str) -> Extraction: ...

    def extract_url(self, url: ParsedURL) -> Extraction: ...

    def extract_image(self, image: ImagePayload, context: str | None = None) -> Extraction: ...


class FixtureExtractor:
    """Small, deliberately limited mock backed by exact synthetic image bytes.

    Text patterns are heuristic, not a language model. Unknown images do not inherit
    any claims from a fixture, filename, metadata, or user-provided instructions.
    """

    def __init__(self) -> None:
        dataset = json.loads(files("app.fixtures").joinpath("examples.json").read_text())
        self._image_extractions: dict[str, Extraction] = {}
        for example in dataset["examples"]:
            if image_name := example.get("image_file"):
                data = files("app.fixtures").joinpath(image_name).read_bytes()
                self._image_extractions[hashlib.sha256(data).hexdigest()] = (
                    Extraction.model_validate(example["extraction"])
                )

    def extract_text(self, text: str) -> Extraction:
        # Only explicit imperative phrases trigger payment. A mention of payment alone
        # (e.g. "never pay a transfer fee") must not be interpreted as a request.
        clauses = re.split(r"[.!?;\n]+", text.casefold())
        active = [
            clause
            for clause in clauses
            if not re.search(r"\b(?:no|not|never|don't|do not|avoid|without)\b", clause)
        ]
        request = re.compile(
            r"\b(?:pay|send|transfer)\s+(?:a\s+|an\s+|the\s+)?"
            r"(?:\$\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:dollars?|usd)|"
            r"(?:transfer|processing|booking)\s+fee|deposit|money|payment)\b"
            r"|\b(?:transfer|processing|booking)\s+fee\s+(?:is\s+)?required\b"
        )
        payment_clauses = [clause for clause in active if request.search(clause)]
        advance = any(
            re.search(
                r"\b(?:before\b.{0,60}\b(?:delivery|delivering|send|sending|receive|receiving|get)"
                r"|upfront|in advance)\b",
                clause,
            )
            and not re.search(
                r"\bafter\b.{0,60}\b(?:delivery|delivering|sending|receiving|admission)\b", clause
            )
            for clause in payment_clauses
        )
        urgent = any(
            re.search(r"\b(?:act now|pay now|send now|hurry|urgent|immediately|today only)\b", c)
            for c in active
        )
        ticket = bool(re.search(r"\btickets?\b", text.casefold()))
        promotion = bool(re.search(r"\b(?:club|event|promotion)\b", text.casefold()))
        credentials_request = re.compile(
            r"\b(?:send|share|reply\s+with|forward|give\s+(?:me|us)|tell\s+(?:me|us))\b"
            r".{0,60}\b(?:password|pin|passcode|login\s+(?:credentials|secrets))\b"
            r"|\b(?:enter|submit|provide)\b.{0,40}\b(?:password|pin|login\s+credentials)\b"
            r".{0,100}\bhttps?://"
        )
        code_request = re.compile(
            r"\b(?:send|share|reply\s+with|forward|give\s+(?:me|us)|tell\s+(?:me|us))\b"
            r".{0,60}\b(?:code|otp)\b"
        )

        def requested(pattern: re.Pattern[str], *, exclude_promotions: bool = False) -> bool | None:
            matching = [
                clause
                for clause in clauses
                if pattern.search(clause)
                and not (
                    exclude_promotions
                    and re.search(r"\b(?:coupon|promo|promotion|discount|voucher)\b", clause)
                )
            ]
            return (
                True
                if any(clause in active for clause in matching)
                else False
                if matching
                else None
            )

        threat = any(
            re.search(
                r"\b(?:your\s+)?account(?:\s+access)?\s+(?:(?:will|may)\s+be|is\s+being)\s+"
                r"(?:locked|suspended|deleted|disabled|restricted)\b.{0,100}"
                r"\b(?:unless|until|if you (?:do not|don't))\b",
                clause,
            )
            for clause in clauses
        )
        return Extraction(
            category="ticket_offer" if ticket else "promotion" if promotion else "unknown",
            payment_requested=True if payment_clauses else None,
            payment_reason="advance_fee" if advance else None,
            urgency_indicated=True if urgent else None,
            credentials_requested=requested(credentials_request),
            verification_code_requested=requested(code_request, exclude_promotions=True),
            account_threat_indicated=True if threat else None,
            uncertainties=[
                "Mock pattern extraction is limited; identity and legitimacy "
                "have not been verified."
            ],
        )

    def extract_url(self, url: ParsedURL) -> Extraction:
        return Extraction(
            uncertainties=[
                "The URL was parsed only; it was not visited or checked "
                "against threat intelligence."
            ]
        )

    def extract_image(self, image: ImagePayload, context: str | None = None) -> Extraction:
        if extraction := self._image_extractions.get(image.sha256):
            return extraction.model_copy(deep=True)
        return Extraction(
            uncertainties=[
                "This image does not match a synthetic fixture. OCR and live image understanding "
                "are not implemented; image content and optional context were not analyzed."
            ]
        )

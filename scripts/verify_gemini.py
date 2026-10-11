"""Make two REAL Gemini calls on synthetic inputs and save sanitized verification proof."""

import json
import os
import sys
from dataclasses import replace
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.schemas.checks import CheckResponse
from app.services.url_intelligence import parse_url

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "backend" / "app" / "fixtures"
ARTIFACT = ROOT / "docs" / "artifacts" / "gemini-live-verification.json"


class VerificationFailure(Exception):
    """Only controlled server errors and fixed verification messages reach the console."""


def checked_result(step, response):
    if response.status_code != 200:
        error = response.json()["error"]
        raise VerificationFailure(f"{step}: {error['code']}: {error['message']}")
    result = CheckResponse.model_validate_json(response.content)
    assessment, observations = result.assessment, result.observations
    if not (
        result.mode == "gemini"
        and result.report_created is False
        and assessment.verified_fraud is False
        and assessment.known_threat is False
        and assessment.related_report_count == 0
        and observations is not None
        and observations.evidence_source == "gemini"
        and observations.verification_level == "unverified_inference"
    ):
        raise VerificationFailure(
            f"{step}: verification_failed: Live/private evidence rules failed."
        )
    if not (
        observations.category == "ticket_offer"
        and observations.payment_requested is True
        and observations.urgency_indicated is True
        and any(parse_url(url).hostname == "tickets.example" for url in observations.destinations)
    ):
        raise VerificationFailure(
            f"{step}: verification_failed: Synthetic observation checks failed."
        )
    record = {"input_type": step, "http_status": 200, **result.model_dump(mode="json")}
    print(f"{step}: 200: {assessment.summary}")
    print(json.dumps({"observations": record["observations"]}))
    return record


def main():
    try:
        settings = Settings.from_env()
        if not settings.gemini_api_key or not settings.gemini_model:
            raise ValueError("Missing provider configuration.")
        settings = replace(settings, fixture_mode=False)
    except ValueError:
        print("Configure GEMINI_API_KEY/GEMINI_MODEL in .env; no requests sent.", file=sys.stderr)
        return 1

    temporary_path = None
    try:
        # Import after configuration checks. No mock extractor is supplied to this app.
        from app.main import create_app

        dataset = json.loads((FIXTURES / "examples.json").read_text())
        example = next(item for item in dataset["examples"] if item["id"] == "ticket_offer")
        metadata = {"source_channel": "fixture", "privacy_mode": "private_check"}
        text_payload = {"content_type": "text", "text": example["text"], **metadata}
        name = example["image_file"]
        image_file = (name, (FIXTURES / name).read_bytes(), "image/png")
        print(f"Calling REAL Google Gemini ({settings.gemini_model}) on synthetic text and image.")
        with TestClient(create_app(settings)) as client:
            text = checked_result("text", client.post("/v1/check", json=text_payload))
            response = client.post(
                "/v1/check", data={"content_type": "image", **metadata}, files={"image": image_file}
            )
            image = checked_result("image", response)
        proof = {
            "verified_at_utc": datetime.now(UTC).isoformat(),
            "provider": "google_gemini",
            "sdk_version": version("google-genai"),
            "model": settings.gemini_model,
            "live_verified": True,
            "synthetic_inputs": True,
            "actual_provider_requests": 2,
            "results": [text, image],
        }
        ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(
            "w", encoding="utf-8", dir=ARTIFACT.parent, delete=False
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(json.dumps(proof, indent=2) + "\n")
        os.replace(temporary_path, ARTIFACT)
        temporary_path = None
        print(f"Both live checks passed. Sanitized proof saved to {ARTIFACT.relative_to(ROOT)}")
        return 0
    except VerificationFailure as error:
        print(str(error), file=sys.stderr)
    except Exception:  # noqa: BLE001 -- sanitize unknown provider failures at the CLI boundary.
        print("verification_failed: Live checks failed; no proof was written.", file=sys.stderr)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

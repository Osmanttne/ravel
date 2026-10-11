"""Evaluate synthetic private checks; add --live for nine real Gemini generations.

Default execution uses the fixture adapter and makes no provider requests. Proofs
contain controlled classifications/flags, never submitted text, codes, or quotes.
"""

import argparse
import json
import os
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.schemas.checks import CheckResponse

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "backend" / "app" / "fixtures"
FLAGS = ("credentials_requested", "verification_code_requested", "account_threat_indicated")
INDICATORS = frozenset(
    {
        "advance_fee",
        "payment_request",
        "urgency",
        "credential_request",
        "verification_code_request",
        "account_threat",
    }
)
ERROR_CODES = frozenset(
    {
        "provider_invalid_output",
        "provider_timeout",
        "service_unavailable",
        "too_large",
        "unsupported_media",
        "unsafe_url",
        "invalid_request",
        "insufficient_input",
    }
)


@dataclass(frozen=True)
class Case:
    fixture_id: str
    input_type: str
    category: str
    required_codes: tuple[str, ...] = ()
    affirmative_flags: tuple[str, ...] = ()
    nonaffirmative_flags: tuple[str, ...] = ()

    @property
    def case_id(self):
        return f"{self.fixture_id}_{self.input_type}"


CASES = (
    Case(
        "credential_request",
        "text",
        "suspicious_verify",
        ("credential_request", "account_threat"),
        ("credentials_requested", "account_threat_indicated"),
        ("verification_code_requested",),
    ),
    Case(
        "verification_code_request",
        "text",
        "suspicious_verify",
        ("verification_code_request",),
        ("verification_code_requested",),
        ("credentials_requested",),
    ),
    Case(
        "account_threat_payment",
        "text",
        "suspicious_verify",
        ("account_threat", "payment_request"),
        ("account_threat_indicated",),
        ("credentials_requested", "verification_code_requested"),
    ),
    Case(
        "account_threat_only",
        "text",
        "insufficient_evidence",
        ("account_threat",),
        ("account_threat_indicated",),
        ("credentials_requested", "verification_code_requested"),
    ),
    Case("benign_code_alert", "text", "insufficient_evidence", nonaffirmative_flags=FLAGS),
    Case("benign_sign_in", "text", "insufficient_evidence", nonaffirmative_flags=FLAGS),
    Case("ticket_offer", "text", "suspicious_verify", ("advance_fee",), nonaffirmative_flags=FLAGS),
    Case(
        "credential_request",
        "image",
        "suspicious_verify",
        ("credential_request", "account_threat"),
        ("credentials_requested", "account_threat_indicated"),
        ("verification_code_requested",),
    ),
    Case("benign_code_alert", "image", "insufficient_evidence", nonaffirmative_flags=FLAGS),
    Case("new_url", "url", "insufficient_evidence", nonaffirmative_flags=FLAGS),
)


class VerificationFailure(Exception):
    """Fixed verification codes only; never wrap private/model text."""


def app_factory(settings):
    # app.main also exports a default ASGI app. Bootstrap that unused app in
    # fixture mode so importing it cannot create an extra Gemini client.
    previous = os.environ.get("RAVEL_FIXTURE_MODE")
    os.environ["RAVEL_FIXTURE_MODE"] = "true"
    try:
        from app.main import create_app
    finally:
        if previous is None:
            os.environ.pop("RAVEL_FIXTURE_MODE", None)
        else:
            os.environ["RAVEL_FIXTURE_MODE"] = previous
    return create_app(settings)


def submit(client, case, example):
    metadata = {"source_channel": "fixture", "privacy_mode": "private_check"}
    if case.input_type == "image":
        name = example["image_file"]
        if Path(name).name != name or not name.endswith(".png"):
            raise VerificationFailure("invalid_fixture_image")
        return client.post(
            "/v1/check",
            data={"content_type": "image", **metadata},
            files={"image": (name, (FIXTURES / name).read_bytes(), "image/png")},
        )
    field = "url" if case.input_type == "url" else "text"
    return client.post(
        "/v1/check", json={"content_type": case.input_type, field: example[field], **metadata}
    )


def evaluate(case, response, mode):
    record = {
        "case_id": case.case_id,
        "input_type": case.input_type,
        "http_status": response.status_code,
        "passed": False,
    }
    if response.status_code != 200:
        try:
            code = response.json()["error"]["code"]
            record["failure_code"] = code if code in ERROR_CODES else "check_failed"
        except Exception:
            record["failure_code"] = "check_failed"
        return record
    try:
        result = CheckResponse.model_validate_json(response.content)
        assessment, observations = result.assessment, result.observations
        codes = [item.code for item in assessment.indicators]
        if any(code not in INDICATORS for code in codes):
            raise VerificationFailure("unexpected_indicator")
        if case.fixture_id.startswith("benign_") and codes:
            raise VerificationFailure("benign_control_indicator_failed")
        if (
            result.mode != mode
            or result.report_created
            or assessment.verified_fraud
            or assessment.known_threat
            or assessment.related_report_count != 0
        ):
            raise VerificationFailure("private_check_invariants_failed")
        record.update(
            mode=mode,
            category=assessment.category.value,
            indicator_codes=codes,
            report_created=False,
            verified_fraud=False,
            known_threat=False,
            related_report_count=0,
        )
        if mode == "gemini":
            if observations is None:
                raise VerificationFailure("observations_missing")
            record["observations"] = {field: getattr(observations, field) for field in FLAGS}
            record["evidence_source"] = observations.evidence_source
            record["verification_level"] = observations.verification_level
            record["uncertainty_codes"] = observations.uncertainty_codes
            if case.input_type == "url":
                if (
                    observations.evidence_source != "not_analyzed"
                    or observations.verification_level != "not_assessed"
                    or observations.category != "unknown"
                    or observations.destinations
                    or any(getattr(observations, f) is not None for f in FLAGS)
                    or any(
                        getattr(observations, f) is not None
                        for f in (
                            "payment_requested",
                            "payment_reason",
                            "urgency_indicated",
                            "secrecy_requested",
                        )
                    )
                    or codes
                ):
                    raise VerificationFailure("local_url_invariants_failed")
            else:
                if (
                    observations.evidence_source != "gemini"
                    or observations.verification_level != "unverified_inference"
                    or any(
                        item.evidence_source != "gemini"
                        or item.verification_level != "unverified_inference"
                        for item in assessment.indicators
                    )
                ):
                    raise VerificationFailure("gemini_provenance_failed")
                if any(
                    getattr(observations, field) is not True for field in case.affirmative_flags
                ):
                    raise VerificationFailure("required_observation_missing")
                if any(getattr(observations, field) is True for field in case.nonaffirmative_flags):
                    raise VerificationFailure("benign_control_or_field_scope_failed")
        if assessment.category.value != case.category:
            raise VerificationFailure("unexpected_assessment_category")
        if not set(case.required_codes).issubset(codes):
            raise VerificationFailure("required_indicator_missing")
        record["passed"] = True
    except VerificationFailure as failure:
        record["failure_code"] = str(failure)
    except Exception:
        record["failure_code"] = "invalid_check_response"
    return record


def save_proof(path, proof):
    temporary_path = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(json.dumps(proof, indent=2) + "\n")
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--live", action="store_true", help="Use configured Gemini for synthetic inputs"
    )
    args = parser.parse_args()
    mode = "gemini" if args.live else "fixture"
    try:
        settings = (
            replace(Settings.from_env(), fixture_mode=False)
            if args.live
            else Settings(app_env="test")
        )
        dataset = json.loads((FIXTURES / "examples.json").read_text())
        examples = {item["id"]: item for item in dataset["examples"]}
        if any(case.fixture_id not in examples for case in CASES):
            raise VerificationFailure("coverage_fixtures_missing")
        results = []
        generation_checks = 0
        with TestClient(app_factory(settings)) as client:
            for case in CASES:
                if args.live and case.input_type != "url":
                    generation_checks += 1
                record = evaluate(case, submit(client, case, examples[case.fixture_id]), mode)
                results.append(record)
                print(json.dumps(record), flush=True)
                # Never retry a failed provider request or spend through a provider outage.
                if args.live and record["http_status"] != 200:
                    break
        passed = len(results) == len(CASES) and all(item["passed"] for item in results)
        proof = {
            "verified_at_utc": datetime.now(UTC).isoformat(),
            "mode": mode,
            "synthetic_inputs": True,
            "all_controls_passed": passed,
            "live_verified": args.live and passed,
            "provider_generation_checks_attempted": generation_checks,
            "actual_provider_requests_on_success": generation_checks if passed else None,
            "provider_retries": 0,
            "url_destination_requests": 0,
            "preview_media_requests": 0,
            "photon_sends": 0,
            "contains_raw_inputs_secret_values_quotes_or_request_ids": False,
            "scope": "Limited synthetic controls; no calibrated fraud accuracy claim.",
            "results": results,
        }
        if args.live:
            proof.update(
                provider="google_gemini",
                model=settings.gemini_model,
                sdk_version=version("google-genai"),
            )
        artifact = (
            ROOT
            / "docs"
            / "artifacts"
            / f"gemini-coverage-{'live' if args.live else 'fixture'}.json"
        )
        save_proof(artifact, proof)
        print(
            f"{mode}: {sum(item['passed'] for item in results)}/{len(CASES)} controls passed; "
            f"proof: {artifact.relative_to(ROOT)}",
            flush=True,
        )
        return 0 if passed else 1
    except VerificationFailure as failure:
        print(str(failure), flush=True)
    except Exception:
        print("coverage_verification_failed: no success claimed.", flush=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

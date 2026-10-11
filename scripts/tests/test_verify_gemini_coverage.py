"""Offline regression checks for truthful, minimized synthetic coverage proofs."""

import json
import sys
from dataclasses import dataclass

import pytest

from app.core.config import Settings
from app.schemas.checks import (
    Assessment,
    AssessmentCategory,
    CheckResponse,
    Indicator,
    PublicObservations,
)
from scripts import verify_gemini_coverage as verifier

PRIVATE_SENTINEL = "MODEL_SECRET_PRIVATE_CONTENT_431209"


@dataclass
class OfflineResponse:
    status_code: int
    content: bytes

    def json(self):
        return json.loads(self.content)


def encoded_response(payload, status=200):
    return OfflineResponse(status, json.dumps(payload).encode())


def public_result(case):
    """Construct a realistic typed response, including fields omitted from proofs."""
    locally_parsed = case.input_type == "url"
    return CheckResponse(
        check_id=PRIVATE_SENTINEL,
        mode="gemini",
        assessment=Assessment(
            category=AssessmentCategory(case.category),
            summary=PRIVATE_SENTINEL,
            indicators=[
                Indicator(
                    code=code,
                    description=PRIVATE_SENTINEL,
                    evidence_source="gemini",
                    verification_level="unverified_inference",
                )
                for code in case.required_codes
            ],
            recommended_action=PRIVATE_SENTINEL,
        ),
        observations=PublicObservations(
            evidence_source="not_analyzed" if locally_parsed else "gemini",
            verification_level="not_assessed" if locally_parsed else "unverified_inference",
            uncertainty_codes=[] if locally_parsed else ["identity_unverified"],
            **{
                field: True if field in case.affirmative_flags else None
                for field in verifier.FLAGS
            },
        ),
        limitations=[PRIVATE_SENTINEL],
    )


def public_payload(case):
    return public_result(case).model_dump(mode="json")


@pytest.mark.parametrize("case", verifier.CASES, ids=lambda case: case.case_id)
def test_valid_public_controls_pass_without_copying_private_response_text(case):
    result = public_result(case)
    record = verifier.evaluate(case, OfflineResponse(200, result.model_dump_json().encode()), "gemini")

    assert record["passed"] is True
    assert record["category"] == case.category
    assert record["report_created"] is False
    assert record["verified_fraud"] is False
    assert record["known_threat"] is False
    assert record["related_report_count"] == 0
    assert record["observations"] == {
        field: getattr(result.observations, field) for field in verifier.FLAGS
    }
    assert record["uncertainty_codes"] == result.observations.uncertainty_codes
    assert PRIVATE_SENTINEL not in json.dumps(record)
    assert not {"check_id", "summary", "recommended_action", "limitations"}.intersection(record)


@pytest.mark.parametrize("input_type", ["text", "image"])
@pytest.mark.parametrize("flag_value", [None, False], ids=["unknown", "negative"])
@pytest.mark.parametrize(
    "indicator_code", ["credential_request", "verification_code_request", "account_threat"]
)
def test_benign_control_with_tactic_indicator_cannot_pass(input_type, flag_value, indicator_code):
    case = verifier.Case(
        "benign_code_alert", input_type, "insufficient_evidence", nonaffirmative_flags=verifier.FLAGS
    )
    payload = public_payload(case)
    payload["observations"].update({field: flag_value for field in verifier.FLAGS})
    payload["assessment"]["indicators"] = [
        Indicator(
            code=indicator_code,
            description=PRIVATE_SENTINEL,
            evidence_source="gemini",
            verification_level="unverified_inference",
        ).model_dump()
    ]

    record = verifier.evaluate(case, encoded_response(payload), "gemini")

    assert record["passed"] is False
    assert record["failure_code"] == "benign_control_indicator_failed"
    assert PRIVATE_SENTINEL not in json.dumps(record)


@pytest.mark.parametrize("flag", verifier.FLAGS)
@pytest.mark.parametrize("value", [False, True], ids=["negative", "affirmative"])
def test_local_url_requires_unknown_new_flags_even_when_negative(flag, value):
    case = verifier.Case("new_url", "url", "insufficient_evidence")
    payload = public_payload(case)
    payload["observations"][flag] = value

    record = verifier.evaluate(case, encoded_response(payload), "gemini")

    assert record["passed"] is False
    assert record["failure_code"] == "local_url_invariants_failed"
    assert PRIVATE_SENTINEL not in json.dumps(record)


@pytest.mark.parametrize(
    ("location", "field", "value", "failure_code"),
    [
        ("response", "report_created", True, "invalid_check_response"),
        ("assessment", "verified_fraud", True, "invalid_check_response"),
        ("assessment", "known_threat", True, "invalid_check_response"),
        ("assessment", "related_report_count", 1, "private_check_invariants_failed"),
        ("assessment", "category", "known_malicious_evidence", "unexpected_assessment_category"),
    ],
)
def test_forbidden_reporting_and_verification_claims_never_pass(location, field, value, failure_code):
    case = verifier.Case("benign_sign_in", "text", "insufficient_evidence")
    payload = public_payload(case)
    target = payload if location == "response" else payload[location]
    target[field] = value

    record = verifier.evaluate(case, encoded_response(payload), "gemini")

    assert record["passed"] is False
    assert record["failure_code"] == failure_code
    assert PRIVATE_SENTINEL not in json.dumps(record)


@pytest.mark.parametrize(
    ("error_payload", "expected_code"),
    [
        ({"error": {"code": "provider_timeout", "message": PRIVATE_SENTINEL}}, "provider_timeout"),
        ({"error": {"code": PRIVATE_SENTINEL, "message": PRIVATE_SENTINEL}}, "check_failed"),
        ({"error": {"code": [PRIVATE_SENTINEL], "message": PRIVATE_SENTINEL}}, "check_failed"),
        ({"model_response": PRIVATE_SENTINEL}, "check_failed"),
    ],
)
def test_provider_error_proof_contains_only_fixed_failure_code(error_payload, expected_code):
    case = verifier.CASES[0]

    record = verifier.evaluate(case, encoded_response(error_payload, 503), "gemini")

    assert record == {
        "case_id": case.case_id,
        "input_type": "text",
        "http_status": 503,
        "passed": False,
        "failure_code": expected_code,
    }
    assert PRIVATE_SENTINEL not in json.dumps(record)


def test_unparseable_provider_error_is_redacted():
    record = verifier.evaluate(
        verifier.CASES[0], OfflineResponse(502, PRIVATE_SENTINEL.encode()), "gemini"
    )

    assert record["passed"] is False
    assert record["failure_code"] == "check_failed"
    assert PRIVATE_SENTINEL not in json.dumps(record)


def test_live_cli_stops_after_provider_error_and_saves_no_private_error_body(monkeypatch, capsys):
    saved = []
    requests = []

    class OfflineClient:
        def __init__(self, app):
            assert app == "offline-app"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, route, **kwargs):
            requests.append((route, kwargs))
            return encoded_response(
                {"error": {"code": "provider_timeout", "message": PRIVATE_SENTINEL}}, 503
            )

    monkeypatch.setattr(sys, "argv", ["verify_gemini_coverage.py", "--live"])
    monkeypatch.setattr(
        Settings, "from_env", lambda: Settings(gemini_api_key=PRIVATE_SENTINEL, fixture_mode=False)
    )
    monkeypatch.setattr(verifier, "app_factory", lambda settings: "offline-app")
    monkeypatch.setattr(verifier, "TestClient", OfflineClient)
    monkeypatch.setattr(verifier, "version", lambda package: "offline-test")
    monkeypatch.setattr(verifier, "save_proof", lambda path, proof: saved.append(proof))

    assert verifier.main() == 1

    assert len(requests) == 1
    assert len(saved) == 1
    proof = saved[0]
    assert proof["all_controls_passed"] is False
    assert proof["live_verified"] is False
    assert proof["provider_generation_checks_attempted"] == 1
    assert proof["actual_provider_requests_on_success"] is None
    assert proof["provider_retries"] == 0
    assert proof["photon_sends"] == 0
    assert proof["url_destination_requests"] == 0
    assert proof["results"][0]["failure_code"] == "provider_timeout"
    assert PRIVATE_SENTINEL not in json.dumps(proof)
    assert PRIVATE_SENTINEL not in capsys.readouterr().out

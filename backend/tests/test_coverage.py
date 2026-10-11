"""Bounded synthetic phishing coverage and benign controls; no live provider calls."""

import json
import socket
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from gemini_helpers import FakeClient, request_parts, sdk_response
from test_check_api import assert_error

from app.core.config import Settings
from app.main import create_app
from app.schemas.checks import Extraction, PublicObservations
from app.services.assessment import build_assessment
from app.services.extractor import FixtureExtractor
from app.services.gemini_extractor import GeminiExtractor, GeminiOutput, parse_gemini_response
from app.services.ingest import InputError

FIXTURES = Path(__file__).parents[1] / "app" / "fixtures"
NEW_FIELDS = ("credentials_requested", "verification_code_requested", "account_threat_indicated")
FIELD_QUOTES = {
    "credentials_requested": "Reply with your password and PIN to verify your account.",
    "verification_code_requested": "Forward your authentication code to me.",
    "account_threat_indicated": "Your account will be locked unless you verify your details.",
}
CONNECTED_SETTINGS = Settings(
    fixture_mode=False, gemini_api_key="dummy-server-key", gemini_model="gemini-test-model"
)


def output_for(**flags):
    return {
        "category": "unknown",
        "payment_requested": None,
        "payment_reason": None,
        "urgency_indicated": None,
        "secrecy_requested": None,
        "credentials_requested": None,
        "verification_code_requested": None,
        "account_threat_indicated": None,
        "urls_visible": [],
        "evidence_spans": [],
        "uncertainty_codes": ["external_verification_needed"],
        **flags,
    }


def fixture_examples():
    return {
        item["id"]: item
        for item in json.loads((FIXTURES / "examples.json").read_text())["examples"]
    }


def assert_private(body):
    assert body["report_created"] is False
    assert body["assessment"]["known_threat"] is False
    assert body["assessment"]["verified_fraud"] is False
    assert body["assessment"]["related_report_count"] == 0


def test_public_observations_keep_legacy_nullable_compatibility_without_new_content_categories():
    old = PublicObservations.model_validate({"category": "unknown"})
    for field in NEW_FIELDS:
        assert getattr(old, field) is None
        assert old.model_dump()[field] is None
    schema = GeminiOutput.model_json_schema()
    assert set(schema["properties"]["category"]["enum"]) == {"unknown", "ticket_offer", "promotion"}
    for field in NEW_FIELDS:
        assert field in schema["required"]
        assert {item["type"] for item in schema["properties"][field]["anyOf"]} == {
            "boolean",
            "null",
        }


@pytest.mark.parametrize("field", NEW_FIELDS)
def test_new_affirmative_flags_require_their_own_verbatim_input_quote(field):
    quote = FIELD_QUOTES[field]
    payload = output_for(**{field: True})
    payload["evidence_spans"] = [{"field": field, "text": quote}]
    extraction = parse_gemini_response(sdk_response(payload), source_text=quote)
    assert getattr(extraction, field) is True
    for bad_spans in (
        [],
        [{"field": "category", "text": quote}],
        [{"field": field, "text": "private-invented-password-or-code"}],
    ):
        payload["evidence_spans"] = bad_spans
        with pytest.raises(InputError) as failure:
            parse_gemini_response(sdk_response(payload), source_text=quote)
        assert failure.value.code == "provider_invalid_output"
        assert failure.value.status_code == 502
        assert "private-invented" not in str(failure.value)
        assert failure.value.__cause__ is None


@pytest.mark.parametrize("field", NEW_FIELDS)
@pytest.mark.parametrize("invalid", ["missing", "true", 1])
def test_new_model_flags_are_required_nullable_strict_booleans(field, invalid):
    payload = output_for()
    if invalid == "missing":
        payload.pop(field)
    else:
        payload[field] = invalid
    with pytest.raises(InputError) as failure:
        parse_gemini_response(sdk_response(payload), source_text="A synthetic message")
    assert failure.value.code == "provider_invalid_output"


@pytest.mark.parametrize(
    "flags,category,codes",
    [
        ({"credentials_requested": True}, "suspicious_verify", {"credential_request"}),
        ({"verification_code_requested": True}, "suspicious_verify", {"verification_code_request"}),
        (
            {"account_threat_indicated": True, "payment_requested": True},
            "suspicious_verify",
            {"account_threat", "payment_request"},
        ),
        (
            {"account_threat_indicated": True, "urgency_indicated": True},
            "insufficient_evidence",
            {"account_threat", "urgency"},
        ),
        ({"account_threat_indicated": True}, "insufficient_evidence", {"account_threat"}),
        ({"payment_requested": True}, "insufficient_evidence", {"payment_request"}),
    ],
)
def test_policy_distinguishes_secret_sharing_from_account_threat_alone(flags, category, codes):
    assessment = build_assessment(Extraction(**flags), input_kind="text", mode="gemini")
    assert assessment.category == category
    assert {item.code for item in assessment.indicators} == codes
    assert all(item.evidence_source == "gemini" for item in assessment.indicators)
    assert all(item.verification_level == "unverified_inference" for item in assessment.indicators)
    assert assessment.verified_fraud is False
    assert assessment.known_threat is False
    assert assessment.related_report_count == 0


@pytest.mark.parametrize("uncertainty", ["content_unclear", "conflicting_evidence"])
def test_uncertainty_review_precedes_all_new_tactic_flags(uncertainty):
    assessment = build_assessment(
        Extraction(
            credentials_requested=True,
            verification_code_requested=True,
            account_threat_indicated=True,
            payment_requested=True,
            uncertainty_codes=[uncertainty],
        ),
        input_kind="image",
        mode="gemini",
    )
    assert assessment.category == "needs_human_review"
    assert assessment.indicators == []


@pytest.mark.parametrize("field", NEW_FIELDS)
def test_connected_api_projects_new_flags_without_quotes_secrets_or_database(
    field, monkeypatch, caplog
):
    def forbidden(*args, **kwargs):
        pytest.fail("Private mocked coverage attempted a network or database connection")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(sqlite3, "connect", forbidden)
    quote = FIELD_QUOTES[field]
    private_value = "private-password-code-sentinel"
    payload = output_for(**{field: True})
    payload["evidence_spans"] = [{"field": field, "text": quote}]
    sdk = FakeClient(response=sdk_response(payload))
    extractor = GeminiExtractor(api_key="dummy-server-key", model="gemini-test-model", client=sdk)
    with TestClient(create_app(CONNECTED_SETTINGS, extractor=extractor)) as client:
        response = client.post(
            "/v1/check",
            json={
                "content_type": "text",
                "text": quote + " " + private_value,
                "source_channel": "photon_imessage",
                "privacy_mode": "private_check",
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "gemini"
    assert body["observations"][field] is True
    assert set(NEW_FIELDS).issubset(body["observations"])
    assert body["observations"]["evidence_source"] == "gemini"
    assert body["observations"]["verification_level"] == "unverified_inference"
    assert_private(body)
    assert quote not in response.text
    assert private_value not in response.text + caplog.text
    assert "evidence_spans" not in body["observations"]
    assert len(sdk.models.calls) == 1
    call = sdk.models.calls[0]
    assert any(private_value in (part.text or "") for part in request_parts(call))
    assert private_value not in str(call["config"].system_instruction)
    assert "never-share warnings" in str(call["config"].system_instruction)
    assert call["config"].tools in (None, [])


def test_malformed_new_flag_has_scrubbed_typed_error_and_no_fixture_fallback():
    secret = "private-password-value"
    payload = output_for(credentials_requested=secret)
    sdk = FakeClient(response=sdk_response(payload))
    extractor = GeminiExtractor(api_key="dummy-server-key", model="gemini-test-model", client=sdk)
    with TestClient(create_app(CONNECTED_SETTINGS, extractor=extractor)) as client:
        response = client.post("/v1/check", json={"content_type": "text", "text": secret})
    assert_error(response, 502, "provider_invalid_output")
    assert secret not in response.text
    assert "assessment" not in response.json()
    assert len(sdk.models.calls) == 1


@pytest.mark.parametrize(
    "example_id,category,codes",
    [
        (
            "credential_request",
            "suspicious_verify",
            {"credential_request", "account_threat", "urgency"},
        ),
        ("verification_code_request", "suspicious_verify", {"verification_code_request"}),
        ("account_threat_payment", "suspicious_verify", {"payment_request", "account_threat"}),
        ("account_threat_only", "insufficient_evidence", {"account_threat", "urgency"}),
        ("benign_code_alert", "insufficient_evidence", set()),
        ("benign_sign_in", "insufficient_evidence", set()),
    ],
)
def test_synthetic_fixture_texts_exercise_suspicious_and_benign_controls(
    client, example_id, category, codes
):
    example = fixture_examples()[example_id]
    response = client.post("/v1/check", json={"content_type": "text", "text": example["text"]})
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "fixture"
    assert "MOCK / FIXTURE" in " ".join(body["limitations"])
    assert body["assessment"]["category"] == category
    assert {item["code"] for item in body["assessment"]["indicators"]} == codes
    assert_private(body)


@pytest.mark.parametrize(
    "text",
    [
        "Never share your password or authentication code with anyone.",
        "Your reset code is 123456. Do not forward this code.",
        "Enter your verification code only in the official app you personally opened.",
        "Sign in with your password using your independently opened official app.",
        "Send your coupon code to receive a discount.",
        "Your account will not be suspended unless you change your settings. Act now.",
        "Your verification code is 123456.",
        "Do not enter your password at https://security.example.",
    ],
)
def test_fixture_negation_code_delivery_and_official_sign_in_do_not_invent_secret_requests(text):
    extraction = FixtureExtractor().extract_text(text)
    assert extraction.credentials_requested is not True
    assert extraction.verification_code_requested is not True
    assert extraction.account_threat_indicated is not True
    assessment = build_assessment(extraction, input_kind="text")
    assert assessment.category == "insufficient_evidence"
    assert not {"credential_request", "verification_code_request", "account_threat"}.intersection(
        item.code for item in assessment.indicators
    )


@pytest.mark.parametrize(
    "example_id,category",
    [
        ("credential_request", "suspicious_verify"),
        ("benign_code_alert", "insufficient_evidence"),
    ],
)
def test_new_exact_synthetic_screenshots_are_labeled_mock_and_keep_private(
    client, example_id, category
):
    image_file = fixture_examples()[example_id]["image_file"]
    response = client.post(
        "/v1/check",
        data={"content_type": "image", "source_channel": "ios_share"},
        files={"image": (image_file, (FIXTURES / image_file).read_bytes(), "image/png")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "fixture"
    assert body["assessment"]["category"] == category
    assert "simulated" in " ".join(body["limitations"])
    assert all(
        item["evidence_source"] == "fixture_provider" for item in body["assessment"]["indicators"]
    )
    assert_private(body)


def test_connected_credential_screenshot_observations_are_unverified_not_an_identity_claim():
    quote = FIELD_QUOTES["credentials_requested"]
    threat_quote = "Your account will be suspended unless you act now."
    payload = output_for(credentials_requested=True, account_threat_indicated=True)
    payload["evidence_spans"] = [
        {"field": "credentials_requested", "text": quote},
        {"field": "account_threat_indicated", "text": threat_quote},
    ]
    sdk = FakeClient(response=sdk_response(payload))
    extractor = GeminiExtractor(api_key="dummy-server-key", model="gemini-test-model", client=sdk)
    with TestClient(create_app(CONNECTED_SETTINGS, extractor=extractor)) as client:
        response = client.post(
            "/v1/check",
            data={"content_type": "image"},
            files={
                "image": (
                    "credential_request.png",
                    (FIXTURES / "credential_request.png").read_bytes(),
                    "image/png",
                ),
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["assessment"]["category"] == "suspicious_verify"
    assert body["observations"]["credentials_requested"] is True
    assert body["observations"]["account_threat_indicated"] is True
    assert {item["code"] for item in body["assessment"]["indicators"]} == {
        "credential_request",
        "account_threat",
    }
    assert all(
        item["verification_level"] == "unverified_inference"
        for item in body["assessment"]["indicators"]
    )
    assert quote not in response.text
    assert threat_quote not in response.text
    assert_private(body)


def test_connected_url_keeps_every_new_observation_unknown_without_model_call():
    sdk = FakeClient(error=AssertionError("No model call is allowed for a URL-only check"))
    extractor = GeminiExtractor(api_key="dummy-server-key", model="gemini-test-model", client=sdk)
    with TestClient(create_app(CONNECTED_SETTINGS, extractor=extractor)) as client:
        response = client.post(
            "/v1/check",
            json={
                "content_type": "url",
                "url": "https://security.example/reset?token=private-token",
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["assessment"]["category"] == "insufficient_evidence"
    assert body["assessment"]["indicators"] == []
    assert body["observations"]["evidence_source"] == "not_analyzed"
    for field in NEW_FIELDS:
        assert body["observations"][field] is None
    assert sdk.models.calls == []
    assert "private-token" not in response.text
    assert_private(body)


@pytest.mark.parametrize(
    "example_id",
    [
        "account_threat_payment",
        "benign_code_alert",
        "benign_sign_in",
    ],
)
def test_readable_security_controls_preserve_generic_payment_and_nonconflicting_extraction(
    example_id,
):
    text = fixture_examples()[example_id]["text"]
    if example_id == "account_threat_payment":
        payload = output_for(
            payment_requested=True, payment_reason="generic_payment", account_threat_indicated=True
        )
        payload["evidence_spans"] = [
            {"field": field, "text": text}
            for field in ("payment_requested", "payment_reason", "account_threat_indicated")
        ]
        category = "suspicious_verify"
        expected_codes = {"payment_request", "account_threat"}
    else:
        payload = output_for(
            **{
                "verification_code_requested"
                if example_id == "benign_code_alert"
                else "credentials_requested": False,
            }
        )
        category = "insufficient_evidence"
        expected_codes = set()
    sdk = FakeClient(response=sdk_response(payload))
    extractor = GeminiExtractor(api_key="dummy-server-key", model="gemini-test-model", client=sdk)
    with TestClient(create_app(CONNECTED_SETTINGS, extractor=extractor)) as client:
        response = client.post("/v1/check", json={"content_type": "text", "text": text})
    assert response.status_code == 200
    body = response.json()
    assert body["assessment"]["category"] == category
    assert {item["code"] for item in body["assessment"]["indicators"]} == expected_codes
    assert body["observations"]["category"] == "unknown"
    assert body["observations"]["payment_reason"] == payload["payment_reason"]
    assert "content_unclear" not in body["observations"]["uncertainty_codes"]
    assert "conflicting_evidence" not in body["observations"]["uncertainty_codes"]
    assert_private(body)
    assert len(sdk.models.calls) == 1
    call = sdk.models.calls[0]
    assert any(text in (part.text or "") for part in request_parts(call))
    instruction = str(call["config"].system_instruction)
    assert "account-verification fee is generic_payment" in instruction
    assert "incompatible claims about the same action" in instruction
    assert "different actions" in instruction
    assert "proof of legitimacy or a safety guarantee" in instruction
    assert text not in instruction

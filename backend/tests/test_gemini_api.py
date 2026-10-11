import socket
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from gemini_helpers import TEXT, FakeClient, sdk_response, valid_output
from test_check_api import assert_error

from app.core.config import Settings
from app.main import create_app
from app.schemas.checks import CheckResponse, Extraction
from app.services.gemini_extractor import GeminiExtractor

FIXTURE_IMAGE = Path(__file__).parents[1] / "app" / "fixtures" / "ticket_offer.png"


@pytest.fixture
def gemini_settings():
    return Settings(
        fixture_mode=False,
        gemini_api_key="dummy-server-only-key",
        gemini_model="gemini-test-model",
    )


def assert_connected_private(response, category):
    assert response.status_code == 200, response.text
    parsed = CheckResponse.model_validate_json(response.content)
    assert parsed.mode == "gemini"
    assert parsed.report_created is False
    assert parsed.assessment.category == category
    assert parsed.assessment.known_threat is False
    assert parsed.assessment.verified_fraud is False
    assert parsed.assessment.related_report_count == 0
    assert response.headers["cache-control"] == "no-store"
    return response.json()


@pytest.mark.parametrize("input_kind", ["text", "image"])
def test_connected_check_exposes_sanitized_observations_not_verified_fraud(
    gemini_settings, input_kind, caplog
):
    sdk = FakeClient()
    extractor = GeminiExtractor(
        api_key="dummy-server-only-key", model="gemini-test-model", client=sdk
    )
    with TestClient(create_app(gemini_settings, extractor=extractor)) as client:
        assert client.get("/health").json() == {"status": "ok", "mode": "gemini"}
        if input_kind == "text":
            response = client.post("/v1/check", json={"content_type": "text", "text": TEXT})
        else:
            response = client.post(
                "/v1/check",
                data={"content_type": "image", "source_channel": "ios_share"},
                files={"image": ("ticket_offer.png", FIXTURE_IMAGE.read_bytes(), "image/png")},
            )
        body = assert_connected_private(response, "suspicious_verify")
        observations = body["observations"]
        assert observations["category"] == "ticket_offer"
        assert observations["payment_requested"] is True
        assert observations["urgency_indicated"] is True
        assert observations["secrecy_requested"] is None
        assert observations["destinations"] == ["https://tickets.example"]
        assert observations["evidence_source"] == "gemini"
        assert observations["verification_level"] == "unverified_inference"
        assert all(
            indicator["evidence_source"] == "gemini"
            and indicator["verification_level"] == "unverified_inference"
            for indicator in body["assessment"]["indicators"]
        )
        for secret in ("private-query-token", "private-fragment", "dummy-server-only-key"):
            assert secret not in response.text
            assert secret not in caplog.text
        assert len(sdk.models.calls) == 1


@pytest.mark.parametrize("flag", [None, False])
def test_nullable_model_flags_remain_distinct_from_false(gemini_settings, flag):
    payload = {
        "category": "unknown",
        "payment_requested": flag,
        "payment_reason": None,
        "urgency_indicated": flag,
        "secrecy_requested": flag,
        "credentials_requested": flag,
        "verification_code_requested": flag,
        "account_threat_indicated": flag,
        "urls_visible": [],
        "evidence_spans": [],
        "uncertainty_codes": ["external_verification_needed"],
    }
    sdk = FakeClient(response=sdk_response(payload))
    extractor = GeminiExtractor(api_key="dummy-key", model="gemini-test-model", client=sdk)
    with TestClient(create_app(gemini_settings, extractor=extractor)) as client:
        response = client.post("/v1/check", json={"content_type": "text", "text": "A message"})
        body = assert_connected_private(response, "insufficient_evidence")
        for name in (
            "payment_requested",
            "urgency_indicated",
            "secrecy_requested",
            "credentials_requested",
            "verification_code_requested",
            "account_threat_indicated",
        ):
            assert body["observations"][name] is flag


def test_conflicting_model_evidence_requires_human_review(gemini_settings):
    payload = valid_output()
    payload["uncertainty_codes"] = ["conflicting_evidence"]
    sdk = FakeClient(response=sdk_response(payload))
    extractor = GeminiExtractor(api_key="dummy-key", model="gemini-test-model", client=sdk)
    with TestClient(create_app(gemini_settings, extractor=extractor)) as client:
        response = client.post("/v1/check", json={"content_type": "text", "text": TEXT})
        body = assert_connected_private(response, "needs_human_review")
        assert body["assessment"]["indicators"] == []
        assert body["observations"]["verification_level"] == "unverified_inference"
        assert "conflicting_evidence" in body["observations"]["uncertainty_codes"]


def test_connected_url_only_check_is_parse_only_without_gemini_inference(gemini_settings):
    sdk = FakeClient(error=AssertionError("A URL-only check must not call Gemini"))
    extractor = GeminiExtractor(api_key="dummy-key", model="gemini-test-model", client=sdk)
    with TestClient(create_app(gemini_settings, extractor=extractor)) as client:
        response = client.post(
            "/v1/check",
            json={"content_type": "url", "url": "https://new.example/private?token=secret"},
        )
        body = assert_connected_private(response, "insufficient_evidence")
        assert body["observations"]["evidence_source"] == "not_analyzed"
        assert body["observations"]["verification_level"] == "not_assessed"
        assert body["observations"]["payment_requested"] is None
        assert sdk.models.calls == []
        assert "?token=secret" not in response.text


def test_connected_private_checks_do_not_connect_to_storage_or_visit_links(
    gemini_settings, monkeypatch
):
    def forbidden_connection(*args, **kwargs):
        pytest.fail("A mocked private check attempted an unexpected network or storage connection")

    monkeypatch.setattr(socket.socket, "connect", forbidden_connection)
    monkeypatch.setattr(sqlite3, "connect", forbidden_connection)
    sdk = FakeClient()
    extractor = GeminiExtractor(api_key="dummy-key", model="gemini-test-model", client=sdk)
    with TestClient(create_app(gemini_settings, extractor=extractor)) as client:
        for source_channel in ("ios_app", "ios_share", "photon_imessage"):
            response = client.post(
                "/v1/check",
                json={"content_type": "text", "text": TEXT, "source_channel": source_channel},
            )
            assert_connected_private(response, "suspicious_verify")
    assert len(sdk.models.calls) == 3


@pytest.mark.parametrize(
    "response,error,code,status",
    [
        (sdk_response(raw="invalid model output secret"), None, "provider_invalid_output", 502),
        (None, TimeoutError("private-timeout-value"), "provider_timeout", 504),
        (None, RuntimeError("private-provider-value"), "service_unavailable", 503),
    ],
)
def test_connected_provider_failures_do_not_fall_back_to_fixture_results(
    gemini_settings, response, error, code, status
):
    sdk = FakeClient(response=response, error=error)
    extractor = GeminiExtractor(api_key="dummy-key", model="gemini-test-model", client=sdk)
    with TestClient(create_app(gemini_settings, extractor=extractor)) as client:
        result = client.post("/v1/check", json={"content_type": "text", "text": TEXT})
        assert_error(result, status, code)
        assert "assessment" not in result.json()
        assert "secret" not in result.text
        assert "private-" not in result.text
        assert len(sdk.models.calls) == 1


def test_application_does_not_close_externally_injected_extractor(gemini_settings):
    class ExternalExtractor:
        close_count = 0

        def extract_text(self, text):
            return Extraction()

        def close(self):
            self.close_count += 1

    extractor = ExternalExtractor()
    with TestClient(create_app(gemini_settings, extractor=extractor)) as client:
        assert_connected_private(
            client.post("/v1/check", json={"content_type": "text", "text": "hello"}),
            "insufficient_evidence",
        )
    assert extractor.close_count == 0


def test_application_closes_extractor_it_created(gemini_settings, monkeypatch):
    class OwnedExtractor:
        close_count = 0

        def close(self):
            self.close_count += 1

    extractor = OwnedExtractor()
    monkeypatch.setattr("app.services.gemini_extractor.GeminiExtractor", lambda **kwargs: extractor)
    with TestClient(create_app(gemini_settings)) as client:
        assert client.get("/health").json()["mode"] == "gemini"
    assert extractor.close_count == 1

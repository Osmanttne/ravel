import json

from google.genai import types

URL = "https://tickets.example/offer?token=private-query-token#private-fragment"
TEXT = f"Free concert tickets. Pay a $20 transfer fee before I send the tickets. Act now. {URL}"


def valid_output():
    return {
        "category": "ticket_offer",
        "payment_requested": True,
        "payment_reason": "advance_fee",
        "urgency_indicated": True,
        "secrecy_requested": None,
        "credentials_requested": None,
        "verification_code_requested": None,
        "account_threat_indicated": None,
        "urls_visible": [URL],
        "visual_regions": [],
        "evidence_spans": [
            {"field": "category", "text": "Free concert tickets."},
            {
                "field": "payment_requested",
                "text": "Pay a $20 transfer fee before I send the tickets.",
            },
            {
                "field": "payment_reason",
                "text": "Pay a $20 transfer fee before I send the tickets.",
            },
            {"field": "urgency_indicated", "text": "Act now."},
            {"field": "urls_visible", "text": URL},
        ],
        "uncertainty_codes": ["identity_unverified", "ticket_ownership_unverified"],
    }


def sdk_response(payload=None, *, raw=None, finish_reason="STOP"):
    text = (
        raw if raw is not None else json.dumps(payload if payload is not None else valid_output())
    )
    return types.GenerateContentResponse(
        candidates=[
            types.Candidate(
                finish_reason=finish_reason,
                content=types.Content(role="model", parts=[types.Part.from_text(text=text)]),
            )
        ]
    )


class FakeModels:
    def __init__(self, response=None, error=None):
        self.response = response if response is not None else sdk_response()
        self.error = error
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return self.response


class FakeClient:
    def __init__(self, response=None, error=None):
        self.models = FakeModels(response=response, error=error)
        self.close_count = 0

    def close(self):
        self.close_count += 1


def request_parts(call):
    contents = call["contents"]
    if not isinstance(contents, list):
        contents = [contents]
    parts = []
    for content in contents:
        assert isinstance(content, types.Content)
        assert content.role == "user"
        parts.extend(content.parts or [])
    return parts

import asyncio
import json
from dataclasses import replace
from io import BytesIO

import pytest
from conftest import image_bytes
from fastapi.testclient import TestClient
from PIL import Image
from test_check_api import assert_error, assert_private_fixture

from app.main import create_app


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost/secret",
        "https://127.0.0.1/",
        "https://10.1.2.3/",
        "https://169.254.169.254/latest/meta-data/",
        "https://[::1]/",
        "https://user:password@tickets.example/offer",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "https:///missing-host",
        "https://tickets.example:invalid/offer",
        "https://tickets.example/\x00secret",
        "https://tickets.example/\nsecret",
        "\nhttps://tickets.example/",
        "https://tickets.example/\n",
        "https://tickets.example/\t",
        "https://tickets.example\\@localhost/",
    ],
)
def test_unsafe_urls_are_rejected_without_fetching(client, url):
    assert_error(
        client.post("/v1/check", json={"content_type": "url", "url": url}), 422, "unsafe_url"
    )


def test_public_case_and_unicode_hostname_are_accepted_without_claiming_safety(client):
    for url in ("HTTPS://TICKETS.EXAMPLE/Offer", "https://bücher.example/event"):
        response = client.post("/v1/check", json={"content_type": "url", "url": url})
        assert_private_fixture(response, "insufficient_evidence")


@pytest.mark.parametrize(
    "filename,content,mime",
    [
        ("fake.png", b"not a PNG", "image/png"),
        ("fake.jpg", b"not a JPEG", "image/jpeg"),
        ("mismatched.png", image_bytes(image_format="JPEG"), "image/png"),
        (
            "script.svg",
            b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            "image/svg+xml",
        ),
        ("unsupported.heic", b"heic-placeholder", "image/heic"),
    ],
)
def test_untrusted_image_types_and_bytes_are_rejected(client, filename, content, mime):
    response = client.post(
        "/v1/check", data={"content_type": "image"}, files={"image": (filename, content, mime)}
    )
    assert_error(response, 415, "unsupported_media")


def test_empty_image_has_insufficient_input_error(client):
    response = client.post(
        "/v1/check",
        data={"content_type": "image"},
        files={"image": ("empty.png", b"", "image/png")},
    )
    assert_error(response, 422, "insufficient_input")


def test_animated_png_is_rejected(client):
    image = Image.new("RGB", (8, 8), "blue")
    frame = Image.new("RGB", (8, 8), "red")
    buffer = BytesIO()
    image.save(buffer, format="PNG", save_all=True, append_images=[frame], duration=100, loop=0)
    response = client.post(
        "/v1/check",
        data={"content_type": "image"},
        files={"image": ("animated.png", buffer.getvalue(), "image/png")},
    )
    assert_error(response, 415, "unsupported_media")


@pytest.mark.parametrize(
    "extra",
    [{"text": "second primary input"}, {"privacy_mode": "report"}, {"unexpected": "private value"}],
)
def test_multipart_rejects_extra_primary_content_and_reporting(client, extra):
    response = client.post(
        "/v1/check",
        data={"content_type": "image", **extra},
        files={"image": ("blank.png", image_bytes(), "image/png")},
    )
    assert_error(response, 422, "invalid_request")


def test_multipart_duplicate_privacy_fields_cannot_change_authorization(client):
    response = client.post(
        "/v1/check",
        files=[
            ("content_type", (None, "image")),
            ("privacy_mode", (None, "private_check")),
            ("privacy_mode", (None, "report")),
            ("image", ("blank.png", image_bytes(), "image/png")),
        ],
    )
    assert_error(response, 422, "invalid_request")


def test_multiple_uploaded_images_are_rejected(client):
    response = client.post(
        "/v1/check",
        data={"content_type": "image"},
        files=[
            ("image", ("first.png", image_bytes(), "image/png")),
            ("image", ("second.png", image_bytes(), "image/png")),
        ],
    )
    assert_error(response, 400, "invalid_request")


@pytest.mark.parametrize(
    "setting,value", [("max_image_bytes", 32), ("max_image_pixels", 9), ("max_image_dimension", 3)]
)
def test_image_resource_limits(settings, setting, value):
    app = create_app(replace(settings, **{setting: value}))
    with TestClient(app) as client:
        response = client.post(
            "/v1/check",
            data={"content_type": "image"},
            files={"image": ("blank.png", image_bytes(size=(4, 4)), "image/png")},
        )
        assert_error(response, 413, "too_large")


def test_declared_request_body_limit(settings):
    with TestClient(create_app(replace(settings, max_request_bytes=100))) as client:
        response = client.post("/v1/check", json={"content_type": "text", "text": "x" * 200})
        assert_error(response, 413, "too_large")


def test_chunked_body_without_content_length_is_capped(settings):
    application = create_app(replace(settings, max_request_bytes=100))
    body = json.dumps({"content_type": "text", "text": "x" * 200}).encode()
    messages = [
        {"type": "http.request", "body": body[:80], "more_body": True},
        {"type": "http.request", "body": body[80:], "more_body": False},
    ]
    sent = []

    async def receive():
        if messages:
            return messages.pop(0)
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/v1/check",
        "raw_path": b"/v1/check",
        "query_string": b"",
        "root_path": "",
        "headers": [(b"content-type", b"application/json")],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }
    asyncio.run(application(scope, receive, send))
    start = next(message for message in sent if message["type"] == "http.response.start")
    assert start["status"] == 413
    response_bytes = b"".join(
        message.get("body", b"") for message in sent if message["type"] == "http.response.body"
    )
    response_body = json.loads(response_bytes)
    assert response_body["error"]["code"] == "too_large"
    headers = {name.lower(): value for name, value in start["headers"]}
    assert headers[b"cache-control"] == b"no-store"
    assert headers[b"x-request-id"].decode() == response_body["request_id"]


def test_connected_mode_cannot_silently_use_fixture_provider(settings):
    with pytest.raises(ValueError):
        create_app(replace(settings, fixture_mode=False))

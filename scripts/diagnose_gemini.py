"""Diagnose real Gemini setup without printing credentials, provider text, or error messages."""

import argparse
import json
import re
import ssl
import sys
from dataclasses import replace
from itertools import islice
from types import SimpleNamespace

import certifi
from google import genai
from google.genai import errors, types

from app.core.config import Settings
from app.services.gemini_extractor import GOOGLE_API_BASE_URL, GeminiExtractor
from app.services.ingest import InputError

MODEL_ID = re.compile(r"(?:models/)?gemini-[a-z0-9][a-z0-9.-]{0,99}\Z")
STATUSES = {
    "OK",
    "CANCELLED",
    "UNKNOWN",
    "INVALID_ARGUMENT",
    "DEADLINE_EXCEEDED",
    "NOT_FOUND",
    "ALREADY_EXISTS",
    "PERMISSION_DENIED",
    "RESOURCE_EXHAUSTED",
    "FAILED_PRECONDITION",
    "ABORTED",
    "OUT_OF_RANGE",
    "UNIMPLEMENTED",
    "INTERNAL",
    "UNAVAILABLE",
    "DATA_LOSS",
    "UNAUTHENTICATED",
}
EXCEPTIONS = {
    "ConnectError",
    "ConnectTimeout",
    "ReadTimeout",
    "WriteTimeout",
    "PoolTimeout",
    "ReadError",
    "WriteError",
    "RemoteProtocolError",
    "LocalProtocolError",
    "ProxyError",
    "UnsupportedProtocol",
    "SSLError",
    "TimeoutError",
    "ConnectionError",
    "PermissionError",
    "ValueError",
    "TypeError",
    "AttributeError",
    "RuntimeError",
    "ImportError",
    "ValidationError",
}
REASONS = {
    "API_KEY_INVALID",
    "API_KEY_SERVICE_BLOCKED",
    "API_KEY_IP_ADDRESS_BLOCKED",
    "API_KEY_HTTP_REFERRER_BLOCKED",
    "API_KEY_ANDROID_APP_BLOCKED",
    "API_KEY_IOS_APP_BLOCKED",
    "API_KEY_EXPIRED",
    "SERVICE_DISABLED",
    "BILLING_DISABLED",
    "PROJECT_DELETED",
    "CONSUMER_INVALID",
    "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
    "IAM_PERMISSION_DENIED",
}


def permission_hint(error):
    # Classify locally without emitting the provider message or its metadata.
    message = (error.message or "").lower()
    if "leaked" in message:
        return "api_key_reported_leaked"
    if "billing" in message:
        return "billing_configuration"
    if "region" in message or "location" in message or "country" in message:
        return "regional_access"
    if "api key" in message or "api_key" in message:
        return "api_key_restriction"
    return "unspecified_permission"


def safe_error(step, error):
    if isinstance(error, errors.APIError):
        code, status = getattr(error, "code", None), getattr(error, "status", None)
        code = code if type(code) is int and 100 <= code <= 599 else "unknown"
        body = error.details if isinstance(error.details, dict) else {}
        body = body.get("error", body)
        reasons = (
            sorted(
                {
                    detail["reason"]
                    for detail in body.get("details", [])
                    if isinstance(detail, dict) and detail.get("reason") in REASONS
                }
            )
            if isinstance(body, dict)
            else []
        )
        print(
            json.dumps(
                {
                    "step": step,
                    "code": code,
                    "status": status if status in STATUSES else "UNKNOWN",
                    "reasons": reasons,
                    **({"permission_hint": permission_hint(error)} if code == 403 else {}),
                }
            )
        )
    else:
        name = type(error).__name__
        print(
            json.dumps(
                {
                    "step": step,
                    "code": "client_exception",
                    "exception_type": name if name in EXCEPTIONS else "unexpected_exception",
                }
            )
        )


def configured_client(settings):
    tls = ssl.create_default_context(cafile=certifi.where())
    arguments = {"trust_env": False, "follow_redirects": False, "verify": tls}
    return genai.Client(
        api_key=settings.gemini_api_key,
        vertexai=False,
        debug_config=genai.client.DebugConfig(
            client_mode=None, replays_directory=None, replay_id=None
        ),
        http_options=types.HttpOptions(
            base_url=GOOGLE_API_BASE_URL,
            api_version="v1beta",
            timeout=max(1, int(settings.gemini_timeout_seconds * 1000)),
            retry_options=types.HttpRetryOptions(attempts=1),
            client_args=arguments,
            async_client_args=arguments,
        ),
    )


def available_models(client):
    try:
        models = islice(client.models.list(config=types.ListModelsConfig(page_size=100)), 200)
        names = {
            model.name.removeprefix("models/")
            for model in models
            if isinstance(model.name, str)
            and MODEL_ID.fullmatch(model.name)
            and "generateContent" in (model.supported_actions or [])
        }
        print(
            json.dumps(
                {"step": "model_list", "code": "ok", "generate_content_models": sorted(names)}
            )
        )
    except Exception as error:  # noqa: BLE001 -- redact unknown SDK errors at the CLI boundary.
        safe_error("model_list", error)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--basic", action="store_true", help="Test a minimal text prompt instead of extraction."
    )
    options = parser.parse_args()
    try:
        settings = Settings.from_env()
        settings = replace(settings, fixture_mode=False)
    except ValueError:
        print("Configure GEMINI_API_KEY/GEMINI_MODEL in .env; no requests sent.", file=sys.stderr)
        return 1
    try:
        with configured_client(settings) as client:
            try:
                metadata = client.models.get(model=settings.gemini_model)
            except errors.APIError as error:
                safe_error("model_metadata", error)
                available_models(client)
                return 1
            name = (
                metadata.name
                if metadata.name and MODEL_ID.fullmatch(metadata.name)
                else settings.gemini_model
            )
            print(
                json.dumps(
                    {
                        "step": "model_metadata",
                        "code": "ok",
                        "model": name,
                        "supports_generate_content": "generateContent"
                        in (metadata.supported_actions or []),
                    }
                )
            )

            if options.basic:
                try:
                    client.models.generate_content(
                        model=settings.gemini_model,
                        contents="Reply with OK.",
                        config=types.GenerateContentConfig(
                            max_output_tokens=64,
                            candidate_count=1,
                            tools=[],
                            automatic_function_calling=types.AutomaticFunctionCallingConfig(
                                disable=True
                            ),
                        ),
                    )
                except Exception as error:  # noqa: BLE001 -- provider errors must be scrubbed.
                    safe_error("basic_generation", error)
                    return 1
                print(json.dumps({"step": "basic_generation", "code": "response_received"}))
                return 0

            def generate(**kwargs):
                try:
                    return client.models.generate_content(**kwargs)
                except Exception as error:
                    safe_error("text_generation", error)
                    raise

            proxy = SimpleNamespace(models=SimpleNamespace(generate_content=generate))
            extractor = GeminiExtractor(
                settings.gemini_api_key,
                settings.gemini_model,
                settings.gemini_timeout_seconds,
                client=proxy,
            )
            try:
                extractor.extract_text(
                    "Free concert tickets. Pay a $20 transfer fee before delivery: "
                    "https://tickets.example/offer. Act now!"
                )
            except InputError as error:
                code = (
                    error.code
                    if error.code
                    in {"provider_timeout", "provider_invalid_output", "service_unavailable"}
                    else "verification_failed"
                )
                print(json.dumps({"step": "text_generation", "code": code}))
                return 1
            print(json.dumps({"step": "text_generation", "code": "parsed_success"}))
            return 0
    except Exception as error:  # noqa: BLE001 -- never emit a provider traceback or response.
        safe_error("diagnostic", error)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

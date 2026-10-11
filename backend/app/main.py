"""Private checks with explicit fixture or Gemini extraction; no report storage."""

import json
import uuid
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from pydantic import BaseModel, ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import Settings
from app.core.http import RequestGuardMiddleware, error_response
from app.schemas import (
    CHECK_REQUEST_ADAPTER,
    CheckMode,
    CheckResponse,
    Extraction,
    ImageCheckMetadata,
    PublicObservations,
    ReportRequest,
    ReportResponse,
    SourceChannel,
    TextCheckRequest,
)
from app.services.assessment import build_assessment
from app.services.extractor import Extractor, FixtureExtractor
from app.services.ingest import InputError, validate_image
from app.services.url_intelligence import extract_urls, parse_url


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    mode: CheckMode = "fixture"


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
    request_id: str


ERRORS = {
    status: {"model": ErrorResponse} for status in (400, 404, 413, 415, 422, 500, 502, 503, 504)
}
LIMITATIONS = [
    "MOCK / FIXTURE MODE: deterministic synthetic extraction, not live AI or threat intelligence.",
    "No community reports or verified threat sources were searched. Report count is zero.",
]
INPUT_LIMITATIONS = {
    "text": "Mock text patterns are limited; identity and legitimacy have not been verified.",
    "url": "The URL was parsed only. It was not visited or checked against threat intelligence.",
    "image": (
        "Image understanding is simulated only for the bundled synthetic screenshots. "
        "Other images and optional context are not analyzed; OCR is not implemented."
    ),
}
GEMINI_LIMITATIONS = [
    "Gemini extraction is an unverified model inference, not proof of identity or fraud.",
    "No community reports or verified threat sources were searched. Report count is zero.",
    "Only sanitized observations are shown; raw model quotes and URLs are omitted.",
]
PUBLIC_PAYMENT_REASONS = {
    "advance_fee",
    "transfer_fee",
    "upfront_payment",
    "deposit_before_delivery",
    "generic_payment",
}


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field.")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError("Nonstandard JSON number.")


async def _json_body(request: Request) -> object:
    if (
        request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        != "application/json"
    ):
        raise InputError("unsupported_media", "Expected application/json.", 415)
    try:
        return json.loads(
            await request.body(), object_pairs_hook=_unique_object, parse_constant=_reject_constant
        )
    except (ValueError, UnicodeDecodeError) as exc:
        raise InputError("invalid_request", "Expected valid JSON with unique fields.", 422) from exc


def create_app(settings: Settings | None = None, *, extractor: Extractor | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    mode: CheckMode = "fixture" if settings.fixture_mode else "gemini"
    owns_extractor = extractor is None
    if extractor is None:
        if settings.fixture_mode:
            extractor = FixtureExtractor()
        else:
            from app.services.gemini_extractor import GeminiExtractor

            extractor = GeminiExtractor(
                api_key=settings.gemini_api_key,
                model=settings.gemini_model,
                timeout_seconds=settings.gemini_timeout_seconds,
            )

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        try:
            yield
        finally:
            if owns_extractor and hasattr(application.state.extractor, "close"):
                await run_in_threadpool(application.state.extractor.close)

    app = FastAPI(
        title="Ravel private-check API",
        version="0.2.0",
        description="Fixture or Gemini content extraction; no threat lookup or report persistence.",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.extractor = extractor
    app.add_middleware(RequestGuardMiddleware, max_bytes=settings.max_request_bytes)

    def request_id(request: Request) -> str:
        return getattr(request.state, "request_id", f"req_{uuid.uuid4().hex}")

    @app.exception_handler(InputError)
    async def input_error(request: Request, exc: InputError):
        return error_response(exc.code, exc.message, exc.status_code, request_id(request))

    @app.exception_handler(ValidationError)
    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: Exception):
        # Pydantic's raw error details can contain private inputs. Never echo them.
        return error_response(
            "invalid_request",
            "Input does not match the documented contract.",
            422,
            request_id(request),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "invalid_request")
        return error_response(
            code, "Request could not be processed.", exc.status_code, request_id(request)
        )

    @app.exception_handler(Exception)
    async def internal_error(request: Request, exc: Exception):
        return error_response(
            "service_unavailable",
            "The check service is temporarily unavailable.",
            500,
            request_id(request),
        )

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(mode=mode)

    async def extract(method, *args) -> Extraction:
        try:
            observation = await run_in_threadpool(method, *args)
            return Extraction.model_validate(observation)
        except InputError:
            raise
        except TimeoutError as exc:
            raise InputError(
                "provider_timeout", "Extraction timed out; no assessment was produced.", 504
            ) from exc
        except Exception as exc:
            # No raw exception text, submitted content, or model output reaches callers.
            raise InputError(
                "service_unavailable", "Extraction failed; no assessment was produced.", 503
            ) from exc

    @app.post("/v1/check", response_model=CheckResponse, responses=ERRORS)
    async def check(request: Request) -> CheckResponse:
        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if media_type == "application/json":
            submission = CHECK_REQUEST_ADAPTER.validate_python(await _json_body(request))
            if isinstance(submission, TextCheckRequest):
                extract_urls(submission.text)  # Parse/validate only; never visit any destination.
                observation = await extract(app.state.extractor.extract_text, submission.text)
                input_kind = "text"
            else:
                parse_url(submission.url)
                # URL-only checks are local parsing. Do not send private paths/query tokens
                # to a model or imply a model can establish reputation from a URL string.
                observation = Extraction(uncertainty_codes=["external_verification_needed"])
                input_kind = "url"
        elif media_type == "multipart/form-data":
            # Always close files, including those temporarily spooled by the multipart parser.
            async with request.form(max_files=1, max_fields=4, max_part_size=8192) as form:
                items = list(form.multi_items())
                names = [name for name, _ in items]
                if len(names) != len(set(names)):
                    raise InputError(
                        "invalid_request", "Duplicate multipart fields are not allowed.", 422
                    )
                if set(names) - {
                    "image",
                    "content_type",
                    "source_channel",
                    "privacy_mode",
                    "context",
                }:
                    raise InputError("invalid_request", "Unexpected multipart field.", 422)
                upload = form.get("image")
                if not isinstance(upload, UploadFile):
                    raise InputError("invalid_request", "An image file is required.", 422)
                metadata = ImageCheckMetadata.model_validate(
                    {name: value for name, value in items if name != "image"}
                )
                if metadata.context:
                    extract_urls(metadata.context)
                data = await upload.read(settings.max_image_bytes + 1)
                image = await run_in_threadpool(
                    validate_image,
                    data,
                    upload.content_type or "",
                    max_bytes=settings.max_image_bytes,
                    max_pixels=settings.max_image_pixels,
                    max_dimension=settings.max_image_dimension,
                )
                observation = await extract(
                    app.state.extractor.extract_image, image, metadata.context
                )
                input_kind = "image"
        else:
            raise InputError(
                "unsupported_media", "Use JSON for text/URLs or multipart for images.", 415
            )

        public_observations = None
        if mode == "gemini":
            if input_kind == "url":
                public_observations = PublicObservations(
                    uncertainty_codes=["external_verification_needed"]
                )
            else:
                try:
                    destinations = list(
                        dict.fromkeys(
                            parse_url(value).safe_display for value in observation.urls_visible
                        )
                    )
                except InputError as exc:
                    raise InputError(
                        "provider_invalid_output",
                        "Extraction returned an invalid destination.",
                        502,
                    ) from exc
                public_payment_reason = observation.payment_reason
                if (
                    observation.payment_requested is True
                    and observation.account_threat_indicated is True
                ):
                    public_payment_reason = "generic_payment"
                elif public_payment_reason not in PUBLIC_PAYMENT_REASONS:
                    public_payment_reason = None
                public_observations = PublicObservations(
                    category=observation.category,
                    payment_requested=observation.payment_requested,
                    payment_reason=public_payment_reason,
                    urgency_indicated=observation.urgency_indicated,
                    secrecy_requested=observation.secrecy_requested,
                    credentials_requested=observation.credentials_requested,
                    verification_code_requested=observation.verification_code_requested,
                    account_threat_indicated=observation.account_threat_indicated,
                    destinations=destinations,
                    evidence_source="gemini",
                    verification_level="unverified_inference",
                    uncertainty_codes=list(
                        dict.fromkeys(
                            observation.uncertainty_codes + ["external_verification_needed"]
                        )
                    ),
                )

        limitations = (
            LIMITATIONS + [INPUT_LIMITATIONS[input_kind]]
            if mode == "fixture"
            else GEMINI_LIMITATIONS + ([INPUT_LIMITATIONS["url"]] if input_kind == "url" else [])
        )
        return CheckResponse(
            check_id=f"chk_{uuid.uuid4().hex}",
            mode=mode,
            assessment=build_assessment(observation, input_kind=input_kind, mode=mode),
            # Provider strings may contain personal data or secret URL tokens. Expose
            # curated server messages only; structured uncertainty codes can follow in M2.
            limitations=limitations,
            observations=public_observations,
        )

    @app.post("/v1/reports", response_model=ReportResponse, responses=ERRORS)
    async def reports(request: Request) -> ReportResponse:
        submission = ReportRequest.model_validate(await _json_body(request))
        destination = submission.confirmed_fields.normalized_destination
        parse_url(destination if "://" in destination else f"https://{destination}")
        raise InputError(
            "service_unavailable",
            "Report storage is not implemented until Milestone 4. Nothing was saved.",
            503,
        )

    @app.get("/v1/campaigns/{campaign_id}", responses=ERRORS)
    async def campaign(campaign_id: str):
        raise InputError(
            "service_unavailable",
            "Campaign intelligence is not implemented until Milestone 4.",
            503,
        )

    def openapi():
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(
            title=app.title, version=app.version, description=app.description, routes=app.routes
        )
        components = schema.setdefault("components", {}).setdefault("schemas", {})
        check_schema = CHECK_REQUEST_ADAPTER.json_schema(
            ref_template="#/components/schemas/{model}"
        )
        components.update(check_schema.pop("$defs", {}))
        report_schema = ReportRequest.model_json_schema(ref_template="#/components/schemas/{model}")
        components.update(report_schema.pop("$defs", {}))
        schema["paths"]["/v1/check"]["post"]["requestBody"] = {
            "required": True,
            "content": {
                "application/json": {"schema": check_schema},
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["image"],
                        "properties": {
                            "image": {"type": "string", "format": "binary"},
                            "content_type": {
                                "type": "string",
                                "enum": ["image"],
                                "default": "image",
                            },
                            "source_channel": {
                                "type": "string",
                                "enum": [s.value for s in SourceChannel],
                                "default": "ios_app",
                            },
                            "privacy_mode": {
                                "type": "string",
                                "enum": ["private_check"],
                                "default": "private_check",
                            },
                            "context": {"type": "string", "maxLength": 2000},
                        },
                    }
                },
            },
        }
        schema["paths"]["/v1/reports"]["post"]["requestBody"] = {
            "required": True,
            "content": {"application/json": {"schema": report_schema}},
        }
        app.openapi_schema = schema
        return schema

    app.openapi = openapi
    return app


app = create_app()

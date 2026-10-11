"""Only configuration needed for the implemented local slice."""

import math
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import dotenv_values


@dataclass(frozen=True)
class Settings:
    fixture_mode: bool = True
    app_env: str = "development"
    max_request_bytes: int = 9 * 1024 * 1024
    max_image_bytes: int = 8 * 1024 * 1024
    max_image_pixels: int = 20_000_000
    max_image_dimension: int = 10_000
    gemini_api_key: str | None = field(default=None, repr=False)
    gemini_model: str | None = None
    gemini_timeout_seconds: float = 30.0

    def __post_init__(self) -> None:
        if type(self.fixture_mode) is not bool:
            raise ValueError("RAVEL_FIXTURE_MODE must be a boolean.")
        if self.app_env not in {"development", "test"}:
            raise ValueError("This local development slice supports APP_ENV=development or test.")
        if not self.fixture_mode:
            if not isinstance(self.gemini_api_key, str) or not self.gemini_api_key.strip():
                raise ValueError("Connected mode requires server-side GEMINI_API_KEY.")
            if not isinstance(self.gemini_model, str) or not re.fullmatch(
                r"gemini-[a-z0-9][a-z0-9.-]{0,99}", self.gemini_model
            ):
                raise ValueError(
                    "Connected mode requires an explicit Gemini model ID in GEMINI_MODEL."
                )
        if (
            isinstance(self.gemini_timeout_seconds, bool)
            or not isinstance(self.gemini_timeout_seconds, (int, float))
            or not math.isfinite(self.gemini_timeout_seconds)
            or not 0 < self.gemini_timeout_seconds <= 120
        ):
            raise ValueError("GEMINI_TIMEOUT_SECONDS must be greater than zero and at most 120.")
        limits = (
            self.max_request_bytes,
            self.max_image_bytes,
            self.max_image_pixels,
            self.max_image_dimension,
        )
        if any(type(value) is not int or value <= 0 for value in limits):
            raise ValueError("Input limits must be positive integers.")

    @classmethod
    def from_env(cls) -> "Settings":
        # .env is optional; process environment takes precedence. No global env mutations.
        root = Path(__file__).resolve().parents[3]
        values = {**dotenv_values(root / ".env"), **os.environ}
        raw = str(values.get("RAVEL_FIXTURE_MODE", "true")).strip().lower()
        if raw not in {"true", "false"}:
            raise ValueError("RAVEL_FIXTURE_MODE must be true or false.")
        try:
            timeout = float(values.get("GEMINI_TIMEOUT_SECONDS", "30"))
        except (ValueError, TypeError) as exc:
            raise ValueError("GEMINI_TIMEOUT_SECONDS must be a number.") from exc
        return cls(
            fixture_mode=raw == "true",
            app_env=values.get("APP_ENV", "development"),
            gemini_api_key=values.get("GEMINI_API_KEY") or None,
            gemini_model=values.get("GEMINI_MODEL") or None,
            gemini_timeout_seconds=timeout,
        )

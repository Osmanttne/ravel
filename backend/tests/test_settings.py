import math

import pytest

from app.core import config
from app.core.config import Settings


@pytest.mark.parametrize(
    "api_key,model",
    [(None, None), ("key", None), (None, "model"), ("", "model"), ("key", " ")],
)
def test_connected_mode_requires_explicit_key_and_model(api_key, model):
    with pytest.raises(ValueError):
        Settings(fixture_mode=False, gemini_api_key=api_key, gemini_model=model)


def test_fixture_mode_requires_no_provider_credentials():
    settings = Settings()
    assert settings.fixture_mode is True
    assert settings.gemini_api_key is None
    assert settings.gemini_model is None


def test_settings_repr_does_not_expose_api_key():
    settings = Settings(
        fixture_mode=False,
        gemini_api_key="server-only-secret-key",
        gemini_model="gemini-configured-model",
    )
    assert "server-only-secret-key" not in repr(settings)


@pytest.mark.parametrize("timeout", [0, -1, math.inf, math.nan])
def test_timeout_must_be_positive_and_finite(timeout):
    with pytest.raises(ValueError):
        Settings(gemini_timeout_seconds=timeout)


def isolate_environment(monkeypatch):
    for name in (
        "RAVEL_FIXTURE_MODE",
        "GEMINI_API_KEY",
        "GEMINI_MODEL",
        "GEMINI_TIMEOUT_SECONDS",
        "APP_ENV",
    ):
        monkeypatch.delenv(name, raising=False)


def test_env_loading_uses_process_override_without_mutating_environment(monkeypatch):
    isolate_environment(monkeypatch)
    monkeypatch.setattr(
        config,
        "dotenv_values",
        lambda path: {
            "RAVEL_FIXTURE_MODE": "false",
            "GEMINI_API_KEY": "dotenv-dummy-key",
            "GEMINI_MODEL": "gemini-dotenv-model",
            "GEMINI_TIMEOUT_SECONDS": "12",
        },
    )
    monkeypatch.setenv("GEMINI_MODEL", "gemini-process-model")
    settings = Settings.from_env()
    assert settings.fixture_mode is False
    assert settings.gemini_api_key == "dotenv-dummy-key"
    assert settings.gemini_model == "gemini-process-model"
    assert settings.gemini_timeout_seconds == 12
    assert "GEMINI_API_KEY" not in config.os.environ


def test_env_missing_credentials_never_silently_switches_to_fixture(monkeypatch):
    isolate_environment(monkeypatch)
    monkeypatch.setattr(config, "dotenv_values", lambda path: {})
    monkeypatch.setenv("RAVEL_FIXTURE_MODE", "false")
    with pytest.raises(ValueError):
        Settings.from_env()

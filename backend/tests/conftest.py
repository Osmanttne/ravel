from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def settings():
    return Settings(fixture_mode=True)


@pytest.fixture
def application(settings):
    return create_app(settings)


@pytest.fixture
def client(application):
    with TestClient(application) as test_client:
        yield test_client


def image_bytes(size=(8, 8), image_format="PNG"):
    """A small valid image that cannot match a bundled screenshot fixture."""
    buffer = BytesIO()
    Image.new("RGB", size, (80, 160, 240)).save(buffer, format=image_format)
    return buffer.getvalue()

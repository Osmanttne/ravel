"""Validate explicitly uploaded screenshots in memory without retaining them."""

import warnings
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO

from PIL import Image, UnidentifiedImageError


class InputError(Exception):
    """A stable, content-free validation error suitable for an API response."""

    def __init__(self, code: str, message: str, status_code: int = 422) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class ImagePayload:
    data: bytes
    mime_type: str
    width: int
    height: int
    sha256: str


_FORMATS = {"image/png": "PNG", "image/jpeg": "JPEG"}


def validate_image(
    data: bytes,
    declared_type: str,
    *,
    max_bytes: int = 8 * 1024 * 1024,
    max_pixels: int = 20_000_000,
    max_dimension: int = 10_000,
) -> ImagePayload:
    """Check MIME, structure, decoded dimensions and pixels before analysis.

    Original bytes remain ephemeral so a synthetic fixture can be identified by
    its digest. No filename, EXIF, screenshot text, or bytes are logged or saved.
    Only PNG/JPEG decoders are enabled, and an image must pass both structural
    verification and a fresh, full pixel decode.
    """
    if not data:
        raise InputError("insufficient_input", "Upload a non-empty screenshot.")
    if len(data) > max_bytes:
        raise InputError("too_large", "The screenshot exceeds the upload size limit.", 413)

    mime_type = declared_type.strip().lower()
    if mime_type in {"image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"}:
        raise InputError(
            "unsupported_media",
            "HEIC/HEIF is unsupported; convert the screenshot to PNG or JPEG.",
            415,
        )
    expected_format = _FORMATS.get(mime_type)
    if expected_format is None:
        raise InputError("unsupported_media", "Upload a PNG or JPEG screenshot.", 415)

    try:
        # Pillow may warn before our lower application-specific pixel limit is
        # checked. Treat its own decompression limit as a hard rejection too.
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data), formats=["PNG", "JPEG"]) as image:
                if image.format != expected_format:
                    raise InputError(
                        "unsupported_media",
                        "The declared image type does not match its contents.",
                        415,
                    )
                width, height = image.size
                if (
                    width <= 0
                    or height <= 0
                    or width > max_dimension
                    or height > max_dimension
                    or width * height > max_pixels
                ):
                    raise InputError(
                        "too_large", "The screenshot exceeds the image resolution limit.", 413
                    )
                if getattr(image, "is_animated", False) or getattr(image, "n_frames", 1) != 1:
                    raise InputError(
                        "unsupported_media",
                        "Animated images are unsupported; upload a static screenshot.",
                        415,
                    )
                image.verify()

            # verify() does not decode pixels, and invalidates the first image.
            # A fresh open + load rejects broken/truncated compressed pixel data.
            with Image.open(BytesIO(data), formats=["PNG", "JPEG"]) as image:
                image.load()

            # JPEG verification alone accepts missing end-of-image markers; do
            # not permit truncated uploads even if a decoder tolerates them.
            if expected_format == "JPEG" and not data.endswith(b"\xff\xd9"):
                raise InputError(
                    "unsupported_media", "The screenshot is incomplete or invalid.", 415
                )
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise InputError(
            "too_large", "The screenshot exceeds the image resolution limit.", 413
        ) from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError) as exc:
        raise InputError(
            "unsupported_media", "The screenshot is incomplete or invalid.", 415
        ) from exc

    return ImagePayload(
        data=data, mime_type=mime_type, width=width, height=height, sha256=sha256(data).hexdigest()
    )

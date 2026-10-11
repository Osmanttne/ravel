"""Regenerate static synthetic screenshots without external data or network calls.

Run from repository root: .venv/bin/python -m app.fixtures.generate
The mock adapter computes hashes on startup, so matching follows these packaged files.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def generate(names: tuple[str, ...] | None = None) -> None:
    fixtures = Path(__file__).parent
    examples = {
        "ticket_offer.png": [
            "SYNTHETIC FIXTURE - NOT A REAL MESSAGE",
            "Free concert tickets!",
            "Pay a $20 transfer fee before delivery.",
            "https://tickets.example/offer",
            "Act now!",
        ],
        "legitimate_promotion.png": [
            "SYNTHETIC FIXTURE - NOT A REAL MESSAGE",
            "Campus club event - everyone welcome.",
            "https://campus.example/events",
            "No payment required.",
            "Repetition alone is not proof of fraud.",
        ],
        "credential_request.png": [
            "SYNTHETIC FIXTURE - NOT A REAL MESSAGE",
            "Your account will be suspended unless you act now.",
            "Reply with your password and PIN",
            "to verify your account.",
        ],
        "benign_code_alert.png": [
            "SYNTHETIC FIXTURE - NOT A REAL MESSAGE",
            "Your verification code is 123456.",
            "Never share this code with anyone.",
            "Enter it only in the official app you opened.",
        ],
    }
    if names is not None and not set(names).issubset(examples):
        raise ValueError("Unknown synthetic screenshot name.")
    font = ImageFont.load_default(size=20)
    for name, lines in examples.items():
        if names is not None and name not in names:
            continue
        image = Image.new("RGB", (760, 320), "#f1f5f9")
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((16, 16, 744, 304), radius=16, fill="white", outline="#cbd5e1")
        for index, line in enumerate(lines):
            draw.text((32, 38 + index * 48), line, font=font, fill="#334155")
        image.save(fixtures / name, format="PNG")


if __name__ == "__main__":
    generate()

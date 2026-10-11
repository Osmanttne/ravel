"""Conservative URL parsing only: this module never resolves or visits links."""

import ipaddress
import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import urlsplit

from app.services.ingest import InputError


@dataclass(frozen=True, slots=True)
class ParsedURL:
    hostname: str
    scheme: str
    safe_display: str


MAX_URL_LENGTH = 2048
MAX_URLS = 20
_SCHEME = re.compile(r"https?://", re.IGNORECASE)
_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\Z", re.ASCII)
_URL_IN_TEXT = re.compile(r"(?<![a-z0-9_])https?:[^\s<>\"']*", re.IGNORECASE)
_LOCAL_SUFFIXES = (".localhost", ".local", ".internal", ".test")


def _unsafe(
    message: str = "Use a complete HTTP or HTTPS URL with a public domain hostname.",
) -> InputError:
    # Do not interpolate raw values: queries, paths, and credentials can contain
    # private invitation tokens, personal identifiers, or payment information.
    return InputError("unsafe_url", message)


def parse_url(value: str) -> ParsedURL:
    """Return only a canonical hostname and secret-free origin for display.

    Reject credentials, control characters, ambiguous authorities, local names,
    IP literals and invalid ports. Exact subdomains remain distinct; registered
    domain grouping and destination fingerprints belong to Milestone 4. A DNS
    name that passes syntax checks is not evidence of a real or safe website.
    """
    if not value or not value.strip():
        raise InputError("insufficient_input", "Provide a URL to check.")
    if len(value) > MAX_URL_LENGTH:
        raise _unsafe("The URL exceeds the length limit.")
    if (
        any(
            character.isspace() or unicodedata.category(character) in {"Cc", "Cf"}
            for character in value
        )
        or "\\" in value
        or not _SCHEME.match(value)
    ):
        raise _unsafe()

    try:
        parts = urlsplit(value)
        if parts.scheme.lower() not in {"http", "https"} or not parts.netloc or not parts.hostname:
            raise _unsafe()
        if "@" in parts.netloc or parts.username is not None or parts.password is not None:
            raise _unsafe("URLs containing credentials are unsupported.")
        if "%" in parts.netloc:
            raise _unsafe("Encoded URL hostnames are unsupported.")
        hostname = parts.hostname
        port = parts.port  # Access validates the range and rejects malformed ports.
        if parts.netloc.endswith(":") or port == 0:
            raise _unsafe("The URL port is invalid.")

        # IP literals are not needed for the demo. Blocking all of them also
        # avoids suggesting that public IP addresses have undergone threat checks.
        try:
            ipaddress.ip_address(hostname)
        except ValueError:
            pass
        else:
            raise _unsafe("IP-address URLs are unsupported; use a public domain hostname.")

        # A trailing DNS root dot is equivalent to the same exact hostname.
        hostname = hostname.removesuffix(".").encode("idna").decode("ascii").lower()
        if len(hostname) > 253:
            raise _unsafe()
        labels = hostname.split(".")
        if len(labels) < 2 or any(
            len(label) > 63 or not _LABEL.fullmatch(label) for label in labels
        ):
            raise _unsafe()
        # Numeric / hexadecimal endings cover ambiguous browser IPv4 forms
        # such as 127.1 and 0177.0.0.1, rather than treating them as DNS names.
        if labels[-1].isdigit() or re.fullmatch(r"0x[0-9a-f]+", labels[-1]):
            raise _unsafe("IP-address URLs are unsupported; use a public domain hostname.")
        if hostname == "localhost" or hostname.endswith(_LOCAL_SUFFIXES):
            raise _unsafe("Local and internal URL hostnames are unsupported.")
    except (ValueError, UnicodeError) as exc:
        raise _unsafe() from exc

    scheme = parts.scheme.lower()
    port_suffix = (
        f":{port}" if port is not None and port != {"http": 80, "https": 443}[scheme] else ""
    )
    # Paths can contain secrets as well as queries/fragments. Display only the
    # origin; this value is deliberately not an exact-destination match key.
    return ParsedURL(
        hostname=hostname, scheme=scheme, safe_display=f"{scheme}://{hostname}{port_suffix}"
    )


def _trim_prose_punctuation(value: str) -> str:
    """Remove ordinary prose delimiters without destroying balanced URL paths."""
    while True:
        previous = value
        value = value.rstrip(".,!;?")
        for closing, opening in ((")", "("), ("]", "["), ("}", "{")):
            if value.endswith(closing) and value.count(closing) > value.count(opening):
                value = value[:-1]
        if value == previous:
            return value


def extract_urls(text: str) -> list[ParsedURL]:
    """Validate every explicit HTTP(S) link, including malformed candidates.

    Invalid links fail the check rather than disappearing as if no link was
    supplied. This does not discover bare domains or follow shortened URLs.
    """
    urls: list[ParsedURL] = []
    for match in _URL_IN_TEXT.finditer(text):
        if len(urls) >= MAX_URLS:
            raise _unsafe(f"Provide no more than {MAX_URLS} URLs in one check.")
        urls.append(parse_url(_trim_prose_punctuation(match.group(0))))
    return urls

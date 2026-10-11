import pytest

from app.services.ingest import InputError
from app.services.url_intelligence import extract_urls, parse_url


def test_hostname_case_idna_and_default_ports_are_normalized():
    parsed = parse_url("HTTPS://BÜCHER.EXAMPLE.:443/secret-path?token=secret#secret")
    assert parsed.hostname == "xn--bcher-kva.example"
    assert parsed.scheme == "https"
    assert parsed.safe_display == "https://xn--bcher-kva.example"


def test_display_omits_sensitive_path_query_and_fragment():
    parsed = parse_url("http://offers.example:8080/private-invite?token=secret#secret")
    assert parsed.safe_display == "http://offers.example:8080"
    assert "secret" not in repr(parsed)
    assert "private-invite" not in repr(parsed)


def test_exact_subdomains_are_not_merged():
    assert parse_url("https://one.tickets.example/").hostname == "one.tickets.example"
    assert parse_url("https://two.tickets.example/").hostname == "two.tickets.example"


def test_text_extraction_handles_prose_punctuation_without_following_urls():
    urls = extract_urls("See (https://tickets.example/offer). Then https://club.example/event!")
    assert [url.hostname for url in urls] == ["tickets.example", "club.example"]


@pytest.mark.parametrize("url", ["http://127.1/", "http://0177.0.0.1/", "http://0x7f000001/"])
def test_ambiguous_ipv4_forms_are_rejected(url):
    with pytest.raises(InputError) as error:
        parse_url(url)
    assert error.value.code == "unsafe_url"


def test_malformed_link_in_text_cannot_disappear_as_no_evidence():
    with pytest.raises(InputError):
        extract_urls("Offer details: https:///missing-host")

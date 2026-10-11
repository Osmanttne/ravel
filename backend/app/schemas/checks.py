"""Strict, versioned contracts for private checks and evidence provenance."""

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SourceChannel(StrEnum):
    IOS_SHARE = "ios_share"
    IOS_APP = "ios_app"
    PHOTON_IMESSAGE = "photon_imessage"
    WEB = "web"
    FIXTURE = "fixture"


NonblankText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=10_000),
]
NonblankURL = Annotated[
    str,
    StringConstraints(min_length=1, max_length=2_048),
]


class TextCheckRequest(StrictModel):
    content_type: Literal["text"]
    text: NonblankText
    # Enum wire values arrive as strings from both JSON and multipart forms.
    source_channel: SourceChannel = Field(default=SourceChannel.IOS_APP, strict=False)
    privacy_mode: Literal["private_check"] = "private_check"


class URLCheckRequest(StrictModel):
    content_type: Literal["url"]
    url: NonblankURL
    source_channel: SourceChannel = Field(default=SourceChannel.IOS_APP, strict=False)
    privacy_mode: Literal["private_check"] = "private_check"


CheckRequest = Annotated[TextCheckRequest | URLCheckRequest, Field(discriminator="content_type")]
CHECK_REQUEST_ADAPTER = TypeAdapter(CheckRequest)


class ImageCheckMetadata(StrictModel):
    content_type: Literal["image"] = "image"
    source_channel: SourceChannel = Field(default=SourceChannel.IOS_APP, strict=False)
    privacy_mode: Literal["private_check"] = "private_check"
    context: Annotated[str, StringConstraints(max_length=2_000)] | None = None


CheckMode = Literal["fixture", "gemini"]
ContentCategory = Literal["ticket_offer", "promotion", "unknown"]
PaymentReason = Literal[
    "advance_fee",
    "transfer_fee",
    "upfront_payment",
    "deposit_before_delivery",
    "generic_payment",
]
UncertaintyCode = Literal[
    "identity_unverified",
    "ticket_ownership_unverified",
    "content_unclear",
    "incomplete_content",
    "conflicting_evidence",
    "external_verification_needed",
]
EvidenceField = Literal[
    "category",
    "payment_requested",
    "payment_reason",
    "urgency_indicated",
    "secrecy_requested",
    "credentials_requested",
    "verification_code_requested",
    "account_threat_indicated",
    "urls_visible",
]


class EvidenceSpan(StrictModel):
    """An internal quote supporting extraction; never part of a public response."""

    field: EvidenceField
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class Extraction(StrictModel):
    """Provider observations, never a provider verdict or proof of fraud."""

    category: ContentCategory = "unknown"
    payment_requested: bool | None = None
    payment_reason: Annotated[str, StringConstraints(max_length=200)] | None = None
    urgency_indicated: bool | None = None
    secrecy_requested: bool | None = None
    credentials_requested: bool | None = None
    verification_code_requested: bool | None = None
    account_threat_indicated: bool | None = None
    urls_visible: list[Annotated[str, StringConstraints(min_length=1, max_length=2_048)]] = Field(
        default_factory=list, max_length=20
    )
    evidence_spans: list[EvidenceSpan] = Field(default_factory=list, max_length=20)
    uncertainty_codes: list[UncertaintyCode] = Field(default_factory=list, max_length=6)
    claims: list[Annotated[str, StringConstraints(max_length=500)]] = Field(
        default_factory=list, max_length=20
    )
    uncertainties: list[Annotated[str, StringConstraints(max_length=500)]] = Field(
        default_factory=list, max_length=20
    )


class Indicator(StrictModel):
    code: str
    description: str
    evidence_source: Literal[
        "submitted_content",
        "fixture_provider",
        "gemini",
        "opt_in_reports",
        "trusted_threat_intelligence",
    ]
    verification_level: Literal[
        "observed_claim",
        "unverified_inference",
        "unreviewed_reports",
        "independently_verified",
    ]


class AssessmentCategory(StrEnum):
    KNOWN_MALICIOUS_EVIDENCE = "known_malicious_evidence"
    SUSPICIOUS_VERIFY = "suspicious_verify"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    NEEDS_HUMAN_REVIEW = "needs_human_review"


class Assessment(StrictModel):
    category: AssessmentCategory = Field(strict=False)
    summary: str
    # Extraction alone cannot produce independently verified evidence.
    verified_fraud: Literal[False] = False
    indicators: list[Indicator] = Field(default_factory=list)
    recommended_action: str
    related_report_count: int = Field(default=0, ge=0)
    known_threat: Literal[False] = False


class PublicObservations(StrictModel):
    """Controlled observations without model quotes, claims, or raw URL tokens."""

    category: ContentCategory = "unknown"
    payment_requested: bool | None = None
    payment_reason: PaymentReason | None = None
    secrecy_requested: bool | None = None
    urgency_indicated: bool | None = None
    credentials_requested: bool | None = None
    verification_code_requested: bool | None = None
    account_threat_indicated: bool | None = None
    destinations: list[Annotated[str, StringConstraints(min_length=1, max_length=2_048)]] = Field(
        default_factory=list, max_length=20
    )
    evidence_source: Literal["fixture_provider", "gemini", "not_analyzed"] = "not_analyzed"
    verification_level: Literal["unverified_inference", "not_assessed"] = "not_assessed"
    uncertainty_codes: list[UncertaintyCode] = Field(default_factory=list, max_length=6)


# Both names describe the same stable public contract.
ObservationResponse = PublicObservations


class CheckResponse(StrictModel):
    check_id: str
    mode: CheckMode = "fixture"
    assessment: Assessment
    observations: PublicObservations | None = None
    report_created: Literal[False] = False
    limitations: list[str] = Field(default_factory=list)

"""Conservative, deterministic policy over fixture or AI extraction.

This is an uncalibrated heuristic over observations, not a fraud classifier.
It has no report repository or threat-intelligence connection and cannot infer
corroboration, verified fraud, or a campaign from repeated submissions.
"""

from app.schemas import Assessment, AssessmentCategory, CheckMode, Extraction, Indicator

_ADVANCE_FEE_REASONS = frozenset(
    {"advance_fee", "transfer_fee", "upfront_payment", "deposit_before_delivery"}
)


def build_assessment(
    extraction: Extraction, *, input_kind: str, mode: CheckMode = "fixture"
) -> Assessment:
    """Convert extracted claims into a cautious result without changing state."""
    if mode not in {"fixture", "gemini"}:
        raise ValueError("Unsupported assessment mode.")
    ai_extraction = mode == "gemini"
    source = (
        "gemini"
        if ai_extraction
        else ("fixture_provider" if input_kind == "image" else "submitted_content")
    )
    verification = (
        "unverified_inference" if ai_extraction or input_kind == "image" else "observed_claim"
    )
    if ai_extraction and {"conflicting_evidence", "content_unclear"}.intersection(
        extraction.uncertainty_codes
    ):
        return Assessment(
            category=AssessmentCategory.NEEDS_HUMAN_REVIEW,
            summary=(
                "AI extraction could not interpret this content consistently. "
                "Its uncertain observations do not establish fraud."
            ),
            recommended_action=(
                "Review the original content and verify the offer through an independently "
                "obtained official contact before acting."
            ),
        )
    indicators: list[Indicator] = []
    payment = extraction.payment_requested is True
    urgency = extraction.urgency_indicated is True
    credentials = extraction.credentials_requested is True
    verification_code = extraction.verification_code_requested is True
    account_threat = extraction.account_threat_indicated is True
    advance_fee = (
        payment
        and not account_threat
        and extraction.payment_reason in _ADVANCE_FEE_REASONS
    )

    if advance_fee:
        indicators.append(
            Indicator(
                code="advance_fee",
                description=(
                    "AI extraction suggests a fee or payment is requested before delivery."
                    if ai_extraction
                    else "The offer requests a fee or payment before delivery."
                ),
                evidence_source=source,
                verification_level=verification,
            )
        )
    elif payment:
        indicators.append(
            Indicator(
                code="payment_request",
                description=(
                    "AI extraction suggests the content includes a payment request."
                    if ai_extraction
                    else "The submitted content contains a payment request."
                ),
                evidence_source=source,
                verification_level=verification,
            )
        )
    if urgency:
        indicators.append(
            Indicator(
                code="urgency",
                description=(
                    "AI extraction suggests the content pressures the recipient to act quickly."
                    if ai_extraction
                    else "The submitted content urges the recipient to act quickly."
                ),
                evidence_source=source,
                verification_level=verification,
            )
        )

    for present, code, claim in (
        (credentials, "credential_request", "asks the recipient to disclose login secrets"),
        (
            verification_code,
            "verification_code_request",
            "asks the recipient to share an authentication or reset code with someone else",
        ),
        (
            account_threat,
            "account_threat",
            "claims account access will be restricted unless the recipient acts",
        ),
    ):
        if present:
            indicators.append(
                Indicator(
                    code=code,
                    description=(
                        f"AI extraction suggests the content {claim}."
                        if ai_extraction
                        else f"The submitted content {claim}."
                    ),
                    evidence_source=source,
                    verification_level=verification,
                )
            )

    if credentials or verification_code:
        return Assessment(
            category=AssessmentCategory.SUSPICIOUS_VERIFY,
            summary=(
                "AI extraction suggests a request to disclose login secrets or share an "
                "authentication code. Confirm the content and verify the request independently; "
                "these inferences do not establish fraud."
                if ai_extraction
                else "A request to disclose login secrets or share an authentication code is "
                "indicated. Verify the request independently; these claims do not establish fraud."
            ),
            indicators=indicators,
            recommended_action=(
                "Do not share passwords, PINs, or authentication codes in response "
                "to this message. "
                "Verify the request through an independently obtained official contact."
            ),
        )

    if account_threat and payment and not advance_fee:
        return Assessment(
            category=AssessmentCategory.SUSPICIOUS_VERIFY,
            summary=(
                "AI extraction suggests a payment request is combined with a threat to restrict "
                "account access. Confirm the content and verify the request independently; "
                "these inferences do not establish fraud."
                if ai_extraction
                else "A payment request is combined with a claim that account access will be "
                "restricted. Verify the request independently; these claims do not establish fraud."
            ),
            indicators=indicators,
            recommended_action=(
                "Verify the account notice through an independently opened official app or "
                "an independently obtained official contact before paying or sharing secrets."
            ),
        )

    if advance_fee or (payment and urgency):
        if ai_extraction:
            summary = (
                "AI extraction suggests an advance fee is requested before delivery. "
                "Confirm the content and verify the offer before paying; "
                "this inference does not establish fraud."
                if advance_fee
                else "AI extraction suggests a payment request is combined with pressure to act "
                "quickly. Confirm the content and verify the offer before paying; "
                "these inferences do not establish fraud."
            )
        else:
            summary = (
                "An advance fee is requested before delivery. Verify the offer before paying; "
                "this claim does not establish fraud."
                if advance_fee
                else "A payment request is combined with pressure to act quickly. Verify "
                "the offer before paying; these claims do not establish fraud."
            )
        return Assessment(
            category=AssessmentCategory.SUSPICIOUS_VERIFY,
            summary=summary,
            indicators=indicators,
            recommended_action=(
                "Verify the offer through an independently obtained official contact "
                "or ticket platform before sending money or payment credentials."
            ),
        )

    return Assessment(
        category=AssessmentCategory.INSUFFICIENT_EVIDENCE,
        summary=(
            "This URL was parsed locally. No model analysis, verified threat lookup, "
            "or community report lookup was performed."
            if input_kind == "url"
            else "AI extraction did not provide enough evidence to determine whether this content "
            "is legitimate. No verified threat or community report lookup has been performed."
            if ai_extraction
            else "There is not enough evidence to determine whether this content is legitimate. "
            "No verified threat or community report lookup has been performed."
        ),
        indicators=indicators,
        recommended_action=(
            "Verify the sender and any payment destination independently before acting. "
            "Missing evidence does not establish safety."
        ),
    )

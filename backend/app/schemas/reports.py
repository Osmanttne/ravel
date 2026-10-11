"""Future opt-in reporting contract; these models do not persist anything."""

from typing import Annotated, Literal

from pydantic import BeforeValidator, StringConstraints

from app.schemas.checks import StrictModel


def _require_affirmative_consent(value: object) -> bool:
    # Literal[True] alone also accepts the integer 1; consent must be a JSON bool.
    if value is not True:
        raise ValueError("Explicit affirmative consent must be the boolean true.")
    return True


AffirmativeConsent = Annotated[Literal[True], BeforeValidator(_require_affirmative_consent)]
BoundedCategory = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
BoundedDestination = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2_048)
]
BoundedPattern = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1_000)
]


class ConfirmedReportFields(StrictModel):
    category: BoundedCategory
    normalized_destination: BoundedDestination
    message_pattern: BoundedPattern


class ReportRequest(StrictModel):
    related_check_id: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            min_length=1,
            max_length=100,
            pattern=r"^chk_[A-Za-z0-9_-]+$",
        ),
    ]
    consent_to_contribute: AffirmativeConsent
    confirmed_fields: ConfirmedReportFields


class ReportResponse(StrictModel):
    report_id: str
    status: Literal["pending_review"] = "pending_review"
    created: bool

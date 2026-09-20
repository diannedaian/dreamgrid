"""Provider-neutral boundary for agent payments (Linda's domain).

An AI agent that has helped a shopper assemble a room asks for permission to pay for it.
The shopper grants a *mandate* (a spending cap, the merchants involved, an expiry) and
proves consent with a passkey. The payment network then issues an *intent* whose signed
token the agent can present to merchants.

The first implementation is the in-process ``MockPaymentNetwork`` sandbox. It moves no
money and issues tokens only our own API can verify. A Visa Intelligent Commerce or Visa
Acceptance adapter would implement the same ``PaymentNetwork`` port. Nothing here imports
a provider SDK.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Literal, Protocol

IntentStatus = Literal["authorized", "captured", "reversed", "declined"]
DeclineCode = Literal[
    "MANDATE_EXCEEDED",
    "BUDGET_EXCEEDED",
    "MANDATE_EXPIRED",
    "MERCHANT_NOT_ALLOWED",
    "CONSENT_INVALID",
    "EMPTY_PLAN",
    "UNPRICED_LINE",
]


@dataclass(frozen=True)
class PaymentLine:
    product_id: str
    title: str
    merchant: str
    unit_price_usd: Decimal
    quantity: int = 1

    @property
    def total_usd(self) -> Decimal:
        return self.unit_price_usd * self.quantity


@dataclass(frozen=True)
class Mandate:
    """What the shopper authorized the agent to do, and for how long."""

    max_amount_usd: Decimal
    merchants: tuple[str, ...]
    expires_at: datetime
    budget_usd: Decimal | None = None


@dataclass(frozen=True)
class ConsentEvidence:
    """How the shopper proved they approved this exact plan."""

    method: Literal["passkey", "confirm"]
    credential_id: str | None
    user_verified: bool
    challenge: str


@dataclass(frozen=True)
class PaymentIntent:
    intent_id: str
    status: IntentStatus
    amount_usd: Decimal
    currency: str
    lines: tuple[PaymentLine, ...]
    mandate: Mandate
    consent: ConsentEvidence
    provider: str
    is_sandbox: bool
    created_at: datetime
    token: str | None = None
    decline_code: DeclineCode | None = None
    decline_reason: str | None = None
    history: tuple[tuple[datetime, IntentStatus], ...] = field(default_factory=tuple)


class PaymentNetwork(Protocol):
    """Port for the network that issues, captures, and reverses payment intents."""

    def create_intent(
        self,
        lines: tuple[PaymentLine, ...],
        mandate: Mandate,
        consent: ConsentEvidence,
        *,
        idempotency_key: str,
    ) -> PaymentIntent: ...

    def capture(self, intent_id: str) -> PaymentIntent: ...

    def reverse(self, intent_id: str) -> PaymentIntent: ...

    def get(self, intent_id: str) -> PaymentIntent | None: ...

    def ledger(self) -> tuple[PaymentIntent, ...]: ...

"""Provider-neutral boundary for Linda's commerce pipeline.

The first concrete implementation may use a Visa sandbox. No real purchase is
authorized by this interface, and no provider SDK types belong here.
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, Protocol


@dataclass(frozen=True)
class ShoppingLineItem:
    """One approved product and its price at approval time."""

    product_id: str
    title: str
    unit_price_usd: Decimal
    quantity: int = 1


@dataclass(frozen=True)
class ShoppingPlan:
    """User-approved shopping plan passed to a commerce adapter."""

    items: tuple[ShoppingLineItem, ...]
    budget_usd: Decimal


@dataclass(frozen=True)
class CheckoutIntent:
    """Sandbox-safe result; it is not proof of a real purchase."""

    intent_id: str
    status: Literal["approved", "declined", "unavailable"]
    provider: str
    is_sandbox: bool


class CommerceGateway(Protocol):
    """Port implemented by a future sandbox commerce adapter."""

    async def create_checkout_intent(
        self,
        plan: ShoppingPlan,
        *,
        idempotency_key: str,
    ) -> CheckoutIntent:
        """Create a user-approved sandbox checkout intent."""
        ...

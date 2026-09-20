"""In-process sandbox payment network.

Issues signed payment-intent tokens after checking the shopper's mandate. It never
contacts a card network and never moves money; every token says so in its header.
The shape (authorize → capture / reverse, decline codes, an append-only ledger)
mirrors what a Visa Acceptance or Visa Intelligent Commerce adapter would return, so
the UI and MCP tools do not change when a real sandbox replaces this.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal
from threading import Lock

from dreamgrid_api.boundaries.payments import (
    ConsentEvidence,
    DeclineCode,
    Mandate,
    PaymentIntent,
    PaymentLine,
)

PROVIDER = "dreamgrid-sandbox"
TOKEN_HEADER = {"alg": "HS256", "typ": "dreamgrid-payment-intent+jwt", "sandbox": True}


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class PaymentDeclined(Exception):
    def __init__(self, code: DeclineCode, reason: str) -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason


class MockPaymentNetwork:
    def __init__(
        self, signing_key: str, now: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        if len(signing_key) < 16:
            raise ValueError("The payment signing key must be at least 16 characters.")
        self._key = signing_key.encode()
        self._now = now
        self._intents: dict[str, PaymentIntent] = {}
        self._by_idempotency: dict[str, str] = {}
        self._order: list[str] = []
        self._lock = Lock()

    # ── issuing ────────────────────────────────────────────────────────────────

    def create_intent(
        self,
        lines: tuple[PaymentLine, ...],
        mandate: Mandate,
        consent: ConsentEvidence,
        *,
        idempotency_key: str,
    ) -> PaymentIntent:
        with self._lock:
            existing = self._by_idempotency.get(idempotency_key)
            if existing:
                return self._intents[existing]
            now = self._now()
            amount = sum((line.total_usd for line in lines), Decimal("0"))
            intent_id = f"pi_{secrets.token_hex(8)}"
            try:
                self._check(lines, mandate, consent, amount, now)
            except PaymentDeclined as declined:
                intent = PaymentIntent(
                    intent_id=intent_id,
                    status="declined",
                    amount_usd=amount,
                    currency="USD",
                    lines=lines,
                    mandate=mandate,
                    consent=consent,
                    provider=PROVIDER,
                    is_sandbox=True,
                    created_at=now,
                    decline_code=declined.code,
                    decline_reason=declined.reason,
                    history=((now, "declined"),),
                )
            else:
                intent = PaymentIntent(
                    intent_id=intent_id,
                    status="authorized",
                    amount_usd=amount,
                    currency="USD",
                    lines=lines,
                    mandate=mandate,
                    consent=consent,
                    provider=PROVIDER,
                    is_sandbox=True,
                    created_at=now,
                    history=((now, "authorized"),),
                )
                intent = PaymentIntent(**{**intent.__dict__, "token": self._sign(intent)})
            self._intents[intent_id] = intent
            self._by_idempotency[idempotency_key] = intent_id
            self._order.append(intent_id)
            return intent

    def _check(
        self,
        lines: tuple[PaymentLine, ...],
        mandate: Mandate,
        consent: ConsentEvidence,
        amount: Decimal,
        now: datetime,
    ) -> None:
        if not lines:
            raise PaymentDeclined("EMPTY_PLAN", "There is nothing priced to pay for.")
        for line in lines:
            if line.unit_price_usd <= 0 or line.quantity <= 0:
                raise PaymentDeclined(
                    "UNPRICED_LINE", f"{line.title} has no known price and cannot be authorized."
                )
        if not consent.challenge or (consent.method == "passkey" and not consent.user_verified):
            raise PaymentDeclined(
                "CONSENT_INVALID", "The shopper's approval could not be verified."
            )
        if mandate.expires_at <= now:
            raise PaymentDeclined(
                "MANDATE_EXPIRED", "This approval has expired; ask the shopper again."
            )
        allowed = {m.strip().lower() for m in mandate.merchants}
        for line in lines:
            if line.merchant.strip().lower() not in allowed:
                raise PaymentDeclined(
                    "MERCHANT_NOT_ALLOWED", f"{line.merchant} is not in the approved merchant list."
                )
        if amount > mandate.max_amount_usd:
            raise PaymentDeclined(
                "MANDATE_EXCEEDED",
                f"${amount:.2f} exceeds the ${mandate.max_amount_usd:.2f} the shopper approved.",
            )
        if (
            mandate.budget_usd is not None
            and mandate.budget_usd > 0
            and amount > mandate.budget_usd
        ):
            raise PaymentDeclined(
                "BUDGET_EXCEEDED",
                f"${amount:.2f} is over the ${mandate.budget_usd:.2f} room budget.",
            )

    # ── lifecycle ─────────────────────────────────────────────────────────────

    def capture(self, intent_id: str) -> PaymentIntent:
        return self._transition(intent_id, "captured", allowed_from=("authorized",))

    def reverse(self, intent_id: str) -> PaymentIntent:
        return self._transition(intent_id, "reversed", allowed_from=("authorized", "captured"))

    def _transition(
        self, intent_id: str, to: str, *, allowed_from: tuple[str, ...]
    ) -> PaymentIntent:
        with self._lock:
            intent = self._intents.get(intent_id)
            if intent is None:
                raise KeyError(intent_id)
            if intent.status not in allowed_from:
                raise ValueError(f"Cannot move a {intent.status} intent to {to}.")
            now = self._now()
            updated = PaymentIntent(
                **{**intent.__dict__, "status": to, "history": (*intent.history, (now, to))}
            )
            self._intents[intent_id] = updated
            return updated

    def get(self, intent_id: str) -> PaymentIntent | None:
        return self._intents.get(intent_id)

    def ledger(self) -> tuple[PaymentIntent, ...]:
        return tuple(self._intents[i] for i in self._order)

    # ── tokens ────────────────────────────────────────────────────────────────

    def _sign(self, intent: PaymentIntent) -> str:
        payload = {
            "iss": PROVIDER,
            "sub": intent.intent_id,
            "amt": f"{intent.amount_usd:.2f}",
            "cur": intent.currency,
            "merchants": sorted({line.merchant for line in intent.lines}),
            "lines": [
                {"id": line.product_id, "qty": line.quantity, "usd": f"{line.unit_price_usd:.2f}"}
                for line in intent.lines
            ],
            "mandate": {
                "max": f"{intent.mandate.max_amount_usd:.2f}",
                "exp": int(intent.mandate.expires_at.timestamp()),
            },
            "consent": {
                "method": intent.consent.method,
                "cred": intent.consent.credential_id,
                "uv": intent.consent.user_verified,
                "challenge_sha256": hashlib.sha256(intent.consent.challenge.encode()).hexdigest(),
            },
            "iat": int(intent.created_at.timestamp()),
            "exp": int(intent.mandate.expires_at.timestamp()),
            "sandbox": True,
        }
        head = _b64(json.dumps(TOKEN_HEADER, separators=(",", ":"), sort_keys=True).encode())
        body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
        signature = hmac.new(self._key, f"{head}.{body}".encode(), hashlib.sha256).digest()
        return f"{head}.{body}.{_b64(signature)}"

    def verify_token(self, token: str) -> dict[str, object] | None:
        """Return the payload if the token was signed by this network and has not expired."""

        try:
            head, body, signature = token.split(".")
        except ValueError:
            return None
        expected = hmac.new(self._key, f"{head}.{body}".encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _unb64(signature)):
            return None
        payload: dict[str, object] = json.loads(_unb64(body))
        if int(str(payload.get("exp", 0))) <= int(self._now().timestamp()):
            return None
        return payload

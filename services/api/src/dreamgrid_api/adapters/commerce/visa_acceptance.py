"""Visa Acceptance (Cybersource) sandbox adapter for agent payments.

Layers a real network call on top of the local sandbox rules: the mandate, consent and
signed-token logic stay in :class:`MockPaymentNetwork`; when a plan passes those checks this
adapter authorizes the amount at ``apitest.visaacceptance.com`` with Visa's published test card,
and later captures or reverses the same transaction. Only the **test** host is ever used, so no
money moves. If Visa cannot be reached the intent still goes through on the local sandbox and
says so (``fallback_reason``), keeping the demo path alive.

Authentication is HTTP Signature (HMAC-SHA256 over host, date, request-target, digest and
merchant id) with the merchant's REST shared secret, exactly as the Visa Acceptance SDKs do.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

import httpx

from dreamgrid_api.adapters.commerce.mock_payment_network import MockPaymentNetwork
from dreamgrid_api.boundaries.payments import (
    DEFAULT_CARD_ID,
    ConsentEvidence,
    Mandate,
    PaymentIntent,
    PaymentLine,
)

log = logging.getLogger(__name__)

TEST_HOST = "apitest.visaacceptance.com"
PROVIDER = "visa-acceptance-sandbox"
# Visa's documented sandbox test cards, never real PANs. Server-side only; the browser only ever
# sees an id, a label and the last four digits. The shopper "picks a card" from these in checkout.
TEST_CARDS: dict[str, dict[str, str]] = {
    "visa-1111": {"number": "4111111111111111", "expirationMonth": "12", "expirationYear": "2031"},
    "visa-3705": {
        "number": "4622943127013705",
        "expirationMonth": "12",
        "expirationYear": "2031",
        "securityCode": "838",
    },
}


def card_for(card_id: str | None) -> tuple[str, dict[str, str]]:
    """Resolve the shopper's pick to a sandbox card, defaulting to the first one."""

    key = card_id if card_id in TEST_CARDS else DEFAULT_CARD_ID
    return key, TEST_CARDS[key]


DEMO_BILL_TO = {
    "firstName": "DreamGrid",
    "lastName": "Shopper",
    "address1": "1 Market St",
    "locality": "San Francisco",
    "administrativeArea": "CA",
    "postalCode": "94105",
    "country": "US",
    "email": "shopper@dreamgrid.test",
}


@dataclass(frozen=True)
class VisaAcceptanceCredentials:
    merchant_id: str
    key_id: str
    shared_secret: str  # Base64 as issued in the Business Center

    def __post_init__(self) -> None:
        if not (self.merchant_id and self.key_id and self.shared_secret):
            raise ValueError(
                "Visa Acceptance merchant id, key id and shared secret are all required."
            )
        base64.b64decode(self.shared_secret, validate=True)


def _sub(data: dict[str, object], key: str) -> dict[str, object]:
    """A nested object from a Visa response, or {} when absent / not an object."""

    value = data.get(key)
    return value if isinstance(value, dict) else {}


class VisaAcceptanceError(RuntimeError):
    """The Visa sandbox rejected or could not process a request."""


class VisaAcceptanceClient:
    """Minimal signed REST client for the payments resource."""

    def __init__(
        self,
        credentials: VisaAcceptanceCredentials,
        http: httpx.Client | None = None,
        host: str = TEST_HOST,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        if not host.startswith("apitest."):
            raise ValueError("Only the Visa Acceptance test host may be used.")
        self._creds = credentials
        self._host = host
        self._http = http or httpx.Client(timeout=30)
        self._now = now

    def signed_headers(self, path: str, body: str) -> dict[str, str]:
        digest = "SHA-256=" + base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
        date = self._now().strftime("%a, %d %b %Y %H:%M:%S GMT")
        to_sign = (
            f"host: {self._host}\ndate: {date}\n(request-target): post {path}\n"
            f"digest: {digest}\nv-c-merchant-id: {self._creds.merchant_id}"
        )
        key = base64.b64decode(self._creds.shared_secret)
        signature = base64.b64encode(
            hmac.new(key, to_sign.encode(), hashlib.sha256).digest()
        ).decode()
        return {
            "v-c-merchant-id": self._creds.merchant_id,
            "Date": date,
            "Host": self._host,
            "Digest": digest,
            "Content-Type": "application/json",
            "Signature": (
                f'keyid="{self._creds.key_id}", algorithm="HmacSHA256", '
                'headers="host date (request-target) digest v-c-merchant-id", '
                f'signature="{signature}"'
            ),
        }

    def post(self, path: str, payload: dict[str, object]) -> dict[str, object]:
        body = json.dumps(payload, separators=(",", ":"))
        try:
            response = self._http.post(
                f"https://{self._host}{path}", content=body, headers=self.signed_headers(path, body)
            )
        except httpx.HTTPError as error:
            raise VisaAcceptanceError(
                f"Visa sandbox unreachable ({error.__class__.__name__})."
            ) from error
        data: dict[str, object] = response.json() if response.content else {}
        if response.status_code >= 400:
            detail = data.get("message") or data.get("reason") or _sub(data, "response").get("rmsg")
            raise VisaAcceptanceError(
                f"Visa sandbox HTTP {response.status_code}: {detail or 'request rejected'}"
            )
        return data

    # ── payments resource ─────────────────────────────────────────────────────

    def authorize(
        self,
        reference: str,
        amount_usd: Decimal,
        lines: tuple[PaymentLine, ...],
        card_id: str | None = None,
    ) -> dict[str, object]:
        _, card = card_for(card_id)
        payload: dict[str, object] = {
            "clientReferenceInformation": {"code": reference[:50]},
            "processingInformation": {"capture": False},
            "paymentInformation": {"card": card},
            "orderInformation": {
                "amountDetails": {"totalAmount": f"{amount_usd:.2f}", "currency": "USD"},
                "billTo": DEMO_BILL_TO,
                "lineItems": [
                    {
                        "productCode": "default",
                        "productName": line.title[:255],
                        "productSku": line.product_id[:255],
                        "quantity": line.quantity,
                        "unitPrice": f"{line.unit_price_usd:.2f}",
                    }
                    for line in lines
                ],
            },
        }
        return self.post("/pts/v2/payments", payload)

    def capture(self, payment_id: str, reference: str, amount_usd: Decimal) -> dict[str, object]:
        return self.post(
            f"/pts/v2/payments/{payment_id}/captures",
            {
                "clientReferenceInformation": {"code": reference[:50]},
                "orderInformation": {
                    "amountDetails": {"totalAmount": f"{amount_usd:.2f}", "currency": "USD"}
                },
            },
        )

    def reverse(self, payment_id: str, reference: str, amount_usd: Decimal) -> dict[str, object]:
        return self.post(
            f"/pts/v2/payments/{payment_id}/reversals",
            {
                "clientReferenceInformation": {"code": reference[:50]},
                "reversalInformation": {
                    "amountDetails": {"totalAmount": f"{amount_usd:.2f}"},
                    "reason": "shopper released the hold",
                },
            },
        )

    def refund(self, payment_id: str, reference: str, amount_usd: Decimal) -> dict[str, object]:
        return self.post(
            f"/pts/v2/payments/{payment_id}/refunds",
            {
                "clientReferenceInformation": {"code": reference[:50]},
                "orderInformation": {
                    "amountDetails": {"totalAmount": f"{amount_usd:.2f}", "currency": "USD"}
                },
            },
        )


class VisaAcceptanceNetwork:
    """PaymentNetwork backed by the Visa Acceptance sandbox, with the local sandbox as fallback."""

    def __init__(self, local: MockPaymentNetwork, client: VisaAcceptanceClient) -> None:
        self._local = local
        self._client = client

    def create_intent(
        self,
        lines: tuple[PaymentLine, ...],
        mandate: Mandate,
        consent: ConsentEvidence,
        *,
        idempotency_key: str,
        card_id: str | None = None,
    ) -> PaymentIntent:
        existing = self._local.get_by_idempotency(idempotency_key)
        if existing:
            return existing
        intent = self._local.create_intent(
            lines, mandate, consent, idempotency_key=idempotency_key, card_id=card_id
        )
        if intent.status != "authorized":
            return intent  # mandate declined locally; Visa is never asked
        try:
            result = self._client.authorize(
                intent.intent_id, intent.amount_usd, lines, card_id=intent.card_id
            )
        except VisaAcceptanceError as error:
            log.warning(
                "Visa Acceptance unavailable, keeping local sandbox authorization: %s", error
            )
            return self._local.update(intent.intent_id, fallback_reason=str(error))
        status = str(result.get("status", ""))
        approval = _sub(result, "processorInformation").get("approvalCode")
        reference = str(result.get("id", "")) or None
        if status != "AUTHORIZED":
            reason = _sub(result, "errorInformation").get("reason") or status or "no status"
            return self._local.decline(
                intent.intent_id,
                "NETWORK_DECLINED",
                f"Visa sandbox declined the authorization ({reason}).",
                network_reference=reference,
            )
        return self._local.update(
            intent.intent_id,
            provider=PROVIDER,
            network_reference=reference,
            approval_code=str(approval) if approval else None,
        )

    def capture(self, intent_id: str) -> PaymentIntent:
        intent = self._require(intent_id)
        if intent.provider == PROVIDER and intent.network_reference:
            self._client.capture(intent.network_reference, intent.intent_id, intent.amount_usd)
        return self._local.capture(intent_id)

    def reverse(self, intent_id: str) -> PaymentIntent:
        intent = self._require(intent_id)
        if intent.provider == PROVIDER and intent.network_reference:
            if intent.status == "captured":
                self._client.refund(intent.network_reference, intent.intent_id, intent.amount_usd)
            else:
                self._client.reverse(intent.network_reference, intent.intent_id, intent.amount_usd)
        return self._local.reverse(intent_id)

    def get(self, intent_id: str) -> PaymentIntent | None:
        return self._local.get(intent_id)

    def ledger(self) -> tuple[PaymentIntent, ...]:
        return self._local.ledger()

    def verify_token(self, token: str) -> dict[str, object] | None:
        return self._local.verify_token(token)

    def _require(self, intent_id: str) -> PaymentIntent:
        intent = self._local.get(intent_id)
        if intent is None:
            raise KeyError(intent_id)
        return intent

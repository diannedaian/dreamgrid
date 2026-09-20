"""Visa Acceptance sandbox adapter: request signing, response mapping, lifecycle and fallback."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest

from dreamgrid_api.adapters.commerce.mock_payment_network import MockPaymentNetwork
from dreamgrid_api.adapters.commerce.visa_acceptance import (
    PROVIDER,
    VisaAcceptanceClient,
    VisaAcceptanceCredentials,
    VisaAcceptanceNetwork,
)
from dreamgrid_api.boundaries.payments import ConsentEvidence, Mandate, PaymentLine
from dreamgrid_api.config import Settings
from dreamgrid_api.dependencies import build_payment_network

NOW = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)
SECRET = base64.b64encode(b"0123456789abcdef0123456789abcdef").decode()
CREDS = VisaAcceptanceCredentials(
    merchant_id="dreamgrid_test", key_id="key-uuid", shared_secret=SECRET
)
CONSENT = ConsentEvidence(
    method="passkey", credential_id="cred", user_verified=True, challenge="abc"
)
DESK = PaymentLine("desk", "College desk", "Wayfair", Decimal("159.00"))
CHAIR = PaymentLine("chair", "College chair", "Wayfair", Decimal("89.00"))
MANDATE = Mandate(Decimal("300"), ("Wayfair",), NOW + timedelta(hours=24))


class FakeVisa:
    """Records signed requests and plays the Visa sandbox: authorize, capture, reverse, refund."""

    def __init__(self, *, authorize_status: str = "AUTHORIZED", fail: bool = False) -> None:
        self.requests: list[httpx.Request] = []
        self.authorize_status = authorize_status
        self.fail = fail

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail:
            raise httpx.ConnectError("boom", request=request)
        path = request.url.path
        if path == "/pts/v2/payments":
            if self.authorize_status == "AUTHORIZED":
                return httpx.Response(
                    201,
                    json={
                        "id": "7898905752856203604806",
                        "status": "AUTHORIZED",
                        "processorInformation": {"approvalCode": "831000"},
                        "orderInformation": {"amountDetails": {"authorizedAmount": "248.00"}},
                    },
                )
            return httpx.Response(
                201,
                json={
                    "id": "789000000000",
                    "status": "DECLINED",
                    "errorInformation": {"reason": "INSUFFICIENT_FUND"},
                },
            )
        if path.endswith(("/captures", "/reversals", "/refunds")):
            status = {"captures": "PENDING", "reversals": "REVERSED", "refunds": "PENDING"}[
                path.rsplit("/", 1)[1]
            ]
            return httpx.Response(201, json={"id": "child", "status": status})
        return httpx.Response(404, json={"message": "not found"})

    def paths(self) -> list[str]:
        return [r.url.path for r in self.requests]


def network(fake: FakeVisa) -> VisaAcceptanceNetwork:
    client = VisaAcceptanceClient(
        CREDS, httpx.Client(transport=httpx.MockTransport(fake)), now=lambda: NOW
    )
    return VisaAcceptanceNetwork(
        MockPaymentNetwork("unit-test-signing-key-0123", now=lambda: NOW), client
    )


def test_requests_carry_a_correct_http_signature() -> None:
    fake = FakeVisa()
    network(fake).create_intent((DESK, CHAIR), MANDATE, CONSENT, idempotency_key="sig")
    request = fake.requests[0]
    body = request.content.decode()
    assert request.url.host == "apitest.visaacceptance.com"
    assert request.headers["v-c-merchant-id"] == "dreamgrid_test"
    assert request.headers["Date"] == "Sun, 20 Sep 2026 12:00:00 GMT"
    expected_digest = "SHA-256=" + base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
    assert request.headers["Digest"] == expected_digest
    to_sign = (
        "host: apitest.visaacceptance.com\ndate: Sun, 20 Sep 2026 12:00:00 GMT\n"
        "(request-target): post /pts/v2/payments\n"
        f"digest: {expected_digest}\nv-c-merchant-id: dreamgrid_test"
    )
    expected_sig = base64.b64encode(
        hmac.new(base64.b64decode(SECRET), to_sign.encode(), hashlib.sha256).digest()
    ).decode()
    assert f'signature="{expected_sig}"' in request.headers["Signature"]
    assert 'keyid="key-uuid"' in request.headers["Signature"]
    assert (
        'headers="host date (request-target) digest v-c-merchant-id"'
        in request.headers["Signature"]
    )
    payload = json.loads(body)
    assert payload["processingInformation"] == {
        "capture": False
    }  # authorization only, never a sale
    assert payload["orderInformation"]["amountDetails"] == {
        "totalAmount": "248.00",
        "currency": "USD",
    }
    assert payload["paymentInformation"]["card"]["number"] == "4111111111111111"
    assert [li["productSku"] for li in payload["orderInformation"]["lineItems"]] == [
        "desk",
        "chair",
    ]


def test_authorized_intent_records_visa_reference_and_keeps_signed_token() -> None:
    fake = FakeVisa()
    net = network(fake)
    intent = net.create_intent((DESK, CHAIR), MANDATE, CONSENT, idempotency_key="ok")
    assert intent.status == "authorized"
    assert intent.provider == PROVIDER and intent.is_sandbox is True
    assert intent.network_reference == "7898905752856203604806"
    assert intent.approval_code == "831000"
    assert intent.fallback_reason is None
    assert net.verify_token(intent.token or "") is not None
    # Idempotent: a repeat does not hit Visa again.
    assert (
        net.create_intent((DESK, CHAIR), MANDATE, CONSENT, idempotency_key="ok").intent_id
        == intent.intent_id
    )
    assert fake.paths() == ["/pts/v2/payments"]


def test_capture_then_refund_and_authorize_then_reverse_call_the_matching_visa_resources() -> None:
    fake = FakeVisa()
    net = network(fake)
    a = net.create_intent((DESK,), MANDATE, CONSENT, idempotency_key="a")
    assert net.capture(a.intent_id).status == "captured"
    assert net.reverse(a.intent_id).status == "reversed"  # refund after capture
    b = net.create_intent((CHAIR,), MANDATE, CONSENT, idempotency_key="b")
    assert net.reverse(b.intent_id).status == "reversed"  # plain reversal of a hold
    ref = "7898905752856203604806"
    assert fake.paths() == [
        "/pts/v2/payments",
        f"/pts/v2/payments/{ref}/captures",
        f"/pts/v2/payments/{ref}/refunds",
        "/pts/v2/payments",
        f"/pts/v2/payments/{ref}/reversals",
    ]
    assert (
        json.loads(fake.requests[1].content)["orderInformation"]["amountDetails"]["totalAmount"]
        == "159.00"
    )


def test_local_mandate_decline_never_reaches_visa() -> None:
    fake = FakeVisa()
    intent = network(fake).create_intent(
        (DESK, CHAIR),
        Mandate(Decimal("100"), ("Wayfair",), NOW + timedelta(hours=1)),
        CONSENT,
        idempotency_key="over",
    )
    assert intent.status == "declined" and intent.decline_code == "MANDATE_EXCEEDED"
    assert fake.requests == []


def test_visa_decline_voids_the_token_with_a_network_code() -> None:
    fake = FakeVisa(authorize_status="DECLINED")
    intent = network(fake).create_intent((DESK,), MANDATE, CONSENT, idempotency_key="declined")
    assert intent.status == "declined"
    assert intent.decline_code == "NETWORK_DECLINED"
    assert "INSUFFICIENT_FUND" in (intent.decline_reason or "")
    assert intent.token is None
    assert intent.network_reference == "789000000000"


def test_unreachable_visa_falls_back_to_the_local_sandbox_and_says_so() -> None:
    fake = FakeVisa(fail=True)
    intent = network(fake).create_intent((DESK,), MANDATE, CONSENT, idempotency_key="down")
    assert intent.status == "authorized"
    assert intent.provider == "dreamgrid-sandbox"
    assert intent.token is not None
    assert intent.fallback_reason and "unreachable" in intent.fallback_reason


def test_client_refuses_non_test_hosts_and_bad_credentials() -> None:
    with pytest.raises(ValueError):
        VisaAcceptanceClient(CREDS, host="api.visaacceptance.com")
    with pytest.raises(ValueError):
        VisaAcceptanceCredentials(merchant_id="m", key_id="k", shared_secret="")
    with pytest.raises(ValueError):
        VisaAcceptanceCredentials(merchant_id="m", key_id="k", shared_secret="not base64!!")


def test_settings_pick_visa_only_when_all_three_credentials_are_present() -> None:
    base = {"_env_file": None, "OPENAI_API_KEY": ""}
    assert Settings(**base).payment_backend == "sandbox"  # type: ignore[arg-type]
    assert Settings(**base, VISA_ACCEPTANCE_MERCHANT_ID="m").payment_backend == "sandbox"  # type: ignore[arg-type]
    full = Settings(
        **base,
        VISA_ACCEPTANCE_MERCHANT_ID="m",
        VISA_ACCEPTANCE_KEY_ID="k",
        VISA_ACCEPTANCE_SHARED_SECRET=SECRET,
    )  # type: ignore[arg-type]
    assert full.payment_backend == "visa-acceptance"
    assert isinstance(build_payment_network(full), VisaAcceptanceNetwork)
    forced = Settings(
        **base,
        payment_network="sandbox",
        VISA_ACCEPTANCE_MERCHANT_ID="m",
        VISA_ACCEPTANCE_KEY_ID="k",
        VISA_ACCEPTANCE_SHARED_SECRET=SECRET,
    )  # type: ignore[arg-type]
    assert isinstance(build_payment_network(forced), MockPaymentNetwork)

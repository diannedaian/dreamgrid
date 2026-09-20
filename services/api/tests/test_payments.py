"""Sandbox agent payments: mandate checks, signed tokens, lifecycle, and passkey consent."""

from __future__ import annotations

import base64
import hashlib
import json
import struct
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from dreamgrid_api.adapters.commerce.mock_payment_network import MockPaymentNetwork
from dreamgrid_api.adapters.commerce.passkeys import PasskeyError, PasskeyRegistry
from dreamgrid_api.boundaries.payments import ConsentEvidence, Mandate, PaymentLine
from dreamgrid_api.config import Settings
from dreamgrid_api.main import create_app

ORIGIN = "http://localhost:5173"
RP_ID = "localhost"


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


# ── a tiny software authenticator so the ES256 path is really exercised ─────────


class FakeAuthenticator:
    def __init__(self, rp_id: str = RP_ID) -> None:
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = b"dreamgrid-test-credential"
        self.rp_hash = hashlib.sha256(rp_id.encode()).digest()
        self.count = 0

    def cose_public_key(self) -> bytes:
        nums = self.key.public_key().public_numbers()
        x, y = nums.x.to_bytes(32, "big"), nums.y.to_bytes(32, "big")
        # {1: 2, 3: -7, -1: 1, -2: x, -3: y} as canonical CBOR
        return (
            b"\xa5"
            + b"\x01\x02"
            + b"\x03\x26"
            + b"\x20\x01"
            + b"\x21\x58\x20"
            + x
            + b"\x22\x58\x20"
            + y
        )

    def register(self, challenge: str, origin: str = ORIGIN) -> dict[str, str]:
        client = json.dumps(
            {"type": "webauthn.create", "challenge": challenge, "origin": origin}
        ).encode()
        flags = 0x01 | 0x04 | 0x40  # UP, UV, attested credential data
        auth = (
            self.rp_hash
            + bytes([flags])
            + struct.pack(">I", 0)
            + b"\x00" * 16
            + struct.pack(">H", len(self.credential_id))
            + self.credential_id
            + self.cose_public_key()
        )
        return {
            "challenge": challenge,
            "clientDataJson": b64(client),
            "authenticatorData": b64(auth),
        }

    def assert_(
        self, challenge: str, *, origin: str = ORIGIN, user_verified: bool = True
    ) -> dict[str, str]:
        client = json.dumps(
            {"type": "webauthn.get", "challenge": challenge, "origin": origin}
        ).encode()
        self.count += 1
        flags = 0x01 | (0x04 if user_verified else 0)
        auth = self.rp_hash + bytes([flags]) + struct.pack(">I", self.count)
        signature = self.key.sign(auth + hashlib.sha256(client).digest(), ec.ECDSA(hashes.SHA256()))
        return {
            "credentialId": b64(self.credential_id),
            "clientDataJson": b64(client),
            "authenticatorData": b64(auth),
            "signature": b64(signature),
        }


# ── network unit tests ────────────────────────────────────────────────────────


NOW = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)
CONSENT = ConsentEvidence(
    method="passkey", credential_id="cred", user_verified=True, challenge="abc"
)
DESK = PaymentLine("desk", "College desk", "Wayfair", Decimal("149.00"))
CHAIR = PaymentLine("chair", "College chair", "Wayfair", Decimal("89.00"))


def mandate(
    max_usd: str, merchants: tuple[str, ...] = ("Wayfair",), budget: str | None = None
) -> Mandate:
    return Mandate(
        max_amount_usd=Decimal(max_usd),
        merchants=merchants,
        expires_at=NOW + timedelta(hours=24),
        budget_usd=Decimal(budget) if budget else None,
    )


def network() -> MockPaymentNetwork:
    return MockPaymentNetwork("unit-test-signing-key-0123", now=lambda: NOW)


def test_authorizes_within_mandate_and_signs_a_verifiable_sandbox_token() -> None:
    net = network()
    intent = net.create_intent((DESK, CHAIR), mandate("300"), CONSENT, idempotency_key="plan-1")
    assert intent.status == "authorized"
    assert intent.amount_usd == Decimal("238.00")
    assert intent.is_sandbox and intent.provider == "dreamgrid-sandbox"
    payload = net.verify_token(intent.token or "")
    assert payload and payload["amt"] == "238.00" and payload["sandbox"] is True
    assert payload["merchants"] == ["Wayfair"]
    assert payload["consent"]["cred"] == "cred"  # type: ignore[index]
    # Tampering breaks the signature; a different key cannot verify it.
    head, body, sig = (intent.token or "").split(".")
    assert net.verify_token(f"{head}.{body}x.{sig}") is None
    assert (
        MockPaymentNetwork("another-key-that-is-long-enough").verify_token(intent.token or "")
        is None
    )


def test_idempotency_key_returns_the_same_intent() -> None:
    net = network()
    first = net.create_intent((DESK,), mandate("300"), CONSENT, idempotency_key="same")
    again = net.create_intent((DESK,), mandate("300"), CONSENT, idempotency_key="same")
    assert first.intent_id == again.intent_id
    assert len(net.ledger()) == 1


@pytest.mark.parametrize(
    ("lines", "mand", "consent", "code"),
    [
        ((DESK, CHAIR), mandate("200"), CONSENT, "MANDATE_EXCEEDED"),
        ((DESK, CHAIR), mandate("300", budget="150"), CONSENT, "BUDGET_EXCEEDED"),
        ((DESK,), mandate("300", merchants=("IKEA",)), CONSENT, "MERCHANT_NOT_ALLOWED"),
        ((), mandate("300"), CONSENT, "EMPTY_PLAN"),
        (
            (PaymentLine("bed", "Bed", "Wayfair", Decimal("0")),),
            mandate("300"),
            CONSENT,
            "UNPRICED_LINE",
        ),
        (
            (DESK,),
            mandate("300"),
            ConsentEvidence("passkey", "cred", False, "abc"),
            "CONSENT_INVALID",
        ),
        (
            (DESK,),
            Mandate(Decimal("300"), ("Wayfair",), NOW - timedelta(minutes=1)),
            CONSENT,
            "MANDATE_EXPIRED",
        ),
    ],
)
def test_declines_are_recorded_with_a_code_and_no_token(lines, mand, consent, code) -> None:  # type: ignore[no-untyped-def]
    net = network()
    intent = net.create_intent(lines, mand, consent, idempotency_key=f"k-{code}")
    assert intent.status == "declined"
    assert intent.decline_code == code
    assert intent.token is None
    assert net.ledger()[0].intent_id == intent.intent_id


def test_lifecycle_authorized_capture_reverse_and_invalid_transitions() -> None:
    net = network()
    intent = net.create_intent((DESK,), mandate("300"), CONSENT, idempotency_key="life")
    captured = net.capture(intent.intent_id)
    assert captured.status == "captured"
    with pytest.raises(ValueError):
        net.capture(intent.intent_id)
    reversed_ = net.reverse(intent.intent_id)
    assert reversed_.status == "reversed"
    assert [s for _, s in reversed_.history] == ["authorized", "captured", "reversed"]
    with pytest.raises(ValueError):
        net.reverse(intent.intent_id)
    with pytest.raises(KeyError):
        net.capture("pi_missing")


# ── passkey registry ───────────────────────────────────────────────────────────


def test_passkey_registration_and_assertion_verify_the_real_es256_signature() -> None:
    registry = PasskeyRegistry(RP_ID, (ORIGIN,), now=lambda: NOW)
    auth = FakeAuthenticator()
    reg_challenge = registry.issue_challenge("register")
    reg = auth.register(reg_challenge.value)
    key = registry.register(
        base64.urlsafe_b64decode(reg["clientDataJson"] + "=="),
        base64.urlsafe_b64decode(reg["authenticatorData"] + "=="),
        reg_challenge.value,
    )
    assert registry.has(key.credential_id)

    challenge = registry.issue_challenge("digest-1")
    assertion = auth.assert_(challenge.value)
    verified = registry.verify_assertion(
        assertion["credentialId"],
        base64.urlsafe_b64decode(assertion["clientDataJson"] + "=="),
        base64.urlsafe_b64decode(assertion["authenticatorData"] + "=="),
        base64.urlsafe_b64decode(assertion["signature"] + "=="),
        challenge.value,
    )
    assert verified.user_verified is True

    # Wrong origin, wrong challenge, or a forged signature are all rejected.
    bad_origin = auth.assert_(challenge.value, origin="https://evil.example")
    with pytest.raises(PasskeyError):
        registry.verify_assertion(
            bad_origin["credentialId"],
            base64.urlsafe_b64decode(bad_origin["clientDataJson"] + "=="),
            base64.urlsafe_b64decode(bad_origin["authenticatorData"] + "=="),
            base64.urlsafe_b64decode(bad_origin["signature"] + "=="),
            challenge.value,
        )
    other = FakeAuthenticator()
    other.credential_id = auth.credential_id
    forged = other.assert_(challenge.value)
    with pytest.raises(PasskeyError):
        registry.verify_assertion(
            forged["credentialId"],
            base64.urlsafe_b64decode(forged["clientDataJson"] + "=="),
            base64.urlsafe_b64decode(forged["authenticatorData"] + "=="),
            base64.urlsafe_b64decode(forged["signature"] + "=="),
            challenge.value,
        )


def test_origin_rule_follows_the_rp_id() -> None:
    registry = PasskeyRegistry("localhost", ("https://app.example",))
    assert registry.origin_allowed("https://app.example")
    assert registry.origin_allowed("http://localhost:5175")
    assert registry.origin_allowed("http://127.0.0.1:5173")
    assert not registry.origin_allowed("https://evil.example")
    assert not registry.origin_allowed("javascript:alert(1)")
    prod = PasskeyRegistry("dreamgrid.app", ())
    assert prod.origin_allowed("https://dreamgrid.app") and prod.origin_allowed(
        "https://www.dreamgrid.app"
    )
    assert not prod.origin_allowed(
        "https://dreamgrid.app.evil.example"
    ) and not prod.origin_allowed("http://127.0.0.1:5173")


def test_challenges_are_single_use_and_bound_to_the_plan_digest() -> None:
    registry = PasskeyRegistry(RP_ID, (ORIGIN,), now=lambda: NOW)
    challenge = registry.issue_challenge("digest-a")
    with pytest.raises(PasskeyError):
        registry.consume_challenge(challenge.value, "digest-b")  # plan changed
    with pytest.raises(PasskeyError):
        registry.consume_challenge(
            challenge.value, "digest-a"
        )  # already consumed by the failed attempt


# ── HTTP routes ────────────────────────────────────────────────────────────────


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Settings(_env_file=None, OPENAI_API_KEY="", environment="test")))


PLAN = {
    "lines": [
        {
            "productId": "desk",
            "title": "College desk",
            "merchant": "Wayfair",
            "unitPriceUsd": "149.00",
            "quantity": 1,
        },
        {
            "productId": "chair",
            "title": "College chair",
            "merchant": "Wayfair",
            "unitPriceUsd": "89.00",
            "quantity": 1,
        },
    ],
    "mandate": {
        "maxAmountUsd": "300.00",
        "merchants": ["Wayfair"],
        "validForMinutes": 60,
        "budgetUsd": "500.00",
    },
}


def enroll(client: TestClient, auth: FakeAuthenticator) -> str:
    challenge = client.post(
        "/api/v1/payments/passkeys/challenge", json={"plan": PLAN, "purpose": "register"}
    ).json()
    response = client.post("/api/v1/payments/passkeys", json=auth.register(challenge["challenge"]))
    assert response.status_code == 201, response.text
    return str(response.json()["credentialId"])


def test_end_to_end_passkey_approval_intent_capture_and_reverse(client: TestClient) -> None:
    auth = FakeAuthenticator()
    credential_id = enroll(client, auth)
    challenge = client.post("/api/v1/payments/passkeys/challenge", json={"plan": PLAN}).json()
    assertion = auth.assert_(challenge["challenge"])
    assert assertion["credentialId"] == credential_id
    created = client.post(
        "/api/v1/payments/intents",
        json={
            "plan": PLAN,
            "consent": {"challenge": challenge["challenge"], "passkey": assertion},
            "idempotencyKey": "room-plan-001",
        },
    )
    assert created.status_code == 201, created.text
    intent = created.json()
    assert intent["status"] == "authorized"
    assert intent["amountUsd"] == "238.00"
    assert intent["consentMethod"] == "passkey" and intent["userVerified"] is True
    assert intent["isSandbox"] is True and intent["provider"] == "dreamgrid-sandbox"
    assert intent["merchants"] == ["Wayfair"]

    verify = client.post("/api/v1/payments/tokens/verify", json={"token": intent["token"]}).json()
    assert verify["valid"] is True and verify["payload"]["sub"] == intent["intentId"]

    captured = client.post(f"/api/v1/payments/intents/{intent['intentId']}/capture").json()
    assert captured["status"] == "captured"
    reversed_ = client.post(f"/api/v1/payments/intents/{intent['intentId']}/reverse").json()
    assert reversed_["status"] == "reversed"
    assert client.post(f"/api/v1/payments/intents/{intent['intentId']}/reverse").status_code == 409
    ledger = client.get("/api/v1/payments/intents").json()
    assert [i["intentId"] for i in ledger] == [intent["intentId"]]


def test_over_mandate_plan_is_declined_not_errored(client: TestClient) -> None:
    challenge = client.post("/api/v1/payments/passkeys/challenge", json={"plan": PLAN}).json()
    tight = {**PLAN, "mandate": {**PLAN["mandate"], "maxAmountUsd": "200.00"}}
    # The challenge was bound to PLAN; changing the mandate afterwards must be caught.
    stale = client.post(
        "/api/v1/payments/intents",
        json={
            "plan": tight,
            "consent": {"challenge": challenge["challenge"]},
            "idempotencyKey": "stale-plan",
        },
    )
    assert stale.status_code == 400 and "changed" in stale.json()["detail"]
    fresh = client.post("/api/v1/payments/passkeys/challenge", json={"plan": tight}).json()
    declined = client.post(
        "/api/v1/payments/intents",
        json={
            "plan": tight,
            "consent": {"challenge": fresh["challenge"]},
            "idempotencyKey": "over-mandate",
        },
    )
    assert declined.status_code == 201
    body = declined.json()
    assert body["status"] == "declined" and body["declineCode"] == "MANDATE_EXCEEDED"
    assert body["token"] is None and body["consentMethod"] == "confirm"


def test_challenge_cannot_be_reused_and_unknown_passkey_is_rejected(client: TestClient) -> None:
    challenge = client.post("/api/v1/payments/passkeys/challenge", json={"plan": PLAN}).json()
    ok = client.post(
        "/api/v1/payments/intents",
        json={
            "plan": PLAN,
            "consent": {"challenge": challenge["challenge"]},
            "idempotencyKey": "first-use",
        },
    )
    assert ok.status_code == 201
    replay = client.post(
        "/api/v1/payments/intents",
        json={
            "plan": PLAN,
            "consent": {"challenge": challenge["challenge"]},
            "idempotencyKey": "second-use",
        },
    )
    assert replay.status_code == 400
    fresh = client.post("/api/v1/payments/passkeys/challenge", json={"plan": PLAN}).json()
    stranger = FakeAuthenticator().assert_(fresh["challenge"])
    rejected = client.post(
        "/api/v1/payments/intents",
        json={
            "plan": PLAN,
            "consent": {"challenge": fresh["challenge"], "passkey": stranger},
            "idempotencyKey": "stranger",
        },
    )
    assert rejected.status_code == 400 and "not enrolled" in rejected.json()["detail"]


def test_browser_can_check_whether_its_passkey_is_still_enrolled(client: TestClient) -> None:
    assert client.get("/api/v1/payments/passkeys/unknown-cred").json() == {
        "credentialId": "unknown-cred",
        "enrolled": False,
    }
    credential_id = enroll(client, FakeAuthenticator())
    assert client.get(f"/api/v1/payments/passkeys/{credential_id}").json()["enrolled"] is True


def test_openapi_lists_payment_routes(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]
    for path in (
        "/api/v1/payments/intents",
        "/api/v1/payments/passkeys",
        "/api/v1/payments/tokens/verify",
    ):
        assert path in paths

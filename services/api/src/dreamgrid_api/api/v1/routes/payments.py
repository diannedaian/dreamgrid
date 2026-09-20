"""Agent payments: passkey approval, payment intents, and the sandbox ledger.

Flow: the browser asks for a challenge bound to the plan digest → the shopper signs it with a
platform passkey → the intent request carries the assertion → the network checks the mandate
and issues a signed sandbox token → capture / reverse move it through its lifecycle.
No route contacts a card network; ``provider`` and ``isSandbox`` say so on every response.
"""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from dreamgrid_api.adapters.commerce.mock_payment_network import MockPaymentNetwork
from dreamgrid_api.adapters.commerce.passkeys import PasskeyError, PasskeyRegistry
from dreamgrid_api.boundaries.payments import (
    ConsentEvidence,
    Mandate,
    PaymentIntent,
    PaymentLine,
    PaymentNetwork,
)
from dreamgrid_api.dependencies import passkeys, payment_network, runtime_settings

router = APIRouter(prefix="/payments", tags=["payments"])


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ── plan + digest ─────────────────────────────────────────────────────────────


class LineIn(CamelModel):
    product_id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=200)
    merchant: str = Field(min_length=1, max_length=120)
    unit_price_usd: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    quantity: int = Field(ge=1, le=99)


class MandateIn(CamelModel):
    max_amount_usd: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    merchants: list[str] = Field(min_length=1, max_length=50)
    valid_for_minutes: int = Field(default=24 * 60, ge=1, le=7 * 24 * 60)
    budget_usd: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)


class PlanIn(CamelModel):
    lines: list[LineIn] = Field(max_length=200)
    mandate: MandateIn


def plan_digest(plan: PlanIn) -> str:
    """Stable hash of exactly what the shopper is approving; the challenge is bound to it."""

    canonical = json.dumps(
        plan.model_dump(mode="json", by_alias=True), sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


# ── passkeys ─────────────────────────────────────────────────────────────────


class ChallengeRequest(CamelModel):
    plan: PlanIn
    purpose: Literal["register", "approve"] = "approve"


class ChallengeResponse(CamelModel):
    challenge: str
    plan_digest: str
    rp_id: str
    expires_at: datetime


@router.post("/passkeys/challenge", response_model=ChallengeResponse)
def passkey_challenge(
    request: ChallengeRequest,
    registry: Annotated[PasskeyRegistry, Depends(passkeys)],
) -> ChallengeResponse:
    digest = plan_digest(request.plan) if request.purpose == "approve" else "register"
    challenge = registry.issue_challenge(digest)
    return ChallengeResponse(
        challenge=challenge.value,
        plan_digest=digest,
        rp_id=registry.rp_id,
        expires_at=challenge.expires_at,
    )


class RegisterRequest(CamelModel):
    challenge: str
    client_data_json: str
    attestation_object: str | None = None
    authenticator_data: str


class RegisterResponse(CamelModel):
    credential_id: str
    created_at: datetime


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


@router.post("/passkeys", response_model=RegisterResponse, status_code=201)
def register_passkey(
    request: RegisterRequest,
    registry: Annotated[PasskeyRegistry, Depends(passkeys)],
) -> RegisterResponse:
    try:
        registry.consume_challenge(request.challenge, "register")
        key = registry.register(
            _unb64(request.client_data_json), _unb64(request.authenticator_data), request.challenge
        )
    except PasskeyError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return RegisterResponse(credential_id=key.credential_id, created_at=key.created_at)


class EnrolledResponse(CamelModel):
    credential_id: str
    enrolled: bool


@router.get("/passkeys/{credential_id}", response_model=EnrolledResponse)
def passkey_enrolled(
    credential_id: str, registry: Annotated[PasskeyRegistry, Depends(passkeys)]
) -> EnrolledResponse:
    """Does the in-memory sandbox still know this credential? Lets the browser re-enrol."""

    return EnrolledResponse(credential_id=credential_id, enrolled=registry.has(credential_id))


# ── intents ───────────────────────────────────────────────────────────────────


class PasskeyAssertionIn(CamelModel):
    credential_id: str
    client_data_json: str
    authenticator_data: str
    signature: str


class ConsentIn(CamelModel):
    challenge: str
    passkey: PasskeyAssertionIn | None = None
    """Absent passkey = a plain confirm click. Allowed in the sandbox, recorded as such."""


class IntentRequest(CamelModel):
    plan: PlanIn
    consent: ConsentIn
    idempotency_key: str = Field(min_length=8, max_length=120)


class LineOut(CamelModel):
    product_id: str
    title: str
    merchant: str
    unit_price_usd: str
    quantity: int
    total_usd: str


class IntentResponse(CamelModel):
    intent_id: str
    status: str
    amount_usd: str
    currency: str
    lines: list[LineOut]
    merchants: list[str]
    mandate_max_usd: str
    mandate_expires_at: datetime
    consent_method: str
    credential_id: str | None
    user_verified: bool
    provider: str
    is_sandbox: bool
    created_at: datetime
    token: str | None
    decline_code: str | None
    decline_reason: str | None
    history: list[dict[str, str]]

    @classmethod
    def from_intent(cls, intent: PaymentIntent) -> IntentResponse:
        return cls(
            intent_id=intent.intent_id,
            status=intent.status,
            amount_usd=f"{intent.amount_usd:.2f}",
            currency=intent.currency,
            lines=[
                LineOut(
                    product_id=line.product_id,
                    title=line.title,
                    merchant=line.merchant,
                    unit_price_usd=f"{line.unit_price_usd:.2f}",
                    quantity=line.quantity,
                    total_usd=f"{line.total_usd:.2f}",
                )
                for line in intent.lines
            ],
            merchants=sorted({line.merchant for line in intent.lines}),
            mandate_max_usd=f"{intent.mandate.max_amount_usd:.2f}",
            mandate_expires_at=intent.mandate.expires_at,
            consent_method=intent.consent.method,
            credential_id=intent.consent.credential_id,
            user_verified=intent.consent.user_verified,
            provider=intent.provider,
            is_sandbox=intent.is_sandbox,
            created_at=intent.created_at,
            token=intent.token,
            decline_code=intent.decline_code,
            decline_reason=intent.decline_reason,
            history=[{"at": at.isoformat(), "status": status} for at, status in intent.history],
        )


@router.post("/intents", response_model=IntentResponse, status_code=201)
def create_intent(
    request: IntentRequest,
    network: Annotated[PaymentNetwork, Depends(payment_network)],
    registry: Annotated[PasskeyRegistry, Depends(passkeys)],
) -> IntentResponse:
    digest = plan_digest(request.plan)
    try:
        registry.consume_challenge(request.consent.challenge, digest)
        if request.consent.passkey:
            pk = request.consent.passkey
            verified = registry.verify_assertion(
                pk.credential_id,
                _unb64(pk.client_data_json),
                _unb64(pk.authenticator_data),
                _unb64(pk.signature),
                request.consent.challenge,
            )
            consent = ConsentEvidence(
                method="passkey",
                credential_id=verified.credential_id,
                user_verified=verified.user_verified,
                challenge=request.consent.challenge,
            )
        else:
            consent = ConsentEvidence(
                method="confirm",
                credential_id=None,
                user_verified=False,
                challenge=request.consent.challenge,
            )
    except PasskeyError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    lines = tuple(
        PaymentLine(
            product_id=line.product_id,
            title=line.title,
            merchant=line.merchant,
            unit_price_usd=line.unit_price_usd,
            quantity=line.quantity,
        )
        for line in request.plan.lines
    )
    mandate = Mandate(
        max_amount_usd=request.plan.mandate.max_amount_usd,
        merchants=tuple(request.plan.mandate.merchants),
        expires_at=datetime.now(UTC) + timedelta(minutes=request.plan.mandate.valid_for_minutes),
        budget_usd=request.plan.mandate.budget_usd,
    )
    intent = network.create_intent(lines, mandate, consent, idempotency_key=request.idempotency_key)
    return IntentResponse.from_intent(intent)


@router.get("/intents", response_model=list[IntentResponse])
def ledger(network: Annotated[PaymentNetwork, Depends(payment_network)]) -> list[IntentResponse]:
    return [IntentResponse.from_intent(i) for i in network.ledger()]


@router.get("/intents/{intent_id}", response_model=IntentResponse)
def get_intent(
    intent_id: str, network: Annotated[PaymentNetwork, Depends(payment_network)]
) -> IntentResponse:
    intent = network.get(intent_id)
    if intent is None:
        raise HTTPException(status_code=404, detail="Unknown payment intent.")
    return IntentResponse.from_intent(intent)


def _transition(
    network: PaymentNetwork, intent_id: str, action: Literal["capture", "reverse"]
) -> IntentResponse:
    try:
        intent = network.capture(intent_id) if action == "capture" else network.reverse(intent_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Unknown payment intent.") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return IntentResponse.from_intent(intent)


@router.post("/intents/{intent_id}/capture", response_model=IntentResponse)
def capture(
    intent_id: str, network: Annotated[PaymentNetwork, Depends(payment_network)]
) -> IntentResponse:
    return _transition(network, intent_id, "capture")


@router.post("/intents/{intent_id}/reverse", response_model=IntentResponse)
def reverse(
    intent_id: str, network: Annotated[PaymentNetwork, Depends(payment_network)]
) -> IntentResponse:
    return _transition(network, intent_id, "reverse")


class VerifyRequest(CamelModel):
    token: str


class VerifyResponse(CamelModel):
    valid: bool
    payload: dict[str, object] | None
    provider: str
    is_sandbox: bool = True


@router.post("/tokens/verify", response_model=VerifyResponse)
def verify_token(
    request: VerifyRequest,
    network: Annotated[PaymentNetwork, Depends(payment_network)],
    settings: Annotated[object, Depends(runtime_settings)],
) -> VerifyResponse:
    """Lets a merchant-side tool (or the MCP stub) check a token the agent presents."""

    del settings
    payload = (
        network.verify_token(request.token) if isinstance(network, MockPaymentNetwork) else None
    )
    return VerifyResponse(valid=payload is not None, payload=payload, provider="dreamgrid-sandbox")

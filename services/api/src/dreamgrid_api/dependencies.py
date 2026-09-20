"""FastAPI dependencies shared by versioned routes."""

from typing import cast

from fastapi import Request

from dreamgrid_api.adapters.commerce.mock_payment_network import MockPaymentNetwork
from dreamgrid_api.adapters.commerce.passkeys import PasskeyRegistry
from dreamgrid_api.adapters.commerce.product_sourcing_service import build_product_sourcing
from dreamgrid_api.adapters.commerce.visa_acceptance import (
    VisaAcceptanceClient,
    VisaAcceptanceCredentials,
    VisaAcceptanceNetwork,
)
from dreamgrid_api.boundaries.payments import PaymentNetwork
from dreamgrid_api.boundaries.product_sourcing import ProductSourcingGateway
from dreamgrid_api.config import Settings


def runtime_settings(request: Request) -> Settings:
    """Read the settings attached by the application factory."""

    return cast(Settings, request.app.state.settings)


def product_sourcing(request: Request) -> ProductSourcingGateway:
    gateway = getattr(request.app.state, "product_sourcing", None)
    if gateway is None:
        gateway = build_product_sourcing(runtime_settings(request))
        request.app.state.product_sourcing = gateway
    return cast(ProductSourcingGateway, gateway)


def payment_network(request: Request) -> PaymentNetwork:
    network = getattr(request.app.state, "payment_network", None)
    if network is None:
        network = build_payment_network(runtime_settings(request))
        request.app.state.payment_network = network
    return cast(PaymentNetwork, network)


def build_payment_network(settings: Settings) -> PaymentNetwork:
    local = MockPaymentNetwork(settings.payment_signing_key.get_secret_value())
    if settings.payment_backend != "visa-acceptance":
        return local
    credentials = VisaAcceptanceCredentials(
        merchant_id=settings.visa_acceptance_merchant_id,
        key_id=settings.visa_acceptance_key_id,
        shared_secret=settings.visa_acceptance_shared_secret.get_secret_value(),
    )
    return VisaAcceptanceNetwork(local, VisaAcceptanceClient(credentials))


def passkeys(request: Request) -> PasskeyRegistry:
    registry = getattr(request.app.state, "passkeys", None)
    if registry is None:
        settings = runtime_settings(request)
        registry = PasskeyRegistry(settings.passkey_rp_id, tuple(settings.passkey_origins))
        request.app.state.passkeys = registry
    return cast(PasskeyRegistry, registry)

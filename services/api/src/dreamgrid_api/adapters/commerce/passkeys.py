"""Server side of the WebAuthn passkey ceremony used to approve payment intents.

The browser creates a platform passkey once (Touch ID / Face ID / Windows Hello) and later
signs a server-issued challenge for each approval. This module stores the enrolled public
key, issues one-time challenges bound to a plan digest, and verifies assertions: origin,
RP ID hash, user-present / user-verified flags, challenge match, and the ES256 signature.

Only the WebAuthn *assertion* is verified here; attestation is not required for a sandbox.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from threading import Lock
from urllib.parse import urlsplit

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

CHALLENGE_TTL = timedelta(minutes=5)
FLAG_USER_PRESENT = 0x01
FLAG_USER_VERIFIED = 0x04


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class PasskeyError(ValueError):
    """The assertion did not prove consent to this plan."""


@dataclass(frozen=True)
class Passkey:
    credential_id: str
    public_key: ec.EllipticCurvePublicKey
    created_at: datetime
    rp_id: str = "localhost"


@dataclass(frozen=True)
class Challenge:
    value: str
    plan_digest: str
    expires_at: datetime


@dataclass(frozen=True)
class VerifiedAssertion:
    credential_id: str
    user_verified: bool
    challenge: str


def _parse_cose_p256(cose: bytes) -> ec.EllipticCurvePublicKey:
    """Minimal CBOR reader for a COSE_Key EC2 P-256 public key (kty 2, alg -7, crv 1)."""

    def read(pos: int) -> tuple[object, int]:
        first = cose[pos]
        major, info = first >> 5, first & 0x1F
        pos += 1
        if info < 24:
            arg = info
        elif info == 24:
            arg, pos = cose[pos], pos + 1
        elif info == 25:
            arg, pos = int.from_bytes(cose[pos : pos + 2], "big"), pos + 2
        else:
            raise PasskeyError("Unsupported COSE key encoding.")
        if major == 0:
            return arg, pos
        if major == 1:
            return -1 - arg, pos
        if major == 2:
            return cose[pos : pos + arg], pos + arg
        if major == 5:
            out: dict[object, object] = {}
            for _ in range(arg):
                key, pos = read(pos)
                value, pos = read(pos)
                out[key] = value
            return out, pos
        raise PasskeyError("Unsupported COSE key encoding.")

    parsed, _ = read(0)
    if not isinstance(parsed, dict):
        raise PasskeyError("COSE key is not a map.")
    if parsed.get(1) != 2 or parsed.get(3) != -7 or parsed.get(-1) != 1:
        raise PasskeyError("Only ES256 / P-256 passkeys are supported in the sandbox.")
    x, y = parsed.get(-2), parsed.get(-3)
    if not isinstance(x, bytes) or not isinstance(y, bytes) or len(x) != 32 or len(y) != 32:
        raise PasskeyError("Malformed P-256 public key.")
    numbers = ec.EllipticCurvePublicNumbers(
        int.from_bytes(x, "big"), int.from_bytes(y, "big"), ec.SECP256R1()
    )
    return numbers.public_key()


def public_key_from_attested_credential(
    authenticator_data: bytes,
) -> tuple[str, ec.EllipticCurvePublicKey]:
    """Pull the credential id and COSE public key out of registration authenticatorData."""

    if len(authenticator_data) < 37 or not authenticator_data[32] & 0x40:
        raise PasskeyError("Registration data has no attested credential.")
    pos = 37 + 16  # rpIdHash, flags, signCount, aaguid
    cred_len = int.from_bytes(authenticator_data[pos : pos + 2], "big")
    pos += 2
    credential_id = _b64(authenticator_data[pos : pos + cred_len])
    pos += cred_len
    return credential_id, _parse_cose_p256(authenticator_data[pos:])


class PasskeyRegistry:
    def __init__(
        self,
        rp_id: str,
        origins: tuple[str, ...],
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.rp_id = rp_id
        self.origins = origins
        self._now = now
        self._keys: dict[str, Passkey] = {}
        self._challenges: dict[str, Challenge] = {}
        self._lock = Lock()

    # ── registration ──────────────────────────────────────────────────────────

    def register(
        self, client_data_json: bytes, authenticator_data: bytes, expected_challenge: str
    ) -> Passkey:
        client = self._client_data(client_data_json, "webauthn.create", expected_challenge)
        # The passkey is scoped to the host the page was served from (localhost ≠ 127.0.0.1).
        rp_id = self.rp_id_for(str(client.get("origin", "")))
        self._check_rp_hash(authenticator_data, rp_id)
        credential_id, public_key = public_key_from_attested_credential(authenticator_data)
        key = Passkey(
            credential_id=credential_id, public_key=public_key, created_at=self._now(), rp_id=rp_id
        )
        with self._lock:
            self._keys[credential_id] = key
        return key

    def rp_id_for(self, origin: str) -> str:
        """The relying-party ID a browser at ``origin`` must use: its own host when that host is
        allowed (so a page on 127.0.0.1 gets ``127.0.0.1``), else the configured RP ID."""

        host = (urlsplit(origin).hostname or "").lower()
        return host if host and self.origin_allowed(origin) else self.rp_id

    def has(self, credential_id: str) -> bool:
        return credential_id in self._keys

    # ── challenges ────────────────────────────────────────────────────────────

    def issue_challenge(self, plan_digest: str) -> Challenge:
        challenge = Challenge(
            value=_b64(secrets.token_bytes(32)),
            plan_digest=plan_digest,
            expires_at=self._now() + CHALLENGE_TTL,
        )
        with self._lock:
            self._challenges[challenge.value] = challenge
        return challenge

    def consume_challenge(self, value: str, plan_digest: str) -> Challenge:
        with self._lock:
            challenge = self._challenges.pop(value, None)
        if challenge is None:
            raise PasskeyError("Unknown or already-used approval challenge.")
        if challenge.expires_at <= self._now():
            raise PasskeyError("The approval challenge expired; review the plan again.")
        if challenge.plan_digest != plan_digest:
            raise PasskeyError("The plan changed after the challenge was issued.")
        return challenge

    # ── assertion ─────────────────────────────────────────────────────────────

    def verify_assertion(
        self,
        credential_id: str,
        client_data_json: bytes,
        authenticator_data: bytes,
        signature: bytes,
        expected_challenge: str,
    ) -> VerifiedAssertion:
        key = self._keys.get(credential_id)
        if key is None:
            raise PasskeyError("This passkey is not enrolled with DreamGrid.")
        self._client_data(client_data_json, "webauthn.get", expected_challenge)
        self._check_rp_hash(authenticator_data, key.rp_id)
        flags = authenticator_data[32]
        if not flags & FLAG_USER_PRESENT:
            raise PasskeyError("The authenticator did not report user presence.")
        signed = authenticator_data + hashlib.sha256(client_data_json).digest()
        try:
            key.public_key.verify(_der_signature(signature), signed, ec.ECDSA(hashes.SHA256()))
        except InvalidSignature as error:
            raise PasskeyError("The passkey signature does not match.") from error
        return VerifiedAssertion(
            credential_id=credential_id,
            user_verified=bool(flags & FLAG_USER_VERIFIED),
            challenge=expected_challenge,
        )

    # ── helpers ───────────────────────────────────────────────────────────────

    def _client_data(
        self, raw: bytes, expected_type: str, expected_challenge: str
    ) -> dict[str, object]:
        try:
            data: dict[str, object] = json.loads(raw)
        except ValueError as error:
            raise PasskeyError("clientDataJSON is not valid JSON.") from error
        if data.get("type") != expected_type:
            raise PasskeyError(f"Unexpected WebAuthn ceremony type {data.get('type')!r}.")
        if data.get("challenge") != expected_challenge:
            raise PasskeyError("The signed challenge does not match the one issued.")
        if not self.origin_allowed(str(data.get("origin", ""))):
            raise PasskeyError(f"Origin {data.get('origin')!r} is not allowed to approve payments.")
        return data

    def origin_allowed(self, origin: str) -> bool:
        """Explicit allow-list, or (per WebAuthn) any http(s) origin whose host is the RP ID.

        For the ``localhost`` RP that also covers ``127.0.0.1`` on any dev-server port.
        """

        if origin in self.origins:
            return True
        parsed = urlsplit(origin)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        host = parsed.hostname.lower()
        if host == self.rp_id or host.endswith(f".{self.rp_id}"):
            return True
        return self.rp_id == "localhost" and host == "127.0.0.1"

    def _check_rp_hash(self, authenticator_data: bytes, rp_id: str) -> None:
        if len(authenticator_data) < 37:
            raise PasskeyError("authenticatorData is too short.")
        if authenticator_data[:32] != hashlib.sha256(rp_id.encode()).digest():
            raise PasskeyError("The passkey belongs to a different site.")


def _der_signature(signature: bytes) -> bytes:
    """WebAuthn ES256 signatures are DER already; accept raw r||s too for robustness."""

    if len(signature) == 64:
        return encode_dss_signature(
            int.from_bytes(signature[:32], "big"), int.from_bytes(signature[32:], "big")
        )
    return signature

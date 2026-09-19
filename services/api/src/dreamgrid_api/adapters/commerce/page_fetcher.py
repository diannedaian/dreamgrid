"""Fetch a user-supplied product page safely.

Only pages the user explicitly pasted are fetched, one at a time, with a
browser-like user agent, a short timeout, and a size cap. Private and loopback
addresses are refused so the API cannot be used to probe the network it runs on.
"""

import ipaddress
import socket
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlsplit

import httpx

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36 DreamGrid/0.1"
)
MAX_BYTES = 2_000_000
TIMEOUT_SECONDS = 8.0
MAX_REDIRECTS = 3


class PageFetchError(Exception):
    """The page could not be fetched; the message is safe to show the user."""


@dataclass(frozen=True)
class FetchedPage:
    requested_url: str
    final_url: str
    status_code: int
    html: str


class PageFetcher(Protocol):
    async def fetch(self, url: str) -> FetchedPage: ...


def validate_public_http_url(url: str) -> str:
    """Return the URL if it is http(s) to a public host; raise PageFetchError otherwise."""

    parts = urlsplit(url.strip())
    if parts.scheme not in {"http", "https"}:
        raise PageFetchError("Only http and https links can be read.")
    host = parts.hostname
    if not host:
        raise PageFetchError("The link has no host name.")
    if host == "localhost" or host.endswith(".localhost"):
        raise PageFetchError("Local addresses cannot be read.")

    try:
        candidates = {info[4][0] for info in socket.getaddrinfo(host, None)}
    except socket.gaierror as error:
        raise PageFetchError(f"Could not resolve {host}.") from error

    for address in candidates:
        ip = ipaddress.ip_address(address)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise PageFetchError("Private network addresses cannot be read.")
    return url.strip()


async def probe_status(url: str, timeout: float = 5.0) -> int | None:
    """HTTP status for a URL, or None when it cannot be reached at all.

    Used to drop search hits that point at pages which do not exist. Bot walls
    answer 403/429/503 for real pages, so only the caller's 404/410 check is
    treated as proof of a bad link.
    """

    try:
        validate_public_http_url(url)
    except PageFetchError:
        return None
    try:
        async with (
            httpx.AsyncClient(
                follow_redirects=True,
                max_redirects=MAX_REDIRECTS,
                timeout=timeout,
                headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*"},
            ) as client,
            client.stream("GET", url) as response,
        ):
            return response.status_code
    except httpx.HTTPError:
        return None


class HttpxPageFetcher:
    """Real fetcher. Not used in tests; the service takes any ``PageFetcher``."""

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client

    async def fetch(self, url: str) -> FetchedPage:
        safe_url = validate_public_http_url(url)
        client = self._client or httpx.AsyncClient(
            follow_redirects=True,
            max_redirects=MAX_REDIRECTS,
            timeout=TIMEOUT_SECONDS,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
        )
        try:
            async with client.stream("GET", safe_url) as response:
                if response.status_code >= 400:
                    raise PageFetchError(
                        f"The store answered with HTTP {response.status_code}; "
                        "it may block automated readers."
                    )
                content_type = response.headers.get("content-type", "")
                if "html" not in content_type and "xml" not in content_type:
                    raise PageFetchError("The link is not an HTML page.")
                chunks: list[bytes] = []
                received = 0
                async for chunk in response.aiter_bytes():
                    received += len(chunk)
                    if received > MAX_BYTES:
                        break
                    chunks.append(chunk)
                html = b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")
                return FetchedPage(
                    requested_url=safe_url,
                    final_url=str(response.url),
                    status_code=response.status_code,
                    html=html,
                )
        except httpx.TimeoutException as error:
            raise PageFetchError("The store took too long to answer.") from error
        except httpx.HTTPError as error:
            raise PageFetchError(
                f"Could not reach the store ({error.__class__.__name__})."
            ) from error
        finally:
            if self._client is None:
                await client.aclose()

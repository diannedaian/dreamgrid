"""Best-effort single-page lookup, never a crawler or arbitrary URL proxy.

HTTPS only, exact host allowlist, pinned public DNS address, verified TLS/SNI,
bounded bytes/time, and redirects are not followed. No cookies or credentials.
"""

import http.client
import ipaddress
import socket
import ssl
import time
from html.parser import HTMLParser
from urllib.parse import urlsplit

from .models import PipelineError

MAX_PAGE_BYTES = 2_000_000


def resolve_target(url: str, hosts: list[str]) -> tuple[str, str, str]:
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower()
        if (
            parsed.scheme != "https"
            or parsed.username
            or parsed.password
            or parsed.port not in {None, 443}
            or host not in hosts
        ):
            raise ValueError("Not allowed")
        addresses = {
            str(item[4][0])
            for item in socket.getaddrinfo(
                host,
                443,
                type=socket.SOCK_STREAM,
            )
        }
        if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
            raise ValueError("Nonpublic address")
        target = parsed.path or "/"
        if parsed.query:
            target += "?" + parsed.query
        return host, sorted(addresses)[0], target
    except (ValueError, OSError) as error:
        raise PipelineError(
            "Link lookup unavailable; paste the product specifications instead."
        ) from error


class PageText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hidden = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self.hidden += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data: str) -> None:
        if not self.hidden and data.strip():
            self.parts.append(" ".join(data.split()))


def fetch_product_text(url: str, hosts: list[str]) -> str:
    host, address, target = resolve_target(url, hosts)
    connection = http.client.HTTPSConnection(host, timeout=4)
    try:
        # Pin the validated address; do not resolve the hostname again in connect().
        raw_socket = socket.create_connection((address, 443), timeout=4)
        try:
            connection.sock = ssl.create_default_context().wrap_socket(
                raw_socket,
                server_hostname=host,
            )
        except Exception:
            raw_socket.close()
            raise
        connection.request(
            "GET",
            target,
            headers={
                "User-Agent": "DreamGrid-Hackathon/0.1",
                "Accept": "text/html",
                "Accept-Encoding": "identity",
            },
        )
        response = connection.getresponse()
        if response.status != 200 or "text/html" not in response.getheader("Content-Type", ""):
            raise PipelineError("Product page could not be read. Paste its specifications instead.")
        chunks: list[bytes] = []
        count, deadline = 0, time.monotonic() + 5
        while count <= MAX_PAGE_BYTES:
            if time.monotonic() > deadline:
                raise PipelineError("Product page timed out. Paste its specifications instead.")
            chunk = response.read1(min(32_768, MAX_PAGE_BYTES + 1 - count))
            if not chunk:
                break
            chunks.append(chunk)
            count += len(chunk)
        payload = b"".join(chunks)
        if len(payload) > MAX_PAGE_BYTES:
            raise PipelineError("Product page is too large. Paste its specifications instead.")
        parser = PageText()
        parser.feed(payload.decode("utf-8", errors="replace"))
        # Keep dimension-adjacent text, not the whole storefront/navigation.
        relevant: list[str] = []
        for index, line in enumerate(parser.parts):
            if any(word in line.lower() for word in ("dimension", "width", "height", "depth")):
                relevant.extend(parser.parts[max(0, index - 1) : index + 8])
        return "\n".join(dict.fromkeys(relevant))[:4000]
    except (OSError, http.client.HTTPException) as error:
        raise PipelineError(
            "Product page unavailable. Paste its specifications instead."
        ) from error
    finally:
        connection.close()

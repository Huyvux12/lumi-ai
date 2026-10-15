"""Allowlisted HTTPS endpoints with public DNS addresses pinned through TLS/SNI."""

import asyncio
import ipaddress
import re
import socket
from urllib.parse import urlsplit

import httpx

from .security import fail


def validate_base_url(value, settings):
    try:
        url = urlsplit(value)
        host = url.hostname or ""
        if (
            url.scheme != "https"
            or url.port not in {None, 443}
            or url.username
            or url.password
            or url.query
            or url.fragment
            or "%" in value
            or "\\" in value
            or any(ord(c) < 33 for c in value)
        ):
            raise ValueError
        if not re.fullmatch(r"[a-zA-Z0-9.-]+", host) or host.endswith("."):
            raise ValueError
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise ValueError
        if "." not in host or host.endswith((".local", ".internal", ".localhost")):
            raise ValueError
        if host.lower() not in settings.llm_allowed_hosts:
            fail("PROVIDER_HOST_FORBIDDEN", "Host LLM chưa có trong danh sách cho phép của backend.", 422)
        return "https://" + host.lower() + url.path.rstrip("/")
    except ValueError:
        fail(
            "INVALID_PROVIDER_URL",
            "Base URL phải là HTTPS của dịch vụ công khai, không chứa query, thông tin đăng nhập hoặc địa chỉ IP.",
            422,
        )


async def public_addresses(host):
    try:
        rows = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM), 10
        )
    except (TimeoutError, OSError):
        fail("PROVIDER_UNAVAILABLE", "Không thể phân giải địa chỉ dịch vụ LLM.", 502)
    addresses = list(dict.fromkeys(row[4][0] for row in rows))
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        fail("PROVIDER_HOST_FORBIDDEN", "Dịch vụ LLM phải phân giải tới địa chỉ Internet công khai.", 422)
    return addresses


class SafeLLMTransport(httpx.AsyncBaseTransport):
    def __init__(self, settings, transport=None):
        self.settings = settings
        self.test_transport = transport
        self.transports = {}

    async def handle_async_request(self, request):
        base = validate_base_url(str(request.url), self.settings)
        host = urlsplit(base).hostname
        addresses = await public_addresses(host)
        # Separate pools per hostname avoid sharing a TLS connection/SNI across hosts on one IP.
        if host not in self.transports:
            self.transports[host] = self.test_transport or httpx.AsyncHTTPTransport(
                retries=0, trust_env=False
            )
        pinned = httpx.Request(
            request.method,
            request.url.copy_with(host=addresses[0]),
            headers={**dict(request.headers), "host": host},
            stream=request.stream,
            extensions={**request.extensions, "sni_hostname": host},
        )
        return await self.transports[host].handle_async_request(pinned)

    async def aclose(self):
        for transport in set(self.transports.values()):
            await transport.aclose()

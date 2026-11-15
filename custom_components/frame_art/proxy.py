"""HTTP views that put the add-on behind Home Assistant's own web server.

- /api/frame_art/api/...  the panel's API, for logged-in HA users (settings: admins only)
- /api/frame_art/mcp      the MCP endpoint; the add-on checks the MCP token itself
- /api/frame_art/panel.js the panel bundle, served by the add-on (public, contains no data)

This is what makes the panel and MCP reachable through Nabu Casa without exposing the add-on.
"""

from __future__ import annotations

from typing import Any

from aiohttp import ClientError, ClientTimeout, web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import API_PREFIX, CONF_HOST, CONF_PORT, CONF_TOKEN, DOMAIN, MCP_PATH, PANEL_JS_PATH

FORWARD_REQUEST = ("content-type", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id")
FORWARD_RESPONSE = ("content-type", "cache-control", "mcp-session-id", "etag")
TIMEOUT = ClientTimeout(total=180)


def _target(hass: HomeAssistant) -> dict[str, Any] | None:
    return hass.data.get(DOMAIN)


async def _forward(
    hass: HomeAssistant,
    request: web.Request,
    path: str,
    authorization: str | None,
) -> web.Response:
    target = _target(hass)
    if not target:
        return web.json_response({"error": "Frame Art isn't set up"}, status=503)
    url = f"http://{target[CONF_HOST]}:{target[CONF_PORT]}{path}"
    headers = {k: v for k in FORWARD_REQUEST if (v := request.headers.get(k))}
    if authorization:
        headers["Authorization"] = authorization
    body = await request.read() if request.body_exists else None
    session = async_get_clientsession(hass)
    try:
        async with session.request(
            request.method,
            url,
            params=request.query,
            data=body,
            headers=headers,
            timeout=TIMEOUT,
            allow_redirects=False,
        ) as resp:
            payload = await resp.read()
            out = {k: v for k in FORWARD_RESPONSE if (v := resp.headers.get(k))}
            return web.Response(body=payload, status=resp.status, headers=out)
    except ClientError, TimeoutError:
        return web.json_response({"error": "The Frame Art add-on isn't reachable"}, status=502)


class FrameArtApiView(HomeAssistantView):
    """The panel's API. HA authenticates the user; the add-on trusts the integration's token."""

    url = API_PREFIX + "/{path:.*}"
    name = "api:frame_art:api"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def _handle(self, request: web.Request, path: str) -> web.Response:
        user = request.get("hass_user")
        if path.startswith("settings/") and not (user and user.is_admin):
            return web.json_response({"error": "Admins only"}, status=403)
        target = _target(self.hass)
        token = target[CONF_TOKEN] if target else ""
        return await _forward(self.hass, request, f"/api/{path}", f"Bearer {token}")

    async def get(self, request: web.Request, path: str) -> web.Response:
        return await self._handle(request, path)

    async def post(self, request: web.Request, path: str) -> web.Response:
        return await self._handle(request, path)

    async def put(self, request: web.Request, path: str) -> web.Response:
        return await self._handle(request, path)

    async def patch(self, request: web.Request, path: str) -> web.Response:
        return await self._handle(request, path)

    async def delete(self, request: web.Request, path: str) -> web.Response:
        return await self._handle(request, path)


class FrameArtMcpView(HomeAssistantView):
    """MCP over streamable HTTP. No HA login: MCP clients bring the Frame Art MCP token."""

    url = MCP_PATH
    name = "api:frame_art:mcp"
    requires_auth = False
    cors_allowed = True

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def _handle(self, request: web.Request) -> web.Response:
        return await _forward(self.hass, request, "/mcp", request.headers.get("Authorization"))

    async def get(self, request: web.Request) -> web.Response:
        return await self._handle(request)

    async def post(self, request: web.Request) -> web.Response:
        return await self._handle(request)

    async def delete(self, request: web.Request) -> web.Response:
        return await self._handle(request)


class FrameArtPanelView(HomeAssistantView):
    """The panel's JavaScript module, straight from the add-on, so UI updates ship with the add-on."""

    url = PANEL_JS_PATH
    name = "api:frame_art:panel"
    requires_auth = False

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def get(self, request: web.Request) -> web.Response:
        target = _target(self.hass)
        token = target[CONF_TOKEN] if target else ""
        resp = await _forward(self.hass, request, "/panel/frame-art-panel.js", f"Bearer {token}")
        resp.headers["Cache-Control"] = "no-cache"
        return resp

"""The integration as HA runs it: discovery set-up, the native panel, and the proxies to the add-on."""

import json

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers.service_info.hassio import HassioServiceInfo
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.frame_art.const import DOMAIN, PANEL_URL_PATH

ADDON = {"host": "92f22987-frame-art", "port": 8099, "token": "internal-secret"}
BASE = "http://92f22987-frame-art:8099"


def discovery(**config) -> HassioServiceInfo:
    return HassioServiceInfo(config={**ADDON, **config}, name="Frame Art", slug="92f22987_frame_art", uuid="abc")


async def setup(hass: HomeAssistant) -> MockConfigEntry:
    await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data=ADDON)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_discovery_sets_up_after_confirm(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_HASSIO}, data=discovery()
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "hassio_confirm"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == ADDON


async def test_rediscovery_updates_the_token(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, data=ADDON)
    entry.add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_HASSIO}, data=discovery(token="rotated")
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"
    assert entry.data["token"] == "rotated"


async def test_manual_setup_reports_unreachable(hass: HomeAssistant, aioclient_mock) -> None:
    aioclient_mock.get(f"{BASE}/api/config", status=401)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], ADDON)
    assert result["errors"] == {"base": "cannot_connect"}


async def test_registers_a_native_panel_and_removes_it_on_unload(hass: HomeAssistant) -> None:
    entry = await setup(hass)
    panel = hass.data["frontend_panels"][PANEL_URL_PATH]
    assert panel.sidebar_title == "Frame Art"
    custom = panel.config["_panel_custom"]
    assert custom["name"] == "frame-art-panel"
    assert custom["module_url"] == "/api/frame_art/panel.js"
    assert custom["embed_iframe"] is False
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert PANEL_URL_PATH not in hass.data["frontend_panels"]


async def test_api_proxy_needs_ha_login_and_uses_the_internal_token(
    hass: HomeAssistant, hass_client, hass_client_no_auth, aioclient_mock
) -> None:
    await setup(hass)
    aioclient_mock.get(f"{BASE}/api/tvs", json=[{"id": "woonkamer"}])
    assert (await (await hass_client_no_auth()).get("/api/frame_art/api/tvs")).status == 401

    resp = await (await hass_client()).get("/api/frame_art/api/tvs")
    assert resp.status == 200
    assert json.loads(await resp.text()) == [{"id": "woonkamer"}]
    _, _, _, headers = aioclient_mock.mock_calls[-1]
    assert headers["Authorization"] == "Bearer internal-secret"


async def test_settings_are_admin_only(
    hass: HomeAssistant, hass_client, hass_read_only_access_token, aioclient_mock
) -> None:
    await setup(hass)
    aioclient_mock.get(f"{BASE}/api/settings/mcp", json={"token": "mcp"})
    aioclient_mock.get(f"{BASE}/api/tvs", json=[])
    user = await hass_client(hass_read_only_access_token)
    assert (await user.get("/api/frame_art/api/settings/mcp")).status == 403
    assert (await user.get("/api/frame_art/api/tvs")).status == 200


async def test_mcp_passes_the_clients_token_not_the_internal_one(
    hass: HomeAssistant, hass_client_no_auth, aioclient_mock
) -> None:
    await setup(hass)
    aioclient_mock.post(f"{BASE}/mcp", json={"jsonrpc": "2.0", "id": 1, "result": {}})
    client = await hass_client_no_auth()
    resp = await client.post(
        "/api/frame_art/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={"Authorization": "Bearer mcp-token", "Accept": "application/json, text/event-stream"},
    )
    assert resp.status == 200
    _, _, body, headers = aioclient_mock.mock_calls[-1]
    assert headers["Authorization"] == "Bearer mcp-token"
    assert b"tools/list" in body


async def test_panel_js_is_public_and_not_cached(hass: HomeAssistant, hass_client_no_auth, aioclient_mock) -> None:
    await setup(hass)
    aioclient_mock.get(
        f"{BASE}/panel/frame-art-panel.js", text="customElements.define()", headers={"content-type": "text/javascript"}
    )
    resp = await (await hass_client_no_auth()).get("/api/frame_art/panel.js")
    assert resp.status == 200
    assert resp.headers["Cache-Control"] == "no-cache"
    assert "customElements" in await resp.text()


async def test_addon_down_gives_502(hass: HomeAssistant, hass_client, aioclient_mock) -> None:
    await setup(hass)
    aioclient_mock.get(f"{BASE}/api/tvs", exc=TimeoutError())
    assert (await (await hass_client()).get("/api/frame_art/api/tvs")).status == 502


async def test_urls_gives_absolute_external_and_internal(hass: HomeAssistant, hass_client, hass_client_no_auth) -> None:
    await setup(hass)
    hass.config.external_url = "https://example.ui.nabu.casa"
    hass.config.internal_url = "http://192.168.1.10:8123"
    assert (await (await hass_client_no_auth()).get("/api/frame_art/urls")).status == 401
    data = json.loads(await (await (await hass_client()).get("/api/frame_art/urls")).text())
    assert data == {
        "external": "https://example.ui.nabu.casa",
        "external_is_cloud": True,
        "internal": "http://192.168.1.10:8123",
        "mcp_path": "/api/frame_art/mcp",
    }

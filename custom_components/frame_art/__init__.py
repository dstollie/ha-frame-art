"""Frame Art: a native Home Assistant panel and an MCP endpoint for the Frame Art add-on."""

from __future__ import annotations

from homeassistant.components import frontend, panel_custom
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CONF_HOST, CONF_PORT, CONF_TOKEN, DOMAIN, PANEL_ELEMENT, PANEL_JS_PATH, PANEL_URL_PATH
from .proxy import FrameArtApiView, FrameArtMcpView, FrameArtPanelView

VIEWS_REGISTERED = f"{DOMAIN}_views"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data[DOMAIN] = {
        CONF_HOST: entry.data[CONF_HOST],
        CONF_PORT: entry.data[CONF_PORT],
        CONF_TOKEN: entry.data[CONF_TOKEN],
    }
    if not hass.data.get(VIEWS_REGISTERED):
        # aiohttp can't remove routes; views look up the current target on every request.
        for view in (FrameArtApiView(hass), FrameArtMcpView(hass), FrameArtPanelView(hass)):
            hass.http.register_view(view)
        hass.data[VIEWS_REGISTERED] = True

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title="Frame Art",
        sidebar_icon="mdi:image-frame",
        module_url=PANEL_JS_PATH,
        embed_iframe=False,
        require_admin=False,
    )
    entry.async_on_unload(entry.add_update_listener(_reload))
    return True


async def _reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    hass.data.pop(DOMAIN, None)
    return True

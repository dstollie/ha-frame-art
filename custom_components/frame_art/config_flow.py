"""Config flow: set up from the add-on's Supervisor discovery, or by hand."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.service_info.hassio import HassioServiceInfo

from .const import CONF_HOST, CONF_PORT, CONF_TOKEN, DOMAIN


async def _reachable(flow: ConfigFlow, data: dict[str, Any]) -> bool:
    session = async_get_clientsession(flow.hass)
    try:
        async with session.get(
            f"http://{data[CONF_HOST]}:{data[CONF_PORT]}/api/config",
            headers={"Authorization": f"Bearer {data[CONF_TOKEN]}"},
            timeout=10,
        ) as resp:
            return resp.status == 200
    except Exception:  # noqa: BLE001 - any failure means "not reachable"
        return False


class FrameArtConfigFlow(ConfigFlow, domain=DOMAIN):
    """One Frame Art add-on per Home Assistant."""

    VERSION = 1

    def __init__(self) -> None:
        self._discovered: dict[str, Any] | None = None

    async def async_step_hassio(self, discovery_info: HassioServiceInfo) -> ConfigFlowResult:
        """The add-on announced itself (host, port and the internal token)."""
        data = {
            CONF_HOST: discovery_info.config[CONF_HOST],
            CONF_PORT: int(discovery_info.config[CONF_PORT]),
            CONF_TOKEN: discovery_info.config[CONF_TOKEN],
        }
        await self.async_set_unique_id(DOMAIN)
        # A reinstalled or updated add-on may announce new details: keep the entry current.
        self._abort_if_unique_id_configured(updates=data)
        self._discovered = data
        return await self.async_step_hassio_confirm()

    async def async_step_hassio_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        assert self._discovered is not None
        if user_input is not None:
            return self.async_create_entry(title="Frame Art", data=self._discovered)
        self._set_confirm_only()
        return self.async_show_form(step_id="hassio_confirm")

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Manual set-up (development, or Home Assistant without Supervisor discovery)."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        errors: dict[str, str] = {}
        if user_input is not None:
            if await _reachable(self, user_input):
                return self.async_create_entry(title="Frame Art", data=user_input)
            errors["base"] = "cannot_connect"
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_HOST): str,
                    vol.Required(CONF_PORT, default=8099): int,
                    vol.Required(CONF_TOKEN): str,
                }
            ),
            errors=errors,
        )

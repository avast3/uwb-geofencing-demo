"""In-memory authoritative zone store.

No database: this is a local student demo. All zones are lost when the
backend process restarts, which is an explicitly accepted trade-off.
"""

from typing import Dict, Optional

from .models import Zone

_zones: Dict[str, "Zone"] = {}
_id_counter = 0


def _letter(n: int) -> str:
    """0 -> 'A', 1 -> 'B', ... 25 -> 'Z', 26 -> 'AA', ... Never reused."""
    s = ""
    while True:
        s = chr(65 + n % 26) + s
        n = n // 26 - 1
        if n < 0:
            return s


def next_zone_id() -> str:
    global _id_counter
    zone_id = f"ZONE-{_letter(_id_counter)}"
    _id_counter += 1
    return zone_id


def list_zones() -> list:
    return list(_zones.values())


def get_zone(zone_id: str) -> Optional["Zone"]:
    return _zones.get(zone_id)


def save_zone(zone: "Zone") -> None:
    _zones[zone.zone_id] = zone


def delete_zone(zone_id: str) -> bool:
    return _zones.pop(zone_id, None) is not None


def clear_zones() -> None:
    _zones.clear()

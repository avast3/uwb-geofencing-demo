"""In-memory authoritative zone store.

No database: this is a local student demo. All zones are lost when the
backend process restarts, which is an explicitly accepted trade-off.
"""

from typing import Dict, List, Optional, Set

from .models import Event, Plant, Zone

_zones: Dict[str, "Zone"] = {}
_id_counter = 0

_events: List["Event"] = []
_event_counter = 0

# Which zone_ids each tag was inside as of its last position update, so a
# transition can be detected (entered/exited) without re-deriving history.
_tag_zone_membership: Dict[str, Set[str]] = {}

_plants: Dict[str, "Plant"] = {}
_plant_counter = 0


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
    # Plant zones live in _zones too, so clearing zones must clear their
    # plants or a plant would be left pointing at zones that don't exist.
    _zones.clear()
    _plants.clear()


def next_event_id() -> str:
    global _event_counter
    _event_counter += 1
    return f"EVT-{_event_counter}"


def list_events() -> List["Event"]:
    return list(_events)


def add_event(event: "Event") -> None:
    _events.append(event)


def clear_events() -> None:
    _events.clear()


def get_event(event_id: str) -> Optional["Event"]:
    for event in _events:
        if event.event_id == event_id:
            return event
    return None


def update_event(updated: "Event") -> bool:
    for i, event in enumerate(_events):
        if event.event_id == updated.event_id:
            _events[i] = updated
            return True
    return False


def get_zone_membership(tag_id: str) -> Set[str]:
    return set(_tag_zone_membership.get(tag_id, set()))


def set_zone_membership(tag_id: str, zone_ids: Set[str]) -> None:
    _tag_zone_membership[tag_id] = set(zone_ids)


def next_plant_number() -> int:
    global _plant_counter
    _plant_counter += 1
    return _plant_counter


def list_plants() -> List["Plant"]:
    return list(_plants.values())


def get_plant(plant_id: str) -> Optional["Plant"]:
    return _plants.get(plant_id)


def save_plant(plant: "Plant") -> None:
    _plants[plant.plant_id] = plant


def delete_plant(plant_id: str) -> Optional["Plant"]:
    return _plants.pop(plant_id, None)

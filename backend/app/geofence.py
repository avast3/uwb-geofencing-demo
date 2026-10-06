"""Authoritative geofence math.

Deliberately free of FastAPI imports so it's a plain, unit-testable
function of (position, zones) -> (state, zone_id). The frontend never
performs this check itself — only this backend's answer decides
SAFE/WARNING/BREACH, per the project's core safety principle.
"""

import math
from typing import List, Optional, Set, Tuple

from .models import CircleZone, RectangleZone, Zone


def point_in_rectangle(x: float, y: float, zone: RectangleZone) -> bool:
    return zone.x_min <= x <= zone.x_max and zone.y_min <= y <= zone.y_max


def point_in_circle(x: float, y: float, zone: CircleZone) -> bool:
    distance = math.sqrt((x - zone.centre_x) ** 2 + (y - zone.centre_y) ** 2)
    return distance <= zone.radius


def _point_in_zone(x: float, y: float, zone: Zone) -> bool:
    if zone.shape == "rectangle":
        return point_in_rectangle(x, y, zone)
    return point_in_circle(x, y, zone)


def contained_zone_ids(x: float, y: float, zones: List[Zone]) -> Set[str]:
    """All active zone_ids whose geometry currently contains this point —
    not just the highest-priority one. A position can be inside a warning
    zone and an exclusion zone nested within it at the same time; the
    event system (events.py) needs that full membership set to generate
    independent ENTERED/EXITED transitions per zone, not just one for
    whichever zone classify() reports as the overall state."""
    return {z.zone_id for z in zones if z.active and _point_in_zone(x, y, z)}


def classify(x: float, y: float, zones: List[Zone]) -> Tuple[str, Optional[str]]:
    """Returns (state, zone_id) for the given position against the given
    zones. Inactive zones are ignored. Exclusion (BREACH) always
    outranks Warning, regardless of draw order or nesting."""
    contained_ids = contained_zone_ids(x, y, zones)
    contained = [z for z in zones if z.zone_id in contained_ids]

    for zone in contained:
        if zone.type == "exclusion":
            return "BREACH", zone.zone_id

    for zone in contained:
        if zone.type == "warning":
            return "WARNING", zone.zone_id

    return "SAFE", None

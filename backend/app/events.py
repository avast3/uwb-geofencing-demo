"""Event log: ENTERED/EXITED transitions, generated only when a tag's
zone membership actually changes — never once per position update, which
would flood the log every ~200ms while the tag sits still inside a zone.
"""

from datetime import datetime
from typing import List, Set

from fastapi import APIRouter

from . import state
from .models import Event, TransitionType, Zone

router = APIRouter(prefix="/api/events", tags=["events"])


def _make_event(tag_id: str, zone: Zone, transition: TransitionType) -> Event:
    message = f"{tag_id} {transition} {zone.name.upper()}"
    return Event(
        event_id=state.next_event_id(),
        timestamp=datetime.now().strftime("%H:%M:%S"),
        tag_id=tag_id,
        zone_id=zone.zone_id,
        zone_name=zone.name,
        transition=transition,
        message=message,
    )


def record_transitions(tag_id: str, zones: List[Zone], contained_zone_ids: Set[str]) -> List[Event]:
    """Diffs contained_zone_ids against this tag's previously recorded
    membership, appends one Event per zone entered or exited since the
    last call, and updates the stored membership. Returns the new events
    (the caller doesn't currently need them, but tests/future callers
    might)."""
    previous = state.get_zone_membership(tag_id)
    entered = contained_zone_ids - previous
    exited = previous - contained_zone_ids

    zones_by_id = {z.zone_id: z for z in zones}
    new_events: List[Event] = []

    for zone_id in entered:
        zone = zones_by_id.get(zone_id)
        if zone is not None:
            new_events.append(_make_event(tag_id, zone, "ENTERED"))
    for zone_id in exited:
        zone = zones_by_id.get(zone_id)
        if zone is not None:
            new_events.append(_make_event(tag_id, zone, "EXITED"))

    for event in new_events:
        state.add_event(event)
    state.set_zone_membership(tag_id, contained_zone_ids)

    return new_events


@router.get("", response_model=List[Event])
def list_events():
    return state.list_events()


@router.delete("")
def clear_events():
    state.clear_events()
    return {"cleared": True}

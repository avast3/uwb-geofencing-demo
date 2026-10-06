"""Zone CRUD endpoints. The backend is the authoritative source of truth
for zone geometry — the frontend only ever renders what these endpoints
return.
"""

from typing import List

from fastapi import APIRouter, HTTPException

from . import state
from .models import CircleZone, RectangleZone, Zone, ZoneIn

router = APIRouter(prefix="/api/zones", tags=["zones"])


def _to_stored(zone_in: ZoneIn, zone_id: str):
    data = zone_in.model_dump()
    if zone_in.shape == "rectangle":
        return RectangleZone(**data, zone_id=zone_id)
    return CircleZone(**data, zone_id=zone_id)


@router.post("", response_model=Zone)
def create_zone(zone_in: ZoneIn):
    zone_id = state.next_zone_id()
    zone = _to_stored(zone_in, zone_id)
    state.save_zone(zone)
    return zone


@router.get("", response_model=List[Zone])
def list_zones():
    return state.list_zones()


@router.put("/{zone_id}", response_model=Zone)
def update_zone(zone_id: str, zone_in: ZoneIn):
    existing = state.get_zone(zone_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Zone not found")
    if existing.shape != zone_in.shape:
        raise HTTPException(status_code=400, detail="Cannot change a zone's shape")
    zone = _to_stored(zone_in, zone_id)
    state.save_zone(zone)
    return zone


@router.delete("/{zone_id}")
def delete_zone(zone_id: str):
    if not state.delete_zone(zone_id):
        raise HTTPException(status_code=404, detail="Zone not found")
    return {"zone_id": zone_id, "deleted": True}


@router.delete("")
def clear_zones():
    state.clear_zones()
    return {"cleared": True}

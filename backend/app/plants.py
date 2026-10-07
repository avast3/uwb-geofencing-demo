"""Moving plant (e.g. a semi-truck) with exclusion + warning zones that
follow it.

Modelled on how a real UWB system handles mobile plant: the plant carries
its own tag, reports its measured position, and the backend re-derives the
plant's zones from that position. The zones are ordinary circle zones in
the shared zone store (tagged with plant_id), so geofence.py and events.py
treat them exactly like drawn zones.

A single UWB tag measures position, not orientation, so the zones are
circles centred on the tag that cover the truck body whichever way it is
facing — they never depend on a heading the system couldn't measure.
"""

import math
from typing import List, Tuple

from fastapi import APIRouter, HTTPException

from . import state
from .models import CircleZone, Plant, PlantCreate, PlantPosition, PlantWithZones

router = APIRouter(prefix="/api/plants", tags=["plants"])

# Demo-scale truck on the 8m x 6m site.
BODY_LENGTH_M = 1.6
BODY_WIDTH_M = 0.7
EXCLUSION_MARGIN_M = 0.3  # beyond the body
WARNING_MARGIN_M = 0.6  # beyond the exclusion zone

# Distance from the tag (truck centre) to a body corner: the furthest any
# part of the truck can be from the tag, in any orientation.
BODY_HALF_DIAGONAL_M = math.hypot(BODY_LENGTH_M / 2, BODY_WIDTH_M / 2)
EXCLUSION_RADIUS_M = BODY_HALF_DIAGONAL_M + EXCLUSION_MARGIN_M
WARNING_RADIUS_M = EXCLUSION_RADIUS_M + WARNING_MARGIN_M


def plant_zone_radii() -> Tuple[float, float]:
    """(exclusion, warning) radii. The only place plant zone size is
    defined."""
    return EXCLUSION_RADIUS_M, WARNING_RADIUS_M


def _zone(zone_id: str, plant: Plant, zone_type: str, radius: float) -> CircleZone:
    label = "Exclusion" if zone_type == "exclusion" else "Warning"
    return CircleZone(
        zone_id=zone_id,
        name=f"{plant.name} {label}",
        type=zone_type,
        active=True,
        plant_id=plant.plant_id,
        centre_x=plant.x,
        centre_y=plant.y,
        radius=radius,
    )


def _place(plant: Plant) -> PlantWithZones:
    """Saves the plant and (re)writes both of its zones at its position."""
    exclusion_radius, warning_radius = plant_zone_radii()
    zones = [
        _zone(plant.exclusion_zone_id, plant, "exclusion", exclusion_radius),
        _zone(plant.warning_zone_id, plant, "warning", warning_radius),
    ]
    state.save_plant(plant)
    for zone in zones:
        state.save_zone(zone)
    return PlantWithZones(plant=plant, zones=zones)


def _get_or_404(plant_id: str) -> Plant:
    plant = state.get_plant(plant_id)
    if plant is None:
        raise HTTPException(status_code=404, detail="Plant not found")
    return plant


@router.post("", response_model=PlantWithZones)
def create_plant(body: PlantCreate):
    number = state.next_plant_number()
    plant = Plant(
        plant_id=f"PLANT-{number}",
        name=f"Plant {number}",
        x=body.x,
        y=body.y,
        home_x=body.x,
        home_y=body.y,
        exclusion_zone_id=state.next_zone_id(),
        warning_zone_id=state.next_zone_id(),
    )
    return _place(plant)


@router.get("", response_model=List[Plant])
def list_plants():
    return state.list_plants()


@router.post("/{plant_id}/position", response_model=PlantWithZones)
def update_plant_position(plant_id: str, body: PlantPosition):
    plant = _get_or_404(plant_id)
    return _place(plant.model_copy(update={"x": body.x, "y": body.y}))


@router.post("/{plant_id}/reset", response_model=PlantWithZones)
def reset_plant(plant_id: str):
    plant = _get_or_404(plant_id)
    return _place(plant.model_copy(update={"x": plant.home_x, "y": plant.home_y}))


@router.delete("/{plant_id}")
def delete_plant(plant_id: str):
    plant = state.delete_plant(plant_id)
    if plant is None:
        raise HTTPException(status_code=404, detail="Plant not found")
    state.delete_zone(plant.exclusion_zone_id)
    state.delete_zone(plant.warning_zone_id)
    return {"plant_id": plant_id, "deleted": True}

"""Moving plant (e.g. a semi-truck) with exclusion + warning zones that
follow it.

Modelled on how a real UWB system handles mobile plant: the plant carries
its own tag, reports its measured position, and the backend re-derives the
plant's zones from that position. The zones are ordinary rectangle zones in
the shared zone store (tagged with plant_id), so geofence.py and events.py
treat them exactly like drawn zones.
"""

from typing import List, Tuple

from fastapi import APIRouter, HTTPException

from . import state
from .models import Plant, PlantCreate, PlantHeading, PlantPosition, PlantWithZones, RectangleZone

router = APIRouter(prefix="/api/plants", tags=["plants"])

# Demo-scale truck on the 8m x 6m site (horizontal heading).
BODY_LENGTH_M = 1.6
BODY_WIDTH_M = 0.7
EXCLUSION_MARGIN_M = 0.3  # each side, beyond the body
WARNING_MARGIN_M = 0.6  # each side, beyond the exclusion zone

Rect = Tuple[float, float, float, float]  # x_min, x_max, y_min, y_max


def plant_zone_rects(x: float, y: float, heading: PlantHeading) -> Tuple[Rect, Rect]:
    """(exclusion, warning) rectangles centred on the plant. The only place
    plant zone geometry is defined."""
    length, width = BODY_LENGTH_M, BODY_WIDTH_M
    half_x, half_y = (length / 2, width / 2) if heading == "horizontal" else (width / 2, length / 2)

    def rect(margin: float) -> Rect:
        return (x - half_x - margin, x + half_x + margin, y - half_y - margin, y + half_y + margin)

    return rect(EXCLUSION_MARGIN_M), rect(EXCLUSION_MARGIN_M + WARNING_MARGIN_M)


def _zone(zone_id: str, plant: Plant, zone_type: str, bounds: Rect) -> RectangleZone:
    x_min, x_max, y_min, y_max = bounds
    label = "Exclusion" if zone_type == "exclusion" else "Warning"
    return RectangleZone(
        zone_id=zone_id,
        name=f"{plant.name} {label}",
        type=zone_type,
        active=True,
        plant_id=plant.plant_id,
        x_min=x_min,
        x_max=x_max,
        y_min=y_min,
        y_max=y_max,
    )


def _place(plant: Plant) -> PlantWithZones:
    """Saves the plant and (re)writes both of its zones at its position."""
    exclusion_rect, warning_rect = plant_zone_rects(plant.x, plant.y, plant.heading)
    zones = [
        _zone(plant.exclusion_zone_id, plant, "exclusion", exclusion_rect),
        _zone(plant.warning_zone_id, plant, "warning", warning_rect),
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
        heading="horizontal",
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
    return _place(plant.model_copy(update={"x": body.x, "y": body.y, "heading": body.heading}))


@router.post("/{plant_id}/reset", response_model=PlantWithZones)
def reset_plant(plant_id: str):
    plant = _get_or_404(plant_id)
    return _place(plant.model_copy(update={"x": plant.home_x, "y": plant.home_y, "heading": "horizontal"}))


@router.delete("/{plant_id}")
def delete_plant(plant_id: str):
    plant = state.delete_plant(plant_id)
    if plant is None:
        raise HTTPException(status_code=404, detail="Plant not found")
    state.delete_zone(plant.exclusion_zone_id)
    state.delete_zone(plant.warning_zone_id)
    return {"plant_id": plant_id, "deleted": True}

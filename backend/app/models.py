"""Pydantic models for hazard/exclusion zones.

A zone is either a rectangle or a circle, distinguished by its `shape`
field. The frontend-drawn geometry is validated here before it is ever
stored, so the backend never holds a degenerate zone (inverted bounds,
non-positive radius, etc).
"""

from typing import Annotated, List, Literal, Optional, Union

from pydantic import BaseModel, Field, model_validator

ZoneType = Literal["warning", "exclusion"]
ZoneShapeType = Literal["rectangle", "circle"]


class ZoneBase(BaseModel):
    name: str
    type: ZoneType
    active: bool = True


class RectangleFields(BaseModel):
    x_min: float
    x_max: float
    y_min: float
    y_max: float

    @model_validator(mode="after")
    def check_bounds(self) -> "RectangleFields":
        if self.x_min >= self.x_max:
            raise ValueError("x_min must be less than x_max")
        if self.y_min >= self.y_max:
            raise ValueError("y_min must be less than y_max")
        return self


class CircleFields(BaseModel):
    centre_x: float
    centre_y: float
    radius: float

    @model_validator(mode="after")
    def check_radius(self) -> "CircleFields":
        if self.radius <= 0:
            raise ValueError("radius must be greater than 0")
        return self


class RectangleZoneIn(ZoneBase, RectangleFields):
    """Request body for creating/replacing a rectangle zone."""

    shape: Literal["rectangle"] = "rectangle"


class CircleZoneIn(ZoneBase, CircleFields):
    """Request body for creating/replacing a circle zone."""

    shape: Literal["circle"] = "circle"


# Discriminated union so FastAPI picks the right model from `shape`.
ZoneIn = Annotated[Union[RectangleZoneIn, CircleZoneIn], Field(discriminator="shape")]


class RectangleZone(RectangleZoneIn):
    zone_id: str


class CircleZone(CircleZoneIn):
    zone_id: str


Zone = Annotated[Union[RectangleZone, CircleZone], Field(discriminator="shape")]


class PositionUpdate(BaseModel):
    """Estimated UWB position reported by the frontend — never the
    ground-truth worker position, per the project's core principle."""

    tag_id: str
    x: float
    y: float
    anchors_active: List[str] = Field(default_factory=list)


SafetyState = Literal["SAFE", "WARNING", "BREACH"]


class PositionResult(BaseModel):
    tag_id: str
    state: Optional[SafetyState] = None
    zone_id: Optional[str] = None
    anchors_online: int
    degraded: bool

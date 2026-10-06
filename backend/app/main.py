from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import events, geofence, state
from .events import router as events_router
from .models import PositionResult, PositionUpdate
from .zones import router as zones_router

# 2D trilateration is mathematically impossible below 3 anchors — see
# frontend/src/utils/positioning.ts for the matching frontend-side
# constant and the reasoning.
MIN_ANCHORS_FOR_POSITION = 3

app = FastAPI(title="UWB Construction Safety Demo - Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(zones_router)
app.include_router(events_router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/position", response_model=PositionResult)
def update_position(update: PositionUpdate):
    anchors_online = len(update.anchors_active)

    if anchors_online < MIN_ANCHORS_FOR_POSITION:
        # Fail visible, not fail silent: never report SAFE when position
        # data isn't reliable enough to have computed in the first place.
        return PositionResult(
            tag_id=update.tag_id,
            state=None,
            zone_id=None,
            anchors_online=anchors_online,
            degraded=True,
        )

    zones = state.list_zones()
    safety_state, zone_id = geofence.classify(update.x, update.y, zones)

    contained = geofence.contained_zone_ids(update.x, update.y, zones)
    events.record_transitions(update.tag_id, zones, contained)

    return PositionResult(
        tag_id=update.tag_id,
        state=safety_state,
        zone_id=zone_id,
        anchors_online=anchors_online,
        degraded=False,
    )

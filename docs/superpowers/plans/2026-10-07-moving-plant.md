# Moving Plant + End Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add self-driving mobile plant (semi-trucks) whose exclusion + warning zones follow them, positioned via simulated UWB and re-derived by the backend, plus an END SIMULATION footer button.

**Architecture:** The frontend simulates each truck's true motion, runs it through the existing simulated-ranging + multilateration pipeline, and posts the *estimated* position to a new `/api/plants` backend router. The backend recomputes the plant's two rectangle zones (stored in the existing zone store, tagged with `plant_id`), so geofence classification, events, and the supervisor console work unchanged.

**Tech Stack:** FastAPI + Pydantic v2 (Python 3.10+), React 18 + TypeScript + Vite, pytest + httpx (new dev-only backend deps), Node's built-in `node --test` with native TS type-stripping (no new frontend deps; Node 26 is installed).

**Spec:** `docs/superpowers/specs/2026-10-07-moving-plant-design.md`

## Global Constraints

- Truck body 1.6 m × 0.7 m; exclusion = body + 0.3 m each side (2.2 × 1.3 m); warning = exclusion + 0.6 m each side (3.4 × 2.5 m); vertical heading swaps width/height.
- Motion: up/down/left/right only, segments 1–3 m at 1.0 m/s, pauses 0.5–1.5 s, truck body always inside the 8 m × 6 m site.
- Plant names `Plant 1`, `Plant 2`, …; zone names `Plant N Exclusion`, `Plant N Warning`; plant ids `PLANT-1`, `PLANT-2`, ….
- Plant position updates are the UWB **estimate**, never ground truth; ~5 Hz per plant (200 ms).
- `geofence.py`, `events.py`, `SupervisorPage.tsx`, `AlertQueue.tsx`, `EventLog.tsx` must not change.
- END SIMULATION: footer, red, replaces the live-panel EDIT ZONES button; keeps events and pending alerts; plants return home.
- No new runtime dependencies. Match surrounding comment density and naming.

## Review Focus

1. **Plant placed at the site edge or corner** → it is nudged so the whole truck body is inside the site. (Test: Task 2 `clampPlacement`.)
2. **Truck turning 90° near an edge** (e.g. horizontal truck 0.4 m from the top wants to go up) → it never pokes outside the site; that direction is skipped. (Test: Task 2 "never leaves bounds" + "skips turns that don't fit".)
3. **Plant deleted while the worker is inside its zone** → no crash, no phantom EXITED event for a zone that no longer exists. (Test: Task 1 `test_deleting_plant_with_worker_inside_does_not_crash`.)
4. **Someone edits or deletes a plant zone through `/api/zones`** → 409, and creating a zone that claims a `plant_id` → 400, so plant geometry can't drift. (Test: Task 1 guard tests.)
5. **Plant removed on the backend during live mode** (Clear Zones from another window) → frontend drops that truck instead of erroring every 200 ms. (Test: Task 3 maps HTTP 404 → `{kind: "gone"}`; Task 5 Step 6 browser check.)

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/models.py` (modify) | `plant_id` on zones; `Plant`, `PlantCreate`, `PlantPosition`, `PlantWithZones` |
| `backend/app/state.py` (modify) | in-memory plant store; `clear_zones()` also clears plants |
| `backend/app/plants.py` (create) | plant geometry constants, `plant_zone_rects()`, `/api/plants` router |
| `backend/app/zones.py` (modify) | 409/400 guards for plant zones |
| `backend/app/main.py` (modify) | include the plants router |
| `backend/requirements-dev.txt` (create) | pytest + httpx |
| `backend/tests/test_plants.py` (create) | backend plant tests |
| `frontend/src/utils/plantMotion.ts` (create) | pure motion step function + placement clamp |
| `frontend/src/utils/plantMotion.test.ts` (create) | `node --test` tests |
| `frontend/src/types/index.ts` (modify) | `Plant`, `PlantHeading`, `Tool` += `"plant"`, `plantId` on zones |
| `frontend/src/services/api.ts` (modify) | plant API calls + field mapping |
| `frontend/src/components/Plant.tsx` (create) | SVG truck |
| `frontend/src/components/Zone.tsx` (modify) | `editable` prop (no handles for plant zones) |
| `frontend/src/components/SiteMap.tsx` (modify) | plant tool click, truck rendering, plant zones non-draggable |
| `frontend/src/components/ZoneToolbar.tsx` (modify) | Moving Plant button |
| `frontend/src/components/ZoneProperties.tsx` (modify) | read-only plant view |
| `frontend/src/hooks/usePlantSimulation.ts` (create) | live-mode motion loop + 5 Hz estimated-position posting |
| `frontend/src/App.tsx` (modify) | plant state, create/delete/clear, start/end simulation |
| `frontend/src/App.css` (modify) | truck, plant zone, END SIMULATION styles |
| `README.md` (modify) | walkthrough, API, structure, architecture |

---

### Task 1: Backend plants (models, geometry, router, guards)

**Files:**
- Create: `backend/requirements-dev.txt`, `backend/tests/__init__.py`, `backend/tests/test_plants.py`, `backend/app/plants.py`
- Modify: `backend/app/models.py`, `backend/app/state.py`, `backend/app/zones.py`, `backend/app/main.py`

**Interfaces:**
- Produces (HTTP, snake_case JSON):
  - `POST /api/plants` body `{x, y}` → `PlantWithZones` = `{plant: Plant, zones: [exclusionZone, warningZone]}`
  - `GET /api/plants` → `Plant[]`
  - `POST /api/plants/{plant_id}/position` body `{x, y, heading}` → `PlantWithZones`; 404 if unknown
  - `POST /api/plants/{plant_id}/reset` → `PlantWithZones`; 404 if unknown
  - `DELETE /api/plants/{plant_id}` → `{plant_id, deleted: true}`; 404 if unknown
  - `Plant` = `{plant_id, name, x, y, heading: "horizontal"|"vertical", home_x, home_y, exclusion_zone_id, warning_zone_id}`
  - Every zone JSON gains `plant_id: string | null`.
  - `PUT`/`DELETE /api/zones/{id}` on a plant zone → 409; `POST /api/zones` with non-null `plant_id` → 400.

- [ ] **Step 1: Add dev dependencies and install them**

Create `backend/requirements-dev.txt`:

```text
-r requirements.txt
pytest>=8.0
httpx>=0.27
```

Create an empty `backend/tests/__init__.py`.

Run: `cd backend && .venv/bin/pip install -q -r requirements-dev.txt`
Expected: exits 0.

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_plants.py`:

```python
import pytest
from fastapi.testclient import TestClient

from app import state
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_state():
    state.clear_zones()
    state.clear_events()
    state.set_zone_membership("TAG-001", set())
    yield


def _size(zone):
    return round(zone["x_max"] - zone["x_min"], 6), round(zone["y_max"] - zone["y_min"], 6)


def _create(x=4.0, y=3.0):
    res = client.post("/api/plants", json={"x": x, "y": y})
    assert res.status_code == 200
    return res.json()


def test_create_plant_makes_two_zones_with_spec_sizes():
    body = _create()
    plant, zones = body["plant"], body["zones"]
    assert plant["plant_id"].startswith("PLANT-")
    assert plant["name"].startswith("Plant ")
    assert plant["heading"] == "horizontal"
    assert (plant["home_x"], plant["home_y"]) == (4.0, 3.0)

    by_type = {z["type"]: z for z in zones}
    assert _size(by_type["exclusion"]) == (2.2, 1.3)
    assert _size(by_type["warning"]) == (3.4, 2.5)
    assert by_type["exclusion"]["name"] == f"{plant['name']} Exclusion"
    assert by_type["warning"]["name"] == f"{plant['name']} Warning"
    for z in zones:
        assert z["plant_id"] == plant["plant_id"]

    listed_ids = {z["zone_id"] for z in client.get("/api/zones").json()}
    assert {plant["exclusion_zone_id"], plant["warning_zone_id"]} <= listed_ids


def test_vertical_heading_swaps_zone_dimensions_and_moves_centre():
    plant = _create()["plant"]
    res = client.post(
        f"/api/plants/{plant['plant_id']}/position",
        json={"x": 5.0, "y": 2.5, "heading": "vertical"},
    )
    assert res.status_code == 200
    by_type = {z["type"]: z for z in res.json()["zones"]}
    assert _size(by_type["exclusion"]) == (1.3, 2.2)
    assert _size(by_type["warning"]) == (2.5, 3.4)
    exc = by_type["exclusion"]
    assert (exc["x_min"] + exc["x_max"]) / 2 == pytest.approx(5.0)
    assert (exc["y_min"] + exc["y_max"]) / 2 == pytest.approx(2.5)


def test_reset_returns_plant_home_and_horizontal():
    plant = _create(2.0, 2.0)["plant"]
    client.post(f"/api/plants/{plant['plant_id']}/position", json={"x": 6, "y": 4, "heading": "vertical"})
    body = client.post(f"/api/plants/{plant['plant_id']}/reset").json()
    assert (body["plant"]["x"], body["plant"]["y"], body["plant"]["heading"]) == (2.0, 2.0, "horizontal")
    exc = next(z for z in body["zones"] if z["type"] == "exclusion")
    assert _size(exc) == (2.2, 1.3)


def test_unknown_plant_returns_404():
    assert client.post("/api/plants/PLANT-999/position", json={"x": 1, "y": 1, "heading": "horizontal"}).status_code == 404
    assert client.post("/api/plants/PLANT-999/reset").status_code == 404
    assert client.delete("/api/plants/PLANT-999").status_code == 404


def test_delete_plant_removes_both_zones():
    plant = _create()["plant"]
    assert client.delete(f"/api/plants/{plant['plant_id']}").json() == {"plant_id": plant["plant_id"], "deleted": True}
    assert client.get("/api/zones").json() == []
    assert client.get("/api/plants").json() == []


def test_clear_zones_also_clears_plants():
    _create()
    client.delete("/api/zones")
    assert client.get("/api/plants").json() == []


def test_plant_zones_cannot_be_edited_or_deleted_via_zone_api():
    plant = _create()["plant"]
    zone = next(z for z in client.get("/api/zones").json() if z["zone_id"] == plant["exclusion_zone_id"])
    put = client.put(f"/api/zones/{zone['zone_id']}", json={**zone, "name": "hacked"})
    assert put.status_code == 409
    assert client.delete(f"/api/zones/{zone['zone_id']}").status_code == 409


def test_creating_a_zone_that_claims_a_plant_is_rejected():
    res = client.post(
        "/api/zones",
        json={"shape": "rectangle", "name": "x", "type": "exclusion", "x_min": 0, "x_max": 1, "y_min": 0, "y_max": 1, "plant_id": "PLANT-1"},
    )
    assert res.status_code == 400


def test_plant_driving_onto_stationary_worker_breaches():
    plant = _create(1.5, 1.5)["plant"]
    worker = {"tag_id": "TAG-001", "x": 6.0, "y": 4.0, "anchors_active": ["A1", "A2", "A3", "A4"]}
    assert client.post("/api/position", json=worker).json()["state"] == "SAFE"
    client.post(f"/api/plants/{plant['plant_id']}/position", json={"x": 6.0, "y": 4.0, "heading": "horizontal"})
    result = client.post("/api/position", json=worker).json()
    assert result["state"] == "BREACH"
    assert result["zone_id"] == plant["exclusion_zone_id"]
    alerts = [e for e in client.get("/api/events").json() if e["requires_ack"]]
    assert alerts[-1]["zone_name"] == f"{plant['name']} Exclusion"


def test_deleting_plant_with_worker_inside_does_not_crash():
    plant = _create(4.0, 3.0)["plant"]
    worker = {"tag_id": "TAG-001", "x": 4.0, "y": 3.0, "anchors_active": ["A1", "A2", "A3", "A4"]}
    assert client.post("/api/position", json=worker).json()["state"] == "BREACH"
    events_before = len(client.get("/api/events").json())
    client.delete(f"/api/plants/{plant['plant_id']}")
    res = client.post("/api/position", json=worker)
    assert res.status_code == 200
    assert res.json()["state"] == "SAFE"
    # No EXITED event is logged for a zone that no longer exists.
    assert len(client.get("/api/events").json()) == events_before
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: FAIL — 404s on `/api/plants` / `KeyError: 'plant_id'` (router and field don't exist yet).

- [ ] **Step 4: Add models**

In `backend/app/models.py`, change `ZoneBase` to:

```python
class ZoneBase(BaseModel):
    name: str
    type: ZoneType
    active: bool = True
    # Set only for zones owned by a moving plant (see plants.py); their
    # geometry is derived from the plant's position, never edited directly.
    plant_id: Optional[str] = None
```

Append to the end of `backend/app/models.py`:

```python
PlantHeading = Literal["horizontal", "vertical"]


class PlantCreate(BaseModel):
    x: float
    y: float


class PlantPosition(BaseModel):
    """A plant's UWB-estimated position (not ground truth), like the
    worker's PositionUpdate."""

    x: float
    y: float
    heading: PlantHeading


class Plant(BaseModel):
    plant_id: str
    name: str
    x: float
    y: float
    heading: PlantHeading
    home_x: float
    home_y: float
    exclusion_zone_id: str
    warning_zone_id: str


class PlantWithZones(BaseModel):
    plant: Plant
    zones: List[Zone]
```

- [ ] **Step 5: Add plant state**

In `backend/app/state.py`, change the imports line to:

```python
from .models import Event, Plant, Zone
```

Below `_tag_zone_membership`, add:

```python
_plants: Dict[str, "Plant"] = {}
_plant_counter = 0
```

Replace `clear_zones` with:

```python
def clear_zones() -> None:
    # Plant zones live in _zones too, so clearing zones must clear their
    # plants or a plant would be left pointing at zones that don't exist.
    _zones.clear()
    _plants.clear()
```

Append to the end of `backend/app/state.py`:

```python
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
```

- [ ] **Step 6: Add the plants router**

Create `backend/app/plants.py`:

```python
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
```

- [ ] **Step 7: Guard plant zones in the zone router and register the plants router**

In `backend/app/zones.py`, add this helper above `create_zone`:

```python
def _reject_plant_zone(zone) -> None:
    if zone.plant_id is not None:
        raise HTTPException(status_code=409, detail="Plant zones are managed through /api/plants")
```

Change `create_zone` to:

```python
@router.post("", response_model=Zone)
def create_zone(zone_in: ZoneIn):
    if zone_in.plant_id is not None:
        raise HTTPException(status_code=400, detail="Plant zones are created through /api/plants")
    zone_id = state.next_zone_id()
    zone = _to_stored(zone_in, zone_id)
    state.save_zone(zone)
    return zone
```

In `update_zone`, directly after the `if existing is None:` block, add:

```python
    _reject_plant_zone(existing)
```

Change `delete_zone` to:

```python
@router.delete("/{zone_id}")
def delete_zone(zone_id: str):
    existing = state.get_zone(zone_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Zone not found")
    _reject_plant_zone(existing)
    state.delete_zone(zone_id)
    return {"zone_id": zone_id, "deleted": True}
```

In `backend/app/main.py`, add `from .plants import router as plants_router` beside the other router imports and `app.include_router(plants_router)` after `app.include_router(events_router)`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: `10 passed`.

- [ ] **Step 9: Commit**

```bash
git add backend/requirements-dev.txt backend/tests backend/app/models.py backend/app/state.py backend/app/plants.py backend/app/zones.py backend/app/main.py
git commit -m "Add backend moving plant: /api/plants with zones that follow the plant"
```

---

### Task 2: Pure plant motion module

**Files:**
- Create: `frontend/src/utils/plantMotion.ts`, `frontend/src/utils/plantMotion.test.ts`
- Modify: `frontend/tsconfig.json`, `frontend/package.json`

**Interfaces:**
- Consumes: `PlantHeading` type from `../types` (added in this task — see Step 3).
- Produces:
  - `type Direction = "up" | "down" | "left" | "right"`
  - `interface SiteBounds { width: number; height: number }`
  - `interface PlantMotion { x: number; y: number; direction: Direction; remainingM: number; pauseS: number }`
  - `BODY_LENGTH_M = 1.6`, `BODY_WIDTH_M = 0.7`, `PLANT_SPEED_MPS = 1.0`
  - `headingFor(direction: Direction): PlantHeading`
  - `clampPlacement(x: number, y: number, heading: PlantHeading, bounds: SiteBounds): { x: number; y: number }`
  - `initialMotion(x: number, y: number): PlantMotion` (faces right, will pick a direction on first step)
  - `stepPlant(m: PlantMotion, dtS: number, bounds: SiteBounds, random?: () => number): PlantMotion`

- [ ] **Step 1: Wire up the test runner**

In `frontend/tsconfig.json`, add after `"include": ["src"],`:

```json
  "exclude": ["src/**/*.test.ts"],
```

(Test files import `node:test`, whose types aren't installed; Node runs them directly.)

In `frontend/package.json` `scripts`, add:

```json
    "test": "node --test \"src/**/*.test.ts\"",
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/utils/plantMotion.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BODY_LENGTH_M,
  BODY_WIDTH_M,
  clampPlacement,
  headingFor,
  initialMotion,
  stepPlant,
} from "./plantMotion.ts";
import type { PlantMotion, SiteBounds } from "./plantMotion.ts";

const SITE: SiteBounds = { width: 8, height: 6 };

// Small deterministic PRNG so tests are repeatable.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bodyInside(m: PlantMotion): boolean {
  const vertical = headingFor(m.direction) === "vertical";
  const hx = (vertical ? BODY_WIDTH_M : BODY_LENGTH_M) / 2;
  const hy = (vertical ? BODY_LENGTH_M : BODY_WIDTH_M) / 2;
  const eps = 1e-9;
  return m.x - hx >= -eps && m.x + hx <= SITE.width + eps && m.y - hy >= -eps && m.y + hy <= SITE.height + eps;
}

test("headingFor maps directions to headings", () => {
  assert.equal(headingFor("left"), "horizontal");
  assert.equal(headingFor("right"), "horizontal");
  assert.equal(headingFor("up"), "vertical");
  assert.equal(headingFor("down"), "vertical");
});

function assertPoint(actual: { x: number; y: number }, x: number, y: number) {
  assert.ok(Math.abs(actual.x - x) < 1e-9 && Math.abs(actual.y - y) < 1e-9, JSON.stringify(actual));
}

test("clampPlacement nudges a corner click so the body is inside", () => {
  assertPoint(clampPlacement(0, 0, "horizontal", SITE), 0.8, 0.35);
  assertPoint(clampPlacement(8, 6, "vertical", SITE), 7.65, 5.2);
  assertPoint(clampPlacement(4, 3, "horizontal", SITE), 4, 3);
});

test("only moves in straight lines along one axis per step", () => {
  const random = seeded(1);
  let m = initialMotion(4, 3);
  for (let i = 0; i < 2000; i++) {
    const next = stepPlant(m, 0.05, SITE, random);
    const movedX = Math.abs(next.x - m.x) > 1e-12;
    const movedY = Math.abs(next.y - m.y) > 1e-12;
    assert.ok(!(movedX && movedY), `diagonal move at step ${i}`);
    m = next;
  }
});

test("never leaves the site, across many seeds and long runs", () => {
  for (let seed = 0; seed < 25; seed++) {
    const random = seeded(seed);
    const start = clampPlacement(seed % 8, seed % 6, "horizontal", SITE);
    let m = initialMotion(start.x, start.y);
    for (let i = 0; i < 3000; i++) {
      m = stepPlant(m, 0.05, SITE, random);
      assert.ok(bodyInside(m), `seed ${seed} step ${i} outside: ${JSON.stringify(m)}`);
    }
  }
});

test("skips turns that don't fit: horizontal truck near the top never turns vertical in place", () => {
  // Body half-length when vertical is 0.8 m; at y = 5.6 a vertical body would poke out the top.
  const start: PlantMotion = { x: 4, y: 5.6, direction: "right", remainingM: 0, pauseS: 0 };
  for (let seed = 0; seed < 50; seed++) {
    const next = stepPlant(start, 0.05, SITE, seeded(seed));
    assert.equal(headingFor(next.direction), "horizontal");
  }
});

test("moves at 1 m/s and pauses after finishing a segment", () => {
  const random = seeded(7);
  let m = stepPlant(initialMotion(4, 3), 0.0001, SITE, random); // picks a segment
  const segment = m.remainingM;
  assert.ok(segment >= 0.2 && segment <= 3);
  m = stepPlant(m, 0.5, SITE, random);
  assert.ok(Math.abs(segment - m.remainingM - 0.5) < 1e-9);
  m = stepPlant(m, 10, SITE, random); // finishes the segment
  assert.equal(m.remainingM, 0);
  assert.ok(m.pauseS >= 0.5 && m.pauseS <= 1.5);
  const paused = stepPlant(m, 0.1, SITE, random);
  assert.equal(paused.x, m.x);
  assert.equal(paused.y, m.y);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module .../plantMotion.ts`.

- [ ] **Step 4: Add the `PlantHeading` type**

In `frontend/src/types/index.ts`, after the `ZoneShape` line add:

```ts
export type PlantHeading = "horizontal" | "vertical";
```

- [ ] **Step 5: Implement the module**

Create `frontend/src/utils/plantMotion.ts`:

```ts
// Ground-truth motion for a simulated mobile plant (semi-truck): straight
// runs up/down/left/right with short pauses, always keeping the truck body
// inside the site. Pure functions with no React or DOM so the behaviour is
// easy to test; App/usePlantSimulation own the timing loop.
//
// Only `import type` here: Node's test runner strips types but can't
// resolve the app's other modules' extensionless imports.

import type { PlantHeading } from "../types";

export type Direction = "up" | "down" | "left" | "right";

export interface SiteBounds {
  width: number;
  height: number;
}

export interface PlantMotion {
  x: number;
  y: number;
  direction: Direction;
  /** Metres left in the current straight run; 0 = choose a new one. */
  remainingM: number;
  /** Seconds left in the current pause. */
  pauseS: number;
}

// Must match BODY_LENGTH_M / BODY_WIDTH_M in backend/app/plants.py.
export const BODY_LENGTH_M = 1.6;
export const BODY_WIDTH_M = 0.7;
export const PLANT_SPEED_MPS = 1.0;
const SEGMENT_MIN_M = 1;
const SEGMENT_MAX_M = 3;
const MIN_USEFUL_RUN_M = 0.2;
const PAUSE_MIN_S = 0.5;
const PAUSE_MAX_S = 1.5;

const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];

export function headingFor(direction: Direction): PlantHeading {
  return direction === "left" || direction === "right" ? "horizontal" : "vertical";
}

function halfExtents(heading: PlantHeading): { hx: number; hy: number } {
  return heading === "horizontal"
    ? { hx: BODY_LENGTH_M / 2, hy: BODY_WIDTH_M / 2 }
    : { hx: BODY_WIDTH_M / 2, hy: BODY_LENGTH_M / 2 };
}

function clampValue(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export function clampPlacement(
  x: number,
  y: number,
  heading: PlantHeading,
  bounds: SiteBounds
): { x: number; y: number } {
  const { hx, hy } = halfExtents(heading);
  return { x: clampValue(x, hx, bounds.width - hx), y: clampValue(y, hy, bounds.height - hy) };
}

export function initialMotion(x: number, y: number): PlantMotion {
  return { x, y, direction: "right", remainingM: 0, pauseS: 0 };
}

// How far the truck could drive in `direction` from (x, y), or -1 if it
// can't even turn to face that way without its body leaving the site.
function maxRun(x: number, y: number, direction: Direction, bounds: SiteBounds): number {
  const { hx, hy } = halfExtents(headingFor(direction));
  const eps = 1e-9;
  if (x - hx < -eps || x + hx > bounds.width + eps || y - hy < -eps || y + hy > bounds.height + eps) return -1;
  switch (direction) {
    case "up":
      return bounds.height - hy - y;
    case "down":
      return y - hy;
    case "left":
      return x - hx;
    case "right":
      return bounds.width - hx - x;
  }
}

export function stepPlant(
  m: PlantMotion,
  dtS: number,
  bounds: SiteBounds,
  random: () => number = Math.random
): PlantMotion {
  if (m.pauseS > 0) {
    return { ...m, pauseS: Math.max(0, m.pauseS - dtS) };
  }

  let next = m;
  if (next.remainingM <= 0) {
    const options = DIRECTIONS.map((d) => ({ d, run: maxRun(next.x, next.y, d, bounds) })).filter(
      (o) => o.run >= MIN_USEFUL_RUN_M
    );
    if (options.length === 0) {
      return { ...next, pauseS: PAUSE_MIN_S };
    }
    const choice = options[Math.floor(random() * options.length) % options.length];
    const wanted = SEGMENT_MIN_M + random() * (SEGMENT_MAX_M - SEGMENT_MIN_M);
    next = { ...next, direction: choice.d, remainingM: Math.min(wanted, choice.run) };
  }

  const d = Math.min(next.remainingM, PLANT_SPEED_MPS * dtS);
  const dx = next.direction === "right" ? d : next.direction === "left" ? -d : 0;
  const dy = next.direction === "up" ? d : next.direction === "down" ? -d : 0;
  const remainingM = next.remainingM - d <= 1e-9 ? 0 : next.remainingM - d;
  const pauseS = remainingM === 0 ? PAUSE_MIN_S + random() * (PAUSE_MAX_S - PAUSE_MIN_S) : 0;
  return { ...next, x: next.x + dx, y: next.y + dy, remainingM, pauseS };
}
```

- [ ] **Step 6: Run tests and the typecheck**

Run: `cd frontend && npm test && npm run -s typecheck && rm -f vite.config.js vite.config.d.ts`
Expected: all 6 tests pass; typecheck exits 0. (`rm` removes files `tsc -b` emits; they're gitignored.)

- [ ] **Step 7: Commit**

```bash
git add frontend/tsconfig.json frontend/package.json frontend/src/types/index.ts frontend/src/utils/plantMotion.ts frontend/src/utils/plantMotion.test.ts
git commit -m "Add pure plant motion module with node --test coverage"
```

---

### Task 3: Frontend types + plant API client

**Files:**
- Modify: `frontend/src/types/index.ts`, `frontend/src/services/api.ts`

**Interfaces:**
- Consumes: Task 1 HTTP API; `PlantHeading` from Task 2.
- Produces:
  - `BaseZone.plantId?: string | null`; `Tool` = `"select" | "rectangle" | "circle" | "plant"`
  - `interface Plant { id; name; x; y; heading: PlantHeading; homeX; homeY; exclusionZoneId; warningZoneId }`
  - `interface PlantWithZones { plant: Plant; zones: Zone[] }`
  - `type PlantUpdateResult = { kind: "ok"; plant: Plant; zones: Zone[] } | { kind: "gone" } | { kind: "error" }`
  - `api.getPlants(): Promise<Plant[]>`
  - `api.createPlant(x: number, y: number): Promise<PlantWithZones | null>`
  - `api.postPlantPosition(id: string, x: number, y: number, heading: PlantHeading): Promise<PlantUpdateResult>`
  - `api.resetPlant(id: string): Promise<PlantWithZones | null>`
  - `api.deletePlant(id: string): Promise<boolean>`

- [ ] **Step 1: Extend the types**

In `frontend/src/types/index.ts`:

Add to `BaseZone`:

```ts
  /** Set for zones owned by a moving plant; their geometry follows the plant. */
  plantId?: string | null;
```

Change `Tool`:

```ts
export type Tool = "select" | "rectangle" | "circle" | "plant";
```

Append:

```ts
export interface Plant {
  id: string;
  name: string;
  /** Last position the backend holds (UWB estimate), metres. */
  x: number;
  y: number;
  heading: PlantHeading;
  /** Where it was placed; END SIMULATION returns it here. */
  homeX: number;
  homeY: number;
  exclusionZoneId: string;
  warningZoneId: string;
}

export interface PlantWithZones {
  plant: Plant;
  zones: Zone[];
}

export type PlantUpdateResult =
  | { kind: "ok"; plant: Plant; zones: Zone[] }
  | { kind: "gone" }
  | { kind: "error" };
```

- [ ] **Step 2: Map `plant_id` on zones**

In `frontend/src/services/api.ts`:
- Add `plant_id?: string | null;` to `BackendZoneCommon`.
- In both branches of `fromBackend`, add `plantId: z.plant_id ?? null,` after `active: z.active,`.
- Extend the type import with `Plant, PlantHeading, PlantUpdateResult, PlantWithZones`.

- [ ] **Step 3: Add the plant calls**

Append to `frontend/src/services/api.ts`:

```ts
interface BackendPlant {
  plant_id: string;
  name: string;
  x: number;
  y: number;
  heading: PlantHeading;
  home_x: number;
  home_y: number;
  exclusion_zone_id: string;
  warning_zone_id: string;
}

interface BackendPlantWithZones {
  plant: BackendPlant;
  zones: BackendZone[];
}

function fromBackendPlant(p: BackendPlant): Plant {
  return {
    id: p.plant_id,
    name: p.name,
    x: p.x,
    y: p.y,
    heading: p.heading,
    homeX: p.home_x,
    homeY: p.home_y,
    exclusionZoneId: p.exclusion_zone_id,
    warningZoneId: p.warning_zone_id,
  };
}

function fromBackendPlantWithZones(r: BackendPlantWithZones): PlantWithZones {
  return { plant: fromBackendPlant(r.plant), zones: r.zones.map(fromBackend) };
}

export async function getPlants(): Promise<Plant[]> {
  const result = await request<BackendPlant[]>("/api/plants");
  return (result ?? []).map(fromBackendPlant);
}

export async function createPlant(x: number, y: number): Promise<PlantWithZones | null> {
  const result = await request<BackendPlantWithZones>("/api/plants", {
    method: "POST",
    body: JSON.stringify({ x, y }),
  });
  return result ? fromBackendPlantWithZones(result) : null;
}

// Sends the plant's estimated UWB position. Unlike request(), this
// distinguishes 404 (plant deleted elsewhere, e.g. Clear Zones in another
// window) from a transient failure, so the caller can drop the plant
// instead of retrying it 5x/sec forever.
export async function postPlantPosition(
  id: string,
  x: number,
  y: number,
  heading: PlantHeading
): Promise<PlantUpdateResult> {
  try {
    const res = await fetch(`${BASE_URL}/api/plants/${id}/position`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y, heading }),
    });
    if (res.status === 404) return { kind: "gone" };
    if (!res.ok) return { kind: "error" };
    const body = fromBackendPlantWithZones((await res.json()) as BackendPlantWithZones);
    return { kind: "ok", ...body };
  } catch {
    return { kind: "error" };
  }
}

export async function resetPlant(id: string): Promise<PlantWithZones | null> {
  const result = await request<BackendPlantWithZones>(`/api/plants/${id}/reset`, { method: "POST" });
  return result ? fromBackendPlantWithZones(result) : null;
}

export async function deletePlant(id: string): Promise<boolean> {
  const result = await request<{ plant_id: string; deleted: boolean }>(`/api/plants/${id}`, {
    method: "DELETE",
  });
  return result?.deleted === true;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run -s typecheck && rm -f vite.config.js vite.config.d.ts`
Expected: exits 0.

- [ ] **Step 5: Check the 404 → "gone" mapping against the real backend**

With the backend running (`uvicorn --reload` picks up Task 1), in the browser devtools console on `http://localhost:5173`:

```js
const api = await import("/src/services/api.ts");
await api.postPlantPosition("PLANT-999", 1, 1, "horizontal");
```

Expected: `{kind: "gone"}`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "Add frontend plant types and API client"
```

---

### Task 4: Place, render, select and delete plants (setup mode)

**Files:**
- Create: `frontend/src/components/Plant.tsx`
- Modify: `frontend/src/components/Zone.tsx`, `frontend/src/components/SiteMap.tsx`, `frontend/src/components/ZoneToolbar.tsx`, `frontend/src/components/ZoneProperties.tsx`, `frontend/src/App.tsx`, `frontend/src/App.css`

**Interfaces:**
- Consumes: `Plant`, `Tool`, `api.createPlant/deletePlant/getPlants` (Task 3); `clampPlacement`, `BODY_LENGTH_M`, `BODY_WIDTH_M`, `Direction` (Task 2).
- Produces:
  - `<PlantComp plant={Plant} pose={PlantPose} onPointerDown?={(e: React.PointerEvent) => void} />`
  - `SiteMap` new props: `plants: Plant[]`, `plantPoses: Record<string, PlantPose>`, `onPlantCreate: (pointM: MetrePoint) => void`
  - `interface PlantPose { x: number; y: number; direction: Direction }` exported from `components/Plant.tsx`
  - `ZoneProperties` new prop: `plant: Plant | null`

- [ ] **Step 1: Truck component**

Create `frontend/src/components/Plant.tsx`:

```tsx
import { metresLengthToPixels, metresToPixels } from "../utils/coordinateTransform";
import { BODY_LENGTH_M, BODY_WIDTH_M } from "../utils/plantMotion";
import type { Direction } from "../utils/plantMotion";
import type { Plant as PlantData } from "../types";

export interface PlantPose {
  x: number;
  y: number;
  direction: Direction;
}

interface PlantProps {
  plant: PlantData;
  pose: PlantPose;
  onPointerDown?: (e: React.PointerEvent) => void;
}

const ROTATION: Record<Direction, number> = { right: 0, down: 90, left: 180, up: -90 };

// Top-down semi-truck (trailer + cab) at its ground-truth position. Drawn
// facing right in a local frame centred on the truck, then rotated so the
// cab leads in the direction of travel.
export default function Plant({ plant, pose, onPointerDown }: PlantProps) {
  const { x, y } = metresToPixels(pose.x, pose.y);
  const length = metresLengthToPixels(BODY_LENGTH_M);
  const width = metresLengthToPixels(BODY_WIDTH_M);
  const cab = length * 0.28;
  const gap = 3;

  return (
    <g transform={`translate(${x}, ${y})`} className="plant" onPointerDown={onPointerDown}>
      <g transform={`rotate(${ROTATION[pose.direction]})`}>
        <rect x={-length / 2} y={-width / 2} width={length - cab - gap} height={width} rx={3} className="plant-trailer" />
        <rect x={length / 2 - cab} y={-width / 2 + 2} width={cab} height={width - 4} rx={4} className="plant-cab" />
        <rect x={length / 2 - 7} y={-width / 2 + 6} width={4} height={width - 12} rx={1} className="plant-windscreen" />
      </g>
      <text x={0} y={4} textAnchor="middle" className="plant-label">
        {plant.name}
      </text>
    </g>
  );
}
```

- [ ] **Step 2: Non-editable zones**

In `frontend/src/components/Zone.tsx`:
- Add `editable?: boolean;` to `ZoneProps` and `editable = true` to the destructured props.
- Change `selectedClass` to keep the highlight, and add a class for plant zones:

```tsx
  const plantClass = zone.plantId ? " zone-plant" : "";
  const className = `zone ${colourClass}${inactiveClass}${selectedClass}${plantClass}`;
```

(replacing the existing `const className = …` line).
- Change both `{isSelected &&` handle conditions to `{isSelected && editable &&`.

- [ ] **Step 3: SiteMap — plant tool, plant zones, trucks**

In `frontend/src/components/SiteMap.tsx`:

Add imports:

```tsx
import PlantComp from "./Plant";
import type { PlantPose } from "./Plant";
```

and add `Plant` to the `../types` type import.

Add to `SiteMapProps`:

```tsx
  plants: Plant[];
  /** Where to draw each truck (ground truth in live mode, backend position in setup). */
  plantPoses: Record<string, PlantPose>;
  onPlantCreate: (pointM: MetrePoint) => void;
```

and destructure `plants, plantPoses, onPlantCreate` in the component signature.

In `handleBackgroundPointerDown`, add a branch before the final `else`:

```tsx
    } else if (tool === "plant") {
      onPlantCreate(m);
```

In `handleBodyPointerDown`, after `const zone = zones.find((z) => z.id === zoneId); if (!zone) return;`, insert:

```tsx
    if (zone.plantId) {
      // Plant zones follow their truck; select it, but never drag/resize.
      const plant = plants.find((p) => p.id === zone.plantId);
      onZoneSelect(plant ? plant.exclusionZoneId : zoneId);
      return;
    }
```

Change the zones render so plant zones are non-editable and the whole plant highlights when either of its zones is selected:

```tsx
      {zones.map((zone) => {
        const plant = zone.plantId ? plants.find((p) => p.id === zone.plantId) : undefined;
        const selected = plant
          ? selectedZoneId === plant.exclusionZoneId || selectedZoneId === plant.warningZoneId
          : zone.id === selectedZoneId;
        return (
          <ZoneComp
            key={zone.id}
            zone={zone}
            isSelected={selected && !locked}
            editable={!zone.plantId}
            onBodyPointerDown={handleBodyPointerDown}
            onHandlePointerDown={handleHandlePointerDown}
          />
        );
      })}
```

After the draw previews and before anchors, render trucks:

```tsx
      {/* Mobile plant, above zones so the truck is visible inside its own zones */}
      {plants.map((plant) => {
        const pose: PlantPose = plantPoses[plant.id] ?? {
          x: plant.x,
          y: plant.y,
          direction: plant.heading === "vertical" ? "up" : "right",
        };
        return (
          <PlantComp
            key={plant.id}
            plant={plant}
            pose={pose}
            onPointerDown={(e) => handleBodyPointerDown(e, plant.exclusionZoneId)}
          />
        );
      })}
```

- [ ] **Step 4: Toolbar button**

In `frontend/src/components/ZoneToolbar.tsx`, after the Circle Zone button add:

```tsx
      <button
        className={tool === "plant" ? "toolbar-btn active" : "toolbar-btn"}
        onClick={() => onToolChange("plant")}
        title="Click the site to place a semi-truck whose zones move with it"
      >
        🚛 Moving Plant
      </button>
```

- [ ] **Step 5: Read-only plant properties**

In `frontend/src/components/ZoneProperties.tsx`:
- Change the import to `import type { Plant, Zone, ZoneType } from "../types";`
- Add `plant: Plant | null;` to the props interface and destructure `plant`.
- Directly after the `if (!zone) { … }` block, add:

```tsx
  if (plant) {
    return (
      <div className="properties-panel">
        <h3>MOVING PLANT</h3>
        <div className="properties-row">
          <span>Name</span>
          <span className="properties-value">{plant.name}</span>
        </div>
        <div className="properties-row">
          <span>Zones</span>
          <span className="properties-value">Exclusion + Warning</span>
        </div>
        <p className="properties-empty">
          Moves automatically during live simulation; its zones follow the
          truck. Use Delete Zone to remove it.
        </p>
      </div>
    );
  }
```

- [ ] **Step 6: App — plant state, create, delete, clear**

In `frontend/src/App.tsx`:

Add imports:

```tsx
import { clampPlacement } from "./utils/plantMotion";
import type { PlantPose } from "./components/Plant";
```

and add `Plant` to the `./types` type import.

Add state beside `zones`:

```tsx
  const [plants, setPlants] = useState<Plant[]>([]);
```

In the initial-load effect, after `if (!cancelled) setZones(loaded);`, add:

```tsx
        const loadedPlants = await api.getPlants();
        if (!cancelled) setPlants(loadedPlants);
```

Add derived values beside `selectedZone`:

```tsx
  const selectedPlant = selectedZone?.plantId ? plants.find((p) => p.id === selectedZone.plantId) ?? null : null;
```

Add a module-level constant beside `WORKER_START_POSITION`:

```tsx
const SITE_BOUNDS = { width: SITE_WIDTH_M, height: SITE_HEIGHT_M };
```

Add a helper and the create handler next to `handleZoneCreate`:

```tsx
  // Replaces the given zones in place (plant zones are re-derived by the
  // backend whenever the plant moves) and appends any not yet known.
  function mergeZones(updated: Zone[]) {
    setZones((prev) => {
      const byId = new Map(updated.map((z) => [z.id, z]));
      const merged = prev.map((z) => byId.get(z.id) ?? z);
      for (const z of updated) if (!prev.some((p) => p.id === z.id)) merged.push(z);
      return merged;
    });
  }

  async function handlePlantCreate(pointM: MetrePoint) {
    const placed = clampPlacement(pointM.x, pointM.y, "horizontal", SITE_BOUNDS);
    const created = await api.createPlant(placed.x, placed.y);
    if (!created) return;
    setPlants((prev) => [...prev, created.plant]);
    mergeZones(created.zones);
    setSelectedZoneId(created.plant.exclusionZoneId);
    setTool("select");
  }
```

Replace `handleDeleteSelected` with:

```tsx
  function handleDeleteSelected() {
    if (!selectedZoneId) return;
    if (selectedPlant) {
      const plant = selectedPlant;
      setPlants((prev) => prev.filter((p) => p.id !== plant.id));
      setZones((prev) => prev.filter((z) => z.plantId !== plant.id));
      setSelectedZoneId(null);
      void api.deletePlant(plant.id);
      return;
    }
    const idToDelete = selectedZoneId;
    setZones((prev) => prev.filter((z) => z.id !== idToDelete));
    setSelectedZoneId(null);
    void api.deleteZone(idToDelete);
  }
```

In `handleClearAll`, add `setPlants([]);` after `setZones([]);`.

Add the setup-mode poses (live poses come in Task 5):

```tsx
  const plantPoses: Record<string, PlantPose> = {};
```

Pass the new props to `<SiteMap … />`:

```tsx
            plants={plants}
            plantPoses={plantPoses}
            onPlantCreate={handlePlantCreate}
```

Pass `plant={selectedPlant}` to `<ZoneProperties … />`.

- [ ] **Step 7: Styles**

Append to `frontend/src/App.css`:

```css
/* --- Mobile plant --- */
.plant {
  cursor: pointer;
}

.plant-trailer {
  fill: #facc15;
  stroke: #713f12;
  stroke-width: 1.5;
}

.plant-cab {
  fill: #f97316;
  stroke: #7c2d12;
  stroke-width: 1.5;
}

.plant-windscreen {
  fill: #0f172a;
}

.plant-label {
  font-size: 10px;
  font-weight: 700;
  fill: #1c1917;
  pointer-events: none;
}

.zone-plant {
  stroke-dasharray: 6 4;
  cursor: pointer;
}
```

- [ ] **Step 8: Typecheck and browser check**

Run: `cd frontend && npm run -s typecheck && rm -f vite.config.js vite.config.d.ts`
Expected: exits 0.

In Chrome at `http://localhost:5173`:
1. Click **🚛 Moving Plant**, click near the bottom-left corner → a truck appears fully inside the site with a dashed red box and dashed amber ring labelled `Plant N Exclusion` / `Plant N Warning`; the panel shows **MOVING PLANT**.
2. Try dragging the truck or its zones → nothing moves; no resize handles appear.
3. Place a second plant; select it; **Delete Zone** → that truck and both zones disappear; `curl -s localhost:8000/api/plants` lists only the first.
4. Reload the page → the remaining plant is still drawn (loaded from the backend).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/Plant.tsx frontend/src/components/Zone.tsx frontend/src/components/SiteMap.tsx frontend/src/components/ZoneToolbar.tsx frontend/src/components/ZoneProperties.tsx frontend/src/App.tsx frontend/src/App.css
git commit -m "Place, render, select and delete moving plants in setup mode"
```

---

### Task 5: Live movement via simulated UWB

**Files:**
- Create: `frontend/src/hooks/usePlantSimulation.ts`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `initialMotion`, `stepPlant`, `headingFor`, `PlantMotion` (Task 2); `api.postPlantPosition`, `api.resetPlant` (Task 3); `computeAnchorRanges(position, anchors, activeAnchorIds, noiseEnabled)`, `estimatePosition(anchors, ranges)` (existing); `PlantPose` (Task 4).
- Produces:
  - `usePlantSimulation(opts: { active: boolean; plants: Plant[]; onlineAnchorIds: ReadonlySet<string>; noiseEnabled: boolean; onZonesUpdated: (zones: Zone[]) => void; onPlantGone: (plantId: string) => void }): Record<string, PlantPose>`

- [ ] **Step 1: The hook**

Create `frontend/src/hooks/usePlantSimulation.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import * as api from "../services/api";
import { ANCHORS, SITE_HEIGHT_M, SITE_WIDTH_M } from "../utils/coordinateTransform";
import { computeAnchorRanges } from "../utils/ranging";
import { estimatePosition } from "../utils/positioning";
import { headingFor, initialMotion, stepPlant } from "../utils/plantMotion";
import type { PlantMotion } from "../utils/plantMotion";
import type { PlantPose } from "../components/Plant";
import type { Plant, Zone } from "../types";

const POSITION_POLL_MS = 200; // ~5/sec per plant, same cadence as the worker
const BOUNDS = { width: SITE_WIDTH_M, height: SITE_HEIGHT_M };

interface Options {
  active: boolean;
  plants: Plant[];
  onlineAnchorIds: ReadonlySet<string>;
  noiseEnabled: boolean;
  onZonesUpdated: (zones: Zone[]) => void;
  onPlantGone: (plantId: string) => void;
}

// Live-mode driver for mobile plant. Each animation frame advances every
// truck's ground-truth motion; every POSITION_POLL_MS each truck is
// "measured" by the simulated anchors exactly like the worker, and only the
// multilaterated estimate is sent to the backend, which moves the plant's
// zones. Returns the ground-truth poses for drawing the trucks.
export function usePlantSimulation({
  active,
  plants,
  onlineAnchorIds,
  noiseEnabled,
  onZonesUpdated,
  onPlantGone,
}: Options): Record<string, PlantPose> {
  const motionsRef = useRef<Record<string, PlantMotion>>({});
  const [poses, setPoses] = useState<Record<string, PlantPose>>({});

  // Latest values for the long-lived loops below, without restarting them.
  const latest = useRef({ plants, onlineAnchorIds, noiseEnabled, onZonesUpdated, onPlantGone });
  useEffect(() => {
    latest.current = { plants, onlineAnchorIds, noiseEnabled, onZonesUpdated, onPlantGone };
  });

  // Animation loop: ground-truth motion.
  useEffect(() => {
    if (!active) {
      motionsRef.current = {};
      setPoses({});
      return;
    }
    let rafId = 0;
    let last = performance.now();
    function tick(now: number) {
      const dt = Math.min((now - last) / 1000, 0.1); // clamp after a background-tab pause
      last = now;
      const motions = motionsRef.current;
      const next: Record<string, PlantPose> = {};
      for (const plant of latest.current.plants) {
        const current = motions[plant.id] ?? initialMotion(plant.homeX, plant.homeY);
        const stepped = stepPlant(current, dt, BOUNDS);
        motions[plant.id] = stepped;
        next[plant.id] = { x: stepped.x, y: stepped.y, direction: stepped.direction };
      }
      for (const id of Object.keys(motions)) {
        if (!(id in next)) delete motions[id];
      }
      setPoses(next);
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [active]);

  // Measurement loop: simulated UWB -> estimate -> backend.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const interval = setInterval(() => {
      const { plants: currentPlants, onlineAnchorIds: online, noiseEnabled: noise } = latest.current;
      for (const plant of currentPlants) {
        const motion = motionsRef.current[plant.id];
        if (!motion) continue;
        const ranges = computeAnchorRanges({ x: motion.x, y: motion.y }, ANCHORS, online, noise);
        const estimate = estimatePosition(ANCHORS, ranges);
        // Fewer than 3 anchors: no position fix, so the zones stay where
        // they were last measured (the system is already shown degraded).
        if (!estimate) continue;
        void api.postPlantPosition(plant.id, estimate.x, estimate.y, headingFor(motion.direction)).then((result) => {
          if (cancelled) return;
          if (result.kind === "ok") latest.current.onZonesUpdated(result.zones);
          else if (result.kind === "gone") latest.current.onPlantGone(plant.id);
        });
      }
    }, POSITION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active]);

  return poses;
}
```

- [ ] **Step 2: Wire into App and reset on start**

In `frontend/src/App.tsx`:

Add `import { usePlantSimulation } from "./hooks/usePlantSimulation";`.

Replace `const plantPoses: Record<string, PlantPose> = {};` with:

```tsx
  function handlePlantGone(plantId: string) {
    setPlants((prev) => prev.filter((p) => p.id !== plantId));
    setZones((prev) => prev.filter((z) => z.plantId !== plantId));
  }

  const livePlantPoses = usePlantSimulation({
    active: mode === "live",
    plants,
    onlineAnchorIds,
    noiseEnabled,
    onZonesUpdated: mergeZones,
    onPlantGone: handlePlantGone,
  });
  const plantPoses: Record<string, PlantPose> = mode === "live" ? livePlantPoses : {};
```

Add a shared reset helper above `handleStartSimulation`:

```tsx
  // Sends every plant back to where it was placed. Failures (backend
  // offline) are ignored: the plant keeps its last zones until the next
  // reset succeeds.
  async function resetPlantsHome() {
    const results = await Promise.all(plants.map((p) => api.resetPlant(p.id)));
    const ok = results.filter((r) => r !== null);
    if (ok.length === 0) return;
    const byId = new Map(ok.map((r) => [r.plant.id, r.plant]));
    setPlants((prev) => prev.map((p) => byId.get(p.id) ?? p));
    mergeZones(ok.flatMap((r) => r.zones));
  }
```

Change `handleStartSimulation` to:

```tsx
  async function handleStartSimulation() {
    setWorkerPosition(WORKER_START_POSITION);
    setOnlineAnchorIds(new Set(ALL_ANCHOR_IDS));
    await resetPlantsHome();
    setMode("live");
  }
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run -s typecheck && rm -f vite.config.js vite.config.d.ts`
Expected: exits 0.

- [ ] **Step 4: Browser check — movement**

Place two plants, press **START SIMULATION**. Expected: both trucks drive in straight lines, pause, turn 90° (cab leading), never leave the site; their dashed zones follow. With **UWB Noise** on, zones jitter a few cm around the truck.

- [ ] **Step 5: Browser check — breach caused by a plant**

Park the worker (WASD) somewhere a truck will pass and wait. Expected: status goes WARNING then BREACH as the amber then red zone reaches the worker; `/supervisor` shows a **RED ZONE ENTRY** for `Plant N Exclusion` and the alarm beeps (if enabled).

- [ ] **Step 6: Browser check — anchors and deletion**

1. Click anchors until only 2 are online. Expected: trucks keep driving on screen but their zones freeze; status shows degraded. Restore anchors → zones catch up.
2. Run `curl -s -X DELETE localhost:8000/api/zones` while live. Expected: trucks disappear within a fraction of a second; no repeating errors in the console beyond the single 404 per plant.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/usePlantSimulation.ts frontend/src/App.tsx
git commit -m "Drive moving plants in live mode via simulated UWB positioning"
```

---

### Task 6: END SIMULATION button

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/App.css`

**Interfaces:**
- Consumes: `resetPlantsHome()` (Task 5).

- [ ] **Step 1: Handler**

In `frontend/src/App.tsx`, add below `handleStartSimulation`:

```tsx
  // Back to zone setup. Events and pending alerts are kept so the
  // supervisor can still resolve them. Switches mode first so the plants
  // stop immediately, then sends them home.
  function handleEndSimulation() {
    setMode("setup");
    void resetPlantsHome();
  }
```

- [ ] **Step 2: Footer button; remove EDIT ZONES**

Delete the EDIT ZONES button from the live panel:

```tsx
              <button className="toolbar-btn" onClick={() => setMode("setup")}>
                EDIT ZONES
              </button>
```

In the footer, after the `{mode === "setup" && ( … START SIMULATION … )}` block, add:

```tsx
        {mode === "live" && (
          <button className="start-simulation-btn end-simulation-btn" onClick={handleEndSimulation}>
            END SIMULATION
          </button>
        )}
```

- [ ] **Step 3: Style**

Append to `frontend/src/App.css`:

```css
.end-simulation-btn {
  background: #dc2626;
  color: #fef2f2;
}
```

- [ ] **Step 4: Typecheck and browser check**

Run: `cd frontend && npm run -s typecheck && rm -f vite.config.js vite.config.d.ts`
Expected: exits 0.

In Chrome: START SIMULATION → footer shows red **END SIMULATION**, and the right panel has no EDIT ZONES button. Let trucks drive away, press END SIMULATION → trucks return to their placed spots, the zone toolbar is back, drawn zones can be dragged again, and `/supervisor` still lists any pending alerts.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.css
git commit -m "Add END SIMULATION footer button; plants return home"
```

---

### Task 7: README, final verification, push

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README**

1. **Demo walkthrough step 1** — append: "Or pick **🚛 Moving Plant** and click the site to place a semi-truck; its exclusion zone and warning ring are fixed to it (place as many as you like)."
2. **Demo walkthrough step 2** — append: "Any moving plant starts driving in straight lines, and its zones follow it."
3. **Demo walkthrough step 7** — replace "**EDIT ZONES** returns to setup mode (locking the worker in place)" with "**END SIMULATION** (footer) returns to setup mode and sends every moving plant back to where it was placed".
4. **Architecture** — after the existing diagram add:

````markdown
Moving plant follows the same path as the worker, with the backend owning
its zones:

```
plant motion (ground truth)                        [frontend, utils/plantMotion.ts]
      v
simulated UWB ranges -> multilateration -> estimate [frontend, hooks/usePlantSimulation.ts]
      v
POST /api/plants/{id}/position {x, y, heading}  ~5x/sec per plant
      v
backend re-derives the plant's exclusion + warning zones  [backend, plants.py]
      v
worker positions are classified against the moved zones (unchanged geofence/events)
```
````

5. **Project structure** — add `plants.py  moving plant router + zone geometry` under `backend/app/`, `tests/  pytest suite (pip install -r requirements-dev.txt)` under `backend/`, and `Plant.tsx` to the components list, `hooks/usePlantSimulation.ts`, `utils/plantMotion.ts` under `frontend/src/`.
6. **API reference** — add rows:

```markdown
| `POST /api/plants`                    | Place a moving plant at `{x, y}`; creates its exclusion + warning zones |
| `GET /api/plants`                     | List moving plants |
| `POST /api/plants/{plant_id}/position` | `{x, y, heading}` — plant's UWB-estimated position; zones are re-derived |
| `POST /api/plants/{plant_id}/reset`    | Return a plant to where it was placed |
| `DELETE /api/plants/{plant_id}`        | Remove a plant and its zones |
```

7. **Running it** — after the frontend block add:

````markdown
**Tests** (optional):

```bash
cd backend && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest -q
cd frontend && npm test
```
````

- [ ] **Step 2: Full verification**

Run:

```bash
cd backend && .venv/bin/python -m pytest -q
cd ../frontend && npm test && npm run -s typecheck && rm -f vite.config.js vite.config.d.ts
git status --short
```

Expected: `10 passed`; 6 node tests pass; typecheck exits 0; only `README.md` modified.

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "README: document moving plant, END SIMULATION, tests"
git push
```

Expected: push succeeds (`gh` credential helper is configured).

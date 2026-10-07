# Moving Plant + End Simulation — Design

Date: 2026-10-07
Status: Draft — awaiting review

## 1. Purpose

The ZoneWatch poster is about "continuous verification of exclusion zones
around **mobile plant**", and its system flow has zones that follow the
plant. The demo currently only supports static, hand-drawn zones. This
change adds moving plant (a semi-truck) whose exclusion and warning zones
travel with it, modelled the way a real UWB system would handle it: the
plant carries its own UWB tag, its position is measured by the same anchors
as the worker, and the backend re-derives the plant's zones from that
measured position and remains the sole authority on SAFE / WARNING /
BREACH.

It also adds an **END SIMULATION** button so switching between live mode
and zone editing is quick.

## 2. Agreed decisions

| Decision | Choice |
|---|---|
| Zones around a plant | Red exclusion box around the truck **and** an amber warning ring outside it, moving together (poster view A) |
| Number of plants | Several; each moves independently |
| Who moves the zones | The backend, from the plant's reported (UWB-estimated) position — approach A, closest to a real UWB system |
| Movement pattern | Straight lines up / down / left / right, random distance, short pauses, always inside the site |
| End of simulation | Plants stop and return to where they were placed |
| END SIMULATION | Footer button in the START SIMULATION position; replaces the EDIT ZONES button in the live panel |

## 3. User-visible behaviour

### Setup mode
- The zone toolbar gains a **🚛 Moving Plant** tool next to Rectangle Zone
  and Circle Zone. Clicking the site places a truck centred on the click
  (nudged inward so its body stays inside the site). Plants are named
  `Plant 1`, `Plant 2`, … in placement order.
- Each plant shows a truck graphic with its two zones drawn around it:
  `Plant N Exclusion` (red) and `Plant N Warning` (amber).
- Plant zones **cannot** be dragged, resized, renamed or retyped — their
  geometry is defined by the truck. Clicking a plant or its zones selects
  the plant; the properties panel shows its name and "Moves automatically
  during live simulation". **Delete Zone** deletes the plant and both its
  zones. **Clear Zones** clears plants too.
- A placed plant counts as an active zone, so START SIMULATION is enabled
  with only plants on the site.

### Live mode
- Every plant drives on its own: pick a direction (up/down/left/right),
  drive 1–3 m at 1.0 m/s, pause 0.5–1.5 s, repeat. Directions that would
  take the truck body outside the site are not chosen.
- Moving left/right the truck is horizontal; moving up/down it turns 90°.
  Its zones swap width and height to match, so they stay axis-aligned
  rectangles.
- If a truck drives into a stationary worker, that is a zone entry like any
  other: WARNING when the amber ring reaches the worker, BREACH (supervisor
  alert, alarm, camera popup) when the red box does.
- The footer shows a red **END SIMULATION** button where START SIMULATION
  was. It returns to setup mode, stops the plants, and moves each one back
  to where it was placed. Events and pending alerts are kept.

### Dimensions (demo scale; the site is 8 m × 6 m)

| Element | Size (horizontal heading) |
|---|---|
| Truck body | 1.6 m × 0.7 m |
| Exclusion zone | body + 0.3 m each side → 2.2 m × 1.3 m |
| Warning zone | exclusion + 0.6 m each side → 3.4 m × 2.5 m |

Vertical heading swaps width and height. These are named constants on the
backend so they can be tuned in one place.

## 4. Architecture

```
plant motion sim (true position)                 [frontend, utils/plantMotion.ts]
      v
simulated UWB ranges from the 4 anchors          [frontend, utils/ranging.ts — reused]
      v
multilateration -> estimated plant position      [frontend, utils/positioning.ts — reused]
      v
POST /api/plants/{id}/position {x, y, heading}   ~5x/sec per plant
      v
backend recomputes the plant's two zones          [backend, plants.py]
      v
worker's next position update is classified against the moved zones
(existing geofence.classify + events.record_transitions, unchanged)
```

Plant zones are ordinary rectangle zones stored in the existing zone store,
tagged with a `plant_id`. This means `geofence.py`, `events.py`, the
supervisor console and the event log need **no changes** — a plant zone
entry produces the same ENTERED/EXITED events and alerts as a drawn zone.

Plant position, like the worker's, is estimated from simulated anchor
ranges rather than read from the true position. With fewer than 3 anchors
online no estimate exists, so the frontend stops sending plant updates and
the plant's zones stay at their last known position. The system is already
shown as degraded in that state.

The truck graphic is drawn at the plant's true (simulated) position; its
zones are drawn from what the backend returns. With UWB Noise on, the zones
jitter slightly around the truck, which is accurate to how a real system
behaves.

## 5. Backend changes

### Models (`models.py`)
- `ZoneBase` gains `plant_id: Optional[str] = None`. Drawn zones leave it
  empty.
- New `Plant`: `plant_id` (`PLANT-1`, …), `name`, `x`, `y` (centre, metres),
  `heading` (`"horizontal" | "vertical"`), `home_x`, `home_y`,
  `exclusion_zone_id`, `warning_zone_id`.
- New `PlantCreate {x, y}` and `PlantPosition {x, y, heading}`.

### State (`state.py`)
- In-memory `_plants` dict plus a plant counter, with the same
  list/get/save/delete helpers as zones. `clear_zones()` also clears
  plants.

### New router (`plants.py`)

| Method & path | Purpose |
|---|---|
| `POST /api/plants` | Create a plant at `{x, y}` (horizontal); creates its two zones; returns the plant and its zones |
| `GET /api/plants` | List plants |
| `POST /api/plants/{id}/position` | Update position + heading; recompute both zones; return them |
| `POST /api/plants/{id}/reset` | Move back to `home_x/home_y`, horizontal; recompute zones; return them |
| `DELETE /api/plants/{id}` | Delete the plant and both its zones |

A single `plant_zone_rects(x, y, heading)` helper computes both rectangles
from the dimension constants; it is the only place plant geometry is
defined.

### Zone router guard (`zones.py`)
- `PUT` and `DELETE /api/zones/{id}` on a zone with a `plant_id` return
  `409 Conflict` ("Plant zones are managed through /api/plants"), so plant
  geometry can't drift from its plant.

## 6. Frontend changes

- **Types:** `Tool` gains `"plant"`; `Zone` gains optional `plantId`; new
  `Plant` type.
- **`services/api.ts`:** `getPlants`, `createPlant`, `postPlantPosition`,
  `resetPlant`, `deletePlant`, plus the `plant_id` ↔ `plantId` field
  mapping.
- **`utils/plantMotion.ts` (new):** pure step function
  `stepPlant(state, dtSeconds, random) -> state` holding position,
  direction, remaining distance and pause time. No React, so it is easy to
  reason about and test.
- **`components/Plant.tsx` (new):** SVG truck (cab + trailer) drawn at a
  position and heading.
- **`ZoneToolbar.tsx`:** adds the Moving Plant tool button.
- **`SiteMap.tsx`:** places a plant on click with the plant tool; renders
  trucks; treats plant zones as non-editable and selects the parent plant
  when one is clicked.
- **`ZoneProperties.tsx`:** read-only view for a selected plant.
- **`App.tsx`:** holds plant state; runs the motion loop and the ~5 Hz
  position post in live mode (reusing the worker's ref-based interval
  pattern); refreshes zones from plant responses; END SIMULATION handler
  (reset each plant, then switch to setup); removes the EDIT ZONES button;
  delete/clear handle plants.
- **`App.css`:** truck styling, non-editable plant zone styling, END
  SIMULATION button (red variant of the start button).

## 7. Error handling

- **Backend offline:** plant creation fails visibly (nothing is placed),
  matching drawn zones today. In live mode trucks still move on screen but
  their zones stop updating; the header already shows BACKEND: OFFLINE.
- **Plant deleted on the backend while live** (e.g. Clear Zones from another
  window): a 404 on a position post drops that plant from local state.
- **Fewer than 3 anchors:** no plant position updates (section 4).
- **END SIMULATION while the backend is offline:** the app still switches
  to setup mode; plants whose reset failed keep their last zones until the
  backend is reachable and the next START SIMULATION resets them.

## 8. Out of scope

- Turning at angles other than 90°, or curved paths.
- Trucks avoiding each other, workers or drawn zones. (They may overlap;
  each zone is still evaluated independently.)
- Steering a truck manually.
- Changes to the supervisor console. Alerts from plant zones already appear
  there with the plant zone's name.

## 9. Testing

The repo has no automated test setup, so verification is:

1. `npm run typecheck` passes.
2. Backend checks with `curl`: create a plant → two zones exist with the
   expected sizes; post a vertical heading → width and height swap; reset →
   back home; `PUT`/`DELETE` on a plant zone → 409; delete the plant → both
   zones gone.
3. In Chrome:
   - Place two plants; start the simulation; confirm both move in straight
     lines, turn 90°, stay inside the site, and their zones follow.
   - Park the worker in a truck's path; confirm WARNING then BREACH,
     and that a supervisor alert appears on `/supervisor`.
   - Press END SIMULATION; confirm plants return home and zones can be
     edited again.
   - Take anchors offline below 3; confirm plant zones freeze.

## 10. Docs

- README: Moving Plant in the walkthrough, END SIMULATION in place of EDIT
  ZONES, the new endpoints in the API reference, new files in the project
  structure, and the plant flow in the architecture section.

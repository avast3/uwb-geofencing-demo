# UWB Construction-Site Geofencing Demo — Design

Date: 2026-10-06
Status: Approved for implementation planning

## 1. Purpose

A local, interactive proof-of-concept for a university engineering design
project proposing a UWB-based construction-site geofencing safety system.
It must make this chain of reasoning visually and mechanically obvious to an
audience watching a live demo:

```
1. Supervisor draws digital geofence
2. Worker is controlled with WASD
3. Virtual UWB anchors measure worker
4. Multilateration estimates position
5. Backend compares position against the user-created geofence
6. Worker enters warning/exclusion zone
7. Warning/Breach state activates
8. Backend logs the event
```

The worker represents the physical worker. The anchors represent real UWB
infrastructure. Range measurements simulate the radio layer. Positioning and
geofence calculations must genuinely run — this is explicitly **not** sprite
collision detection.

Cameras/AI vision are out of scope for this version (future work only).

## 2. Scope boundaries

In scope: zone drawing/editing (rectangle + circle, warning + exclusion
types), 8m×6m top-down site with 4 fixed UWB anchors, WASD-controlled
worker, simulated UWB ranging with optional noise, least-squares
multilateration, FastAPI backend as the authoritative geofence judge,
state-change event logging, anchor on/off fault demo, backend
connected/offline status reporting.

Out of scope (per project spec): AI cameras, facial recognition, worker
identity systems, cloud hosting, authentication, mobile app, machine
learning, 3D site, real UWB hardware, productivity monitoring, Docker.

## 3. Architecture & data flow

Two local processes, no cloud/Docker/auth:

- **Backend** — FastAPI (Python 3.13), `localhost:8000`. Holds authoritative
  state: zones, current tag state, event log. Runs the actual geofence
  math (point-in-rectangle / point-in-circle). The frontend never decides
  SAFE/WARNING/BREACH itself — it only renders what the backend returns.
- **Frontend** — React + Vite + TypeScript, `localhost:5173`. Owns the
  canvas (drawing, worker/anchor/zone rendering) and the simulated physical
  layer (ranging + multilateration). Talks to the backend via `fetch`.

Concrete data flow:

```
WASD key state → true (x, y) in frontend
      ↓
ranging.ts: distance to each ON anchor + optional ±0.05 m noise
      ↓
positioning.ts: least-squares multilateration → estimated (x, y)
      ↓
POST /api/position {tag_id, x, y, anchors_active}   (~10x/sec while live)
      ↓
backend geofence.py: estimated (x, y) vs each active zone → SAFE/WARNING/BREACH
      ↓
response {state, zone_id, anchors_online, degraded} → frontend updates LED/status
      ↓
backend (on state transition only): append event
      ↓
GET /api/events polled by EventLog component
```

Zones are created/edited in the frontend drawing UI, then immediately sent
to the backend via `POST`/`PUT`/`DELETE /api/zones`. The backend's
in-memory zone store is the single source of truth checked by
`/api/position`.

## 4. Backend API surface

```
POST   /api/zones                create a zone → returns zone with assigned zone_id
GET    /api/zones                list all zones
PUT    /api/zones/{zone_id}      update (move/resize/rename/retype/activate)
DELETE /api/zones/{zone_id}      delete one
DELETE /api/zones                clear all

POST   /api/anchors/{id}/toggle  body {active: bool} — flip A1-A4 on/off

POST   /api/position             {tag_id, x, y, anchors_active: ["A1","A2","A3","A4"]}
                                  → {tag_id, state, zone_id, anchors_online, degraded}

GET    /api/events               list logged transitions
DELETE /api/events                clear log

GET    /api/status               {backend, anchors_online, last_update, last_message}
```

Notes:

- `anchors_active` rides on every `/api/position` call so the backend can
  report `anchors_online` and compute `degraded` (true when fewer than 3
  anchors are active — 2D multilateration requires ≥3). This avoids a
  separate persisted anchor model.
- `degraded = true` ⇒ frontend shows **POSITION UNAVAILABLE / SYSTEM
  DEGRADED**, never SAFE. Fail visible, not fail silent.
- All state lives in a plain in-memory store in `state.py` — wiped on
  backend restart (confirmed acceptable; this is a short live demo, not a
  production system, and a fresh zone-drawing pass takes seconds).
- CORS restricted to `http://localhost:5173`.

## 5. Zone geometry & types

Rectangle: `{x_min, x_max, y_min, y_max}`. Inside test:
`x_min ≤ x ≤ x_max AND y_min ≤ y ≤ y_max`.

Circle: `{centre_x, centre_y, radius}`. Inside test:
`sqrt((x-centre_x)^2 + (y-centre_y)^2) ≤ radius`.

Every zone also has `zone_id`, `name`, `type` (`warning` | `exclusion`),
`shape` (`rectangle` | `circle`), `active: bool`.

Classification priority when a position overlaps multiple zones:
**exclusion (BREACH) beats warning (WARNING)**, regardless of draw order or
nesting. A single active exclusion zone is sufficient to run the full demo;
concentric warning+exclusion pairs are not required by the system, only
suggested as a demo pattern.

## 6. Multilateration method

4 fixed, non-collinear anchors (A1=(0,0), A2=(8,0), A3=(0,6), A4=(8,6)).
Method: **linear least-squares trilateration** — subtract the squared-range
equation for one reference anchor from the others to cancel the quadratic
(x²+y²) terms, leaving a linear system `A·[x,y]ᵗ = b`, solved via closed-form
2×2 normal equations (no numpy/extra dependency needed). With exactly 3
active anchors the system is exactly determined; with 4 it's an honest
least-squares fit, giving modestly better noise rejection. Below 3 active
anchors, 2D positioning is mathematically impossible — this is exactly the
`degraded` branch in §4.

Implemented in `frontend/src/utils/positioning.ts`, readable and commented
to explain *why* (reference-anchor elimination), not just *what* the code
does, since the project explicitly needs this to be mathematically
explainable to reviewers.

## 7. Anchors

Fixed at the four corners for this version — **not** user-repositionable.
Rationale: draggable anchors risk near-collinear/degenerate geometry that
would make multilateration numerically unstable mid-presentation; the
required fault-tolerance behaviour (anchor dropout → degraded positioning)
is already fully covered by the ON/OFF toggle per anchor. Anchor
repositioning is noted as a future-work extension alongside optional CCTV
integration, not built in V1.

```
A1 = (0, 0)  — Gateway   A2 = (8, 0)
A3 = (0, 6)              A4 = (8, 6)
```

## 8. Frontend component breakdown

- `SiteMap.tsx` — 8×6 m canvas: grid, metre ticks, composes
  Anchor/Zone/Worker, owns mouse-event routing for drawing.
- `ZoneToolbar.tsx` — Select / Rectangle / Circle / Delete / Clear buttons +
  live dimension readout while dragging (e.g. "Radius: 1.32 m").
- `Zone.tsx` — renders one zone (rect or circle) + selection/edit handles; a
  co-located `useZoneDrag` hook handles move/resize math.
- `ZoneProperties.tsx` — name / type / shape / active editor for the
  selected zone.
- `Worker.tsx` — hard-hat worker glyph (inline SVG, no image asset) at
  ground-truth position, plus an optional debug cross at the estimated UWB
  position ("Show UWB Estimate").
- `Anchor.tsx` — anchor glyph with online/offline styling + label (A1
  additionally labelled "Gateway").
- `Controls.tsx` — WASD/arrow key listener → velocity vector; UWB Noise
  ON/OFF; per-anchor ON/OFF; Start Simulation / Edit Zones mode switch.
- `StatusPanel.tsx` — TAG status (state/LED, estimated X/Y, optional
  position-error readout) + system status (backend/anchors/gateway), from
  polling `/api/status`.
- `EventLog.tsx` — polls `/api/events`, renders timestamped
  ENTERED/EXITED lines.

Support modules:

- `utils/ranging.ts` — distance-to-anchor + optional ±0.05 m noise.
- `utils/positioning.ts` — multilateration (§6).
- `utils/coordinateTransform.ts` — metres ↔ SVG pixel conversion.
- `services/api.ts` — thin fetch wrapper, catches network errors for the
  offline-backend case.
- `types/index.ts` — shared Zone/Position/State types.

`App.tsx` only holds the ZONE SETUP vs LIVE SIMULATION mode switch and
composes the components above — no business logic lives in it.

## 9. Backend module breakdown

- `state.py` — in-memory store: `zones: dict[str, Zone]`,
  `events: list[Event]`, `last_tag_state: dict[str, TagState]`,
  `anchor_status`. Single module, one obvious source of truth.
- `models.py` — Pydantic models: `ZoneCreate`/`Zone` (discriminated by
  `shape`), `PositionUpdate`, `PositionResult`, `Event`, `StatusResponse`.
- `geofence.py` — pure functions, no FastAPI imports, unit-testable in
  isolation: `point_in_rectangle`, `point_in_circle`,
  `classify(x, y, zones) -> (state, zone_id)` applying the
  exclusion-beats-warning rule.
- `zones.py` — `/api/zones*` router; validates shape-specific fields,
  assigns human-readable `zone_id`s (`ZONE-A`, `ZONE-B`, ...), delegates to
  `state.py`.
- `events.py` — `/api/events*` router + transition-detection helper that
  diffs the new `classify()` result against `last_tag_state` and appends an
  event only on change, wording ENTERED/EXITED per zone type.
- `main.py` — FastAPI app, CORS, mounts routers; defines `/api/position`
  (geofence.classify → events.record_transition → update
  state.last_tag_state) and `/api/status`.

## 10. Error handling & degraded states

- **Backend unreachable** — `services/api.ts` catches the fetch failure;
  `StatusPanel` shows **BACKEND OFFLINE**. Frontend keeps rendering/moving
  the worker locally without crashing; tag status shows a neutral
  "no data" state rather than falsely showing SAFE.
- **< 3 active anchors** — backend sees `anchors_active.length < 3` and
  returns `degraded: true, state: null`. Frontend renders **POSITION
  UNAVAILABLE / SYSTEM DEGRADED** instead of any color-coded safety state.
- **Invalid zone geometry** (e.g. `x_min > x_max`, negative radius) —
  rejected by Pydantic (422). Frontend leaves the in-progress zone selected
  and editable rather than popping an error dialog, since intrusive alerts
  mid-presentation are worse than a silent no-op.

## 11. Safety states & visuals

| State | Trigger | Colour |
|---|---|---|
| SAFE | estimate inside no zone | green |
| WARNING | estimate inside a warning zone | amber |
| BREACH | estimate inside an exclusion zone (overrides WARNING) | red |
| SYSTEM DEGRADED | < 3 active anchors | amber/grey |
| OFFLINE | backend unreachable | grey/red |

Simulated wearable indicator mirrors this (LED OFF / LED AMBER / LED RED)
as a stand-in for a real device's LED/vibration/audible warning.

## 12. Disclaimer

Displayed unobtrusively in the UI:

> This system supplements physical exclusion controls, spotters, SWMS and
> site supervision. It does not replace them.

## 13. Build order (for the implementation plan)

Matches the project spec's staged build order: (1) site + geofence editor
only, no worker yet; (2) FastAPI stood up, zones round-trip to backend;
(3) WASD worker; (4) simulated ranging; (5) multilateration; (6) backend
geofence logic wired to `/api/position`; (7) event system with
transition-only logging; (8) wearable LED/status visuals; (9) anchor
on/off + noise toggle + degraded-state fault demo; (10) UI/README polish.
Each stage is run and manually verified before moving to the next.

## 14. Explicit decisions made during design review

- UWB noise defaults **OFF** at app load (matches demo Step 9, which
  frames enabling noise as a deliberate, later step).
- Zones/events are **in-memory only**, reset on backend restart.
- Anchors are **fixed** at the four corners, not user-repositionable, in
  this version.

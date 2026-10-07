# UWB Construction-Site Geofencing Demo

A local, interactive proof-of-concept for a university engineering design
project proposing a UWB-based construction-site geofencing safety system.

A supervisor draws hazard zones on a digital site map. A worker, driven
around the site with WASD, is "measured" by four simulated UWB anchors.
Those simulated ranges are reconstructed into an estimated position via
multilateration — not read off the worker's true position — and that
estimate is sent to a FastAPI backend, which is the sole authority on
whether the worker is SAFE, in a WARNING zone, or in BREACH of an
exclusion zone. Zone entries/exits are logged as events, and anchors can
be switched offline to demonstrate graceful degradation.

### What's simulated and what's representative

Only the hardware layer is simulated: there are no UWB radios or wearable
tags, so anchor ranges are generated in the browser from the worker's
position. Everything downstream of those ranges — multilateration, the
SAFE/WARNING/BREACH geofence logic, and the event logging and supervisor
alert flow — reflects how a deployed system would behave. The backend's
infrastructure is deliberately simplified for the demo: data is held in
memory rather than a database, a single tag (TAG-001) is tracked, and there
is no authentication.

> This system supplements physical exclusion controls, spotters, SWMS and
> site supervision. It does not replace them.

## Running it

Two local processes, no internet access, no cloud services, no Docker.

**Backend** (Python 3.10+):

```bash
cd backend
python3 -m venv .venv          # first time only
.venv/bin/pip install -r requirements.txt   # first time only
.venv/bin/uvicorn app.main:app --reload --port 8000
```

**Frontend** (Node 18+):

```bash
cd frontend
npm install     # first time only
npm run dev
```

Then open:

- Frontend: <http://localhost:5173>
- Backend API docs (Swagger UI): <http://localhost:8000/docs>

The header's **BACKEND: CONNECTED/OFFLINE** badge confirms the two sides
can see each other. If it says OFFLINE, check the backend terminal for
errors — the frontend keeps running either way, it just can't get a
geofence verdict.

## Demo walkthrough

1. **Draw a hazard zone.** Pick **Rectangle Zone** or **Circle Zone** and
   click-drag on the site. The zone auto-selects; rename it, set its
   **Type** (Warning/Exclusion), and confirm **Active** is checked. One
   active exclusion zone is enough to proceed. A warning zone drawn
   around (or overlapping) an exclusion zone demonstrates the priority
   rule below.
2. **Press START SIMULATION.** The toolbar collapses, zone geometry
   locks, and TAG-001 (a little hard-hat worker) appears at the site
   centre.
3. **Drive the worker** with **WASD** or the arrow keys. Watch the
   **TAG-001 STATUS** panel: the LED is off/grey while SAFE, glows amber
   in a Warning zone, glows red in an Exclusion zone. If a zone overlaps
   both types, **Exclusion (BREACH) always wins**.
4. **Open the supervisor console.** Click the **SUPERVISOR: N PENDING ↗**
   badge in the header (or go to <http://localhost:5173/supervisor>) and
   put that window beside the map. Click **ENABLE ALARM SOUND** once —
   browsers block audio until the page is clicked. Every exclusion-zone
   entry now shows up as a **SUPERVISOR ALERT** and the console repeats a
   *beep~ beep~* alarm until each alert is **Acknowledged** or
   **Escalated** (use **ALARM ON/MUTED** to silence it). Either button
   first opens an **AI CAMERA** popup — a placeholder for the site's
   existing CCTV, which in the proposed system would let the supervisor
   visually verify the scene before deciding — and the action is only
   recorded on **Confirm** (**Cancel** leaves it pending). The **EVENT LOG**
   below picks up `ENTERED`/`EXITED` lines as you cross zone boundaries —
   one line per actual crossing, not one per frame.
5. **Toggle UWB Noise** (in the diagnostics panel) to see the cyan
   "estimated position" cross (enable **Show UWB Estimate** first) wobble
   a few centimetres around the worker instead of overlapping it exactly.
6. **Click an anchor** (A1–A4) on the map to take it offline. Watch
   **SYSTEM STATUS**: Anchors drops below 4/4, and once fewer than 3
   remain online, the status panel shows **SYSTEM DEGRADED** / **POSITION
   UNAVAILABLE** — never a false SAFE. Click the anchor again to restore
   it.
7. **EDIT ZONES** returns to setup mode (locking the worker in place);
   **START SIMULATION** again resets the worker position and brings all
   anchors back online.

## Architecture

```
WASD keypress
      v
true (ground-truth) worker position          [frontend, Controls.tsx]
      v
simulated per-anchor UWB range + optional noise   [frontend, utils/ranging.ts]
      v
multilateration -> estimated position             [frontend, utils/positioning.ts]
      v
POST /api/position {tag_id, x, y, anchors_active}  ~5x/sec
      v
backend: estimated position vs. user-drawn zones   [backend, geofence.py]
      v
SAFE / WARNING / BREACH  (or degraded if <3 anchors online)
      v
backend logs ENTERED/EXITED on zone-membership change   [backend, events.py]
      v
frontend renders: LED status, event log, system status
```

The frontend never computes SAFE/WARNING/BREACH itself — only renders
what the backend returns. The backend never sees the ground-truth
position, only the frontend's UWB estimate, matching how the real system
would actually work.

## Project structure

```
backend/
  app/
    main.py       FastAPI app, CORS, /api/health, /api/position
    models.py     Pydantic models (zones, position, events)
    state.py      in-memory store (zones, events, per-tag zone membership)
    zones.py      /api/zones CRUD router
    geofence.py   point-in-rectangle/circle, classify(), contained_zone_ids()
    events.py     /api/events router + ENTERED/EXITED transition detection
  requirements.txt

frontend/
  src/
    components/   SiteMap, Zone, Anchor, Worker, Controls, ZoneToolbar,
                   ZoneProperties, StatusPanel, SystemStatus, EventLog,
                   AlertQueue, CameraModal
    utils/        coordinateTransform.ts, ranging.ts, positioning.ts
    services/
      api.ts      all fetch calls + backend<->frontend field conversion
    types/
      index.ts    shared domain types
    utils/alarm.ts  useAlarm(): repeating Web Audio beep for the console
    App.tsx       site map page: top-level state and layout
    SupervisorPage.tsx  /supervisor console: alerts, event log, alarm
    main.tsx      picks the page from the URL path
  package.json

docs/superpowers/specs/   design spec this project was built from
```

## API reference

| Method & path                | Purpose |
|---|---|
| `GET /api/health`             | `{"status": "ok"}` — used for the CONNECTED/OFFLINE badge |
| `POST /api/zones`             | Create a zone (rectangle or circle); returns it with an assigned `zone_id` |
| `GET /api/zones`               | List all zones |
| `PUT /api/zones/{zone_id}`     | Replace a zone's geometry/name/type/active state |
| `DELETE /api/zones/{zone_id}`  | Delete one zone |
| `DELETE /api/zones`            | Clear all zones |
| `POST /api/position`           | `{tag_id, x, y, anchors_active}` -> `{state, zone_id, anchors_online, degraded}` |
| `GET /api/events`              | List logged ENTERED/EXITED transitions |
| `DELETE /api/events`           | Clear the event log |

Full interactive docs (including request/response schemas) are always at
`http://localhost:8000/docs` while the backend is running.

## Notes on persistence

Everything lives in memory in the backend process — zones and events are
lost on restart. This is an accepted trade-off for a short local demo, not
an oversight; redrawing a couple of zones takes seconds.

## Out of scope (by design)

A live camera feed or AI video analysis, facial recognition, worker
identity systems, cloud hosting, authentication, a mobile app, machine
learning, a full 3D site, real UWB hardware, productivity monitoring.

Integration with the site's existing CCTV is part of the proposed system:
supervisors would check the relevant camera before acknowledging or
escalating an alert. The demo represents this step with the camera popup,
a labelled placeholder with no video or AI behind it.

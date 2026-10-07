import { useEffect, useRef, useState } from "react";
import SiteMap from "./components/SiteMap";
import ZoneToolbar from "./components/ZoneToolbar";
import ZoneProperties from "./components/ZoneProperties";
import Controls from "./components/Controls";
import StatusPanel from "./components/StatusPanel";
import SystemStatus from "./components/SystemStatus";
import * as api from "./services/api";
import { ANCHORS, SITE_HEIGHT_M, SITE_WIDTH_M, clampToSite } from "./utils/coordinateTransform";
import type { MetrePoint } from "./utils/coordinateTransform";
import { clampPlacement } from "./utils/plantMotion";
import type { PlantPose } from "./components/Plant";
import { computeAnchorRanges } from "./utils/ranging";
import { estimatePosition } from "./utils/positioning";
import type { AppMode, LogEvent, Plant, PositionResult, Tool, Zone, ZoneDraft, ZonePatch } from "./types";
import "./App.css";

const TAG_ID = "TAG-001";
const HEALTH_POLL_MS = 4000;
const POSITION_POLL_MS = 200; // ~5/sec, well within the spec's "~10x/sec" guidance
const EVENTS_POLL_MS = 1000;
const WORKER_SPEED_MPS = 2.5;
const WORKER_START_POSITION: MetrePoint = { x: SITE_WIDTH_M / 2, y: SITE_HEIGHT_M / 2 };
const ALL_ANCHOR_IDS = new Set(ANCHORS.map((a) => a.id));
const SITE_BOUNDS = { width: SITE_WIDTH_M, height: SITE_HEIGHT_M };

// Converts a running counter into A, B, C, ... Z, AA, AB, ... used for the
// default human-readable zone name (the zone's actual id is assigned by
// the backend, independently of this).
function letterFromIndex(n: number): string {
  let s = "";
  let num = n;
  do {
    s = String.fromCharCode(65 + (num % 26)) + s;
    num = Math.floor(num / 26) - 1;
  } while (num >= 0);
  return s;
}

function formatClockTime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function App() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [mode, setMode] = useState<AppMode>("setup");
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null); // null = checking
  const [workerPosition, setWorkerPosition] = useState<MetrePoint>(WORKER_START_POSITION);
  const [noiseEnabled, setNoiseEnabled] = useState(false); // OFF by default, see design spec
  const [showEstimate, setShowEstimate] = useState(false);
  const [geofenceResult, setGeofenceResult] = useState<PositionResult | null>(null);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [onlineAnchorIds, setOnlineAnchorIds] = useState<Set<string>>(() => new Set(ALL_ANCHOR_IDS));
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [, setRangeSampleTick] = useState(0); // write-only: just forces periodic re-renders below
  const zoneCounterRef = useRef(0);

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const selectedPlant = selectedZone?.plantId ? plants.find((p) => p.id === selectedZone.plantId) ?? null : null;
  const hasActiveZone = zones.some((z) => z.active);
  // Not memoized, so this recomputes on every render — including every
  // movement frame and every rangeSampleTick below. A real UWB radio
  // keeps re-measuring even while the tag is stationary, so the
  // simulated ranges should too.
  const anchorRanges =
    mode === "live" ? computeAnchorRanges(workerPosition, ANCHORS, onlineAnchorIds, noiseEnabled) : [];
  // Reconstructed from anchorRanges only — never from workerPosition
  // directly. This is the estimate a real geofence check would compare
  // against zones, not the ground truth.
  const estimatedPosition = mode === "live" ? estimatePosition(ANCHORS, anchorRanges) : null;
  const positionErrorM = estimatedPosition
    ? Math.hypot(workerPosition.x - estimatedPosition.x, workerPosition.y - estimatedPosition.y)
    : null;

  useEffect(() => {
    if (mode !== "live") return;
    const interval = setInterval(() => setRangeSampleTick((t) => t + 1), 250);
    return () => clearInterval(interval);
  }, [mode]);

  // Posts the estimated position to the backend's authoritative geofence
  // check. Reads the latest estimate/online-anchor-set via refs (updated
  // every render, see below) rather than depending on them directly, so
  // this interval's identity — and therefore its cadence — doesn't reset
  // every time either changes, which during movement/toggling can be
  // every frame.
  const estimatedPositionRef = useRef(estimatedPosition);
  const onlineAnchorIdsRef = useRef(onlineAnchorIds);
  useEffect(() => {
    estimatedPositionRef.current = estimatedPosition;
    onlineAnchorIdsRef.current = onlineAnchorIds;
  });

  useEffect(() => {
    if (mode !== "live") {
      setGeofenceResult(null);
      return;
    }
    let cancelled = false;
    const interval = setInterval(async () => {
      const pos = estimatedPositionRef.current;
      const activeIds = Array.from(onlineAnchorIdsRef.current);
      if (!pos) {
        // Fewer than 3 online anchors: no estimate was even computable.
        // Fail visible, not fail silent — show degraded immediately
        // rather than leaving the last known SAFE/WARNING/BREACH on
        // screen, and don't bother the backend with a meaningless x/y.
        if (!cancelled) {
          setGeofenceResult({
            tagId: TAG_ID,
            state: null,
            zoneId: null,
            anchorsOnline: activeIds.length,
            degraded: true,
          });
        }
        return;
      }
      const result = await api.postPosition(TAG_ID, pos.x, pos.y, activeIds);
      if (cancelled) return;
      setGeofenceResult(result);
      if (result) setLastUpdate(formatClockTime(new Date()));
    }, POSITION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mode]);

  // Event log: polled independently of the position loop above since it
  // only changes episodically (on an actual zone entry/exit), not every
  // position sample. Polled in both modes so the header's pending-alert
  // badge stays accurate even while the supervisor resolves alerts from
  // the /supervisor page during zone setup.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const latest = await api.getEvents();
      if (!cancelled) setEvents(latest);
    };
    void poll();
    const interval = setInterval(poll, EVENTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Initial load from the backend (the authoritative zone store) and a
  // periodic health poll driving the BACKEND: CONNECTED/OFFLINE indicator.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const online = await api.checkHealth();
      if (cancelled) return;
      setBackendOnline(online);
      if (online) {
        const loaded = await api.getZones();
        if (!cancelled) setZones(loaded);
        const loadedPlants = await api.getPlants();
        if (!cancelled) setPlants(loadedPlants);
      }
    })();

    const interval = setInterval(async () => {
      const online = await api.checkHealth();
      if (!cancelled) setBackendOnline(online);
    }, HEALTH_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleZoneCreate(draft: ZoneDraft) {
    const letter = letterFromIndex(zoneCounterRef.current);
    zoneCounterRef.current += 1;
    const name = `${draft.type === "exclusion" ? "Exclusion" : "Warning"} Zone ${letter}`;
    const created = await api.createZone({ ...draft, name });
    if (!created) return; // backend unreachable/rejected it: nothing to render
    setZones((prev) => [...prev, created]);
    setSelectedZoneId(created.id);
    setTool("select");
  }

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

  function handleZoneUpdate(id: string, patch: ZonePatch) {
    const existing = zones.find((z) => z.id === id);
    if (!existing) return;
    const updated = { ...existing, ...patch } as Zone;
    setZones((prev) => prev.map((z) => (z.id === id ? updated : z)));
    void api.updateZone(updated);
  }

  function patchSelected(patch: ZonePatch) {
    if (selectedZoneId) handleZoneUpdate(selectedZoneId, patch);
  }

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

  function handleClearAll() {
    setZones([]);
    setPlants([]);
    setSelectedZoneId(null);
    void api.clearZones();
  }

  // Applied every animation frame while a movement key is held. Reads the
  // previous position from React's functional update, never from a
  // closure, so rapid key-driven updates can't go stale or drop frames.
  function handleWorkerMove(dxM: number, dyM: number) {
    setWorkerPosition((prev) => clampToSite({ x: prev.x + dxM, y: prev.y + dyM }));
  }

  function handleStartSimulation() {
    setWorkerPosition(WORKER_START_POSITION);
    setOnlineAnchorIds(new Set(ALL_ANCHOR_IDS));
    setMode("live");
  }

  function handleAnchorToggle(anchorId: string) {
    setOnlineAnchorIds((prev) => {
      const next = new Set(prev);
      if (next.has(anchorId)) next.delete(anchorId);
      else next.add(anchorId);
      return next;
    });
  }

  const plantPoses: Record<string, PlantPose> = {};

  const lastMessage = events.length > 0 ? events[events.length - 1].message : null;
  const pendingAlerts = events.filter((e) => e.requiresAck && e.ackStatus === "PENDING");

  const backendLabel =
    backendOnline === null ? "BACKEND: CHECKING..." : backendOnline ? "BACKEND: CONNECTED" : "BACKEND: OFFLINE";
  const backendClass =
    backendOnline === null ? "backend-badge checking" : backendOnline ? "backend-badge online" : "backend-badge offline";

  return (
    <div className="app">
      <header className="app-header">
        <h1>UWB CONSTRUCTION SAFETY DEMO</h1>
        <div className="header-badges">
          <a
            className={`supervisor-badge${pendingAlerts.length > 0 ? " pending" : ""}`}
            href="/supervisor"
            target="_blank"
            rel="noopener"
            title="Open the supervisor console (alerts + event log) in a new window"
          >
            SUPERVISOR: {pendingAlerts.length} PENDING ↗
          </a>
          <span className={backendClass}>{backendLabel}</span>
          <span className="mode-badge">
            {mode === "setup" ? "ZONE SETUP MODE" : "LIVE SIMULATION MODE"}
          </span>
        </div>
      </header>

      {mode === "setup" && (
        <ZoneToolbar
          tool={tool}
          onToolChange={setTool}
          hasSelection={selectedZoneId !== null}
          hasZones={zones.length > 0}
          onDeleteSelected={handleDeleteSelected}
          onClearAll={handleClearAll}
        />
      )}

      <div className="main-area">
        <div className="map-area">
          <SiteMap
            zones={zones}
            selectedZoneId={selectedZoneId}
            tool={mode === "live" ? "select" : tool}
            locked={mode === "live"}
            workerPosition={mode === "live" ? workerPosition : null}
            estimatedPosition={estimatedPosition}
            showEstimate={showEstimate}
            onlineAnchorIds={onlineAnchorIds}
            onAnchorToggle={mode === "live" ? handleAnchorToggle : undefined}
            onZoneCreate={handleZoneCreate}
            onZoneUpdate={handleZoneUpdate}
            onZoneSelect={setSelectedZoneId}
            plants={plants}
            plantPoses={plantPoses}
            onPlantCreate={handlePlantCreate}
          />
          <Controls active={mode === "live"} speed={WORKER_SPEED_MPS} onMove={handleWorkerMove} />
        </div>

        {mode === "setup" ? (
          <ZoneProperties
            zone={selectedZone}
            plant={selectedPlant}
            onRename={(name) => patchSelected({ name })}
            onChangeType={(type) => patchSelected({ type })}
            onToggleActive={(active) => patchSelected({ active })}
          />
        ) : (
          <div className="right-column">
            <StatusPanel
              tagId={TAG_ID}
              state={geofenceResult?.state ?? null}
              zoneId={geofenceResult?.zoneId ?? null}
              degraded={geofenceResult?.degraded ?? false}
            />

            <SystemStatus
              backendOnline={backendOnline}
              anchorsOnlineCount={onlineAnchorIds.size}
              totalAnchors={ANCHORS.length}
              gatewayOnline={onlineAnchorIds.has("A1")}
              lastUpdate={lastUpdate}
              lastMessage={lastMessage}
            />

            <div className="properties-panel">
              <h3>LIVE SIMULATION MODE</h3>
              <p className="properties-empty">
                This mode locks the zone geometry, lets you drive TAG-001
                around the site, and sends the UWB-estimated position to
                the backend for the authoritative SAFE/WARNING/BREACH
                check. Alerts and the event log are on the
                supervisor console (header link).
              </p>
              <div className="properties-row">
                <span>Ground truth</span>
                <span className="properties-value">
                  X {workerPosition.x.toFixed(2)} m, Y {workerPosition.y.toFixed(2)} m
                </span>
              </div>
              <div className="properties-row">
                <span>Estimated (UWB)</span>
                <span className="properties-value">
                  {estimatedPosition
                    ? `X ${estimatedPosition.x.toFixed(2)} m, Y ${estimatedPosition.y.toFixed(2)} m`
                    : "POSITION UNAVAILABLE"}
                </span>
              </div>
              {positionErrorM !== null && (
                <div className="properties-row">
                  <span>Position error</span>
                  <span className="properties-value">{(positionErrorM * 100).toFixed(1)} cm</span>
                </div>
              )}

              <label className="properties-row">
                <span>UWB Noise</span>
                <input
                  type="checkbox"
                  checked={noiseEnabled}
                  onChange={(e) => setNoiseEnabled(e.target.checked)}
                />
              </label>
              <label className="properties-row">
                <span>Show UWB Estimate</span>
                <input
                  type="checkbox"
                  checked={showEstimate}
                  onChange={(e) => setShowEstimate(e.target.checked)}
                />
              </label>

              <h3 className="ranges-heading">UWB RANGES (sim.)</h3>
              {anchorRanges.map((r) => (
                <div className="properties-row" key={r.anchorId}>
                  <span>{r.anchorId}</span>
                  <span className="properties-value">{r.distance.toFixed(2)} m</span>
                </div>
              ))}

              <button className="toolbar-btn" onClick={() => setMode("setup")}>
                EDIT ZONES
              </button>
            </div>
          </div>
        )}
      </div>

      <footer className="app-footer">
        <div className="disclaimer">
          This system supplements physical exclusion controls, spotters, SWMS
          and site supervision. It does not replace them.
        </div>
        {mode === "setup" && (
          <button
            className="start-simulation-btn"
            disabled={!hasActiveZone}
            onClick={handleStartSimulation}
            title={hasActiveZone ? "" : "Create at least one active zone first"}
          >
            START SIMULATION
          </button>
        )}
      </footer>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import SiteMap from "./components/SiteMap";
import ZoneToolbar from "./components/ZoneToolbar";
import ZoneProperties from "./components/ZoneProperties";
import Controls from "./components/Controls";
import * as api from "./services/api";
import { ANCHORS, SITE_HEIGHT_M, SITE_WIDTH_M, clampToSite } from "./utils/coordinateTransform";
import type { MetrePoint } from "./utils/coordinateTransform";
import { computeAnchorRanges } from "./utils/ranging";
import { estimatePosition } from "./utils/positioning";
import type { AppMode, Tool, Zone, ZoneDraft, ZonePatch } from "./types";
import "./App.css";

const HEALTH_POLL_MS = 4000;
const WORKER_SPEED_MPS = 2.5;
const WORKER_START_POSITION: MetrePoint = { x: SITE_WIDTH_M / 2, y: SITE_HEIGHT_M / 2 };
// Anchor on/off toggling is a later stage; for now every anchor is always
// active, but ranging.ts already takes an explicit active set so that
// stage only has to add the toggle UI, not change this call.
const ALL_ANCHOR_IDS = new Set(ANCHORS.map((a) => a.id));

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

export default function App() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [mode, setMode] = useState<AppMode>("setup");
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null); // null = checking
  const [workerPosition, setWorkerPosition] = useState<MetrePoint>(WORKER_START_POSITION);
  const [noiseEnabled, setNoiseEnabled] = useState(false); // OFF by default, see design spec
  const [showEstimate, setShowEstimate] = useState(false);
  const [, setRangeSampleTick] = useState(0); // write-only: just forces periodic re-renders below
  const zoneCounterRef = useRef(0);

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const hasActiveZone = zones.some((z) => z.active);
  // Not memoized, so this recomputes on every render — including every
  // movement frame and every rangeSampleTick below. A real UWB radio
  // keeps re-measuring even while the tag is stationary, so the
  // simulated ranges should too.
  const anchorRanges =
    mode === "live" ? computeAnchorRanges(workerPosition, ANCHORS, ALL_ANCHOR_IDS, noiseEnabled) : [];
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
    const idToDelete = selectedZoneId;
    setZones((prev) => prev.filter((z) => z.id !== idToDelete));
    setSelectedZoneId(null);
    void api.deleteZone(idToDelete);
  }

  function handleClearAll() {
    setZones([]);
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
    setMode("live");
  }

  const backendLabel =
    backendOnline === null ? "BACKEND: CHECKING..." : backendOnline ? "BACKEND: CONNECTED" : "BACKEND: OFFLINE";
  const backendClass =
    backendOnline === null ? "backend-badge checking" : backendOnline ? "backend-badge online" : "backend-badge offline";

  return (
    <div className="app">
      <header className="app-header">
        <h1>UWB CONSTRUCTION SAFETY DEMO</h1>
        <div className="header-badges">
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
            onZoneCreate={handleZoneCreate}
            onZoneUpdate={handleZoneUpdate}
            onZoneSelect={setSelectedZoneId}
          />
          <Controls active={mode === "live"} speed={WORKER_SPEED_MPS} onMove={handleWorkerMove} />
        </div>

        {mode === "setup" ? (
          <ZoneProperties
            zone={selectedZone}
            onRename={(name) => patchSelected({ name })}
            onChangeType={(type) => patchSelected({ type })}
            onToggleActive={(active) => patchSelected({ active })}
          />
        ) : (
          <div className="properties-panel">
            <h3>LIVE SIMULATION MODE</h3>
            <p className="properties-empty">
              Live SAFE/WARNING/BREACH status is added in a later build
              stage. For now this mode locks the zone geometry, lets you
              drive TAG-001 around the site, and reconstructs an estimated
              position from simulated UWB ranges via multilateration.
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

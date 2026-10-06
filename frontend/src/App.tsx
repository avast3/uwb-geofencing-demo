import { useEffect, useRef, useState } from "react";
import SiteMap from "./components/SiteMap";
import ZoneToolbar from "./components/ZoneToolbar";
import ZoneProperties from "./components/ZoneProperties";
import * as api from "./services/api";
import type { AppMode, Tool, Zone, ZoneDraft, ZonePatch } from "./types";
import "./App.css";

const HEALTH_POLL_MS = 4000;

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
  const zoneCounterRef = useRef(0);

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const hasActiveZone = zones.some((z) => z.active);

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
            onZoneCreate={handleZoneCreate}
            onZoneUpdate={handleZoneUpdate}
            onZoneSelect={setSelectedZoneId}
          />
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
              Worker control, UWB ranging and live SAFE/WARNING/BREACH status
              are added in later build stages. For now this mode only proves
              the zone geometry is locked in before "live" operation begins.
            </p>
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
            onClick={() => setMode("live")}
            title={hasActiveZone ? "" : "Create at least one active zone first"}
          >
            START SIMULATION
          </button>
        )}
      </footer>
    </div>
  );
}

import { useRef, useState } from "react";
import SiteMap from "./components/SiteMap";
import ZoneToolbar from "./components/ZoneToolbar";
import ZoneProperties from "./components/ZoneProperties";
import type { AppMode, Tool, Zone, ZoneDraft, ZonePatch } from "./types";
import "./App.css";

// Converts a running counter into A, B, C, ... Z, AA, AB, ... for zone
// ids/default names. Never reused after deletion, so ids stay unique.
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
  const zoneCounterRef = useRef(0);

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const hasActiveZone = zones.some((z) => z.active);

  function handleZoneCreate(draft: ZoneDraft) {
    const letter = letterFromIndex(zoneCounterRef.current);
    zoneCounterRef.current += 1;
    const id = `ZONE-${letter}`;
    const name = `${draft.type === "exclusion" ? "Exclusion" : "Warning"} Zone ${letter}`;
    const zone = { ...draft, id, name } as Zone;
    setZones((prev) => [...prev, zone]);
    setSelectedZoneId(id);
    setTool("select");
  }

  function handleZoneUpdate(id: string, patch: ZonePatch) {
    setZones((prev) => prev.map((z) => (z.id === id ? ({ ...z, ...patch } as Zone) : z)));
  }

  function patchSelected(patch: ZonePatch) {
    if (selectedZoneId) handleZoneUpdate(selectedZoneId, patch);
  }

  function handleDeleteSelected() {
    if (!selectedZoneId) return;
    setZones((prev) => prev.filter((z) => z.id !== selectedZoneId));
    setSelectedZoneId(null);
  }

  function handleClearAll() {
    setZones([]);
    setSelectedZoneId(null);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>UWB CONSTRUCTION SAFETY DEMO</h1>
        <span className="mode-badge">
          {mode === "setup" ? "ZONE SETUP MODE" : "LIVE SIMULATION MODE"}
        </span>
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

import type { SafetyState } from "../types";

interface StatusPanelProps {
  tagId: string;
  state: SafetyState | null;
  zoneId: string | null;
  degraded: boolean;
}

// Simulates the worker's wearable indicator: a device that in real life
// would also vibrate and sound an alert, but for this software demo a
// visual LED + status line is sufficient (per the design spec).
export default function StatusPanel({ tagId, state, zoneId, degraded }: StatusPanelProps) {
  const ledClass = degraded
    ? "led-degraded"
    : state === "BREACH"
      ? "led-red"
      : state === "WARNING"
        ? "led-amber"
        : "led-off";

  const stateLabel = degraded ? "SYSTEM DEGRADED" : (state ?? "—");
  const ledLabel = degraded
    ? "LED: AMBER/GREY"
    : state === "BREACH"
      ? "LED RED"
      : state === "WARNING"
        ? "LED AMBER"
        : state === "SAFE"
          ? "LED OFF"
          : "—";

  const stateClass = degraded ? "status-state-degraded" : `status-state-${(state ?? "pending").toLowerCase()}`;

  return (
    <div className="status-panel">
      <h3>{tagId} STATUS</h3>
      <div className="status-readout">
        <span className={`status-led ${ledClass}`} />
        <div className="status-text">
          <div className={`status-state ${stateClass}`}>
            {stateLabel}
            {zoneId ? ` (${zoneId})` : ""}
          </div>
          <div className="status-led-label">{ledLabel}</div>
        </div>
      </div>
      <p className="status-caption">
        Represents the wearable's LED. A physical device would also vibrate and sound an audible alert.
      </p>
    </div>
  );
}

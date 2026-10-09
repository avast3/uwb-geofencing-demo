import type { SafetyState } from "../types";

interface StatusPanelProps {
  tagId: string;
  state: SafetyState | null;
  /** Name of the zone the backend reported, if any. */
  zoneName: string | null;
  degraded: boolean;
}

const STATE_LABELS: Record<SafetyState, string> = { SAFE: "Safe", WARNING: "Warning", BREACH: "Breach" };

// Simulates the worker's wearable indicator: a device that in real life
// would also vibrate and sound an alert, but for this software demo a
// visual LED + status line is sufficient (per the design spec).
export default function StatusPanel({ tagId, state, zoneName, degraded }: StatusPanelProps) {
  const ledClass = degraded
    ? "led-degraded"
    : state === "BREACH"
      ? "led-red"
      : state === "WARNING"
        ? "led-amber"
        : "led-off";

  const stateLabel = degraded ? "Degraded" : state ? STATE_LABELS[state] : "—";
  const detail = degraded
    ? "Position unavailable — fewer than 3 anchors online"
    : zoneName
      ? `In ${zoneName}`
      : state === "SAFE"
        ? "Outside all hazard zones"
        : "Waiting for first position…";
  const ledLabel = degraded
    ? "Wearable LED: grey"
    : state === "BREACH"
      ? "Wearable LED: red"
      : state === "WARNING"
        ? "Wearable LED: amber"
        : "Wearable LED: off";

  const stateClass = degraded ? "status-state-degraded" : `status-state-${(state ?? "pending").toLowerCase()}`;

  return (
    <div className="status-panel">
      <h3>Worker {tagId}</h3>
      <div className="status-readout">
        <span className={`status-led ${ledClass}`} />
        <div className={`status-state ${stateClass}`}>{stateLabel}</div>
      </div>
      <div className="status-detail">{detail}</div>
      <p className="status-caption">
        {ledLabel}. A physical tag would also vibrate and sound an alert.
      </p>
    </div>
  );
}

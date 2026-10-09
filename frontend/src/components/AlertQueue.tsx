import { useState } from "react";
import type { LogEvent } from "../types";
import CameraModal from "./CameraModal";
import type { AlertAction } from "./CameraModal";

interface AlertCardProps {
  alert: LogEvent;
  onAcknowledge: (eventId: string, note: string) => void;
  onEscalate: (eventId: string, note: string) => void;
}

function AlertCard({ alert, onAcknowledge, onEscalate }: AlertCardProps) {
  const [note, setNote] = useState("");
  // Which action is awaiting confirmation in the camera popup, if any. The
  // action is only sent to the backend on Confirm, so Cancel leaves the
  // alert pending.
  const [pendingAction, setPendingAction] = useState<AlertAction | null>(null);

  function handleConfirm() {
    if (pendingAction === "acknowledge") onAcknowledge(alert.eventId, note);
    else if (pendingAction === "escalate") onEscalate(alert.eventId, note);
    setPendingAction(null);
  }

  return (
    <div className="alert-card">
      <div className="alert-card-header">
        <span className="alert-card-title">Red zone entry</span>
        <span className="alert-card-time">{alert.timestamp}</span>
      </div>
      <div className="alert-card-body">
        {alert.tagId} entered <strong>{alert.zoneName}</strong>
      </div>
      <input
        type="text"
        className="alert-card-note"
        placeholder="Action taken (optional) — e.g. worker moved, barricade reset"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="alert-card-actions">
        <button className="alert-btn alert-btn-ack" onClick={() => setPendingAction("acknowledge")}>
          Acknowledge
        </button>
        <button className="alert-btn alert-btn-escalate" onClick={() => setPendingAction("escalate")}>
          Escalate
        </button>
      </div>
      {pendingAction && (
        <CameraModal
          alert={alert}
          action={pendingAction}
          onConfirm={handleConfirm}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}

interface AlertQueueProps {
  alerts: LogEvent[];
  onAcknowledge: (eventId: string, note: string) => void;
  onEscalate: (eventId: string, note: string) => void;
}

// The supervisor verification loop: every exclusion-zone ENTRY is an alert
// requiring a human to acknowledge or escalate it — the system warns the
// worker, but a person decides and logs the outcome, supporting (not
// replacing) the spotter.
export default function AlertQueue({ alerts, onAcknowledge, onEscalate }: AlertQueueProps) {
  return (
    <div className="alert-queue">
      <div className="alert-queue-header">
        <h3>Supervisor alerts</h3>
        {alerts.length > 0 && <span className="alert-count">{alerts.length} pending</span>}
      </div>
      {alerts.length === 0 ? (
        <p className="properties-empty">No pending alerts.</p>
      ) : (
        alerts.map((alert) => (
          <AlertCard key={alert.eventId} alert={alert} onAcknowledge={onAcknowledge} onEscalate={onEscalate} />
        ))
      )}
    </div>
  );
}

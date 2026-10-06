import { useState } from "react";
import type { LogEvent } from "../types";

interface AlertCardProps {
  alert: LogEvent;
  onAcknowledge: (eventId: string, note: string) => void;
  onEscalate: (eventId: string, note: string) => void;
}

function AlertCard({ alert, onAcknowledge, onEscalate }: AlertCardProps) {
  const [note, setNote] = useState("");

  return (
    <div className="alert-card">
      <div className="alert-card-header">
        <span className="alert-card-title">RED ZONE ENTRY</span>
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
        <button className="alert-btn alert-btn-ack" onClick={() => onAcknowledge(alert.eventId, note)}>
          Acknowledge
        </button>
        <button className="alert-btn alert-btn-escalate" onClick={() => onEscalate(alert.eventId, note)}>
          Escalate
        </button>
      </div>
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
      <h3>SUPERVISOR ALERTS</h3>
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

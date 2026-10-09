import { useEffect } from "react";
import type { LogEvent } from "../types";

export type AlertAction = "acknowledge" | "escalate";

interface CameraModalProps {
  alert: LogEvent;
  action: AlertAction;
  onConfirm: () => void;
  onCancel: () => void;
}

// Placeholder for a site camera view: before a supervisor acknowledges or
// escalates an alert, they'd visually verify the scene. No real video or AI
// is involved — the feed area is deliberately just a labelled empty frame.
export default function CameraModal({ alert, action, onConfirm, onCancel }: CameraModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const isAck = action === "acknowledge";

  return (
    <div className="camera-modal-backdrop" onClick={onCancel}>
      <div
        className="camera-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="camera-modal-header">
          <h3 id="camera-modal-title">AI camera · {alert.zoneName}</h3>
          <span className="camera-modal-live">Placeholder</span>
        </div>

        <div className="camera-feed-placeholder">Insert camera video feed</div>

        <div className="camera-modal-details">
          {alert.tagId} entered <strong>{alert.zoneName}</strong> at {alert.timestamp}
        </div>

        <div className="alert-card-actions">
          <button className="alert-btn camera-modal-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className={`alert-btn ${isAck ? "alert-btn-ack" : "alert-btn-escalate"}`} onClick={onConfirm} autoFocus>
            {isAck ? "Confirm Acknowledge" : "Confirm Escalate"}
          </button>
        </div>
      </div>
    </div>
  );
}

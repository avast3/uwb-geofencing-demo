import type { LogEvent } from "../types";

interface EventLogProps {
  events: LogEvent[];
  onClear: () => void;
}

// For an alert-requiring event, renders its resolution inline so the
// chronological log alone tells the full story: entry -> verified/escalated
// -> action taken -> cleared time.
function resolutionText(e: LogEvent): string | null {
  if (!e.requiresAck) return null;
  if (e.ackStatus === "PENDING" || !e.ackStatus) return "AWAITING SUPERVISOR ACTION";
  const verdict = e.ackStatus === "ACKNOWLEDGED" ? "Verified: supervisor" : "ESCALATED";
  const action = e.actionNote ? ` · Action: ${e.actionNote}` : "";
  const cleared = e.clearedAt ? ` · Cleared ${e.clearedAt}` : "";
  return `${verdict}${action}${cleared}`;
}

// Chronological ENTERED/EXITED transitions from the backend. One row per
// actual zone-membership change — the backend only ever appends an event
// when something changes, so this never grows once per animation frame.
export default function EventLog({ events, onClear }: EventLogProps) {
  return (
    <div className="event-log">
      <div className="event-log-header">
        <h3>Event log</h3>
        <button className="toolbar-btn danger" disabled={events.length === 0} onClick={onClear}>
          Clear Events
        </button>
      </div>
      <div className="event-log-list">
        {events.length === 0 ? (
          <p className="properties-empty">No zone entries or exits yet.</p>
        ) : (
          events.map((e) => {
            const resolution = resolutionText(e);
            return (
              <div key={e.eventId} className="event-log-row">
                <span className="event-log-time">{e.timestamp}</span>
                <span className="event-log-text">
                  <span className={`event-log-message event-log-${e.transition.toLowerCase()}`}>{e.message}</span>
                  {resolution && (
                    <span className={`event-log-resolution event-log-resolution-${(e.ackStatus ?? "pending").toLowerCase()}`}>
                      {" "}
                      — {resolution}
                    </span>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

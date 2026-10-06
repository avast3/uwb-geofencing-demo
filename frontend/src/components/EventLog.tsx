import type { LogEvent } from "../types";

interface EventLogProps {
  events: LogEvent[];
  onClear: () => void;
}

// Chronological ENTERED/EXITED transitions from the backend. One row per
// actual zone-membership change — the backend only ever appends an event
// when something changes, so this never grows once per animation frame.
export default function EventLog({ events, onClear }: EventLogProps) {
  return (
    <div className="event-log">
      <div className="event-log-header">
        <h3>EVENT LOG</h3>
        <button className="toolbar-btn danger" disabled={events.length === 0} onClick={onClear}>
          Clear Events
        </button>
      </div>
      <div className="event-log-list">
        {events.length === 0 ? (
          <p className="properties-empty">No zone entries or exits yet.</p>
        ) : (
          events.map((e) => (
            <div key={e.eventId} className="event-log-row">
              <span className="event-log-time">{e.timestamp}</span>
              <span className={`event-log-message event-log-${e.transition.toLowerCase()}`}>{e.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

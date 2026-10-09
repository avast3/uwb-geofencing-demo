import { useEffect, useState } from "react";
import EventLog from "./components/EventLog";
import AlertQueue from "./components/AlertQueue";
import VerificationNotice from "./components/VerificationNotice";
import * as api from "./services/api";
import { useAlarm } from "./utils/alarm";
import type { LogEvent } from "./types";
import "./App.css";

const HEALTH_POLL_MS = 4000;
const EVENTS_POLL_MS = 1000;

// Standalone supervisor console at /supervisor, meant to be opened in its
// own window beside the site map. It shares no in-memory state with the map
// page: the backend is the single source of truth for events and their
// acknowledge/escalate status, so both pages stay in sync by polling it.
export default function SupervisorPage() {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null); // null = checking

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const latest = await api.getEvents();
      if (!cancelled) setEvents(latest);
    };
    void poll();
    const interval = setInterval(poll, EVENTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const online = await api.checkHealth();
      if (!cancelled) setBackendOnline(online);
    };
    void check();
    const interval = setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const pendingAlerts = events.filter((e) => e.requiresAck && e.ackStatus === "PENDING");
  const alarm = useAlarm(pendingAlerts.length > 0);

  async function handleAcknowledgeAlert(eventId: string, note: string) {
    const updated = await api.acknowledgeEvent(eventId, note);
    if (updated) setEvents((prev) => prev.map((e) => (e.eventId === eventId ? updated : e)));
  }

  async function handleEscalateAlert(eventId: string, note: string) {
    const updated = await api.escalateEvent(eventId, note);
    if (updated) setEvents((prev) => prev.map((e) => (e.eventId === eventId ? updated : e)));
  }

  function handleClearEvents() {
    setEvents([]);
    void api.clearEvents();
  }

  const backendLabel =
    backendOnline === null ? "BACKEND: CHECKING..." : backendOnline ? "BACKEND: CONNECTED" : "BACKEND: OFFLINE";
  const backendClass =
    backendOnline === null ? "backend-badge checking" : backendOnline ? "backend-badge online" : "backend-badge offline";

  return (
    <div className="app">
      <header className="app-header">
        <h1>SUPERVISOR CONSOLE</h1>
        <div className="header-badges">
          {alarm.enabled ? (
            <button
              className={`alarm-btn${alarm.sounding ? " sounding" : ""}`}
              onClick={() => alarm.setMuted(!alarm.muted)}
            >
              {alarm.muted ? "🔇 ALARM MUTED" : "🔊 ALARM ON"}
            </button>
          ) : (
            <button className="alarm-btn needs-enable" onClick={alarm.enable}>
              🔈 ENABLE ALARM SOUND
            </button>
          )}
          <span className={backendClass}>{backendLabel}</span>
          <span className="mode-badge">TAG-001 MONITOR</span>
        </div>
      </header>

      <div className="event-log-section supervisor-section">
        <VerificationNotice />
        <AlertQueue alerts={pendingAlerts} onAcknowledge={handleAcknowledgeAlert} onEscalate={handleEscalateAlert} />
        <EventLog events={events} onClear={handleClearEvents} />
      </div>

      <footer className="app-footer">
        <div className="disclaimer">
          This system supplements physical exclusion controls, spotters, SWMS
          and site supervision. It does not replace them.
        </div>
      </footer>
    </div>
  );
}

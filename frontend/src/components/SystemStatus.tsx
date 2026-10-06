interface SystemStatusProps {
  backendOnline: boolean | null; // null = still checking
  anchorsOnlineCount: number;
  totalAnchors: number;
  gatewayOnline: boolean;
  lastUpdate: string | null;
  lastMessage: string | null;
}

// "These values must originate from actual communication with FastAPI" —
// backendOnline/lastUpdate/lastMessage are all driven by real responses
// (or their absence), never hardcoded.
export default function SystemStatus({
  backendOnline,
  anchorsOnlineCount,
  totalAnchors,
  gatewayOnline,
  lastUpdate,
  lastMessage,
}: SystemStatusProps) {
  const backendLabel = backendOnline === null ? "CHECKING..." : backendOnline ? "CONNECTED" : "OFFLINE";
  const backendClass = backendOnline === null ? "status-pending" : backendOnline ? "status-good" : "status-bad";

  return (
    <div className="status-panel">
      <h3>SYSTEM STATUS</h3>
      <div className="properties-row">
        <span>Backend</span>
        <span className={`properties-value ${backendClass}`}>{backendLabel}</span>
      </div>
      <div className="properties-row">
        <span>Gateway</span>
        <span className={`properties-value ${gatewayOnline ? "status-good" : "status-bad"}`}>
          {gatewayOnline ? "ONLINE" : "OFFLINE"}
        </span>
      </div>
      <div className="properties-row">
        <span>Anchors</span>
        <span className={`properties-value ${anchorsOnlineCount < 3 ? "status-bad" : "status-good"}`}>
          {anchorsOnlineCount} / {totalAnchors} ONLINE
        </span>
      </div>
      <div className="properties-row">
        <span>Last Update</span>
        <span className="properties-value">{lastUpdate ?? "—"}</span>
      </div>
      <div className="properties-row">
        <span>Last Message</span>
        <span className="properties-value status-last-message">{lastMessage ?? "—"}</span>
      </div>
      <p className="status-caption">Click an anchor on the map to take it offline/online (fault demo).</p>
    </div>
  );
}

import { useState } from "react";

function formatClockTime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Placeholder for the ZoneWatch "unable to verify" state: when a zone's tag,
// camera or network data is missing, the system can't confirm the zone is
// clear, so it asks a supervisor to check it in person rather than showing a
// false all-clear. Fixed text only — not driven by real system data — and
// "Mark checked" is local to this page (resets on reload).
export default function VerificationNotice() {
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  return (
    <div className={`verify-notice${checkedAt ? " checked" : ""}`}>
      <span className="verify-notice-text">
        {checkedAt ? (
          <>
            ✓ Zone 1 · checked by supervisor at {checkedAt}
          </>
        ) : (
          <>
            <strong>Zone 1</strong> · unable to verify: tag, camera or network data missing
          </>
        )}
      </span>
      {!checkedAt && (
        <button className="verify-notice-btn" onClick={() => setCheckedAt(formatClockTime(new Date()))}>
          Mark checked
        </button>
      )}
    </div>
  );
}

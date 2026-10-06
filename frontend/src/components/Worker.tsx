import { metresToPixels } from "../utils/coordinateTransform";
import type { MetrePoint } from "../utils/coordinateTransform";

interface WorkerProps {
  /** Ground-truth position — the actual simulated worker location. */
  position: MetrePoint;
  label?: string;
}

// A small construction worker glyph (hard hat + hi-vis body), not just a
// dot, at the ground-truth position. Drawn in a local -12..12 coordinate
// space and translated into place so the shape itself stays simple.
export default function Worker({ position, label = "TAG-001" }: WorkerProps) {
  const { x, y } = metresToPixels(position.x, position.y);

  return (
    <g transform={`translate(${x}, ${y})`} className="worker">
      {/* hi-vis body */}
      <path
        d="M -8 11 Q -8 1 0 1 Q 8 1 8 11 Z"
        className="worker-body"
      />
      {/* head */}
      <circle cx="0" cy="-3" r="5.5" className="worker-head" />
      {/* hard hat dome */}
      <path d="M -6.5 -4.5 A 6.5 6.5 0 0 1 6.5 -4.5 Z" className="worker-hat" />
      {/* hard hat brim */}
      <ellipse cx="0" cy="-4.5" rx="7.5" ry="1.6" className="worker-hat-brim" />
      <text x="0" y="24" textAnchor="middle" className="worker-label">
        {label}
      </text>
    </g>
  );
}

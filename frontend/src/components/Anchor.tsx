import { metresToPixels } from "../utils/coordinateTransform";
import type { AnchorInfo } from "../types";

interface AnchorProps {
  anchor: AnchorInfo;
  online: boolean;
  /** Only provided in LIVE SIMULATION MODE — clicking toggles the anchor. */
  onToggle?: (anchorId: string) => void;
}

// Renders one fixed UWB anchor as site infrastructure. Anchors never move,
// but can be switched online/offline (the anchor fault demo) while live —
// offline anchors are dimmed and contribute no range measurements.
export default function Anchor({ anchor, online, onToggle }: AnchorProps) {
  const { x, y } = metresToPixels(anchor.xM, anchor.yM);
  const className = `anchor${online ? "" : " anchor-offline"}${onToggle ? " anchor-clickable" : ""}`;

  return (
    <g className={className} onClick={onToggle ? () => onToggle(anchor.id) : undefined}>
      <circle cx={x} cy={y} r={7} className="anchor-dot" />
      <circle cx={x} cy={y} r={13} className="anchor-ring" />
      <text x={x} y={y - 18} textAnchor="middle" className="anchor-label">
        {anchor.id}
      </text>
      {anchor.label && (
        <text x={x} y={y + 28} textAnchor="middle" className="anchor-sublabel">
          {anchor.label}
        </text>
      )}
      {!online && (
        <text x={x} y={y + (anchor.label ? 42 : 28)} textAnchor="middle" className="anchor-offline-label">
          OFFLINE
        </text>
      )}
    </g>
  );
}

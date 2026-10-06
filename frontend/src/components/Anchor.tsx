import { metresToPixels } from "../utils/coordinateTransform";
import type { AnchorInfo } from "../types";

interface AnchorProps {
  anchor: AnchorInfo;
}

// Renders one fixed UWB anchor as site infrastructure. Anchors never move
// and (in this stage) are always online; the on/off fault demo arrives
// in a later stage.
export default function Anchor({ anchor }: AnchorProps) {
  const { x, y } = metresToPixels(anchor.xM, anchor.yM);

  return (
    <g className="anchor">
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
    </g>
  );
}

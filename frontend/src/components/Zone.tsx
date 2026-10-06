import { metresToPixels, metresLengthToPixels } from "../utils/coordinateTransform";
import type { ResizeHandle, Zone as ZoneData } from "../types";

interface ZoneProps {
  zone: ZoneData;
  isSelected: boolean;
  onBodyPointerDown: (e: React.PointerEvent, zoneId: string) => void;
  onHandlePointerDown: (e: React.PointerEvent, zoneId: string, handle: ResizeHandle) => void;
}

const HANDLE_RADIUS = 6;

// Renders one zone (rectangle or circle) plus, when selected, the
// move/resize handles. Pure presentation + pointer-event wiring — all
// drag math lives in SiteMap, which owns the authoritative zone geometry.
export default function Zone({ zone, isSelected, onBodyPointerDown, onHandlePointerDown }: ZoneProps) {
  const colourClass = zone.type === "exclusion" ? "zone-exclusion" : "zone-warning";
  const inactiveClass = zone.active ? "" : " zone-inactive";
  const selectedClass = isSelected ? " zone-selected" : "";
  const className = `zone ${colourClass}${inactiveClass}${selectedClass}`;

  if (zone.shape === "rectangle") {
    const topLeft = metresToPixels(zone.xMin, zone.yMax);
    const bottomRight = metresToPixels(zone.xMax, zone.yMin);
    const widthPx = bottomRight.x - topLeft.x;
    const heightPx = bottomRight.y - topLeft.y;

    const corners: { handle: ResizeHandle; x: number; y: number }[] = [
      { handle: "nw", x: topLeft.x, y: topLeft.y },
      { handle: "ne", x: bottomRight.x, y: topLeft.y },
      { handle: "sw", x: topLeft.x, y: bottomRight.y },
      { handle: "se", x: bottomRight.x, y: bottomRight.y },
    ];

    return (
      <g>
        <rect
          x={topLeft.x}
          y={topLeft.y}
          width={widthPx}
          height={heightPx}
          className={className}
          onPointerDown={(e) => onBodyPointerDown(e, zone.id)}
        />
        <text x={topLeft.x + 6} y={topLeft.y + 16} className="zone-label">
          {zone.name}
        </text>
        {isSelected &&
          corners.map((c) => (
            <circle
              key={c.handle}
              cx={c.x}
              cy={c.y}
              r={HANDLE_RADIUS}
              className="zone-handle"
              onPointerDown={(e) => onHandlePointerDown(e, zone.id, c.handle)}
            />
          ))}
      </g>
    );
  }

  // Circle zone
  const centre = metresToPixels(zone.centreX, zone.centreY);
  const radiusPx = metresLengthToPixels(zone.radius);
  const edgeHandlePos = { x: centre.x + radiusPx, y: centre.y };

  return (
    <g>
      <circle
        cx={centre.x}
        cy={centre.y}
        r={radiusPx}
        className={className}
        onPointerDown={(e) => onBodyPointerDown(e, zone.id)}
      />
      <text x={centre.x} y={centre.y - radiusPx - 8} textAnchor="middle" className="zone-label">
        {zone.name}
      </text>
      {isSelected && (
        <>
          <rect
            x={centre.x - HANDLE_RADIUS}
            y={centre.y - HANDLE_RADIUS}
            width={HANDLE_RADIUS * 2}
            height={HANDLE_RADIUS * 2}
            className="zone-handle"
            onPointerDown={(e) => onHandlePointerDown(e, zone.id, "centre")}
          />
          <circle
            cx={edgeHandlePos.x}
            cy={edgeHandlePos.y}
            r={HANDLE_RADIUS}
            className="zone-handle"
            onPointerDown={(e) => onHandlePointerDown(e, zone.id, "radius")}
          />
        </>
      )}
    </g>
  );
}

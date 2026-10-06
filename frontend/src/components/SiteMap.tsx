import { useEffect, useRef, useState } from "react";
import Anchor from "./Anchor";
import ZoneComp from "./Zone";
import WorkerComp from "./Worker";
import {
  MARGIN_PX,
  MIN_ZONE_SIZE_M,
  SITE_HEIGHT_M,
  SITE_HEIGHT_PX,
  SITE_WIDTH_M,
  SITE_WIDTH_PX,
  SVG_HEIGHT,
  SVG_WIDTH,
  clamp,
  clampToSite,
  metresToPixels,
  pixelsToMetres,
} from "../utils/coordinateTransform";
import type {
  AnchorInfo,
  CircleZone,
  RectangleZone,
  ResizeHandle,
  Tool,
  Zone,
  ZoneDraft,
  ZonePatch,
} from "../types";
import type { MetrePoint } from "../utils/coordinateTransform";

const ANCHORS: AnchorInfo[] = [
  { id: "A1", xM: 0, yM: 0, label: "Gateway" },
  { id: "A2", xM: SITE_WIDTH_M, yM: 0 },
  { id: "A3", xM: 0, yM: SITE_HEIGHT_M },
  { id: "A4", xM: SITE_WIDTH_M, yM: SITE_HEIGHT_M },
];

interface SiteMapProps {
  zones: Zone[];
  selectedZoneId: string | null;
  tool: Tool;
  /** LIVE SIMULATION MODE: zone geometry is locked — no draw/move/resize. */
  locked?: boolean;
  /** Ground-truth worker position; omitted/undefined in ZONE SETUP MODE. */
  workerPosition?: MetrePoint | null;
  onZoneCreate: (draft: ZoneDraft) => void;
  onZoneUpdate: (id: string, patch: ZonePatch) => void;
  onZoneSelect: (id: string | null) => void;
}

type DragState =
  | { kind: "draw-rect"; startM: MetrePoint; currentM: MetrePoint }
  | { kind: "draw-circle"; centreM: MetrePoint; currentM: MetrePoint }
  | { kind: "move"; zoneId: string; startPointerM: MetrePoint; originalZone: Zone }
  | {
      kind: "resize-rect";
      zoneId: string;
      handle: ResizeHandle;
      oppositeM: MetrePoint;
    }
  | { kind: "resize-circle-radius"; zoneId: string; originalZone: CircleZone }
  | {
      kind: "resize-circle-centre";
      zoneId: string;
      startPointerM: MetrePoint;
      originalZone: CircleZone;
    };

type PreviewState =
  | { kind: "rect"; a: MetrePoint; b: MetrePoint }
  | { kind: "circle"; centre: MetrePoint; edge: MetrePoint };

function dist(a: MetrePoint, b: MetrePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Opposite (anchored) corner for a rectangle resize handle, in metres.
function oppositeCorner(zone: RectangleZone, handle: ResizeHandle): MetrePoint {
  switch (handle) {
    case "nw":
      return { x: zone.xMax, y: zone.yMin };
    case "ne":
      return { x: zone.xMin, y: zone.yMin };
    case "sw":
      return { x: zone.xMax, y: zone.yMax };
    case "se":
    default:
      return { x: zone.xMin, y: zone.yMax };
  }
}

function resizeRect(oppositeM: MetrePoint, pointerM: MetrePoint): ZonePatch {
  let x = pointerM.x;
  let y = pointerM.y;
  if (Math.abs(x - oppositeM.x) < MIN_ZONE_SIZE_M) {
    x = oppositeM.x + (x >= oppositeM.x ? MIN_ZONE_SIZE_M : -MIN_ZONE_SIZE_M);
    x = clamp(x, 0, SITE_WIDTH_M);
  }
  if (Math.abs(y - oppositeM.y) < MIN_ZONE_SIZE_M) {
    y = oppositeM.y + (y >= oppositeM.y ? MIN_ZONE_SIZE_M : -MIN_ZONE_SIZE_M);
    y = clamp(y, 0, SITE_HEIGHT_M);
  }
  return {
    xMin: Math.min(oppositeM.x, x),
    xMax: Math.max(oppositeM.x, x),
    yMin: Math.min(oppositeM.y, y),
    yMax: Math.max(oppositeM.y, y),
  };
}

function translateRect(zone: RectangleZone, dx: number, dy: number): ZonePatch {
  let xMin = zone.xMin + dx;
  let xMax = zone.xMax + dx;
  let yMin = zone.yMin + dy;
  let yMax = zone.yMax + dy;
  if (xMin < 0) {
    xMax -= xMin;
    xMin = 0;
  }
  if (xMax > SITE_WIDTH_M) {
    xMin -= xMax - SITE_WIDTH_M;
    xMax = SITE_WIDTH_M;
  }
  if (yMin < 0) {
    yMax -= yMin;
    yMin = 0;
  }
  if (yMax > SITE_HEIGHT_M) {
    yMin -= yMax - SITE_HEIGHT_M;
    yMax = SITE_HEIGHT_M;
  }
  return { xMin, xMax, yMin, yMax };
}

function translateCircle(zone: CircleZone, dx: number, dy: number): ZonePatch {
  const centre = clampToSite({ x: zone.centreX + dx, y: zone.centreY + dy });
  return { centreX: centre.x, centreY: centre.y };
}

// The 8x6m digital site. Renders the grid, fixed anchors and user-drawn
// zones, and owns all pointer-event drag logic for drawing / selecting /
// moving / resizing zones. Geometry math lives here; naming/ID assignment
// and the zones array itself live in the parent (App).
export default function SiteMap({
  zones,
  selectedZoneId,
  tool,
  locked = false,
  workerPosition = null,
  onZoneCreate,
  onZoneUpdate,
  onZoneSelect,
}: SiteMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  function clientToMetres(clientX: number, clientY: number): MetrePoint {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scaleX = SVG_WIDTH / rect.width;
    const scaleY = SVG_HEIGHT / rect.height;
    const pxX = (clientX - rect.left) * scaleX;
    const pxY = (clientY - rect.top) * scaleY;
    return clampToSite(pixelsToMetres(pxX, pxY));
  }

  useEffect(() => {
    function handleMove(e: PointerEvent) {
      const state = dragRef.current;
      if (!state) return;
      const m = clientToMetres(e.clientX, e.clientY);

      switch (state.kind) {
        case "draw-rect":
          dragRef.current = { ...state, currentM: m };
          setPreview({ kind: "rect", a: state.startM, b: m });
          break;
        case "draw-circle":
          dragRef.current = { ...state, currentM: m };
          setPreview({ kind: "circle", centre: state.centreM, edge: m });
          break;
        case "move": {
          const dx = m.x - state.startPointerM.x;
          const dy = m.y - state.startPointerM.y;
          const patch =
            state.originalZone.shape === "rectangle"
              ? translateRect(state.originalZone, dx, dy)
              : translateCircle(state.originalZone, dx, dy);
          onZoneUpdate(state.zoneId, patch);
          break;
        }
        case "resize-rect":
          onZoneUpdate(state.zoneId, resizeRect(state.oppositeM, m));
          break;
        case "resize-circle-radius": {
          const r = Math.max(
            MIN_ZONE_SIZE_M / 2,
            dist({ x: state.originalZone.centreX, y: state.originalZone.centreY }, m)
          );
          onZoneUpdate(state.zoneId, { radius: r });
          break;
        }
        case "resize-circle-centre": {
          const dx = m.x - state.startPointerM.x;
          const dy = m.y - state.startPointerM.y;
          const centre = clampToSite({
            x: state.originalZone.centreX + dx,
            y: state.originalZone.centreY + dy,
          });
          onZoneUpdate(state.zoneId, { centreX: centre.x, centreY: centre.y });
          break;
        }
      }
    }

    function handleUp() {
      const state = dragRef.current;
      dragRef.current = null;
      setPreview(null);
      if (!state) return;

      if (state.kind === "draw-rect") {
        const xMin = Math.min(state.startM.x, state.currentM.x);
        const xMax = Math.max(state.startM.x, state.currentM.x);
        const yMin = Math.min(state.startM.y, state.currentM.y);
        const yMax = Math.max(state.startM.y, state.currentM.y);
        if (xMax - xMin >= MIN_ZONE_SIZE_M && yMax - yMin >= MIN_ZONE_SIZE_M) {
          onZoneCreate({
            shape: "rectangle",
            type: "exclusion",
            active: true,
            xMin,
            xMax,
            yMin,
            yMax,
          });
        }
      } else if (state.kind === "draw-circle") {
        const radius = dist(state.centreM, state.currentM);
        if (radius >= MIN_ZONE_SIZE_M / 2) {
          onZoneCreate({
            shape: "circle",
            type: "exclusion",
            active: true,
            centreX: state.centreM.x,
            centreY: state.centreM.y,
            radius,
          });
        }
      }
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onZoneCreate, onZoneUpdate]);

  function handleBackgroundPointerDown(e: React.PointerEvent) {
    if (locked) return;
    const m = clientToMetres(e.clientX, e.clientY);
    if (tool === "rectangle") {
      dragRef.current = { kind: "draw-rect", startM: m, currentM: m };
      setPreview({ kind: "rect", a: m, b: m });
    } else if (tool === "circle") {
      dragRef.current = { kind: "draw-circle", centreM: m, currentM: m };
      setPreview({ kind: "circle", centre: m, edge: m });
    } else {
      onZoneSelect(null);
    }
  }

  function handleBodyPointerDown(e: React.PointerEvent, zoneId: string) {
    if (locked) return;
    if (tool !== "select") {
      // A zone's SVG element is a sibling of the background rect, not its
      // descendant, so pointerdown here never bubbles to the background
      // handler. Starting a draw here too ensures drawing a new zone works
      // even when it starts on top of an existing one.
      handleBackgroundPointerDown(e);
      return;
    }
    e.stopPropagation();
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return;
    onZoneSelect(zoneId);
    dragRef.current = {
      kind: "move",
      zoneId,
      startPointerM: clientToMetres(e.clientX, e.clientY),
      originalZone: zone,
    };
  }

  function handleHandlePointerDown(
    e: React.PointerEvent,
    zoneId: string,
    handle: ResizeHandle
  ) {
    if (locked) return;
    if (tool !== "select") {
      handleBackgroundPointerDown(e);
      return;
    }
    e.stopPropagation();
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return;

    if (zone.shape === "rectangle") {
      dragRef.current = {
        kind: "resize-rect",
        zoneId,
        handle,
        oppositeM: oppositeCorner(zone, handle),
      };
    } else if (handle === "centre") {
      dragRef.current = {
        kind: "resize-circle-centre",
        zoneId,
        startPointerM: clientToMetres(e.clientX, e.clientY),
        originalZone: zone,
      };
    } else {
      dragRef.current = { kind: "resize-circle-radius", zoneId, originalZone: zone };
    }
  }

  // --- Grid lines -----------------------------------------------------
  const verticalLines = [];
  for (let xM = 0; xM <= SITE_WIDTH_M; xM++) {
    const top = metresToPixels(xM, SITE_HEIGHT_M);
    const bottom = metresToPixels(xM, 0);
    verticalLines.push(
      <line key={`v${xM}`} x1={top.x} y1={top.y} x2={bottom.x} y2={bottom.y} className="grid-line" />
    );
  }
  const horizontalLines = [];
  for (let yM = 0; yM <= SITE_HEIGHT_M; yM++) {
    const left = metresToPixels(0, yM);
    const right = metresToPixels(SITE_WIDTH_M, yM);
    horizontalLines.push(
      <line key={`h${yM}`} x1={left.x} y1={left.y} x2={right.x} y2={right.y} className="grid-line" />
    );
  }

  const siteOrigin = metresToPixels(0, SITE_HEIGHT_M); // top-left of site box

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
      className="site-map"
      role="img"
      aria-label="Construction site map"
    >
      {/* Site boundary + grid */}
      <rect
        x={siteOrigin.x}
        y={siteOrigin.y}
        width={SITE_WIDTH_PX}
        height={SITE_HEIGHT_PX}
        className="site-background"
        onPointerDown={handleBackgroundPointerDown}
      />
      {verticalLines}
      {horizontalLines}

      {/* Axis tick labels */}
      {Array.from({ length: SITE_WIDTH_M + 1 }, (_, xM) => {
        const p = metresToPixels(xM, 0);
        return (
          <text key={`xt${xM}`} x={p.x} y={p.y + MARGIN_PX - 8} textAnchor="middle" className="axis-label">
            {xM}
          </text>
        );
      })}
      {Array.from({ length: SITE_HEIGHT_M + 1 }, (_, yM) => {
        const p = metresToPixels(0, yM);
        return (
          <text key={`yt${yM}`} x={p.x - MARGIN_PX + 14} y={p.y + 4} textAnchor="middle" className="axis-label">
            {yM}
          </text>
        );
      })}

      {/* Zones (rendered below anchors so anchors stay visible at corners) */}
      {zones.map((zone) => (
        <ZoneComp
          key={zone.id}
          zone={zone}
          isSelected={zone.id === selectedZoneId && !locked}
          onBodyPointerDown={handleBodyPointerDown}
          onHandlePointerDown={handleHandlePointerDown}
        />
      ))}

      {/* Live draw preview */}
      {preview && preview.kind === "rect" && <RectPreview a={preview.a} b={preview.b} />}
      {preview && preview.kind === "circle" && <CirclePreview centre={preview.centre} edge={preview.edge} />}

      {/* Anchors on top */}
      {ANCHORS.map((a) => (
        <Anchor key={a.id} anchor={a} />
      ))}

      {/* Worker drawn last so it's always visible above anchors/zones */}
      {workerPosition && <WorkerComp position={workerPosition} />}
    </svg>
  );
}

function RectPreview({ a, b }: { a: MetrePoint; b: MetrePoint }) {
  const xMin = Math.min(a.x, b.x);
  const xMax = Math.max(a.x, b.x);
  const yMin = Math.min(a.y, b.y);
  const yMax = Math.max(a.y, b.y);
  const topLeft = metresToPixels(xMin, yMax);
  const bottomRight = metresToPixels(xMax, yMin);
  const widthM = xMax - xMin;
  const heightM = yMax - yMin;

  return (
    <g>
      <rect
        x={topLeft.x}
        y={topLeft.y}
        width={bottomRight.x - topLeft.x}
        height={bottomRight.y - topLeft.y}
        className="zone-preview"
      />
      <text x={topLeft.x} y={topLeft.y - 8} className="preview-label">
        Width: {widthM.toFixed(2)} m   Height: {heightM.toFixed(2)} m
      </text>
    </g>
  );
}

function CirclePreview({ centre, edge }: { centre: MetrePoint; edge: MetrePoint }) {
  const radiusM = dist(centre, edge);
  const centrePx = metresToPixels(centre.x, centre.y);
  const radiusPx = radiusM * (SITE_WIDTH_PX / SITE_WIDTH_M);

  return (
    <g>
      <circle cx={centrePx.x} cy={centrePx.y} r={radiusPx} className="zone-preview" />
      <text x={centrePx.x} y={centrePx.y - radiusPx - 8} textAnchor="middle" className="preview-label">
        Radius: {radiusM.toFixed(2)} m
      </text>
    </g>
  );
}

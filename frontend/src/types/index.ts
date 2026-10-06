// Shared domain types for the UWB geofencing demo.
// All geometry is expressed in site metres (origin bottom-left),
// independent of how it is drawn on screen.

export type ZoneType = "warning" | "exclusion";
export type ZoneShape = "rectangle" | "circle";

export interface BaseZone {
  id: string;
  name: string;
  type: ZoneType;
  active: boolean;
}

export interface RectangleZone extends BaseZone {
  shape: "rectangle";
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface CircleZone extends BaseZone {
  shape: "circle";
  centreX: number;
  centreY: number;
  radius: number;
}

export type Zone = RectangleZone | CircleZone;

export type Tool = "select" | "rectangle" | "circle";

// ZONE SETUP MODE (drawing/editing zones) vs LIVE SIMULATION MODE.
export type AppMode = "setup" | "live";

export type ResizeHandle =
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "radius"
  | "centre";

export interface AnchorInfo {
  id: "A1" | "A2" | "A3" | "A4";
  xM: number;
  yM: number;
  label?: string;
}

// Geometry + classification for a zone about to be created; id/name are
// assigned by the owner of the zones array (App), not by the drawing UI.
export type ZoneDraft =
  | Omit<RectangleZone, "id" | "name">
  | Omit<CircleZone, "id" | "name">;

// A partial update applied to an existing zone (move/resize/rename/retype).
// Combines both shapes' optional fields since the caller only ever sets
// fields relevant to the zone's actual shape.
export type ZonePatch = Partial<Omit<RectangleZone, "id" | "shape">> &
  Partial<Omit<CircleZone, "id" | "shape">>;

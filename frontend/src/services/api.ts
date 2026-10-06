// All communication with the FastAPI backend lives here. The backend is
// the authoritative source of truth for zone data (see design spec); this
// module is the only place that knows the backend's snake_case JSON shape
// and converts it to/from the frontend's camelCase Zone type.

import type {
  LogEvent,
  PositionResult,
  SafetyState,
  Zone,
  ZoneDraft,
  ZoneTransition,
  ZoneType,
} from "../types";

const BASE_URL = "http://localhost:8000";

interface BackendZoneCommon {
  zone_id: string;
  name: string;
  type: ZoneType;
  active: boolean;
}

interface BackendRectangleZone extends BackendZoneCommon {
  shape: "rectangle";
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
}

interface BackendCircleZone extends BackendZoneCommon {
  shape: "circle";
  centre_x: number;
  centre_y: number;
  radius: number;
}

type BackendZone = BackendRectangleZone | BackendCircleZone;

function fromBackend(z: BackendZone): Zone {
  if (z.shape === "rectangle") {
    return {
      id: z.zone_id,
      name: z.name,
      type: z.type,
      active: z.active,
      shape: "rectangle",
      xMin: z.x_min,
      xMax: z.x_max,
      yMin: z.y_min,
      yMax: z.y_max,
    };
  }
  return {
    id: z.zone_id,
    name: z.name,
    type: z.type,
    active: z.active,
    shape: "circle",
    centreX: z.centre_x,
    centreY: z.centre_y,
    radius: z.radius,
  };
}

// Request body shape for both POST (create) and PUT (full replace).
function toBackendBody(zone: ZoneDraft & { name: string }) {
  if (zone.shape === "rectangle") {
    return {
      shape: "rectangle",
      name: zone.name,
      type: zone.type,
      active: zone.active,
      x_min: zone.xMin,
      x_max: zone.xMax,
      y_min: zone.yMin,
      y_max: zone.yMax,
    };
  }
  return {
    shape: "circle",
    name: zone.name,
    type: zone.type,
    active: zone.active,
    centre_x: zone.centreX,
    centre_y: zone.centreY,
    radius: zone.radius,
  };
}

// Centralised fetch wrapper: every network/parse failure is caught here
// and turned into `null`, so callers never need their own try/catch and
// a backend outage can never throw up into a React event handler.
async function request<T>(path: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      console.error(`API ${options?.method ?? "GET"} ${path} failed: HTTP ${res.status}`);
      return null;
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : (null as T);
  } catch (err) {
    console.error(`API ${options?.method ?? "GET"} ${path} network error`, err);
    return null;
  }
}

export async function checkHealth(): Promise<boolean> {
  const result = await request<{ status: string }>("/api/health");
  return result?.status === "ok";
}

export async function getZones(): Promise<Zone[]> {
  const result = await request<BackendZone[]>("/api/zones");
  return (result ?? []).map(fromBackend);
}

export async function createZone(zone: ZoneDraft & { name: string }): Promise<Zone | null> {
  const result = await request<BackendZone>("/api/zones", {
    method: "POST",
    body: JSON.stringify(toBackendBody(zone)),
  });
  return result ? fromBackend(result) : null;
}

export async function updateZone(zone: Zone): Promise<Zone | null> {
  const { id, ...rest } = zone;
  const result = await request<BackendZone>(`/api/zones/${id}`, {
    method: "PUT",
    body: JSON.stringify(toBackendBody(rest)),
  });
  return result ? fromBackend(result) : null;
}

export async function deleteZone(zoneId: string): Promise<boolean> {
  const result = await request<{ zone_id: string; deleted: boolean }>(`/api/zones/${zoneId}`, {
    method: "DELETE",
  });
  return result?.deleted === true;
}

export async function clearZones(): Promise<boolean> {
  const result = await request<{ cleared: boolean }>("/api/zones", { method: "DELETE" });
  return result?.cleared === true;
}

interface BackendPositionResult {
  tag_id: string;
  state: SafetyState | null;
  zone_id: string | null;
  anchors_online: number;
  degraded: boolean;
}

// Sends the frontend's estimated UWB position (never ground truth) and
// returns the backend's authoritative SAFE/WARNING/BREACH verdict.
export async function postPosition(
  tagId: string,
  x: number,
  y: number,
  anchorsActive: string[]
): Promise<PositionResult | null> {
  const result = await request<BackendPositionResult>("/api/position", {
    method: "POST",
    body: JSON.stringify({ tag_id: tagId, x, y, anchors_active: anchorsActive }),
  });
  if (!result) return null;
  return {
    tagId: result.tag_id,
    state: result.state,
    zoneId: result.zone_id,
    anchorsOnline: result.anchors_online,
    degraded: result.degraded,
  };
}

interface BackendEvent {
  event_id: string;
  timestamp: string;
  tag_id: string;
  zone_id: string;
  zone_name: string;
  transition: ZoneTransition;
  message: string;
}

function fromBackendEvent(e: BackendEvent): LogEvent {
  return {
    eventId: e.event_id,
    timestamp: e.timestamp,
    tagId: e.tag_id,
    zoneId: e.zone_id,
    zoneName: e.zone_name,
    transition: e.transition,
    message: e.message,
  };
}

export async function getEvents(): Promise<LogEvent[]> {
  const result = await request<BackendEvent[]>("/api/events");
  return (result ?? []).map(fromBackendEvent);
}

export async function clearEvents(): Promise<boolean> {
  const result = await request<{ cleared: boolean }>("/api/events", { method: "DELETE" });
  return result?.cleared === true;
}

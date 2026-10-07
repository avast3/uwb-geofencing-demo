// All communication with the FastAPI backend lives here. The backend is
// the authoritative source of truth for zone data (see design spec); this
// module is the only place that knows the backend's snake_case JSON shape
// and converts it to/from the frontend's camelCase Zone type.

import type {
  AckStatus,
  LogEvent,
  Plant,
  PlantUpdateResult,
  PlantWithZones,
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
  plant_id?: string | null;
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
    plantId: z.plant_id ?? null,
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
    plantId: z.plant_id ?? null,
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
  requires_ack: boolean;
  ack_status: AckStatus | null;
  action_note: string | null;
  cleared_at: string | null;
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
    requiresAck: e.requires_ack,
    ackStatus: e.ack_status,
    actionNote: e.action_note,
    clearedAt: e.cleared_at,
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

async function resolveEvent(
  eventId: string,
  action: "acknowledge" | "escalate",
  actionNote: string
): Promise<LogEvent | null> {
  const result = await request<BackendEvent>(`/api/events/${eventId}/${action}`, {
    method: "POST",
    body: JSON.stringify({ action_note: actionNote || null }),
  });
  return result ? fromBackendEvent(result) : null;
}

export function acknowledgeEvent(eventId: string, actionNote: string): Promise<LogEvent | null> {
  return resolveEvent(eventId, "acknowledge", actionNote);
}

export function escalateEvent(eventId: string, actionNote: string): Promise<LogEvent | null> {
  return resolveEvent(eventId, "escalate", actionNote);
}

interface BackendPlant {
  plant_id: string;
  name: string;
  x: number;
  y: number;
  home_x: number;
  home_y: number;
  exclusion_zone_id: string;
  warning_zone_id: string;
}

interface BackendPlantWithZones {
  plant: BackendPlant;
  zones: BackendZone[];
}

function fromBackendPlant(p: BackendPlant): Plant {
  return {
    id: p.plant_id,
    name: p.name,
    x: p.x,
    y: p.y,
    homeX: p.home_x,
    homeY: p.home_y,
    exclusionZoneId: p.exclusion_zone_id,
    warningZoneId: p.warning_zone_id,
  };
}

function fromBackendPlantWithZones(r: BackendPlantWithZones): PlantWithZones {
  return { plant: fromBackendPlant(r.plant), zones: r.zones.map(fromBackend) };
}

export async function getPlants(): Promise<Plant[]> {
  const result = await request<BackendPlant[]>("/api/plants");
  return (result ?? []).map(fromBackendPlant);
}

export async function createPlant(x: number, y: number): Promise<PlantWithZones | null> {
  const result = await request<BackendPlantWithZones>("/api/plants", {
    method: "POST",
    body: JSON.stringify({ x, y }),
  });
  return result ? fromBackendPlantWithZones(result) : null;
}

// Sends the plant's estimated UWB position — position only, since a
// single UWB tag can't measure orientation. Unlike request(), this
// distinguishes 404 (plant deleted elsewhere, e.g. Clear Zones in another
// window) from a transient failure, so the caller can drop the plant
// instead of retrying it 5x/sec forever.
export async function postPlantPosition(
  id: string,
  x: number,
  y: number
): Promise<PlantUpdateResult> {
  try {
    const res = await fetch(`${BASE_URL}/api/plants/${id}/position`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    });
    if (res.status === 404) return { kind: "gone" };
    if (!res.ok) return { kind: "error" };
    const body = fromBackendPlantWithZones((await res.json()) as BackendPlantWithZones);
    return { kind: "ok", ...body };
  } catch {
    return { kind: "error" };
  }
}

export async function resetPlant(id: string): Promise<PlantWithZones | null> {
  const result = await request<BackendPlantWithZones>(`/api/plants/${id}/reset`, { method: "POST" });
  return result ? fromBackendPlantWithZones(result) : null;
}

export async function deletePlant(id: string): Promise<boolean> {
  const result = await request<{ plant_id: string; deleted: boolean }>(`/api/plants/${id}`, {
    method: "DELETE",
  });
  return result?.deleted === true;
}

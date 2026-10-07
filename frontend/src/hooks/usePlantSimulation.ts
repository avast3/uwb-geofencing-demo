import { useEffect, useRef, useState } from "react";
import * as api from "../services/api";
import { ANCHORS, SITE_HEIGHT_M, SITE_WIDTH_M } from "../utils/coordinateTransform";
import { computeAnchorRanges } from "../utils/ranging";
import { estimatePosition } from "../utils/positioning";
import { headingFor, initialMotion, stepPlant } from "../utils/plantMotion";
import type { PlantMotion } from "../utils/plantMotion";
import type { PlantPose } from "../components/Plant";
import type { Plant, Zone } from "../types";

const POSITION_POLL_MS = 200; // ~5/sec per plant, same cadence as the worker
const BOUNDS = { width: SITE_WIDTH_M, height: SITE_HEIGHT_M };

interface Options {
  active: boolean;
  plants: Plant[];
  onlineAnchorIds: ReadonlySet<string>;
  noiseEnabled: boolean;
  onZonesUpdated: (zones: Zone[]) => void;
  onPlantGone: (plantId: string) => void;
}

// Live-mode driver for mobile plant. Each animation frame advances every
// truck's ground-truth motion; every POSITION_POLL_MS each truck is
// "measured" by the simulated anchors exactly like the worker, and only the
// multilaterated estimate is sent to the backend, which moves the plant's
// zones. Returns the ground-truth poses for drawing the trucks.
export function usePlantSimulation({
  active,
  plants,
  onlineAnchorIds,
  noiseEnabled,
  onZonesUpdated,
  onPlantGone,
}: Options): Record<string, PlantPose> {
  const motionsRef = useRef<Record<string, PlantMotion>>({});
  const [poses, setPoses] = useState<Record<string, PlantPose>>({});

  // Latest values for the long-lived loops below, without restarting them.
  const latest = useRef({ plants, onlineAnchorIds, noiseEnabled, onZonesUpdated, onPlantGone });
  useEffect(() => {
    latest.current = { plants, onlineAnchorIds, noiseEnabled, onZonesUpdated, onPlantGone };
  });

  // Animation loop: ground-truth motion.
  useEffect(() => {
    if (!active) {
      motionsRef.current = {};
      setPoses({});
      return;
    }
    let rafId = 0;
    let last = performance.now();
    function tick(now: number) {
      const dt = Math.min((now - last) / 1000, 0.1); // clamp after a background-tab pause
      last = now;
      const motions = motionsRef.current;
      const next: Record<string, PlantPose> = {};
      for (const plant of latest.current.plants) {
        const current = motions[plant.id] ?? initialMotion(plant.homeX, plant.homeY);
        const stepped = stepPlant(current, dt, BOUNDS);
        motions[plant.id] = stepped;
        next[plant.id] = { x: stepped.x, y: stepped.y, direction: stepped.direction };
      }
      for (const id of Object.keys(motions)) {
        if (!(id in next)) delete motions[id];
      }
      // With no plants, keep the same empty object so React skips the
      // re-render instead of repainting the whole app every frame.
      setPoses((prev) => (Object.keys(next).length === 0 && Object.keys(prev).length === 0 ? prev : next));
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [active]);

  // Measurement loop: simulated UWB -> estimate -> backend.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const interval = setInterval(() => {
      const { plants: currentPlants, onlineAnchorIds: online, noiseEnabled: noise } = latest.current;
      for (const plant of currentPlants) {
        const motion = motionsRef.current[plant.id];
        if (!motion) continue;
        const ranges = computeAnchorRanges({ x: motion.x, y: motion.y }, ANCHORS, online, noise);
        const estimate = estimatePosition(ANCHORS, ranges);
        // Fewer than 3 anchors: no position fix, so the zones stay where
        // they were last measured (the system is already shown degraded).
        if (!estimate) continue;
        void api.postPlantPosition(plant.id, estimate.x, estimate.y, headingFor(motion.direction)).then((result) => {
          if (cancelled) return;
          if (result.kind === "ok") latest.current.onZonesUpdated(result.zones);
          else if (result.kind === "gone") latest.current.onPlantGone(plant.id);
        });
      }
    }, POSITION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active]);

  return poses;
}

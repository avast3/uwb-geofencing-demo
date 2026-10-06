import { useEffect, useRef } from "react";

const MOVE_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);

interface ControlsProps {
  /** Only capture keys and animate while the simulation is live. */
  active: boolean;
  /** Metres per second. */
  speed?: number;
  /** Called every animation frame with the metre delta to apply. */
  onMove: (dxM: number, dyM: number) => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
}

// Owns WASD / arrow-key capture and turns held keys into a continuous
// velocity, applied every animation frame via onMove. Deliberately knows
// nothing about the worker's actual position — the parent clamps/applies
// the delta — so this component has no stale-closure risk across frames.
export default function Controls({ active, speed = 2.5, onMove }: ControlsProps) {
  const pressedKeys = useRef<Set<string>>(new Set());
  const onMoveRef = useRef(onMove);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (MOVE_KEYS.has(key)) {
        pressedKeys.current.add(key);
        e.preventDefault();
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      pressedKeys.current.delete(e.key.toLowerCase());
    }

    function handleBlur() {
      pressedKeys.current.clear();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    let rafId: number;
    let last = performance.now();

    function tick(now: number) {
      const dt = Math.min((now - last) / 1000, 0.1); // clamp a stalled frame
      last = now;

      const keys = pressedKeys.current;
      let dx = 0;
      let dy = 0;
      if (keys.has("w") || keys.has("arrowup")) dy += 1;
      if (keys.has("s") || keys.has("arrowdown")) dy -= 1;
      if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
      if (keys.has("d") || keys.has("arrowright")) dx += 1;

      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy); // normalise so diagonal isn't faster
        onMoveRef.current((dx / len) * speed * dt, (dy / len) * speed * dt);
      }

      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      cancelAnimationFrame(rafId);
      pressedKeys.current.clear();
    };
  }, [active, speed]);

  if (!active) return null;

  return (
    <div className="controls-hint">
      Move TAG-001: <strong>W A S D</strong> or <strong>Arrow Keys</strong>
    </div>
  );
}

import { metresLengthToPixels, metresToPixels } from "../utils/coordinateTransform";
import { BODY_LENGTH_M, BODY_WIDTH_M } from "../utils/plantMotion";
import type { Direction } from "../utils/plantMotion";
import type { Plant as PlantData } from "../types";

export interface PlantPose {
  x: number;
  y: number;
  direction: Direction;
}

interface PlantProps {
  plant: PlantData;
  pose: PlantPose;
  onPointerDown?: (e: React.PointerEvent) => void;
}

const ROTATION: Record<Direction, number> = { right: 0, down: 90, left: 180, up: -90 };

// Top-down semi-truck (trailer + cab) at its ground-truth position. Drawn
// facing right in a local frame centred on the truck, then rotated so the
// cab leads in the direction of travel.
export default function Plant({ plant, pose, onPointerDown }: PlantProps) {
  const { x, y } = metresToPixels(pose.x, pose.y);
  const length = metresLengthToPixels(BODY_LENGTH_M);
  const width = metresLengthToPixels(BODY_WIDTH_M);
  const cab = length * 0.28;
  const gap = 3;

  return (
    <g transform={`translate(${x}, ${y})`} className="plant" onPointerDown={onPointerDown}>
      <g transform={`rotate(${ROTATION[pose.direction]})`}>
        <rect x={-length / 2} y={-width / 2} width={length - cab - gap} height={width} rx={3} className="plant-trailer" />
        <rect x={length / 2 - cab} y={-width / 2 + 2} width={cab} height={width - 4} rx={4} className="plant-cab" />
        <rect x={length / 2 - 7} y={-width / 2 + 6} width={4} height={width - 12} rx={1} className="plant-windscreen" />
      </g>
      <text x={0} y={4} textAnchor="middle" className="plant-label">
        {plant.name}
      </text>
    </g>
  );
}

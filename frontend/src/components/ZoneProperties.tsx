import type { Zone, ZoneType } from "../types";

interface ZonePropertiesProps {
  zone: Zone | null;
  onRename: (name: string) => void;
  onChangeType: (type: ZoneType) => void;
  onToggleActive: (active: boolean) => void;
}

export default function ZoneProperties({
  zone,
  onRename,
  onChangeType,
  onToggleActive,
}: ZonePropertiesProps) {
  if (!zone) {
    return (
      <div className="properties-panel">
        <h3>ZONE PROPERTIES</h3>
        <p className="properties-empty">No zone selected. Draw a zone, or select one with the Select tool.</p>
      </div>
    );
  }

  return (
    <div className="properties-panel">
      <h3>ZONE PROPERTIES</h3>

      <label className="properties-row">
        <span>Name</span>
        <input
          type="text"
          value={zone.name}
          onChange={(e) => onRename(e.target.value)}
        />
      </label>

      <label className="properties-row">
        <span>Type</span>
        <select value={zone.type} onChange={(e) => onChangeType(e.target.value as ZoneType)}>
          <option value="warning">Warning</option>
          <option value="exclusion">Exclusion</option>
        </select>
      </label>

      <div className="properties-row">
        <span>Shape</span>
        <span className="properties-value">{zone.shape === "rectangle" ? "Rectangle" : "Circle"}</span>
      </div>

      <label className="properties-row">
        <span>Active</span>
        <input
          type="checkbox"
          checked={zone.active}
          onChange={(e) => onToggleActive(e.target.checked)}
        />
      </label>

      {zone.shape === "rectangle" ? (
        <>
          <div className="properties-row">
            <span>Width</span>
            <span className="properties-value">{(zone.xMax - zone.xMin).toFixed(2)} m</span>
          </div>
          <div className="properties-row">
            <span>Height</span>
            <span className="properties-value">{(zone.yMax - zone.yMin).toFixed(2)} m</span>
          </div>
        </>
      ) : (
        <>
          <div className="properties-row">
            <span>Centre</span>
            <span className="properties-value">
              X {zone.centreX.toFixed(2)} m, Y {zone.centreY.toFixed(2)} m
            </span>
          </div>
          <div className="properties-row">
            <span>Radius</span>
            <span className="properties-value">{zone.radius.toFixed(2)} m</span>
          </div>
        </>
      )}
    </div>
  );
}

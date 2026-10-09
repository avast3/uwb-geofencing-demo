import type { Tool } from "../types";

interface ZoneToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  hasSelection: boolean;
  hasZones: boolean;
  onDeleteSelected: () => void;
  onClearAll: () => void;
}

export default function ZoneToolbar({
  tool,
  onToolChange,
  hasSelection,
  hasZones,
  onDeleteSelected,
  onClearAll,
}: ZoneToolbarProps) {
  return (
    <div className="toolbar">
      <button
        className={tool === "select" ? "toolbar-btn active" : "toolbar-btn"}
        onClick={() => onToolChange("select")}
      >
        Select / Edit
      </button>
      <button
        className={tool === "rectangle" ? "toolbar-btn active" : "toolbar-btn"}
        onClick={() => onToolChange("rectangle")}
      >
        Rectangle zone
      </button>
      <button
        className={tool === "circle" ? "toolbar-btn active" : "toolbar-btn"}
        onClick={() => onToolChange("circle")}
      >
        Circle zone
      </button>
      <button
        className={tool === "plant" ? "toolbar-btn active" : "toolbar-btn"}
        onClick={() => onToolChange("plant")}
        title="Click the site to place a semi-truck whose zones move with it"
      >
        Moving plant
      </button>
      <span className="toolbar-divider" />
      <button className="toolbar-btn danger" disabled={!hasSelection} onClick={onDeleteSelected}>
        Delete
      </button>
      <button className="toolbar-btn danger" disabled={!hasZones} onClick={onClearAll}>
        Clear all
      </button>
    </div>
  );
}

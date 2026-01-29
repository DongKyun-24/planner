export default function FilterPanel({
  filterPanelRef,
  editableWindows,
  integratedFilters,
  setIntegratedFilters,
  ui,
  panelFontFamily
}) {
  return (
    <div
      ref={filterPanelRef}
      style={{
        position: "absolute",
        top: 40,
        right: 0,
        width: 230,
        borderRadius: 16,
        border: `1px solid ${ui.border}`,
        background: ui.surface,
        boxShadow: "0 18px 40px rgba(15, 23, 42, 0.3)",
        padding: "12px 14px",
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontFamily: panelFontFamily
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {editableWindows.map((w) => (
          <label
            key={w.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontWeight: 500,
              color: ui.text,
              padding: "4px 10px",
              borderRadius: 8,
              border: `1px solid ${ui.border2}`,
              background: ui.surface2,
              cursor: "pointer",
              fontFamily: panelFontFamily,
              transition: "border-color 120ms ease"
            }}
          >
            <input
              type="checkbox"
              checked={integratedFilters[w.id] !== false}
              onChange={(e) => {
                const next = e.target.checked
                setIntegratedFilters((prev) => ({ ...prev, [w.id]: next }))
              }}
            />
            <span
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontSize: 13
              }}
            >
              {w.title}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

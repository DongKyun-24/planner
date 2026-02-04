export default function DayListModal({
  open,
  onClose,
  readOnly = false,
  ui,
  dayListTitle,
  dayListMode,
  setDayListMode,
  dayListEditText,
  setDayListEditText,
  applyDayListEdit,
  dayListReadItems,
  memoFontPx
}) {
  if (!open) return null
  const effectiveMode = readOnly ? "read" : dayListMode

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 200
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 92vw)",
          maxHeight: "80vh",
          background: ui.surface,
          color: ui.text,
          borderRadius: 12,
          border: `1px solid ${ui.border}`,
          boxShadow: ui.shadow,
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontWeight: 900 }}>{dayListTitle}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => setDayListMode("read")}
              style={{
                height: 28,
                padding: "0 10px",
                borderRadius: 8,
                border: `1px solid ${ui.border}`,
                background: effectiveMode === "read" ? ui.accent : ui.surface,
                color: effectiveMode === "read" ? "#fff" : ui.text,
                cursor: "pointer",
                fontWeight: 800
              }}
            >
              Read
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setDayListMode("edit")}
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 8,
                  border: `1px solid ${ui.border}`,
                  background: effectiveMode === "edit" ? ui.accent : ui.surface,
                  color: effectiveMode === "edit" ? "#fff" : ui.text,
                  cursor: "pointer",
                  fontWeight: 800
                }}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                height: 28,
                padding: "0 10px",
                borderRadius: 8,
                border: `1px solid ${ui.border}`,
                background: ui.surface2,
                color: ui.text,
                cursor: "pointer",
                fontWeight: 800
              }}
            >
              Close
            </button>
          </div>
        </div>

        {effectiveMode === "edit" ? (
          <textarea
            value={dayListEditText}
            onChange={(e) => {
              const next = e.target.value
              setDayListEditText(next)
              applyDayListEdit(next)
            }}
            placeholder="Type your schedule notes"
            style={{
              marginTop: 10,
              width: "100%",
              minHeight: 260,
              maxHeight: "60vh",
              padding: "10px 12px",
              borderRadius: 10,
              border: `1px solid ${ui.border2}`,
              background: ui.surface2,
              color: ui.text,
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: "inherit",
              fontWeight: 600,
              resize: "vertical"
            }}
          />
        ) : (
          <div
            style={{
              marginTop: 10,
              width: "100%",
              minHeight: 260,
              maxHeight: "60vh",
              padding: "12px",
              borderRadius: 10,
              border: `1px solid ${ui.border}`,
              background: ui.surface,
              color: ui.text,
              fontSize: memoFontPx,
              lineHeight: 1.25,
              fontFamily: "inherit",
              fontWeight: 400,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 2
            }}
          >
            {dayListReadItems ? (
              dayListReadItems.isAll ? (
                <>
                  {dayListReadItems.timedItems.map((item, idx) => (
                    <div key={`daylist-timed-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      {item.time} {item.title ? `[${item.title}] ` : ""}
                      {item.text}
                    </div>
                  ))}
                  {dayListReadItems.noTimeGroupItems.map((item, idx) => (
                    <div key={`daylist-group-notime-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      [{item.title}] {item.text}
                    </div>
                  ))}
                  {dayListReadItems.general.map((line, idx) => (
                    <div key={`daylist-general-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      {line}
                    </div>
                  ))}
                  {dayListReadItems.general.length === 0 &&
                    dayListReadItems.noTimeGroupItems.length === 0 &&
                    dayListReadItems.timedItems.length === 0 && <div style={{ color: ui.text2 }}>No content.</div>}
                </>
              ) : (
                <>
                  {dayListReadItems.timedItems.map((item, idx) => (
                    <div key={`daylist-timed-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      {item.time} {item.text}
                    </div>
                  ))}
                  {dayListReadItems.noTimeItems.map((line, idx) => (
                    <div key={`daylist-notime-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      {line}
                    </div>
                  ))}
                  {dayListReadItems.noTimeItems.length === 0 && dayListReadItems.timedItems.length === 0 && (
                    <div style={{ color: ui.text2 }}>No content.</div>
                  )}
                </>
              )
            ) : (
              <span style={{ color: ui.text2 }}>No content.</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

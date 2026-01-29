export default function DayListModal({
  open,
  onClose,
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
                background: dayListMode === "read" ? ui.accent : ui.surface,
                color: dayListMode === "read" ? "#fff" : ui.text,
                cursor: "pointer",
                fontWeight: 800
              }}
            >
              읽기모드
            </button>
            <button
              type="button"
              onClick={() => setDayListMode("edit")}
              style={{
                height: 28,
                padding: "0 10px",
                borderRadius: 8,
                border: `1px solid ${ui.border}`,
                background: dayListMode === "edit" ? ui.accent : ui.surface,
                color: dayListMode === "edit" ? "#fff" : ui.text,
                cursor: "pointer",
                fontWeight: 800
              }}
            >
              편집모드
            </button>
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
              닫기
            </button>
          </div>
        </div>
        {dayListMode === "edit" ? (
          <textarea
            value={dayListEditText}
            onChange={(e) => {
              const next = e.target.value
              setDayListEditText(next)
              applyDayListEdit(next)
            }}
            placeholder="할 일을 입력하세요"
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
                  {dayListReadItems.general.map((line, idx) => (
                    <div key={`daylist-general-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      {line}
                    </div>
                  ))}
                  {dayListReadItems.noTimeGroupItems.map((item, idx) => (
                    <div key={`daylist-group-notime-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      [{item.title}] {item.text}
                    </div>
                  ))}
                  {dayListReadItems.timedItems.map((item, idx) => (
                    <div key={`daylist-timed-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      {item.time} {item.title ? `[${item.title}] ` : ""}{item.text}
                    </div>
                  ))}
                  {dayListReadItems.general.length === 0 &&
                    dayListReadItems.noTimeGroupItems.length === 0 &&
                    dayListReadItems.timedItems.length === 0 && <div style={{ color: ui.text2 }}>내용이 없습니다.</div>}
                </>
              ) : (
                <>
                  {dayListReadItems.noTimeItems.map((line, idx) => (
                    <div key={`daylist-notime-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      {line}
                    </div>
                  ))}
                  {dayListReadItems.timedItems.map((item, idx) => (
                    <div key={`daylist-timed-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      {item.time} {item.text}
                    </div>
                  ))}
                  {dayListReadItems.noTimeItems.length === 0 && dayListReadItems.timedItems.length === 0 && (
                    <div style={{ color: ui.text2 }}>내용이 없습니다.</div>
                  )}
                </>
              )
            ) : (
              <span style={{ color: ui.text2 }}>내용이 없습니다.</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

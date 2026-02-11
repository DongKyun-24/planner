import ThemeToggle from "./ThemeToggle"

export default function SettingsPanel({
  settingsPanelRef,
  ui,
  panelFontFamily,
  settingsRowStyle,
  settingsLabelTextStyle,
  settingsNumberInput,
  theme,
  setTheme,
  FONT_MIN,
  FONT_MAX,
  CALENDAR_FONT_MIN,
  CALENDAR_FONT_MAX,
  tabFontInput,
  setTabFontInput,
  tabFontPx,
  setTabFontPx,
  memoFontInput,
  setMemoFontInput,
  memoFontPx,
  setMemoFontPx,
  calendarFontInput,
  setCalendarFontInput,
  calendarFontPx,
  setCalendarFontPx,
  showLogout = false,
  onSignOut,
  onClose
}) {
  return (
    <div
      ref={settingsPanelRef}
      style={{
        position: "absolute",
        top: 48,
        right: 12,
        width: 202,
        borderRadius: 16,
        border: `1px solid ${ui.border}`,
        background: ui.surface,
        boxShadow: "0 10px 28px rgba(15, 23, 42, 0.25)",
        padding: "10px 12px",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontFamily: panelFontFamily,
        color: ui.text
      }}
    >
      <div style={settingsRowStyle}>
        <div style={settingsLabelTextStyle}>테마</div>
        <ThemeToggle compact theme={theme} ui={ui} setTheme={setTheme} />
      </div>

      <div style={settingsRowStyle}>
        <div style={settingsLabelTextStyle}>제목</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number"
            inputMode="numeric"
            min={FONT_MIN}
            max={FONT_MAX}
            value={tabFontInput}
            onChange={(e) => {
              const raw = e.target.value
              setTabFontInput(raw)
              if (raw.trim() === "") return
              const n = Number(raw)
              if (!Number.isFinite(n)) return
              setTabFontPx(n)
            }}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) {
                setTabFontInput(String(tabFontPx))
                return
              }
              const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, n))
              setTabFontPx(clamped)
              setTabFontInput(String(clamped))
            }}
            style={{ ...settingsNumberInput, width: 48 }}
            title="탭 글씨 크기(px)"
          />
          <div style={{ fontSize: 12, fontWeight: 700, color: ui.text2 }}>px</div>
        </div>
      </div>

      <div style={settingsRowStyle}>
        <div style={settingsLabelTextStyle}>본문</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number"
            inputMode="numeric"
            min={FONT_MIN}
            max={FONT_MAX}
            value={memoFontInput}
            onChange={(e) => {
              const raw = e.target.value
              setMemoFontInput(raw)
              if (raw.trim() === "") return
              const n = Number(raw)
              if (!Number.isFinite(n)) return
              setMemoFontPx(n)
            }}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) {
                setMemoFontInput(String(memoFontPx))
                return
              }
              const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, n))
              setMemoFontPx(clamped)
              setMemoFontInput(String(clamped))
            }}
            style={{ ...settingsNumberInput, width: 48 }}
            title="본문 글씨 크기(px)"
          />
          <div style={{ fontSize: 12, fontWeight: 700, color: ui.text2 }}>px</div>
        </div>
      </div>

      <div style={settingsRowStyle}>
        <div style={settingsLabelTextStyle}>Calendar</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number"
            inputMode="numeric"
            min={CALENDAR_FONT_MIN}
            max={CALENDAR_FONT_MAX}
            value={calendarFontInput}
            onChange={(e) => {
              const raw = e.target.value
              setCalendarFontInput(raw)
              if (raw.trim() === "") return
              const n = Number(raw)
              if (!Number.isFinite(n)) return
              setCalendarFontPx(n)
            }}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) {
                setCalendarFontInput(String(calendarFontPx))
                return
              }
              const clamped = Math.max(CALENDAR_FONT_MIN, Math.min(CALENDAR_FONT_MAX, n))
              setCalendarFontPx(clamped)
              setCalendarFontInput(String(clamped))
            }}
            style={{ ...settingsNumberInput, width: 48 }}
            title="Calendar font size (px)"
          />
          <div style={{ fontSize: 12, fontWeight: 700, color: ui.text2 }}>px</div>
        </div>
      </div>

      {showLogout ? (
        <button
          type="button"
          onClick={onSignOut}
          style={{
            width: "100%",
            height: 30,
            borderRadius: 10,
            border: `1px solid ${ui.border}`,
            background: ui.surface2,
            color: "#ef4444",
            cursor: "pointer",
            fontWeight: 700,
            fontFamily: panelFontFamily
          }}
        >
          로그아웃
        </button>
      ) : null}

      <button
        type="button"
        onClick={onClose}
        style={{
          width: "100%",
          height: 30,
          borderRadius: 10,
          border: `1px solid ${ui.border}`,
          background: ui.surface2,
          color: ui.text,
          cursor: "pointer",
          fontWeight: 600,
          fontFamily: panelFontFamily,
          letterSpacing: "0.04em"
        }}
      >
        닫기
      </button>
    </div>
  )
}

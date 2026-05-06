import ThemeToggle from "./ThemeToggle"

function FontSizeRow({
  label,
  min,
  max,
  value,
  setValue,
  fontPx,
  setFontPx,
  settingsRowStyle,
  settingsLabelTextStyle,
  settingsNumberInput,
  title,
  ui
}) {
  function applyFontSize(nextValue) {
    const next = Number(nextValue)
    if (!Number.isFinite(next)) return
    const clamped = Math.max(min, Math.min(max, next))
    setFontPx(clamped)
    setValue(String(clamped))
  }

  function stepFontSize(delta) {
    const current = Number(value)
    const base = Number.isFinite(current) ? current : fontPx
    applyFontSize(base + delta)
  }

  return (
    <div style={settingsRowStyle}>
      <div style={settingsLabelTextStyle}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <input
            type="text"
            inputMode="numeric"
            value={value}
            onChange={(e) => {
              const raw = e.target.value
              setValue(raw)
              if (raw.trim() === "") return
              const next = Number(raw)
              if (!Number.isFinite(next)) return
              setFontPx(Math.max(min, Math.min(max, next)))
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault()
                stepFontSize(1)
              } else if (e.key === "ArrowDown") {
                e.preventDefault()
                stepFontSize(-1)
              }
            }}
            onBlur={(e) => {
              const next = Number(e.target.value)
              if (!Number.isFinite(next)) {
                setValue(String(fontPx))
                return
              }
              applyFontSize(next)
            }}
            className="settings-font-input"
            style={{
              ...settingsNumberInput,
              width: 62,
              height: 28,
              borderRadius: 9,
              padding: "0 22px 0 8px",
              fontSize: 13,
              fontWeight: 850,
              textAlign: "center"
            }}
            title={title}
          />
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 2,
              top: "50%",
              transform: "translateY(-50%)",
              display: "inline-flex",
              flexDirection: "column",
              gap: 1
            }}
          >
            <button
              type="button"
              tabIndex={-1}
              className="settings-font-step"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => stepFontSize(1)}
              style={{
                width: 18,
                height: 13,
                padding: 0,
                border: "none",
                background: "transparent",
                color: ui.text2,
                opacity: 0.62,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                lineHeight: 0,
                borderRadius: 5,
                outline: "none",
                transition: "background 120ms ease, color 120ms ease, opacity 120ms ease"
              }}
              title={`${label} 크게`}
            >
              <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
                <path d="M3 8l4-5 4 5z" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="settings-font-step"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => stepFontSize(-1)}
              style={{
                width: 18,
                height: 13,
                padding: 0,
                border: "none",
                background: "transparent",
                color: ui.text2,
                opacity: 0.62,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                lineHeight: 0,
                borderRadius: 5,
                outline: "none",
                transition: "background 120ms ease, color 120ms ease, opacity 120ms ease"
              }}
              title={`${label} 작게`}
            >
              <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
                <path d="M3 4l4 5 4-5z" fill="currentColor" />
              </svg>
            </button>
          </span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: ui.text2 }}>px</div>
      </div>
    </div>
  )
}

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
  memoTabFontInput,
  setMemoTabFontInput,
  memoTabFontPx,
  setMemoTabFontPx,
  memoBodyFontInput,
  setMemoBodyFontInput,
  memoBodyFontPx,
  setMemoBodyFontPx,
  calendarFontInput,
  setCalendarFontInput,
  calendarFontPx,
  setCalendarFontPx,
  showLogout = false,
  onSignOut,
  onDeleteAccount,
  deleteAccountLoading = false,
  onClose
}) {
  return (
    <div
      ref={settingsPanelRef}
      style={{
        position: "absolute",
        top: 48,
        right: 12,
        width: 228,
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
        color: ui.text,
        "--settings-focus": ui.accent,
        "--settings-focus-soft": theme === "dark" ? "rgba(96, 165, 250, 0.16)" : "rgba(59, 130, 246, 0.12)",
        "--settings-step-hover-bg": theme === "dark" ? "rgba(148, 163, 184, 0.16)" : "rgba(226, 232, 240, 0.82)",
        "--settings-step-hover-color": ui.text
      }}
    >
      <style>{`
        .settings-font-input:focus {
          outline: none !important;
          border-color: var(--settings-focus) !important;
          box-shadow: 0 0 0 3px var(--settings-focus-soft) !important;
        }
        .settings-font-step:hover {
          opacity: 1 !important;
          background: var(--settings-step-hover-bg) !important;
          color: var(--settings-step-hover-color) !important;
        }
        .settings-font-step:focus {
          outline: none !important;
        }
        .settings-font-step:active {
          transform: translateY(0.5px);
        }
      `}</style>
      <div style={settingsRowStyle}>
        <div style={settingsLabelTextStyle}>테마</div>
        <ThemeToggle compact theme={theme} ui={ui} setTheme={setTheme} />
      </div>

      <FontSizeRow
        label="탭"
        min={FONT_MIN}
        max={FONT_MAX}
        value={tabFontInput}
        setValue={setTabFontInput}
        fontPx={tabFontPx}
        setFontPx={setTabFontPx}
        settingsRowStyle={settingsRowStyle}
        settingsLabelTextStyle={settingsLabelTextStyle}
        settingsNumberInput={settingsNumberInput}
        title="탭 글씨 크기(px)"
        ui={ui}
      />

      <FontSizeRow
        label="일정"
        min={FONT_MIN}
        max={FONT_MAX}
        value={memoFontInput}
        setValue={setMemoFontInput}
        fontPx={memoFontPx}
        setFontPx={setMemoFontPx}
        settingsRowStyle={settingsRowStyle}
        settingsLabelTextStyle={settingsLabelTextStyle}
        settingsNumberInput={settingsNumberInput}
        title="일정 글씨 크기(px)"
        ui={ui}
      />

      <FontSizeRow
        label="메모 탭"
        min={FONT_MIN}
        max={FONT_MAX}
        value={memoTabFontInput}
        setValue={setMemoTabFontInput}
        fontPx={memoTabFontPx}
        setFontPx={setMemoTabFontPx}
        settingsRowStyle={settingsRowStyle}
        settingsLabelTextStyle={settingsLabelTextStyle}
        settingsNumberInput={settingsNumberInput}
        title="메모 탭 글씨 크기(px)"
        ui={ui}
      />

      <FontSizeRow
        label="메모 본문"
        min={FONT_MIN}
        max={FONT_MAX}
        value={memoBodyFontInput}
        setValue={setMemoBodyFontInput}
        fontPx={memoBodyFontPx}
        setFontPx={setMemoBodyFontPx}
        settingsRowStyle={settingsRowStyle}
        settingsLabelTextStyle={settingsLabelTextStyle}
        settingsNumberInput={settingsNumberInput}
        title="메모 본문 글씨 크기(px)"
        ui={ui}
      />

      <FontSizeRow
        label="캘린더"
        min={CALENDAR_FONT_MIN}
        max={CALENDAR_FONT_MAX}
        value={calendarFontInput}
        setValue={setCalendarFontInput}
        fontPx={calendarFontPx}
        setFontPx={setCalendarFontPx}
        settingsRowStyle={settingsRowStyle}
        settingsLabelTextStyle={settingsLabelTextStyle}
        settingsNumberInput={settingsNumberInput}
        title="캘린더 글씨 크기(px)"
        ui={ui}
      />

      {showLogout ? (
        <>
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

          {typeof onDeleteAccount === "function" ? (
            <button
              type="button"
              onClick={onDeleteAccount}
              disabled={deleteAccountLoading}
              style={{
                width: "100%",
                height: 32,
                borderRadius: 10,
                border: "1px solid rgba(239, 68, 68, 0.34)",
                background: theme === "dark" ? "rgba(127, 29, 29, 0.18)" : "#fef2f2",
                color: "#dc2626",
                cursor: deleteAccountLoading ? "default" : "pointer",
                fontWeight: 800,
                fontFamily: panelFontFamily,
                opacity: deleteAccountLoading ? 0.65 : 1
              }}
            >
              {deleteAccountLoading ? "탈퇴 중..." : "계정 탈퇴"}
            </button>
          ) : null}

        </>
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

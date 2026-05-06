export default function MonthNavigator({
  ymYear,
  setYmYear,
  ymMonth,
  setYmMonth,
  goPrevMonth,
  goNextMonth,
  ui,
  labelPrefix = ""
}) {
  const safeMonth = Number(ymMonth) || 1
  const prefix = labelPrefix ? `${labelPrefix} ` : ""
  const shellBackground = `linear-gradient(180deg, ${ui.surface}, ${ui.surface2})`
  function stepYear(delta) {
    const current = Number(ymYear)
    const base = Number.isFinite(current) ? current : new Date().getFullYear()
    setYmYear(base + delta)
  }

  const buttonStyle = {
    width: 34,
    height: 34,
    borderRadius: 6,
    border: `1px solid ${ui.border}`,
    background: shellBackground,
    color: ui.text,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    cursor: "pointer",
    flexShrink: 0,
    boxShadow: "0 1px 0 rgba(15, 23, 42, 0.04)"
  }
  const chevronStyle = {
    width: 18,
    height: 18,
    stroke: "currentColor",
    strokeWidth: 2.35,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    fill: "none"
  }

  return (
    <div
      className="month-navigator"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        flexShrink: 0
      }}
    >
      <button
        type="button"
        onClick={goPrevMonth}
        className="month-nav-button no-hover-outline"
        style={buttonStyle}
        title={`${prefix}previous month`}
        aria-label={`${prefix}previous month`}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" style={chevronStyle}>
          <path d="M12.3 4.6 6.9 10l5.4 5.4" />
        </svg>
      </button>

      <div
        className="month-nav-center"
        style={{
          height: 34,
          minWidth: 160,
          border: `1px solid ${ui.border}`,
          borderRadius: 6,
          background: shellBackground,
          color: ui.text,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          gap: 0,
          overflow: "hidden",
          boxShadow: "0 1px 0 rgba(15, 23, 42, 0.04)"
        }}
      >
        <label
          className="month-nav-year-segment"
          style={{
            position: "relative",
            width: 86,
            height: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            flexShrink: 0
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: "relative",
              zIndex: 2,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              color: ui.text,
              fontSize: 16,
              fontWeight: 780,
              lineHeight: "18px",
              pointerEvents: "none"
            }}
          >
            <span
              style={{
                minWidth: 40,
                textAlign: "right",
                lineHeight: "18px"
              }}
            >
              {ymYear}
            </span>
            <span
              style={{
                position: "relative",
                width: 20,
                height: 18,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                pointerEvents: "auto"
              }}
            >
              <span
                className="month-nav-year-unit-text"
                style={{
                  fontSize: 13,
                  fontWeight: 620,
                  color: ui.text2,
                  lineHeight: "18px"
                }}
              >
                {"\uB144"}
              </span>
              <span
                className="month-nav-year-arrows"
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  transform: "translateX(3px)",
                  display: "inline-flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: 0,
                  pointerEvents: "none"
                }}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    stepYear(1)
                  }}
                  className="month-nav-year-arrow no-hover-outline"
                  style={{
                    width: 22,
                    height: 11,
                    border: 0,
                    padding: 0,
                    background: "transparent",
                    color: ui.text2,
                    cursor: "pointer",
                    lineHeight: 0
                  }}
                >
                  <svg width="20" height="9" viewBox="0 0 20 9" aria-hidden="true">
                    <path d="M5 6 10 2l5 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    stepYear(-1)
                  }}
                  className="month-nav-year-arrow no-hover-outline"
                  style={{
                    width: 22,
                    height: 11,
                    border: 0,
                    padding: 0,
                    background: "transparent",
                    color: ui.text2,
                    cursor: "pointer",
                    lineHeight: 0
                  }}
                >
                  <svg width="20" height="9" viewBox="0 0 20 9" aria-hidden="true">
                    <path d="M5 3 10 7l5-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </span>
            </span>
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={ymYear}
            onChange={(e) => setYmYear(e.target.value)}
            className="month-nav-field no-hover-outline"
            aria-label={`${prefix}year`}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 1,
              width: "100%",
              height: "100%",
              border: "1px solid transparent",
              background: "transparent",
              color: "transparent",
              outline: "none",
              padding: 0,
              textAlign: "center",
              fontFamily: "inherit",
              fontSize: 16,
              fontWeight: 780,
              letterSpacing: 0,
              lineHeight: 1,
              cursor: "text",
              caretColor: ui.text,
              opacity: 0.01
            }}
          />
        </label>

        <span
          aria-hidden="true"
          style={{
            alignSelf: "stretch",
            width: 1,
            background: ui.border,
            flexShrink: 0
          }}
        />

        <label
          className="month-nav-month-segment"
          style={{
            position: "relative",
            width: 72,
            height: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            flexShrink: 0
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              color: ui.text,
              fontSize: 16,
              fontWeight: 780,
              lineHeight: "18px",
              pointerEvents: "none"
            }}
          >
            <span style={{ lineHeight: "18px" }}>{safeMonth}</span>
            <span
              style={{
                position: "relative",
                width: 20,
                height: 18,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}
            >
              <span
                className="month-nav-month-unit-text"
                style={{
                  fontSize: 13,
                  fontWeight: 620,
                  color: ui.text2,
                  lineHeight: "18px"
                }}
              >
                {"\uC6D4"}
              </span>
              <span
                className="month-nav-month-arrow"
                style={{
                  position: "absolute",
                  inset: 0,
                  transform: "translateX(5px)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: 0,
                  color: ui.text2,
                  lineHeight: 0
                }}
              >
                <svg width="20" height="9" viewBox="0 0 20 9" aria-hidden="true">
                  <path d="M5 3 10 7l5-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </span>
          </span>
          <select
            value={safeMonth}
            onChange={(e) => setYmMonth(Number(e.target.value))}
            className="month-nav-select no-hover-outline"
            aria-label={`${prefix}month`}
            style={{
              position: "absolute",
              inset: 0,
              height: "100%",
              width: "100%",
              border: "1px solid transparent",
              background: "transparent",
              color: "transparent",
              outline: "none",
              padding: 0,
              textAlign: "center",
              textAlignLast: "center",
              appearance: "none",
              WebkitAppearance: "none",
              MozAppearance: "none",
              fontFamily: "inherit",
              fontSize: 16,
              fontWeight: 780,
              letterSpacing: 0,
              lineHeight: 1,
              cursor: "pointer",
              opacity: 0.01
            }}
          >
            {Array.from({ length: 12 }).map((_, i) => {
              const m = i + 1
              return (
                <option key={m} value={m}>
                  {`${m}\uC6D4`}
                </option>
              )
            })}
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={goNextMonth}
        className="month-nav-button no-hover-outline"
        style={buttonStyle}
        title={`${prefix}next month`}
        aria-label={`${prefix}next month`}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" style={chevronStyle}>
          <path d="M7.7 4.6 13.1 10l-5.4 5.4" />
        </svg>
      </button>
    </div>
  )
}

import { dayOfWeek } from "../utils/dateUtils"
import { getHolidayName } from "../utils/holiday"

export default function CalendarPanel({
  calendarPanelRef,
  calendarTopRef,
  calendarBodyRef,
  ymYear,
  setYmYear,
  ymMonth,
  setYmMonth,
  goPrevMonth,
  goNextMonth,
  layoutPreset,
  outerCollapsed,
  setLayoutPreset,
  pillButton,
  controlInput,
  arrowButton,
  ui,
  calendarCellH,
  firstWeekday,
  weeks,
  lastDay,
  itemsByDate,
  selectedDateKey,
  todayKey,
  highlightTokens,
  theme,
  viewYear,
  viewMonth,
  openDayList,
  handleDayClick,
  calendarInteractingRef,
  goToday
}) {
  return (
    <div
      ref={calendarPanelRef}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        minHeight: 0,
        borderRadius: 8,
        background: ui.surface,
        fontFamily: "inherit",
        border: `1px solid ${ui.border}`,
        boxShadow: ui.shadow,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <div
        ref={calendarTopRef}
        style={{
          padding: "8px 12px",
          borderBottom: `1px solid ${ui.border}`,
          background: ui.surface2
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            minWidth: 0
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <input
                type="number"
                value={ymYear}
                onChange={(e) => setYmYear(e.target.value)}
                className="calendar-ym-control"
                style={{ ...controlInput, width: 76, padding: "0 24px 0 10px" }}
                aria-label="연도 입력"
              />
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  right: 2,
                  top: "50%",
                  marginTop: 0.5,
                  transform: "translateY(-50%)",
                  display: "inline-flex",
                  flexDirection: "column",
                  gap: 0
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    const next = Number(ymYear)
                    setYmYear(Number.isFinite(next) ? next + 1 : viewYear + 1)
                  }}
                  className="no-hover-outline ym-spin-button"
                  style={{
                    width: 22,
                    height: 20,
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    color: ui.text2,
                    opacity: 0.6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    lineHeight: 0,
                    marginBottom: -5
                  }}
                  aria-label="연도 증가"
                >
                  <svg width="22" height="20" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M5 12l5-6 5 6z" fill="currentColor" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = Number(ymYear)
                    setYmYear(Number.isFinite(next) ? next - 1 : viewYear - 1)
                  }}
                  className="no-hover-outline ym-spin-button"
                  style={{
                    width: 22,
                    height: 20,
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    color: ui.text2,
                    opacity: 0.6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    lineHeight: 0,
                    marginTop: -5
                  }}
                  aria-label="연도 감소"
                >
                  <svg width="22" height="20" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M5 8l5 6 5-6z" fill="currentColor" />
                  </svg>
                </button>
              </span>
            </div>
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <select
                value={ymMonth}
                onChange={(e) => setYmMonth(Number(e.target.value))}
                className="calendar-ym-control"
                style={{
                  ...controlInput,
                  width: 72,
                  padding: "0 20px 0 18px",
                  appearance: "none",
                  WebkitAppearance: "none",
                  MozAppearance: "none"
                }}
                aria-label="월 선택"
              >
                {Array.from({ length: 12 }).map((_, i) => {
                  const m = i + 1
                  return (
                    <option key={m} value={m}>
                      {m}월
                    </option>
                  )
                })}
              </select>
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  right: 2,
                  top: "50%",
                  marginTop: 0,
                  transform: "translateY(-50%)",
                  pointerEvents: "none",
                  color: ui.text2,
                  opacity: 0.5
                }}
              >
                <svg width="18" height="12" viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M4 7l6 6 6-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </div>

            <button
              onClick={goToday}
              style={{ ...pillButton, padding: "0 10px 2px", borderRadius: 12, lineHeight: 1 }}
              title="오늘로 이동"
              aria-label="오늘로 이동"
            >
              Today
            </button>

            <button onClick={goPrevMonth} className="arrow-button" style={arrowButton} title="이전 달" aria-label="이전 달">
              ◀
            </button>
            <button onClick={goNextMonth} className="arrow-button" style={arrowButton} title="다음 달" aria-label="다음 달">
              ▶
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {(layoutPreset === "calendar-left" || outerCollapsed === "left") && (
              <button
                onClick={() => setLayoutPreset((p) => (p === "memo-left" ? "calendar-left" : "memo-left"))}
                style={{ ...pillButton, padding: "0 10px" }}
                title="메모/달력 위치 변경"
                aria-label="메모/달력 위치 변경"
              >
                ⇆
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        ref={calendarBodyRef}
        style={{
          padding: 6,
          overflow: "auto",
          minHeight: 0
        }}
      >
        <div
          style={{
            border: `1px solid ${ui.border2}`,
            borderRadius: 8,
            overflow: "hidden",
            background: ui.surface
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 0,
              fontWeight: 800,
              color: ui.text2,
              fontSize: 11,
              textAlign: "center",
              userSelect: "none",
              background: ui.surface2
            }}
          >
            {[
              { label: "Sun", color: ui.holiday },
              { label: "Mon", color: ui.text2 },
              { label: "Tue", color: ui.text2 },
              { label: "Wed", color: ui.text2 },
              { label: "Thu", color: ui.text2 },
              { label: "Fri", color: ui.text2 },
              { label: "Sat", color: ui.saturday }
            ].map((w, i) => (
              <div
                key={`weekday-${i}`}
                style={{
                  padding: "4px 0 6px",
                  lineHeight: 1,
                  borderRight: i % 7 === 6 ? "none" : `1px solid ${ui.border2}`,
                  borderBottom: "none",
                  color: w.color
                }}
              >
                {w.label}
              </div>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 0,
              gridAutoRows: `${calendarCellH}px`
            }}
          >
            {Array.from({ length: firstWeekday }).map((_, i) => {
              const col = i % 7
              const row = Math.floor(i / 7)
              const isLastCol = col === 6
              const isLastRow = row === weeks - 1
              return (
                <div
                  key={`empty-${i}`}
                  style={{
                    borderRight: isLastCol ? "none" : `1px solid ${ui.border2}`,
                    borderBottom: isLastRow ? "none" : `1px solid ${ui.border2}`,
                    background: ui.surface
                  }}
                />
              )
            })}

            {Array.from({ length: lastDay }).map((_, i) => {
              const day = i + 1
              const key = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`
              const cellIndex = firstWeekday + i
              const col = cellIndex % 7
              const row = Math.floor(cellIndex / 7)
              const isLastCol = col === 6
              const isLastRow = row === weeks - 1

              const items = itemsByDate[key] || []
              const itemLineH = 14
              const headerH = 28
              const maxItems = Math.max(1, Math.floor((calendarCellH - headerH) / itemLineH))
              const visibleCount = Math.min(items.length, maxItems)
              const recent = visibleCount > 0 ? items.slice(0, visibleCount) : []
              const hiddenCount = items.length - visibleCount

              const isSelected = selectedDateKey === key
              const isToday = key === todayKey

              const dow = dayOfWeek(viewYear, viewMonth, day)
              const holidayName = getHolidayName(viewYear, viewMonth, day)
              const isHoliday = Boolean(holidayName)
              const isSunday = dow === 0
              const isSaturday = dow === 6

              const bgColor = isSelected
                ? highlightTokens.selected.soft
                : isToday
                  ? highlightTokens.today.soft
                  : ui.surface

              const dayColor = isHoliday || isSunday ? ui.holiday : isSaturday ? ui.saturday : ui.text

              return (
                <div
                  key={key}
                  className="calendar-day-cell"
                  onPointerDown={() => {
                    if (calendarInteractingRef?.current != null) calendarInteractingRef.current = true
                  }}
                  onPointerUp={() => {
                    setTimeout(() => {
                      if (calendarInteractingRef?.current != null) calendarInteractingRef.current = false
                    }, 0)
                  }}
                  onPointerCancel={() => {
                    if (calendarInteractingRef?.current != null) calendarInteractingRef.current = false
                  }}
                  onClick={() => handleDayClick(day)}
                  style={{
                    borderRight: isLastCol ? "none" : `1px solid ${ui.border2}`,
                    borderBottom: isLastRow ? "none" : `1px solid ${ui.border2}`,
                    borderRadius: 0,
                    padding: "2px 4px",
                    boxSizing: "border-box",
                    overflow: "hidden",
                    cursor: "pointer",
                    userSelect: "none",
                    background: bgColor,
                    boxShadow: isSelected
                      ? theme === "dark"
                        ? "0 0 0 1px rgba(96,165,250,0.22)"
                        : "0 2px 10px rgba(37, 99, 235, 0.12)"
                      : "none",
                    transition: "transform 80ms ease, box-shadow 120ms ease, background 120ms ease",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 0
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-1px)"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0px)"
                  }}
                >
                  {isSelected && (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 2,
                        background: highlightTokens.selected.ring
                      }}
                    />
                  )}

                  {isToday && !isSelected && (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 2,
                        background: highlightTokens.today.ring,
                        opacity: 0.9
                      }}
                    />
                  )}

                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 8
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 900,
                          fontSize: 11,
                          color: dayColor,
                          lineHeight: 1,
                          marginTop: 0
                        }}
                      >
                        {day}
                      </div>
                      {holidayName ? (
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 900,
                            color: ui.holiday,
                            lineHeight: 1,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: 60
                          }}
                          title={holidayName}
                        >
                          {holidayName}
                        </div>
                      ) : null}
                    </div>

                    {items.length > 0 ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openDayList(key, items)
                        }}
                        style={{
                          fontSize: 10,
                          fontWeight: 900,
                          padding: "1px 6px",
                          borderRadius: 999,
                          border: `1px solid ${ui.border}`,
                          background: ui.surface,
                          color: ui.text2,
                          flexShrink: 0,
                          cursor: "pointer"
                        }}
                        title={hiddenCount > 0 ? "전체 일정 보기" : "메모 항목 보기"}
                      >
                        {items.length}개
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openDayList(key, items)
                        }}
                        style={{
                          fontSize: 10,
                          fontWeight: 900,
                          padding: "1px 6px",
                          borderRadius: 999,
                          border: `1px solid ${ui.border}`,
                          background: ui.surface,
                          color: ui.text2,
                          flexShrink: 0,
                          cursor: "pointer"
                        }}
                        title="메모 추가"
                      >
                        +
                      </button>
                    )}
                  </div>

                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 10,
                      lineHeight: 1.2,
                      color: ui.text,
                      minWidth: 0
                    }}
                  >
                    {recent.map((it) => (
                      <div
                        key={it.id}
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          minWidth: 0
                        }}
                      >
                        {it.color && (
                          <span
                            title={it.sourceTitle ? `[${it.sourceTitle}]` : "항목"}
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 999,
                              background: it.color,
                              flexShrink: 0,
                              marginTop: 0
                            }}
                          />
                        )}
                        {it.time ? (
                          <span style={{ color: ui.text2, fontWeight: 900, flexShrink: 0, fontSize: 9 }}>
                            {it.time}
                          </span>
                        ) : null}
                        <span style={{ fontWeight: 650, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {it.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

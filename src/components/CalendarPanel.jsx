import { dayOfWeek } from "../utils/dateUtils"
import { getHolidayName } from "../utils/holiday"
import { useEffect, useRef, useState } from "react"
import MonthNavigator from "./MonthNavigator"

const TASK_RING_BLUE = "#3b82f6"
const PLANNER_DND_MIME = "application/x-planner-item"
const TASK_CHECK_GLYPH_STYLE = {
  display: "inline-block",
  fontSize: 10,
  fontWeight: 900,
  lineHeight: 1,
  transform: "rotate(-12deg) translate(1px, -1px)",
  transformOrigin: "center",
  pointerEvents: "none"
}

function TaskTimeGlyph({ color = "#64748b", size = 8 }) {
  const safeSize = Math.max(7, Number(size) || 8)
  const handThickness = Math.max(1, safeSize * 0.12)
  return (
    <span
      aria-hidden="true"
      style={{
        width: safeSize,
        height: safeSize,
        borderRadius: 999,
        border: `${Math.max(1, safeSize * 0.12)}px solid ${color}`,
        boxSizing: "border-box",
        display: "inline-block",
        position: "relative",
        pointerEvents: "none"
      }}
    >
      <span
        style={{
          position: "absolute",
          width: handThickness,
          height: Math.max(2.2, safeSize * 0.34),
          borderRadius: 999,
          background: color,
          top: safeSize * 0.18,
          left: "50%",
          transform: "translateX(-50%)"
        }}
      />
      <span
        style={{
          position: "absolute",
          width: Math.max(2.4, safeSize * 0.34),
          height: handThickness,
          borderRadius: 999,
          background: color,
          top: "50%",
          left: "50%",
          transform: "translateY(-50%)"
        }}
      />
    </span>
  )
}

function colorWithAlpha(color, alpha = 1) {
  const raw = String(color ?? "").trim()
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0))
  const hex = raw.replace("#", "")
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`
  }
  if (/^rgba?\(/i.test(raw)) return raw
  return color
}

function getCalendarTaskMarkerPalette(accent, isDark, completed, surface = "#ffffff") {
  if (!completed) {
    return {
      border: isDark ? colorWithAlpha(accent, 0.82) : accent,
      background: isDark ? "rgba(255, 255, 255, 0.05)" : surface,
      color: "transparent"
    }
  }
  return {
    border: isDark ? colorWithAlpha(accent, 0.94) : accent,
    background: isDark ? colorWithAlpha(accent, 0.22) : colorWithAlpha(accent, 0.14),
    color: isDark ? "#eff6ff" : accent
  }
}

function writeDraggedPlannerItem(event, item) {
  try {
    const json = JSON.stringify(item ?? {})
    event.dataTransfer.setData(PLANNER_DND_MIME, json)
    event.dataTransfer.setData("text/plain", json)
  } catch {
    event.dataTransfer.setData("text/plain", String(item?.id ?? ""))
  }
}

function readDraggedPlannerItem(event, fallbackItem = null) {
  if (fallbackItem) return fallbackItem
  const raw = event.dataTransfer.getData(PLANNER_DND_MIME) || event.dataTransfer.getData("text/plain")
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function plannerItemHasTime(item) {
  return Boolean(String(item?.time ?? item?.row?.time ?? "").trim())
}

function plannerItemIsRecurring(item) {
  return Boolean(item?.sourceType === "recurring" || item?.repeatLabel || item?.repeat || item?.seriesId || item?.familyId || item?.row?.series_id)
}

function isMovablePlannerItem(item) {
  if (!item) return false
  if (plannerItemIsRecurring(item) && plannerItemHasTime(item)) return false
  return true
}

function getPlannerMoveBlockedMessage(item) {
  if (plannerItemIsRecurring(item)) {
    if (plannerItemHasTime(item)) return "시간 있는 반복 일정은 시간순으로 고정돼요."
    return "반복 일정은 같은 날짜 안에서만 순서를 바꿀 수 있어요."
  }
  if (plannerItemHasTime(item)) {
    return "시간 있는 일정은 같은 날짜 안에서만 순서를 바꿀 수 있어요."
  }
  return "이 항목은 드래그로 이동할 수 없어요."
}

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
  setLayoutPreset,
  showSwapButton,
  brandLogo = null,
  pillButton,
  memoTopRightButton,
  ui,
  calendarCellH,
  calendarFontPx,
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
  handleDayClick,
  onItemClick,
  onDateAdd,
  onDateRangeAdd,
  onItemMove,
  onTaskToggle,
  calendarInteractingRef,
  goToday,
  onOpenAddPicker,
  settingsButtonRef,
  onSettingsToggle,
  showSettingsButton = false,
  showTopActions = true
}) {
  const [draggedItem, setDraggedItem] = useState(null)
  const [dateRangeDrag, setDateRangeDrag] = useState(null)
  const blockedMoveTimerRef = useRef(null)
  const blockedMoveNoticeShownRef = useRef(false)
  const suppressNextCellClickRef = useRef(false)

  function clearBlockedMoveNoticeTimer() {
    if (!blockedMoveTimerRef.current) return
    window.clearTimeout(blockedMoveTimerRef.current)
    blockedMoveTimerRef.current = null
  }

  function scheduleBlockedMoveNotice(item) {
    clearBlockedMoveNoticeTimer()
    blockedMoveTimerRef.current = window.setTimeout(() => {
      blockedMoveTimerRef.current = null
      blockedMoveNoticeShownRef.current = true
      window.alert(getPlannerMoveBlockedMessage(item))
    }, 520)
  }

  useEffect(() => () => clearBlockedMoveNoticeTimer(), [])

  function shouldIgnoreDateRangePointer(event) {
    if (event.button != null && event.button !== 0) return true
    if (draggedItem) return true
    return Boolean(event.target?.closest?.("button"))
  }

  function getOrderedDateRange(startKey, endKey) {
    const start = String(startKey ?? "").trim()
    const end = String(endKey ?? startKey ?? "").trim()
    return start <= end ? { start, end } : { start: end, end: start }
  }

  function beginDateRangeDrag(event, key) {
    if (shouldIgnoreDateRangePointer(event)) return
    if (!key) return
    setDateRangeDrag({ active: true, startKey: key, endKey: key, moved: false })
    if (calendarInteractingRef?.current != null) calendarInteractingRef.current = true
  }

  function updateDateRangeDrag(key) {
    if (!dateRangeDrag?.active || !key) return
    setDateRangeDrag((prev) => {
      if (!prev?.active) return prev
      if (prev.endKey === key) return prev
      return { ...prev, endKey: key, moved: true }
    })
  }

  function finishDateRangeDrag(event, key) {
    if (!dateRangeDrag?.active) {
      setTimeout(() => {
        if (calendarInteractingRef?.current != null) calendarInteractingRef.current = false
      }, 0)
      return
    }
    const finalEndKey = key || dateRangeDrag.endKey || dateRangeDrag.startKey
    const { start, end } = getOrderedDateRange(dateRangeDrag.startKey, finalEndKey)
    const isRange = start && end && start !== end
    setDateRangeDrag(null)
    setTimeout(() => {
      if (calendarInteractingRef?.current != null) calendarInteractingRef.current = false
    }, 0)
    if (!isRange) return
    suppressNextCellClickRef.current = true
    event?.preventDefault?.()
    event?.stopPropagation?.()
    onDateRangeAdd?.(start, end)
  }

  function splitTimeLabel(value) {
    const raw = String(value ?? "").trim()
    if (!raw) return { start: "", end: "" }
    const match = raw.match(/^(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})$/)
    if (!match) return { start: raw, end: "" }
    return { start: match[1], end: match[2] }
  }

  const itemFontPx = Math.max(11, (Number(calendarFontPx) || 10) + 3)
  const timeFontPx = Math.max(8, itemFontPx - 1)
  const dotSizePx = Math.max(5, Math.round(itemFontPx * 0.6))
  const taskDotSizePx = Math.max(14, Math.round(itemFontPx * 1.1))
  const itemGapPx = Math.max(4, Math.round(itemFontPx * 0.34))
  const itemGroupGapPx = Math.max(4, Math.round(itemFontPx * 0.26))
  const calendarGridLine = theme === "dark" ? ui.border2 : "rgba(148, 163, 184, 0.16)"
  const calendarGridLineSoft = theme === "dark" ? ui.border2 : "rgba(148, 163, 184, 0.12)"

  return (
    <div
      ref={calendarPanelRef}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        minHeight: 0,
        height: "100%",
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flex: "1 1 auto",
              minWidth: 0
            }}
          >
            {brandLogo}
            <MonthNavigator
              ymYear={ymYear}
              setYmYear={setYmYear}
              ymMonth={ymMonth}
              setYmMonth={setYmMonth}
              goPrevMonth={goPrevMonth}
              goNextMonth={goNextMonth}
              ui={ui}
            />
            {showTopActions ? (
              <>
                <button
                  type="button"
                  onClick={goToday}
                  style={{ ...pillButton, padding: "0 10px 2px", borderRadius: 6, lineHeight: 1 }}
                  title="오늘로 이동"
                  aria-label="오늘로 이동"
                >
                  Today
                </button>

                <button
                  type="button"
                  onClick={(e) => onOpenAddPicker?.(e.currentTarget)}
                  style={{
                    ...pillButton,
                    height: 32,
                    padding: "0 12px",
                    borderRadius: 6,
                    lineHeight: "normal",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                  title="일정 추가"
                  aria-label="일정 추가"
                >
                  🗓 Add
                </button>
              </>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 8,
              flexShrink: 0,
              minWidth: 36,
              marginLeft: "auto"
            }}
          >
            {showSettingsButton ? (
              <button
                ref={settingsButtonRef}
                type="button"
                onClick={onSettingsToggle}
                style={{
                  ...(memoTopRightButton || pillButton),
                  padding: 0,
                  fontSize: 18,
                  color: ui.text,
                  flexShrink: 0
                }}
                title="설정"
                aria-label="설정"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                  style={{ transform: "translateY(1px) scale(1.02)" }}
                >
                  <path
                    fill="currentColor"
                    fillRule="evenodd"
                    d="M11.983 2.25c-.267 0-.52.04-.76.115l-.6 1.95a.75.75 0 0 1-.428.48l-.9.39a.75.75 0 0 1-.636-.02l-1.823-1.07a9.029 9.029 0 0 0-1.354 1.354l1.07 1.823a.75.75 0 0 1 .02.636l-.39.9a.75.75 0 0 1-.48.428l-1.95.6a9.05 9.05 0 0 0 0 1.52l1.95.6a.75.75 0 0 1 .48.428l.39.9a.75.75 0 0 1-.02.636l-1.07 1.823a9.029 9.029 0 0 0 1.354 1.354l1.823-1.07a.75.75 0 0 1 .636-.02l.9.39a.75.75 0 0 1 .428.48l.6 1.95a9.05 9.05 0 0 0 1.52 0l.6-1.95a.75.75 0 0 1 .428-.48l.9-.39a.75.75 0 0 1 .636.02l1.823 1.07a9.029 9.029 0 0 0 1.354-1.354l-1.07-1.823a.75.75 0 0 1-.02-.636l.39-.9a.75.75 0 0 1 .48-.428l1.95-.6a9.05 9.05 0 0 0 0-1.52l-1.95-.6a.75.75 0 0 1-.48-.428l-.39-.9a.75.75 0 0 1 .02-.636l1.07-1.823a9.029 9.029 0 0 0-1.354-1.354l-1.823 1.07a.75.75 0 0 1-.636.02l-.9-.39a.75.75 0 0 1-.428-.48l-.6-1.95a9.05 9.05 0 0 0-.76-.115Zm.017 5.25a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            ) : null}
            {showSwapButton && (
              <button
                type="button"
                onClick={() => setLayoutPreset((p) => (p === "memo-left" ? "calendar-left" : "memo-left"))}
                style={{
                  ...(memoTopRightButton || pillButton),
                  padding: 0,
                  fontSize: 18,
                  fontWeight: 800,
                  flexShrink: 0
                }}
                title="메모/달력 위치 변경"
                aria-label="메모/달력 위치 변경"
              >
                <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path
                    d="M4 6h10M11 3l3 3-3 3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M16 14H6M9 11l-3 3 3 3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
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
          minHeight: 0,
          flex: "1 1 auto"
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
              gridAutoRows: `minmax(${calendarCellH}px, auto)`
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
                    borderRight: isLastCol ? "none" : `1px solid ${calendarGridLine}`,
                    borderBottom: isLastRow ? "none" : `0.5px solid ${calendarGridLineSoft}`,
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

              const isSelected = selectedDateKey === key
              const isToday = key === todayKey
              const hasDateAccent = isSelected || isToday

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
              const activeRange = dateRangeDrag?.active ? getOrderedDateRange(dateRangeDrag.startKey, dateRangeDrag.endKey) : null
              const isInDateRange =
                Boolean(activeRange?.start && activeRange?.end) && key >= activeRange.start && key <= activeRange.end
              const rangeBgColor = theme === "dark" ? "rgba(59, 130, 246, 0.16)" : "rgba(59, 130, 246, 0.10)"

              const dayColor = isHoliday || isSunday ? ui.holiday : isSaturday ? ui.saturday : ui.text

              return (
                <div
                  key={key}
                  className="calendar-day-cell"
                  onDragOver={(e) => {
                    const hasDrag = Boolean(draggedItem) || Array.from(e.dataTransfer.types ?? []).includes(PLANNER_DND_MIME)
                    if (!hasDrag) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = "move"
                  }}
                  onDrop={(e) => {
                    const item = readDraggedPlannerItem(e, draggedItem)
                    if (!item) return
                    e.preventDefault()
                    e.stopPropagation()
                    setDraggedItem(null)
                    onItemMove?.(item, key, items.length)
                  }}
                  onPointerDown={(e) => {
                    beginDateRangeDrag(e, key)
                  }}
                  onPointerEnter={() => {
                    updateDateRangeDrag(key)
                  }}
                  onPointerUp={(e) => {
                    finishDateRangeDrag(e, key)
                  }}
                  onPointerCancel={() => {
                    setDateRangeDrag(null)
                    if (calendarInteractingRef?.current != null) calendarInteractingRef.current = false
                  }}
                  onClick={(e) => {
                    if (suppressNextCellClickRef.current) {
                      suppressNextCellClickRef.current = false
                      e.preventDefault()
                      e.stopPropagation()
                      return
                    }
                    handleDayClick(day)
                  }}
                  style={{
                    borderRight: isLastCol ? "none" : `1px solid ${calendarGridLine}`,
                    borderBottom: isLastRow ? "none" : `0.5px solid ${calendarGridLineSoft}`,
                    borderRadius: 0,
                    padding: hasDateAccent ? "5px 4px 6px" : "2px 4px 6px",
                    boxSizing: "border-box",
                    overflow: "hidden",
                    cursor: "pointer",
                    userSelect: "none",
                    background: isInDateRange ? rangeBgColor : bgColor,
                    boxShadow: isSelected
                      ? theme === "dark"
                        ? "0 0 0 1px rgba(96,165,250,0.22)"
                        : "0 2px 10px rgba(37, 99, 235, 0.12)"
                      : isInDateRange
                        ? theme === "dark"
                          ? "inset 0 0 0 1px rgba(96,165,250,0.24)"
                          : "inset 0 0 0 1px rgba(37,99,235,0.20)"
                      : "none",
                    transition: "box-shadow 140ms ease, background 140ms ease",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 0
                  }}
                >
                  {isSelected && (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 1,
                        background: highlightTokens.selected.ring
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
                          fontWeight: 760,
                          fontSize: 12,
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
                            fontSize: 11,
                            fontWeight: 720,
                            color: ui.holiday,
                            lineHeight: 1,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: 60,
                            transform: "translateY(1px)"
                          }}
                          title={holidayName}
                        >
                          {holidayName}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: Math.max(5, Math.round(itemFontPx * 0.52)),
                      fontSize: itemFontPx,
                      lineHeight: 1.2,
                      color: ui.text,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: itemGroupGapPx
                    }}
                  >
                    {items.map((it) => {
                      const timeInfo = splitTimeLabel(it.time)
                      const isTask = Boolean(it?.isTask)
                      const canDragItem = isMovablePlannerItem(it)
                      const taskAccent = String(it?.color ?? "").trim() || TASK_RING_BLUE
                      const taskPalette = getCalendarTaskMarkerPalette(taskAccent, theme === "dark", Boolean(it?.completed), ui.surface)
                      const showTimeMark = isTask && !it.completed && plannerItemHasTime(it)
                      return (
                        <button
                          type="button"
                          key={it.id}
                          className="calendar-task-item no-hover-outline"
                          draggable={canDragItem}
                          onPointerDown={(e) => {
                            if (canDragItem) return
                            e.stopPropagation()
                            scheduleBlockedMoveNotice(it)
                          }}
                          onPointerMove={() => {
                            if (!canDragItem) clearBlockedMoveNoticeTimer()
                          }}
                          onPointerUp={() => {
                            if (!canDragItem) clearBlockedMoveNoticeTimer()
                          }}
                          onPointerLeave={() => {
                            if (!canDragItem) clearBlockedMoveNoticeTimer()
                          }}
                          onPointerCancel={() => {
                            if (!canDragItem) clearBlockedMoveNoticeTimer()
                          }}
                          onDragStart={(e) => {
                            if (!canDragItem) return
                            e.stopPropagation()
                            const item = { ...it, dateKey: it.dateKey || key }
                            setDraggedItem(item)
                            e.dataTransfer.effectAllowed = "move"
                            writeDraggedPlannerItem(e, item)
                          }}
                          onDragEnd={() => setDraggedItem(null)}
                          onDragOver={(e) => {
                            const hasDrag = Boolean(draggedItem) || Array.from(e.dataTransfer.types ?? []).includes(PLANNER_DND_MIME)
                            if (!hasDrag) return
                            e.preventDefault()
                            e.dataTransfer.dropEffect = "move"
                          }}
                          onDrop={(e) => {
                            const dragged = readDraggedPlannerItem(e, draggedItem)
                            if (!dragged) return
                            e.preventDefault()
                            e.stopPropagation()
                            setDraggedItem(null)
                            const targetIndex = items.findIndex((candidate) => candidate.id === it.id)
                            onItemMove?.(dragged, key, targetIndex < 0 ? items.length : targetIndex)
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (blockedMoveNoticeShownRef.current) {
                              blockedMoveNoticeShownRef.current = false
                              return
                            }
                            onItemClick?.({ ...it, dateKey: it.dateKey || key })
                          }}
                          style={{
                            width: "100%",
                            border: "none",
                            background: "transparent",
                            color: "inherit",
                            padding: "3px 2px 3px 1px",
                            font: "inherit",
                            textAlign: "left",
                            display: "flex",
                            alignItems: "flex-start",
                            gap: itemGapPx,
                            minWidth: 0,
                            borderRadius: 5,
                            cursor: canDragItem ? "grab" : "pointer",
                            opacity: draggedItem?.id === it.id ? 0.55 : isTask && it.completed ? 0.62 : 1
                          }}
                          title={canDragItem ? "드래그로 이동" : getPlannerMoveBlockedMessage(it)}
                        >
                          {isTask || it.color ? (
                            <span
                              title={it.sourceTitle ? `[${it.sourceTitle}]` : "항목"}
                              role={isTask ? "checkbox" : undefined}
                              aria-checked={isTask ? Boolean(it.completed) : undefined}
                              tabIndex={isTask ? 0 : undefined}
                              draggable={false}
                              onPointerDown={(e) => {
                                if (!isTask) return
                                e.stopPropagation()
                              }}
                              onDragStart={(e) => {
                                if (!isTask) return
                                e.preventDefault()
                                e.stopPropagation()
                              }}
                              onClick={(e) => {
                                if (!isTask) return
                                e.preventDefault()
                                e.stopPropagation()
                                onTaskToggle?.({ ...it, dateKey: it.dateKey || key })
                              }}
                              onKeyDown={(e) => {
                                if (!isTask) return
                                if (e.key !== "Enter" && e.key !== " ") return
                                e.preventDefault()
                                e.stopPropagation()
                                onTaskToggle?.({ ...it, dateKey: it.dateKey || key })
                              }}
                              style={{
                                width: isTask ? Math.max(12, taskDotSizePx) : dotSizePx,
                                height: isTask ? Math.max(12, taskDotSizePx) : dotSizePx,
                                borderRadius: isTask ? 3 : 999,
                                border: isTask ? `1.8px solid ${taskPalette.border}` : "none",
                                background: isTask ? taskPalette.background : it.color,
                                color: isTask ? taskPalette.color : "transparent",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                position: "relative",
                                flexShrink: 0,
                                alignSelf: "center",
                                marginTop: 0,
                                fontWeight: 900,
                                fontSize: isTask ? Math.max(8, Math.round(taskDotSizePx * 0.56)) : 0,
                                lineHeight: 1,
                                cursor: isTask ? "pointer" : "inherit"
                              }}
                            >
                              {isTask && it.completed ? <span style={TASK_CHECK_GLYPH_STYLE}>✓</span> : null}
                              {showTimeMark ? (
                                <TaskTimeGlyph
                                  color={theme === "dark" ? "#cbd5e1" : taskPalette.border}
                                  size={Math.max(7.8, taskDotSizePx * 0.62)}
                                />
                              ) : null}
                            </span>
                          ) : null}
                          {it.time ? (
                            <span
                              style={{
                                color: ui.text2,
                                fontWeight: 900,
                                fontSize: timeFontPx,
                                lineHeight: 1.05,
                                display: "inline-flex",
                                flexDirection: "column",
                                alignItems: "flex-start",
                                alignSelf: "center",
                                flexShrink: 0
                              }}
                            >
                              <span>{timeInfo.start}</span>
                              {timeInfo.end ? <span>{timeInfo.end}</span> : null}
                            </span>
                          ) : null}
                          <span
                            style={{
                              fontWeight: isTask ? 550 : 650,
                              alignSelf: timeInfo.end || isTask ? "center" : "flex-start",
                              minWidth: 0,
                              lineHeight: 1.3,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "clip",
                              color: isTask && it.completed ? ui.text2 : ui.text,
                              textDecoration: isTask && it.completed ? "line-through" : "none",
                              textDecorationColor:
                                isTask && it.completed
                                  ? theme === "dark"
                                    ? "rgba(203, 213, 225, 0.38)"
                                    : "rgba(100, 116, 139, 0.42)"
                                  : "transparent",
                              textDecorationThickness: isTask && it.completed ? "1.35px" : undefined
                            }}
                          >
                            {it.text}
                          </span>
                        </button>
                      )
                    })}
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

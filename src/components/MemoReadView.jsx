import { getRepeatLabel, parseRecurringRawLine } from "../utils/recurringRules"

import { useEffect, useRef, useState } from "react"
import { parseDashboardSemicolonLine, parseLeadingTimeDashboardLine } from "../utils/plannerText"
import { decodeTaskLineBreaks, stripTaskSuffix } from "../utils/taskMarkers"

const TASK_RING_BLUE = "#3b82f6"
const PLANNER_DND_MIME = "application/x-planner-item"
void parseRecurringRawLine
const TASK_CONTROL_SIZE = 19
const TASK_ROW_GAP = 7
const TASK_ROW_PADDING = "2px 0"
const TASK_TIME_COL_W = 74
const REGULAR_TASK_TEXT_OFFSET = 0
const REPEAT_META_TEXT_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 20,
  fontSize: 11,
  color: "inherit",
  fontWeight: 700,
  lineHeight: 1,
  flexShrink: 0
}
const TASK_TEXT_STYLE = {
  minWidth: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 20,
  fontWeight: 560,
  lineHeight: 1.34,
  letterSpacing: 0
}
const REPEAT_BADGE_STYLE = {
  height: 20,
  padding: "0 8px",
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  fontWeight: 720,
  lineHeight: 1,
  flexShrink: 0
}
const TASK_CHECK_GLYPH_STYLE = {
  display: "inline-block",
  fontSize: 16,
  fontWeight: 820,
  lineHeight: 1,
  transform: "rotate(-12deg) translate(1px, -1px)",
  transformOrigin: "center",
  pointerEvents: "none"
}

function TaskTimeGlyph({ color = "#64748b", size = 9 }) {
  const safeSize = Math.max(8, Number(size) || 9)
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
          height: Math.max(2.4, safeSize * 0.35),
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
          width: Math.max(2.6, safeSize * 0.35),
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

function getSurfaceLuminance(color) {
  const raw = String(color ?? "").trim()
  const hex = raw.replace("#", "")
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return 1
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
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
  return raw || color
}

function getTaskCheckboxPalette(ui, completed) {
  const isDark = getSurfaceLuminance(ui?.surface) < 0.35
  if (!completed) {
    return {
      border: isDark ? "rgba(147, 197, 253, 0.58)" : "#2563eb",
      background: isDark ? "rgba(255, 255, 255, 0.03)" : ui.surface,
      color: "transparent",
      opacity: 1
    }
  }
  return {
    border: isDark ? "rgba(125, 211, 252, 0.56)" : "rgba(37, 99, 235, 0.52)",
    background: isDark ? "rgba(125, 211, 252, 0.16)" : "rgba(59, 130, 246, 0.12)",
    color: isDark ? "#d7f0ff" : "#5375b6",
    opacity: isDark ? 0.86 : 0.74
  }
}

function formatDisplayTimeLabel(value) {
  const raw = String(value ?? "").trim()
  const match = raw.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/)
  if (!match) return raw
  return `${match[1]}\n${match[2]}`
}

function CategoryBadge({ title, ui, accent = "#60a5fa" }) {
  const label = String(title ?? "").trim()
  if (!label) return null
  return (
    <span
      style={{
        height: 22,
        padding: "0 9px",
        borderRadius: 999,
        border: `1px solid ${ui.border}`,
        background: ui.surface,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        flexShrink: 0
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: accent,
          flexShrink: 0
        }}
      />
      <span style={{ fontSize: 11, fontWeight: 680, color: ui.text2, lineHeight: 1 }}>{label}</span>
    </span>
  )
}

function getReadableTaskParts(item) {
  const fallbackTitle = String(item?.title ?? "").trim()
  const rawText = String(item?.text ?? item?.display ?? item?.baseRaw ?? item?.rawLine ?? "").trim()
  const baseText = stripTaskSuffix(rawText).text || rawText
  const parsed = parseDashboardSemicolonLine(baseText, { allowEmptyText: true })

  if (parsed) {
    const text = decodeTaskLineBreaks(String(parsed.text ?? "").trim())
    const title = fallbackTitle || String(parsed.group ?? "").trim()
    const time = String(item?.time ?? parsed.time ?? "").trim()
    return {
      time,
      title,
      text: text || baseText,
      display: text || baseText
    }
  }

  const timed = parseLeadingTimeDashboardLine(baseText, { allowEmptyText: true })
  if (timed) {
    const text = decodeTaskLineBreaks(String(timed.text ?? "").trim())
    const title = fallbackTitle || String(timed.group ?? "").trim()
    const time = String(item?.time ?? timed.time ?? "").trim()
    return {
      time,
      title,
      text: text || baseText,
      display: text || baseText
    }
  }

  return {
    time: String(item?.time ?? "").trim(),
    title: fallbackTitle,
    text: decodeTaskLineBreaks(baseText),
    display: decodeTaskLineBreaks(baseText)
  }
}

function getTaskControlSize(memoFontPx = 13) {
  return Math.max(16, Math.min(21, Math.round(memoFontPx + 2)))
}

function splitDateHeaderLabel(header) {
  const text = String(header ?? "").trim()
  const match = text.match(/^(.+?)\s*\(([^)]+)\)(?:\s+(.+))?\s*$/)
  if (!match) return { date: text, weekday: "", holiday: "" }
  return {
    date: String(match[1] ?? "").trim(),
    weekday: String(match[2] ?? "").trim(),
    holiday: String(match[3] ?? "").trim()
  }
}

function getWeekdayTextColor(weekday, ui) {
  const label = String(weekday ?? "").trim()
  if (label === "일") return "#ef4444"
  if (label === "토") return "#2563eb"
  return ui.text2
}

function TaskCard({
  item,
  ui,
  memoFontPx,
  onTaskToggle,
  onTaskOpen,
  windowColorByTitle,
  showCategoryBadges = true,
  draggable = false,
  isDragging = false,
  onDragStart,
  onDragEnd,
  onDropBefore,
  onBlockedMoveAttempt
}) {
  const repeatLabel =
    item?.sourceType === "recurring" ? getRepeatLabel(item?.repeat, item?.repeatInterval) : ""
  const readable = getReadableTaskParts(item)
  const timeLabel = formatDisplayTimeLabel(readable.time)
  const categoryTitle = showCategoryBadges ? readable.title : ""
  const contentLabel = readable.text
  const controlSize = getTaskControlSize(memoFontPx)
  const checkboxPalette = getTaskCheckboxPalette(ui, item.completed)
  const [isHovered, setIsHovered] = useState(false)
  const blockedMoveTimerRef = useRef(null)
  const blockedMoveNoticeShownRef = useRef(false)
  const categoryAccent = categoryTitle
    ? windowColorByTitle?.get?.(categoryTitle) || item?.color || "#60a5fa"
    : item?.color || "#60a5fa"
  const isDarkSurface = getSurfaceLuminance(ui?.surface) < 0.35
  const checkboxBorderColor = item.completed
    ? colorWithAlpha(categoryAccent, isDarkSurface ? 0.9 : 0.78)
    : categoryAccent
  const checkboxBackground = item.completed
    ? colorWithAlpha(categoryAccent, isDarkSurface ? 0.24 : 0.14)
    : checkboxPalette.background
  const checkboxCheckColor = item.completed ? (isDarkSurface ? "#eff6ff" : categoryAccent) : checkboxPalette.color

  function clearBlockedMoveNoticeTimer() {
    if (!blockedMoveTimerRef.current) return
    window.clearTimeout(blockedMoveTimerRef.current)
    blockedMoveTimerRef.current = null
  }

  function scheduleBlockedMoveNotice() {
    if (draggable || typeof onBlockedMoveAttempt !== "function") return
    clearBlockedMoveNoticeTimer()
    blockedMoveTimerRef.current = window.setTimeout(() => {
      blockedMoveTimerRef.current = null
      blockedMoveNoticeShownRef.current = true
      onBlockedMoveAttempt(item)
    }, 520)
  }

  useEffect(() => () => clearBlockedMoveNoticeTimer(), [])

  return (
    <div
      draggable={draggable}
      onPointerDown={(e) => {
        if (draggable || typeof onBlockedMoveAttempt !== "function") return
        e.stopPropagation()
        scheduleBlockedMoveNotice()
      }}
      onPointerMove={() => clearBlockedMoveNoticeTimer()}
      onPointerUp={() => clearBlockedMoveNoticeTimer()}
      onPointerCancel={() => clearBlockedMoveNoticeTimer()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        clearBlockedMoveNoticeTimer()
        setIsHovered(false)
      }}
      onDragStart={(e) => {
        if (!draggable) return
        e.stopPropagation()
        onDragStart?.(e)
      }}
      onDragEnd={(e) => {
        e.stopPropagation()
        onDragEnd?.(e)
      }}
      onDragOver={(e) => {
        const hasDrag = Array.from(e.dataTransfer.types ?? []).includes(PLANNER_DND_MIME)
        if (!hasDrag) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = "move"
      }}
      onDrop={(e) => {
        const dragged = readDraggedPlannerItem(e)
        if (!dragged) return
        e.preventDefault()
        e.stopPropagation()
        onDropBefore?.(dragged)
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (blockedMoveNoticeShownRef.current) {
          blockedMoveNoticeShownRef.current = false
          return
        }
        onTaskOpen?.(item)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          e.stopPropagation()
          onTaskOpen?.(item)
        }
      }}
      role="button"
      tabIndex={0}
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "3px 8px 3px 10px",
        display: "flex",
        alignItems: "center",
        gap: TASK_ROW_GAP,
        cursor: draggable ? "grab" : "pointer",
        borderRadius: 8,
        background: isHovered ? ui.surface2 : "transparent",
        outline: "none",
        boxShadow: isHovered
          ? `inset 3px 0 0 ${categoryAccent}, 0 8px 18px rgba(15, 23, 42, 0.05)`
          : "none",
        transition: "background 120ms ease, box-shadow 120ms ease",
        opacity: isDragging ? 0.55 : 1
      }}
      title={draggable ? "드래그로 이동" : getPlannerMoveBlockedMessage(item)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onTaskToggle?.(item)
        }}
        style={{
          width: controlSize,
          height: controlSize,
          borderRadius: 3,
          border: `1.7px solid ${checkboxBorderColor}`,
          background: checkboxBackground,
          color: checkboxCheckColor,
          opacity: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          overflow: "visible",
          cursor: "pointer",
          padding: 0,
          alignSelf: "center",
          marginTop: 0,
          margin: 0
        }}
      >
        {item.completed ? (
          <span style={TASK_CHECK_GLYPH_STYLE}>✓</span>
        ) : timeLabel ? (
          <TaskTimeGlyph color={checkboxBorderColor} size={Math.max(9, controlSize * 0.52)} />
        ) : null}
      </button>
      {timeLabel ? (
        <div
          style={{
            width: 46,
            flexShrink: 0,
            minHeight: controlSize,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            fontSize: 12,
            fontWeight: 680,
            lineHeight: 1.08,
            color: ui.text2,
            whiteSpace: "pre-line"
          }}
        >
          {timeLabel}
        </div>
      ) : null}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
          minHeight: controlSize,
          lineHeight: 1.2,
          paddingTop: 0
        }}
      >
        <span
          style={{
            ...TASK_TEXT_STYLE,
            justifyContent: "flex-start",
            minHeight: controlSize,
            fontSize: memoFontPx,
            fontWeight: item.completed ? 500 : 540,
            flex: 1,
            minWidth: 0,
            color: item.completed ? ui.text2 : ui.text,
            opacity: item.completed ? 0.62 : 1,
            textDecoration: item.completed ? "line-through" : "none",
            textDecorationColor: item.completed ? ui.text : "transparent",
            textDecorationThickness: item.completed ? "1.5px" : undefined,
            whiteSpace: "normal",
            overflowWrap: "anywhere",
            wordBreak: "break-word"
          }}
        >
          {contentLabel}
        </span>
        {repeatLabel || categoryTitle ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 6,
              flexShrink: 0,
              minHeight: controlSize,
              marginLeft: 4
            }}
          >
            {repeatLabel ? (
              <span
                style={{
                  ...REPEAT_BADGE_STYLE,
                  border: `1px solid ${ui.border}`,
                  background: ui.surface2,
                  color: ui.text2
                }}
              >
                {repeatLabel}
              </span>
            ) : null}
            <CategoryBadge title={categoryTitle} ui={ui} accent={categoryAccent} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function RecurringScheduleLine({ item, ui, memoFontPx, onOpen, windowColorByTitle }) {
  const readable = getReadableTaskParts(item)
  const timeLabel = formatDisplayTimeLabel(readable.time)
  const categoryTitle = readable.title
  const contentLabel = readable.text
  const categoryAccent = categoryTitle
    ? windowColorByTitle?.get?.(categoryTitle) || item?.color || "#60a5fa"
    : "#60a5fa"
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen?.(item)
      }}
      style={{
        width: "100%",
        textAlign: "left",
        border: "none",
        outline: "none",
        boxShadow: "none",
        background: "transparent",
        color: ui.text,
        borderRadius: 0,
        padding: TASK_ROW_PADDING,
        display: "flex",
        alignItems: "center",
        gap: TASK_ROW_GAP,
        flexWrap: "nowrap",
        cursor: "pointer"
      }}
    >
      <span
        style={{
          width: 46,
          minHeight: 20,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          fontSize: 12,
          fontWeight: 680,
          color: ui.text2,
          flexShrink: 0,
          whiteSpace: "pre-line",
          lineHeight: 1.05
        }}
      >
        {timeLabel || "\u00A0"}
      </span>
      <span
        style={{
          minWidth: 0,
          display: "inline-flex",
          alignItems: "center",
          minHeight: 20,
          color: ui.text,
          fontSize: memoFontPx,
          fontWeight: 520,
          lineHeight: 1.32
        }}
      >
        {contentLabel}
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 6,
          flexShrink: 0,
          minHeight: 20
        }}
      >
        <span
          style={{
            ...REPEAT_BADGE_STYLE,
            border: `1px solid ${ui.border}`,
            background: ui.surface2,
            color: ui.text2
          }}
        >
          {item.repeatLabel}
        </span>
        <CategoryBadge title={categoryTitle} ui={ui} accent={categoryAccent} />
      </span>
    </button>
  )
}

export default function MemoReadView({
  blocks,
  ui,
  highlightTokens,
  todayKey,
  keyToYMD,
  buildHeaderLine,
  setReadBlockRef,
  handleReadBlockClick,
  readScrollMarginTop,
  taskItemsByDate = {},
  memoFontPx = 13,
  windowColorByTitle,
  showCategoryBadges = true,
  onTaskToggle,
  onTaskOpen,
  onTaskMove,
  emptyText = "Add 버튼이나 달력 날짜를 눌러 일정을 추가해보세요."
}) {
  const [draggedTask, setDraggedTask] = useState(null)
  const [hoveredBlockKey, setHoveredBlockKey] = useState("")

  if (!blocks || blocks.length === 0) {
    return (
      <div
        style={{
          color: ui.text2,
          fontWeight: 500,
          fontSize: 15,
          lineHeight: 1.55,
          padding: "18px 18px 0 18px"
        }}
      >
        <div style={{ maxWidth: 420 }}>{emptyText}</div>
      </div>
    )
  }

  return (
    <>
      {blocks.map((block) => {
        if (!block?.dateKey) return null
        const { y, m, d } = keyToYMD(block.dateKey)
        const header = buildHeaderLine(y, m, d)
        const headerParts = splitDateHeaderLabel(header)
        const forceVisible = Boolean(block.forceVisible)
        const isToday = block.dateKey === todayKey
        const isHolidayHeader = Boolean(headerParts.holiday)
        const isBlockHovered = hoveredBlockKey === block.dateKey
        const blockBorderColor = isBlockHovered
          ? "rgba(59, 130, 246, 0.26)"
          : isToday
            ? "rgba(14, 165, 233, 0.28)"
            : "transparent"
        const blockShadow = isBlockHovered
          ? "0 10px 24px rgba(15, 23, 42, 0.07), inset 3px 0 0 rgba(59, 130, 246, 0.55)"
          : isToday
            ? `inset 3px 0 0 rgba(59, 130, 246, 0.55), 0 0 0 1px ${highlightTokens.today.soft}`
            : "none"
        const blockBackground = isBlockHovered
          ? `linear-gradient(90deg, ${highlightTokens.today.soft}, rgba(255,255,255,0) 72%)`
          : isToday
            ? `linear-gradient(90deg, ${highlightTokens.today.soft}, rgba(0,0,0,0) 58%)`
            : "transparent"

        const taskItems = (Array.isArray(taskItemsByDate?.[block.dateKey]) ? taskItemsByDate[block.dateKey] : [])
          .filter((item) => String(item?.display ?? "").trim())
        const hasContent = taskItems.length > 0
        if (!hasContent && !forceVisible) return null

        return (
          <div
            key={block.dateKey}
            ref={setReadBlockRef(block.dateKey)}
            onClick={(e) => {
              e.stopPropagation()
              handleReadBlockClick(block.dateKey)
            }}
            onMouseEnter={() => setHoveredBlockKey(block.dateKey)}
            onMouseLeave={() => setHoveredBlockKey((prev) => (prev === block.dateKey ? "" : prev))}
            onDragOver={(e) => {
              const hasDrag = Boolean(draggedTask) || Array.from(e.dataTransfer.types ?? []).includes(PLANNER_DND_MIME)
              if (!hasDrag) return
              e.preventDefault()
              e.dataTransfer.dropEffect = "move"
            }}
            onDrop={(e) => {
              const item = readDraggedPlannerItem(e, draggedTask)
              if (!item) return
              e.preventDefault()
              e.stopPropagation()
              setDraggedTask(null)
              onTaskMove?.(item, block.dateKey, taskItems.length)
            }}
            style={{
              marginBottom: 16,
              marginLeft: -4,
              scrollMarginTop: readScrollMarginTop,
              cursor: "default",
              position: "relative",
              border: `1px solid ${blockBorderColor}`,
              borderRadius: 10,
              padding: "10px 8px",
              paddingLeft: isToday ? 18 : 12,
              boxShadow: blockShadow,
              background: blockBackground,
              transition: "border-color 140ms ease, background 140ms ease, box-shadow 140ms ease"
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 8,
                fontWeight: 760
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 5, minHeight: 26 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    fontSize: Math.max(16, Math.round(memoFontPx + 1)),
                    fontWeight: 720,
                    lineHeight: 1.04,
                    letterSpacing: 0,
                    color: isHolidayHeader ? "#ef4444" : ui.text
                  }}
                >
                  {headerParts.date}
                </span>
                {headerParts.weekday ? (
                  <span
                    style={{
                      padding: "0 2px",
                      color: isHolidayHeader ? "#ef4444" : getWeekdayTextColor(headerParts.weekday, ui),
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: Math.max(11, Math.round(memoFontPx - 4)),
                      fontWeight: 620,
                      lineHeight: 1,
                      opacity: 0.82
                    }}
                  >
                    {headerParts.weekday}
                  </span>
                ) : null}
                {headerParts.holiday ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      color: "#ef4444",
                      fontSize: Math.max(11, Math.round(memoFontPx - 4)),
                      fontWeight: 720,
                      lineHeight: 1
                    }}
                  >
                    {headerParts.holiday}
                  </span>
                ) : null}
                {isToday && (
                  <span
                    style={{
                      padding: "0 2px",
                      fontSize: Math.max(10, Math.round(memoFontPx - 4)),
                      fontWeight: 760,
                      lineHeight: 1,
                      color: ui.text2,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      letterSpacing: "0.02em"
                    }}
                  >
                    TODAY
                  </span>
                )}
              </div>
            </div>
            <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 4 }}>
              {taskItems.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    paddingTop: 2
                  }}
                >
                  {taskItems.map((item, index) => {
                    const canDrag = isMovablePlannerItem(item)
                    return (
                    <TaskCard
                      key={`${block.dateKey}-task-${item.id}`}
                      item={item}
                      ui={ui}
                      memoFontPx={memoFontPx}
                      windowColorByTitle={windowColorByTitle}
                      showCategoryBadges={showCategoryBadges}
                      onTaskToggle={onTaskToggle}
                      onTaskOpen={onTaskOpen}
                      draggable={canDrag}
                      isDragging={draggedTask?.id === item.id}
                      onDragStart={(event) => {
                        const dragItem = { ...item, dateKey: item.dateKey || block.dateKey }
                        setDraggedTask(dragItem)
                        event.dataTransfer.effectAllowed = "move"
                        writeDraggedPlannerItem(event, dragItem)
                      }}
                      onDragEnd={() => setDraggedTask(null)}
                      onDropBefore={(dragged) => {
                        setDraggedTask(null)
                        onTaskMove?.(dragged, block.dateKey, index)
                      }}
                      onBlockedMoveAttempt={() => window.alert(getPlannerMoveBlockedMessage(item))}
                    />
                    )
                  })}
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </>
  )
}

import { useEffect, useMemo, useRef, useState } from "react"
import { getRepeatLabel, parseRecurringRawLine } from "../utils/recurringRules"
import { buildTaskMetaText, decodeTaskLineBreaks, parseTaskSuffix, stripTaskSuffix } from "../utils/taskMarkers"
import {
  getLineHeightPx,
  measureCharPosPx,
  normalizeTimeTokenOrRange,
  parseDashboardSemicolonLine,
  parseLeadingTimeDashboardLine,
  parseTimePrefix
} from "../utils/plannerText"

const TASK_RING_BLUE = "#3b82f6"
const TASK_CONTROL_SIZE = 19
const TASK_ROW_GAP = 7
const TASK_ROW_PADDING = "2px 0"
const REGULAR_TASK_TEXT_OFFSET = 0
const TASK_TIME_COL_W = 74
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
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 20,
  lineHeight: 1.2,
  fontWeight: 500
}
const TASK_CHECK_GLYPH_STYLE = {
  display: "inline-block",
  fontSize: 16,
  fontWeight: 900,
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
const TASK_ROW_ACTION_BUTTON_STYLE = {
  width: 22,
  height: 22,
  borderRadius: 8,
  border: "none",
  background: "transparent",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
  padding: 0
}
const TASK_DRAFT_ROW_SEPARATOR = "\u001e"

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
const REPEAT_BADGE_STYLE = {
  height: 20,
  padding: "0 8px",
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1,
  flexShrink: 0
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
      <span style={{ fontSize: 11, fontWeight: 700, color: ui.text2, lineHeight: 1 }}>{label}</span>
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
    const title = fallbackTitle
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
    const title = fallbackTitle
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

function SectionBox({ ui, empty = false, onClick, children }) {
  const clickable = typeof onClick === "function"
  return (
    <div
      data-keep-edit={clickable ? "true" : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      style={{
        width: "100%",
        minHeight: empty ? 54 : undefined,
        padding: empty ? "10px 12px" : "8px 12px",
        borderRadius: 10,
        border: `1px solid ${ui.border}`,
        background: ui.surface2,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        boxSizing: "border-box",
        cursor: clickable ? "pointer" : "default"
      }}
    >
      {children}
    </div>
  )
}

function RowActionButton({ ui, title, onClick }) {
  return (
    <button
      type="button"
      data-keep-edit="true"
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick?.(e)
      }}
      title={title}
      aria-label={title}
      style={{
        ...TASK_ROW_ACTION_BUTTON_STYLE,
        color: ui.text2
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1, transform: "translateY(-1px)" }}>⋮</span>
    </button>
  )
}

function RecurringScheduleRow({ item, ui, memoFontPx, onOpen, windowColorByTitle }) {
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
      data-keep-edit="true"
      onClick={(e) => {
        e.preventDefault()
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
        padding: "2px 0 2px 8px",
        display: "flex",
        alignItems: "center",
        gap: TASK_ROW_GAP,
        flexWrap: "nowrap",
        cursor: "pointer"
      }}
    >
      <span
        style={{
          width: TASK_TIME_COL_W,
          minHeight: 20,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          fontSize: 12,
          fontWeight: 900,
          color: ui.text2
        }}
      >
        {timeLabel || "\u00A0"}
      </span>
      <span
        style={{
          ...TASK_TEXT_STYLE,
          flex: 1,
          minWidth: 0,
          fontSize: memoFontPx
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
            background: ui.surface,
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

function ScheduleReadRow({ item, ui, memoFontPx, windowColorByTitle }) {
  const readable = getReadableTaskParts(item)
  const timeLabel = formatDisplayTimeLabel(readable.time)
  const categoryTitle = readable.title
  const contentLabel = readable.text
  const categoryAccent = categoryTitle
    ? windowColorByTitle?.get?.(categoryTitle) || item?.color || "#60a5fa"
    : "#60a5fa"
  return (
    <div
      style={{
        width: "100%",
        textAlign: "left",
        color: ui.text,
        padding: TASK_ROW_PADDING,
        display: "flex",
        alignItems: "center",
        gap: TASK_ROW_GAP,
        boxSizing: "border-box"
      }}
    >
      <span
        style={{
          width: TASK_TIME_COL_W,
          minHeight: 20,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          fontSize: 12,
          fontWeight: 900,
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
          ...TASK_TEXT_STYLE,
          justifyContent: "flex-start",
          flex: 1,
          minWidth: 0,
          minHeight: 20,
          fontSize: memoFontPx
        }}
      >
        {contentLabel}
      </span>
      {categoryTitle ? <CategoryBadge title={categoryTitle} ui={ui} accent={categoryAccent} /> : null}
    </div>
  )
}

function RecurringTaskRow({ item, ui, memoFontPx, onOpen, onToggle, windowColorByTitle }) {
  const controlSize = getTaskControlSize(memoFontPx)
  const readable = getReadableTaskParts(item)
  const timeLabel = formatDisplayTimeLabel(readable.time)
  const categoryTitle = readable.title
  const contentLabel = readable.text
  const checkboxPalette = getTaskCheckboxPalette(ui, item.completed)
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
  return (
    <div
      data-keep-edit="true"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onOpen?.(item)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          e.stopPropagation()
          onOpen?.(item)
        }
      }}
      role="button"
      tabIndex={0}
      style={{
        width: "100%",
        textAlign: "left",
        border: "none",
        background: "transparent",
        color: ui.text,
        borderRadius: 0,
        padding: "2px 0 2px 8px",
        display: "flex",
        alignItems: "center",
        gap: TASK_ROW_GAP,
        cursor: "pointer",
        outline: "none",
        boxShadow: "none"
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggle?.(item)
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
      <span
        style={{
          width: TASK_TIME_COL_W,
          minHeight: controlSize,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          fontSize: 12,
          fontWeight: 900,
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
          ...TASK_TEXT_STYLE,
          justifyContent: "flex-start",
          flex: 1,
          minWidth: 0,
          fontSize: memoFontPx,
          color: item.completed ? ui.text2 : ui.text,
          opacity: item.completed ? 0.62 : 1,
          textDecoration: item.completed ? "line-through" : "none",
          textDecorationColor: item.completed ? ui.text : "transparent",
          textDecorationThickness: item.completed ? "1.5px" : undefined,
          alignItems: "center"
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
          minHeight: controlSize
        }}
      >
        <span
          style={{
            ...REPEAT_BADGE_STYLE,
            border: `1px solid ${ui.border}`,
            background: ui.surface,
            color: ui.text2
          }}
        >
          {item.repeatLabel}
        </span>
        <CategoryBadge title={categoryTitle} ui={ui} accent={categoryAccent} />
      </span>
    </div>
  )
}

function RegularTaskReadRow({ item, ui, memoFontPx, onOpen, onToggle, windowColorByTitle }) {
  const checkboxPalette = getTaskCheckboxPalette(ui, item.completed)
  const controlSize = getTaskControlSize(memoFontPx)
  const readable = getReadableTaskParts(item)
  const timeLabel = formatDisplayTimeLabel(readable.time)
  const categoryAccent = readable.title
    ? windowColorByTitle?.get?.(readable.title) || item?.color || "#60a5fa"
    : item?.color || "#60a5fa"
  const isDarkSurface = getSurfaceLuminance(ui?.surface) < 0.35
  const checkboxBorderColor = item.completed
    ? colorWithAlpha(categoryAccent, isDarkSurface ? 0.9 : 0.78)
    : categoryAccent
  const checkboxBackground = item.completed
    ? colorWithAlpha(categoryAccent, isDarkSurface ? 0.24 : 0.14)
    : checkboxPalette.background
  const checkboxCheckColor = item.completed ? (isDarkSurface ? "#eff6ff" : categoryAccent) : checkboxPalette.color
  return (
    <div
      onClick={() => onOpen?.(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen?.(item)
        }
      }}
      role="button"
      tabIndex={0}
      style={{
        width: "100%",
        textAlign: "left",
        color: ui.text,
        padding: "2px 0 2px 8px",
        boxSizing: "border-box",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: TASK_ROW_GAP,
        outline: "none",
        boxShadow: "none"
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggle?.(item)
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
      <span
        style={{
          width: TASK_TIME_COL_W,
          minHeight: 20,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          fontSize: 12,
          fontWeight: 900,
          color: ui.text2,
          flexShrink: 0,
          whiteSpace: "pre-line",
          lineHeight: 1.05
        }}
      >
        {timeLabel || "\u00A0"}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
          minHeight: 20,
          lineHeight: 1.2,
          paddingTop: 0,
          paddingLeft: REGULAR_TASK_TEXT_OFFSET,
          flex: 1
        }}
      >
        <span
          style={{
            ...TASK_TEXT_STYLE,
            justifyContent: "flex-start",
            fontSize: memoFontPx,
            flex: 1,
            minWidth: 0,
            color: item.completed ? ui.text2 : ui.text,
            opacity: item.completed ? 0.62 : 1,
            textDecoration: item.completed ? "line-through" : "none",
            textDecorationColor: item.completed ? ui.text : "transparent",
            textDecorationThickness: item.completed ? "1.5px" : undefined
          }}
        >
          {readable.text}
        </span>
        <CategoryBadge title={readable.title} ui={ui} accent={categoryAccent} />
      </div>
    </div>
  )
}

function RecurringTaskEditRow({ item, ui, memoFontPx, onOpen }) {
  const categoryTitle = String(item?.title ?? "").trim()
  const contentLabel = String(item?.text ?? item?.display ?? "").trim()
  const timeLabel = formatDisplayTimeLabel(item?.time)
  return (
    <div
      data-keep-edit="true"
      style={{
        minHeight: 34,
        padding: "0 2px",
        borderRadius: 0,
        border: "none",
        background: "transparent",
        display: "flex",
        alignItems: "center",
        gap: 8
      }}
    >
      {timeLabel ? (
        <span
          style={{
            width: 54,
            minHeight: 20,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            fontSize: 12,
            fontWeight: 900,
            color: ui.text2,
            flexShrink: 0,
            whiteSpace: "pre-line",
            lineHeight: 1.05
          }}
        >
          {timeLabel}
        </span>
      ) : null}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          color: ui.text,
          fontSize: memoFontPx,
          lineHeight: 1.5,
          fontFamily: "inherit",
          fontWeight: 600
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
          minHeight: 22
        }}
      >
        <span
          style={{
            ...REPEAT_BADGE_STYLE,
            border: `1px solid ${ui.border}`,
            background: ui.surface,
            color: ui.text2
          }}
        >
          {item.repeatLabel}
        </span>
        <CategoryBadge title={categoryTitle} ui={ui} />
        <RowActionButton ui={ui} title="반복 설정" onClick={() => onOpen?.(item)} />
      </span>
    </div>
  )
}

function TaskDraftRow({
  ui,
  memoFontPx,
  value,
  placeholder = "",
  inputRef,
  onFocus,
  onChange,
  onBlur,
  onKeyDown,
  onPaste,
  onAction,
  actionTitle = "반복 설정",
  rightMeta = null,
  onPress = null
}) {
  const localRef = useRef(null)
  const pressable = typeof onPress === "function"

  function resizeTextarea(el) {
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(120, Math.max(34, el.scrollHeight))}px`
  }

  useEffect(() => {
    resizeTextarea(localRef.current)
  }, [value, memoFontPx])

  return (
    <div
      data-keep-edit="true"
      role={pressable ? "button" : undefined}
      tabIndex={pressable ? 0 : undefined}
      onClick={
        pressable
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              onPress?.()
            }
          : undefined
      }
      onKeyDown={
        pressable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                e.stopPropagation()
                onPress?.()
              }
            }
          : undefined
      }
      style={{
        minHeight: 40,
        padding: "0 2px",
        borderRadius: 0,
        border: "none",
        background: "transparent",
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: pressable ? "pointer" : "default"
      }}
    >
      <textarea
        ref={(el) => {
          localRef.current = el
          inputRef?.(el)
          resizeTextarea(el)
        }}
        rows={1}
        readOnly={pressable}
        value={value}
        onMouseDown={
          pressable
            ? (e) => {
                e.preventDefault()
              }
            : undefined
        }
        onFocus={pressable ? undefined : onFocus}
        onChange={(e) => {
          if (pressable) return
          resizeTextarea(e.currentTarget)
          onChange?.(e)
        }}
        onBlur={pressable ? undefined : onBlur}
        onKeyDown={pressable ? undefined : onKeyDown}
        onPaste={pressable ? undefined : onPaste}
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 34,
          maxHeight: 120,
          border: "none",
          outline: "none",
          background: "transparent",
          color: ui.text,
          fontSize: memoFontPx,
          lineHeight: 1.35,
          fontFamily: "inherit",
          fontWeight: 500,
          letterSpacing: "-0.01em",
          padding: "8px 2px 7px 10px",
          boxSizing: "border-box",
          boxShadow: "none",
          appearance: "none",
          WebkitAppearance: "none",
          resize: "none",
          overflow: "hidden",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          cursor: pressable ? "pointer" : "text"
        }}
      />
      {rightMeta}
      <RowActionButton ui={ui} title={actionTitle} onClick={onAction} />
    </div>
  )
}

function getMentionContext(value, caret) {
  if (caret < 0) return null
  const lineStart = value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1
  const linePrefix = value.slice(lineStart, caret)
  const atOffset = linePrefix.lastIndexOf("@")
  if (atOffset === -1) return null

  const anchorPos = lineStart + atOffset
  const beforeChar = anchorPos > 0 ? value[anchorPos - 1] : ""
  if (beforeChar && beforeChar !== ";" && !/\s/.test(beforeChar)) return null

  const query = value.slice(anchorPos + 1, caret)
  if (/[\s;@]/.test(query)) return null

  let tokenEnd = anchorPos + 1
  while (tokenEnd < value.length) {
    const ch = value[tokenEnd]
    if (ch === ";" || /\s/.test(ch) || ch === "@") break
    tokenEnd += 1
  }
  if (tokenEnd < caret) return null

  return { anchorPos, tokenEnd, query }
}

function buildMentionMatches(editableWindows, query) {
  const q = String(query ?? "").trim().toLowerCase()
  if (!q) return editableWindows
  return editableWindows.filter((w) => String(w?.title ?? "").toLowerCase().includes(q))
}

function isRecurringTaskLike(item) {
  const repeat = String(item?.repeat ?? item?.repeatType ?? item?.row?.repeat_type ?? "").trim()
  return (
    item?.sourceType === "recurring" ||
    Boolean(item?.repeatLabel) ||
    Boolean(item?.seriesId || item?.familyId || item?.row?.series_id) ||
    (repeat && repeat !== "none")
  )
}

function withRepeatLabel(item) {
  if (!item) return item
  return {
    ...item,
    repeatLabel: item.repeatLabel || getRepeatLabel(item?.repeat ?? item?.row?.repeat_type, item?.repeatInterval ?? item?.row?.repeat_interval)
  }
}

function splitDayListSections(sourceText) {
  const normalized = String(sourceText ?? "").replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  const scheduleLines = []
  const taskLines = []
  const taskLineMap = []

  lines.forEach((line, index) => {
    if (parseTaskSuffix(String(line ?? "").trim())) {
      taskLines.push(String(line ?? ""))
      taskLineMap.push(index)
      return
    }
    scheduleLines.push(String(line ?? ""))
  })

  return {
    scheduleText: scheduleLines.join("\n").trim(),
    taskText: taskLines.join("\n").trim(),
    taskLineMap
  }
}

function parseDraftTimeOnlyLine(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return null

  const semicolonParts = raw.includes(";") ? raw.split(";") : []
  const semicolonTime = semicolonParts.length > 1 ? normalizeTimeTokenOrRange(semicolonParts[0]) : ""
  if (semicolonTime) {
    const text = String(semicolonParts.slice(1).join(";") ?? "").trim()
    if (!text) return null
    return { time: semicolonTime, text }
  }

  const timed = parseTimePrefix(raw)
  if (!timed?.time || !String(timed.text ?? "").trim()) return null
  return { time: timed.time, text: String(timed.text ?? "").trim() }
}

function composeScopedTaskDraftText(text, scopedCategoryTitle = "") {
  const raw = String(text ?? "").trim()
  if (!raw) return ""
  const scopedTitle = String(scopedCategoryTitle ?? "").trim()
  if (!scopedTitle) return raw

  const timed = parseDraftTimeOnlyLine(raw)
  if (timed) {
    const content = String(timed.text ?? "").trim()
    if (!content) return ""
    return [timed.time, `@${scopedTitle}`, content].filter(Boolean).join(";")
  }

  return `@${scopedTitle};${raw}`
}

function stripScopedTaskDraftText(text, scopedCategoryTitle = "") {
  let raw = decodeTaskLineBreaks(String(text ?? "").trim())
  const scopedTitle = String(scopedCategoryTitle ?? "").trim()
  if (!raw || !scopedTitle) return raw

  for (let i = 0; i < 4; i += 1) {
    const semicolon = parseDashboardSemicolonLine(raw, { allowEmptyText: true })
    if (semicolon && String(semicolon.group ?? "").trim() === scopedTitle) {
      const content = decodeTaskLineBreaks(String(semicolon.text ?? "").trim())
      if (!content) return ""
      raw = [semicolon.time, content].filter(Boolean).join(" ")
      continue
    }

    const timed = parseLeadingTimeDashboardLine(raw, { allowEmptyText: true })
    if (timed && String(timed.group ?? "").trim() === scopedTitle) {
      const content = decodeTaskLineBreaks(String(timed.text ?? "").trim())
      if (!content) return ""
      raw = [timed.time, content].filter(Boolean).join(" ")
      continue
    }

    break
  }

  return raw
}

function normalizeTaskDraftLine(line, scopedCategoryTitle = "") {
  const raw = String(line ?? "")
  const trimmed = raw.trim()
  if (!trimmed) return ""
  const stripped = stripTaskSuffix(trimmed)
  const text = composeScopedTaskDraftText(stripped.text, scopedCategoryTitle)
  if (!text) return ""
  return buildTaskMetaText(text, {
    completed: stripped.completed ?? false
  })
}

function joinDayListSections(scheduleText, taskText, scopedCategoryTitle = "") {
  const schedule = String(scheduleText ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => String(line ?? "").trim())
    .filter(Boolean)
    .join("\n")
  const task = String(taskText ?? "")
    .replace(/\r\n/g, "\n")
    .split(TASK_DRAFT_ROW_SEPARATOR)
    .map((line) => normalizeTaskDraftLine(line, scopedCategoryTitle))
    .filter(Boolean)
    .join("\n")
  return [schedule, task].filter(Boolean).join("\n")
}

function splitTaskDraftRows(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n")
  if (!normalized) return [""]
  const rows = normalized.split(TASK_DRAFT_ROW_SEPARATOR)
  return rows.length ? rows : [""]
}

function splitTaskDraftEntries(text, scopedCategoryTitle = "") {
  const rows = splitTaskDraftRows(text)
  return rows.map((row) => {
    const parsed = stripTaskSuffix(row)
    return {
      text: stripScopedTaskDraftText(parsed.text || "", scopedCategoryTitle),
      completed: parsed.completed ?? false
    }
  })
}

function mergeAllRowsIntoTaskDraft(text, scopedCategoryTitle = "") {
  const split = splitDayListSections(text)
  const scheduleRows = String(split.scheduleText ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => normalizeTaskDraftLine(line, scopedCategoryTitle))
    .filter(Boolean)
  const taskRows = String(split.taskText ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => normalizeTaskDraftLine(line, scopedCategoryTitle))
    .filter(Boolean)
  return [...scheduleRows, ...taskRows].join(TASK_DRAFT_ROW_SEPARATOR)
}

export default function DayListModal({
  open,
  onClose,
  readOnly = false,
  ui,
  highlightTokens,
  dayListKey = "",
  dayListTitle,
  isToday = false,
  setDayListMode,
  dayListEditText,
  setDayListEditText,
  applyDayListEdit,
  dayListReadItems,
  memoFontPx,
  editableWindows = [],
  windowColorByTitle,
  scopedCategoryTitle = "",
  recurringItems = [],
  taskItems = [],
  onTaskToggle,
  onRecurringCreate,
  onRecurringSelect,
  onRecurringInlineSave
}) {
  const panelRef = useRef(null)
  const taskTextareaRef = useRef(null)
  const taskRowInputRefs = useRef(new Map())
  const activeTextareaRef = useRef(null)
  const caretMirrorRef = useRef(null)
  const caretMarkerRef = useRef(null)
  const mentionOptionRefs = useRef(new Map())
  const backdropPressStartedRef = useRef(false)
  const [pendingTaskLineIndex, setPendingTaskLineIndex] = useState(null)
  const [scheduleDraftText, setScheduleDraftText] = useState("")
  const [taskDraftText, setTaskDraftText] = useState("")
  const [recurringTaskDrafts, setRecurringTaskDrafts] = useState({})
  const [mentionState, setMentionState] = useState({
    visible: false,
    query: "",
    anchorPos: -1,
    tokenEnd: -1
  })
  const [mentionHoverId, setMentionHoverId] = useState(null)
  const [pendingTaskRowFocus, setPendingTaskRowFocus] = useState(null)

  const effectiveMode = readOnly ? "read" : "edit"
  const mentionMatches = useMemo(
    () => buildMentionMatches(editableWindows, mentionState.query),
    [editableWindows, mentionState.query]
  )
  const splitSections = useMemo(() => splitDayListSections(dayListEditText), [dayListEditText])
  const readOrderedItems = useMemo(() => {
    if (Array.isArray(dayListReadItems?.orderedItems)) {
      return dayListReadItems.orderedItems
        .map((item) => ({
          time: String(item?.time ?? "").trim(),
          text: String(item?.text ?? "").trim(),
          title: String(item?.title ?? "").trim()
        }))
        .filter((item) => item.text)
    }

    const timed = Array.isArray(dayListReadItems?.timedItems) ? dayListReadItems.timedItems : []
    const noTime = Array.isArray(dayListReadItems?.noTimeItems) ? dayListReadItems.noTimeItems : []
    const ordered = []

    for (const item of timed) {
      if (item && typeof item === "object") {
        ordered.push({
          time: String(item.time ?? "").trim(),
          text: String(item.text ?? "").trim(),
          title: String(item.title ?? "").trim()
        })
      } else {
        ordered.push({ time: "", text: String(item ?? "").trim(), title: "" })
      }
    }
    for (const item of noTime) {
      if (item && typeof item === "object") {
        ordered.push({
          time: "",
          text: String(item.text ?? "").trim(),
          title: String(item.title ?? "").trim()
        })
      } else {
        ordered.push({ time: "", text: String(item ?? "").trim(), title: "" })
      }
    }
    return ordered.filter((item) => item.text)
  }, [dayListReadItems])
  const recurringScheduleCards = useMemo(() => {
    return (Array.isArray(recurringItems) ? recurringItems : [])
      .map((item) => {
        const parsed = parseRecurringRawLine(item?.rawLine, item?.title ?? "")
        if (parsed.isTask) return null
        return {
          ...item,
          display: parsed.display || item?.display || "",
          repeatLabel: getRepeatLabel(item?.repeat, item?.repeatInterval)
        }
      })
      .filter((item) => item?.display)
  }, [recurringItems])
  const taskCards = useMemo(() => {
    return (Array.isArray(taskItems) ? taskItems : []).filter((item) => String(item?.display ?? "").trim())
  }, [taskItems])
  const recurringTaskCards = useMemo(
    () =>
      taskCards
        .filter((item) => isRecurringTaskLike(item))
        .map((item) => withRepeatLabel(item)),
    [taskCards]
  )
  const combinedReadRows = useMemo(() => {
    if (taskCards.length > 0) {
      return taskCards.map((item) => ({
        kind: isRecurringTaskLike(item) ? "recurring-task" : "task",
        key: `${isRecurringTaskLike(item) ? "recurring-task" : "task"}-${item.id}`,
        item: isRecurringTaskLike(item) ? withRepeatLabel(item) : item
      }))
    }

    const rows = []
    readOrderedItems.forEach((item, idx) => {
      rows.push({ kind: "schedule", key: `schedule-${idx}`, item })
    })
    recurringScheduleCards.forEach((item) => {
      rows.push({ kind: "recurring-schedule", key: `recurring-schedule-${item.id}`, item })
    })
    return rows
  }, [taskCards, readOrderedItems, recurringScheduleCards])
  const taskDraftEntries = useMemo(
    () => splitTaskDraftEntries(taskDraftText, scopedCategoryTitle),
    [taskDraftText, scopedCategoryTitle]
  )
  const combinedEditRows = useMemo(() => {
    const rows = []
    const regularTaskCards = taskCards.filter((item) => !isRecurringTaskLike(item))
    taskDraftEntries.forEach((entry, regularIndex) => {
      rows.push({
        kind: "regular",
        key: `task-regular-edit-${regularTaskCards[regularIndex]?.id ?? regularIndex}`,
        index: regularIndex,
        item: regularTaskCards[regularIndex] ?? null,
        entry
      })
    })
    if (rows.length === 0) {
      rows.push({
        kind: "regular",
        key: "task-regular-empty-0",
        index: 0,
        item: null,
        entry: {
          text: "",
          completed: false
        }
      })
    }
    for (const item of recurringTaskCards) {
      rows.push({
        kind: "recurring",
        key: `task-recurring-edit-${item.id}`,
        item: withRepeatLabel(item)
      })
    }
    return rows
  }, [taskCards, recurringTaskCards, taskDraftEntries])

  function hideMentionMenu() {
    setMentionState((prev) =>
      prev.visible || prev.query || prev.anchorPos !== -1 || prev.tokenEnd !== -1
        ? { visible: false, query: "", anchorPos: -1, tokenEnd: -1 }
        : prev
    )
  }

  function refreshMentionMenu() {
    hideMentionMenu()
  }

  function updateDayListText(nextText) {
    setDayListEditText(nextText)
    applyDayListEdit(nextText)
  }

  function updateSplitDrafts(nextScheduleText, nextTaskText) {
    setScheduleDraftText(nextScheduleText)
    setTaskDraftText(nextTaskText)
    updateDayListText(joinDayListSections(nextScheduleText, nextTaskText, scopedCategoryTitle))
  }

  function updateTaskDraftEntries(nextEntries) {
    const nextTaskText = nextEntries
      .map((entry) => {
        const text = String(entry?.text ?? "").trim()
        if (!text) return ""
        return buildTaskMetaText(text, {
          completed: Boolean(entry?.completed)
        })
      })
      .join(TASK_DRAFT_ROW_SEPARATOR)
    updateSplitDrafts(scheduleDraftText, nextTaskText)
  }

  function getRecurringDraftText(item) {
    const itemId = String(item?.id ?? "").trim()
    if (itemId && Object.prototype.hasOwnProperty.call(recurringTaskDrafts, itemId)) {
      return recurringTaskDrafts[itemId]
    }
    const parsed = stripTaskSuffix(String(item?.rawLine ?? item?.baseRaw ?? "").trim())
    return String(parsed.text ?? item?.baseRaw ?? item?.text ?? "").trim()
  }

  function handleTaskRowChange(index, nextValue) {
    const nextEntries = [...taskDraftEntries]
    nextEntries[index] = {
      ...(nextEntries[index] ?? { completed: false }),
      text: nextValue
    }
    updateTaskDraftEntries(nextEntries)
  }

  function handleTaskRowKeyDown(index, e) {
    if (e.key === "Enter" && e.shiftKey) {
      requestAnimationFrame(() => {
        const input = taskRowInputRefs.current.get(index)
        if (!input) return
        input.style.height = "auto"
        input.style.height = `${Math.min(120, Math.max(34, input.scrollHeight))}px`
      })
      return
    }

    if (e.key === "Enter") {
      e.preventDefault()
      const nextEntries = [...taskDraftEntries]
      nextEntries.splice(index + 1, 0, {
        text: "",
        completed: false
      })
      updateTaskDraftEntries(nextEntries)
      setPendingTaskRowFocus({ index: index + 1, caret: 0 })
      return
    }

    if (e.key === "Backspace" && !String(taskDraftEntries[index]?.text ?? "")) {
      if (taskDraftEntries.length <= 1) return
      e.preventDefault()
      const nextEntries = [...taskDraftEntries]
      nextEntries.splice(index, 1)
      updateTaskDraftEntries(nextEntries)
      const nextIndex = Math.max(0, index - 1)
      const prevValue = String(nextEntries[nextIndex]?.text ?? "")
      setPendingTaskRowFocus({ index: nextIndex, caret: prevValue.length })
    }
  }

  function handleTaskRowPaste(index, e) {
    const pasted = e.clipboardData?.getData("text/plain") ?? ""
    if (!pasted.includes("\n")) return
    e.preventDefault()
    const lines = pasted.replace(/\r\n/g, "\n").split("\n")
    const pastedEntries = lines.map((line) => {
      const parsed = stripTaskSuffix(line)
      return {
        text: parsed.text || "",
        completed: parsed.completed ?? false
      }
    })
    const nextEntries = [...taskDraftEntries]
    nextEntries.splice(index, 1, ...pastedEntries)
    updateTaskDraftEntries(nextEntries)
    const nextIndex = index + lines.length - 1
    const lastValue = String(pastedEntries[pastedEntries.length - 1]?.text ?? "")
    setPendingTaskRowFocus({ index: nextIndex, caret: lastValue.length })
  }

  function handleDraftRowRecurringCreate(index) {
    const row = combinedEditRows.find((item) => item.kind === "regular" && item.index === index)
    const entry = row?.entry ?? taskDraftEntries[index]
    const baseDraftLine = buildTaskMetaText(String(entry?.text ?? "").trim(), {
      completed: false
    })
    const rawLine = normalizeTaskDraftLine(baseDraftLine, "")
    const sourceRawLine = normalizeTaskDraftLine(baseDraftLine, scopedCategoryTitle)
    const categoryTitle = String(row?.item?.title ?? scopedCategoryTitle ?? "").trim()
    const parsed = parseRecurringRawLine(rawLine, categoryTitle)
    const sourceTask = row?.item
      ? {
          ...row.item,
          rawLine: sourceRawLine,
          baseRaw: parsed.baseRaw || String(entry?.text ?? "").trim(),
          text: parsed.text || String(entry?.text ?? "").trim(),
          title: parsed.title || row.item?.title || "",
          time: parsed.time || "",
          display: parsed.display || String(entry?.text ?? "").trim()
        }
      : null
    onRecurringCreate?.({
      kind: "task",
      rawLine,
      categoryTitle,
      sourceTask,
      sourceLineIndex: Number.isInteger(row?.item?.lineIndex) ? row.item.lineIndex : index
    })
  }

  function handleRecurringDraftChange(item, nextValue) {
    const itemId = String(item?.id ?? "").trim()
    if (!itemId) return
    setRecurringTaskDrafts((prev) => ({
      ...prev,
      [itemId]: nextValue
    }))
  }

  function beginEditMode(taskLineIndex = null) {
    const mergedTaskDraft = mergeAllRowsIntoTaskDraft(dayListEditText, scopedCategoryTitle)
    setScheduleDraftText("")
    setTaskDraftText(mergedTaskDraft)
    setPendingTaskLineIndex(Number.isInteger(taskLineIndex) ? taskLineIndex : null)
    setDayListMode("edit")
  }

  function handleEditShellPointerDownCapture(e) {
    if (readOnly || effectiveMode !== "edit") return
    const target = e.target instanceof Element ? e.target : null
    if (!target) return
    if (target.closest("textarea, button, input, select, option, [data-keep-edit='true']")) return
    hideMentionMenu()
  }

  function ensureTextareaCaretVisible(textarea) {
    const ta = textarea
    const panel = panelRef.current
    const mirror = caretMirrorRef.current
    const marker = caretMarkerRef.current
    if (!ta || !panel || !mirror || !marker) return

    const value = ta.value ?? ""
    const caretPos = ta.selectionEnd ?? ta.selectionStart ?? value.length
    const { top } = measureCharPosPx(ta, mirror, marker, value, caretPos)
    const lineHeightPx = getLineHeightPx(ta)
    const caretBottom = top + lineHeightPx
    const topPadding = Math.max(8, Math.round(lineHeightPx * 0.45))
    const bottomPadding = Math.max(12, Math.round(lineHeightPx * 0.9))
    const maxScrollTop = Math.max(0, ta.scrollHeight - ta.clientHeight)

    let nextScrollTop = ta.scrollTop
    const visibleTop = ta.scrollTop + topPadding
    const visibleBottom = ta.scrollTop + ta.clientHeight - bottomPadding
    if (caretBottom > visibleBottom) {
      nextScrollTop = Math.min(maxScrollTop, caretBottom - ta.clientHeight + bottomPadding)
    } else if (top < visibleTop) {
      nextScrollTop = Math.max(0, top - topPadding)
    }
    if (Math.abs(nextScrollTop - ta.scrollTop) > 1) {
      ta.scrollTop = nextScrollTop
    }

    const panelRect = panel.getBoundingClientRect()
    const taRect = ta.getBoundingClientRect()
    const caretViewportTop = taRect.top + (top - ta.scrollTop)
    const caretViewportBottom = caretViewportTop + lineHeightPx
    const panelTop = panelRect.top + 12
    const panelBottom = panelRect.bottom - 12

    if (caretViewportBottom > panelBottom) {
      panel.scrollTop += caretViewportBottom - panelBottom
    } else if (caretViewportTop < panelTop) {
      panel.scrollTop += caretViewportTop - panelTop
    }
  }

  function scrollMentionOptionIntoView(optionId) {
    if (!optionId) return
    const target = mentionOptionRefs.current.get(optionId)
    if (!target) return
    target.scrollIntoView({ block: "nearest" })
  }

  function handleMentionPick(title) {
    const ta = activeTextareaRef.current
    if (!ta) return
    const value = ta.value ?? ""
    const caret = ta.selectionStart ?? 0
    const context =
      getMentionContext(value, caret) ??
      (mentionState.anchorPos >= 0 && mentionState.tokenEnd >= mentionState.anchorPos
        ? { anchorPos: mentionState.anchorPos, tokenEnd: mentionState.tokenEnd }
        : null)
    if (!context) return

    // Only replace the full token when it is already a category mention like "@title;...".
    // If the user inserted "@" in front of existing text, keep that trailing text intact.
    const replaceFullToken = value[context.tokenEnd] === ";"
    const replaceEnd = replaceFullToken
      ? Math.max(context.tokenEnd, context.anchorPos + 1)
      : Math.max(caret, context.anchorPos + 1)
    const nextChar = value[replaceEnd] ?? ""
    const insert = `@${title}${nextChar === ";" ? "" : ";"}`
    const nextText = value.slice(0, context.anchorPos) + insert + value.slice(replaceEnd)
    const nextCaret = context.anchorPos + insert.length
    const isTaskEditor = ta === taskTextareaRef.current
    const nextScheduleDraft = isTaskEditor ? scheduleDraftText : nextText
    const nextTaskDraft = isTaskEditor ? nextText : taskDraftText

    updateSplitDrafts(nextScheduleDraft, nextTaskDraft)
    hideMentionMenu()
    requestAnimationFrame(() => {
      const el = activeTextareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCaret, nextCaret)
      refreshMentionMenu()
    })
  }

  useEffect(() => {
    if (!open || readOnly) return
    const mergedTaskDraft = mergeAllRowsIntoTaskDraft(dayListEditText, scopedCategoryTitle)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScheduleDraftText("")
    setTaskDraftText(mergedTaskDraft)
    setPendingTaskLineIndex(null)
    hideMentionMenu()
  }, [open, readOnly, dayListKey, scopedCategoryTitle])

  useEffect(() => {
    if (!open || effectiveMode !== "edit") {
      const rafId = requestAnimationFrame(() => {
        hideMentionMenu()
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [open, effectiveMode])

  useEffect(() => {
    if (!mentionState.visible || !mentionHoverId) return
    const rafId = requestAnimationFrame(() => {
      scrollMentionOptionIntoView(mentionHoverId)
    })
    return () => cancelAnimationFrame(rafId)
  }, [mentionState.visible, mentionHoverId])

  useEffect(() => {
    if (!open || effectiveMode !== "edit") return
    const ta = activeTextareaRef.current
    if (!ta || document.activeElement !== ta) return
    const rafId = requestAnimationFrame(() => {
      ensureTextareaCaretVisible(ta)
    })
    return () => cancelAnimationFrame(rafId)
  }, [open, effectiveMode, scheduleDraftText, taskDraftText])

  useEffect(() => {
    if (!open || effectiveMode !== "edit") return
    if (!Number.isInteger(pendingTaskLineIndex) || pendingTaskLineIndex < 0) return

    const taskEditorIndex = splitSections.taskLineMap.indexOf(pendingTaskLineIndex)
    const lines = splitTaskDraftRows(taskDraftText)
    const targetIndex = Math.max(0, Math.min(taskEditorIndex >= 0 ? taskEditorIndex : 0, Math.max(0, lines.length - 1)))
    const rafId = requestAnimationFrame(() => {
      const targetValue = String(lines[targetIndex] ?? "")
      setPendingTaskRowFocus({ index: targetIndex, caret: targetValue.length })
      setPendingTaskLineIndex(null)
    })

    return () => cancelAnimationFrame(rafId)
  }, [open, effectiveMode, pendingTaskLineIndex, splitSections.taskLineMap, taskDraftText])

  useEffect(() => {
    if (!open || effectiveMode !== "edit") return
    if (!pendingTaskRowFocus || !Number.isInteger(pendingTaskRowFocus.index)) return
    const rafId = requestAnimationFrame(() => {
      const input = taskRowInputRefs.current.get(pendingTaskRowFocus.index)
      if (!input) return
      input.focus()
      const caretPos = Math.max(0, Math.min(Number(pendingTaskRowFocus.caret) || 0, input.value.length))
      input.setSelectionRange(caretPos, caretPos)
      input.scrollIntoView({ block: "nearest" })
      setPendingTaskRowFocus(null)
    })
    return () => cancelAnimationFrame(rafId)
  }, [open, effectiveMode, pendingTaskRowFocus, taskDraftEntries.length])

  useEffect(() => {
    if (!open || effectiveMode !== "edit") return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecurringTaskDrafts((prev) => {
      const next = {}
      for (const item of recurringTaskCards) {
        const itemId = String(item?.id ?? "").trim()
        if (!itemId) continue
        const parsed = stripTaskSuffix(String(item?.rawLine ?? item?.baseRaw ?? "").trim())
        next[itemId] =
          Object.prototype.hasOwnProperty.call(prev, itemId)
            ? prev[itemId]
            : String(parsed.text ?? item?.baseRaw ?? item?.text ?? "").trim()
      }
      return next
    })
  }, [open, effectiveMode, recurringTaskCards])

  if (!open) return null

  return (
    <div
      onPointerDown={(e) => {
        backdropPressStartedRef.current = e.target === e.currentTarget
      }}
      onPointerUp={(e) => {
        const shouldClose = backdropPressStartedRef.current && e.target === e.currentTarget
        backdropPressStartedRef.current = false
        if (shouldClose) onClose()
      }}
      onPointerCancel={() => {
        backdropPressStartedRef.current = false
      }}
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
        ref={caretMirrorRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "-99999px",
          left: "-99999px",
          visibility: "hidden",
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
          wordBreak: "break-word"
        }}
      >
        <span ref={caretMarkerRef} />
      </div>
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        onPointerDownCapture={handleEditShellPointerDownCapture}
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
          gap: 10,
          overflowY: "auto"
        }}
        >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 900,
                display: "inline-flex",
                alignItems: "center",
                lineHeight: 1.1
              }}
            >
              {dayListTitle}
            </div>
            {isToday ? (
              <span
                style={{
                  minHeight: 24,
                  padding: "0 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 900,
                  lineHeight: 1,
                  color: highlightTokens?.today?.pillText ?? ui.accent,
                  border: `1px solid ${highlightTokens?.today?.pillText ?? ui.accent}`,
                  background: highlightTokens?.today?.soft ?? ui.surface2,
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxSizing: "border-box"
                }}
              >
                Today
              </span>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
          <div style={{ position: "relative", marginTop: 10 }}>
            {mentionState.visible && mentionMatches.length > 0 ? (
              <div
                style={{
                  position: "absolute",
                  right: 12,
                  top: 12,
                  minWidth: 120,
                  maxHeight: 170,
                  overflowY: "auto",
                  borderRadius: 8,
                  border: `1px solid ${ui.border}`,
                  background: ui.surface,
                  boxShadow: ui.shadow,
                  zIndex: 4,
                  display: "flex",
                  flexDirection: "column"
                }}
              >
                {mentionMatches.map((w) => (
                  <button
                    key={w.id}
                    ref={(el) => {
                      if (el) mentionOptionRefs.current.set(w.id, el)
                      else mentionOptionRefs.current.delete(w.id)
                    }}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleMentionPick(w.title)
                    }}
                    onMouseEnter={() => setMentionHoverId(w.id)}
                    style={{
                      height: 30,
                      padding: "0 10px",
                      textAlign: "left",
                      cursor: "pointer",
                      color: ui.text,
                      fontWeight: 700,
                      border: mentionHoverId === w.id ? `2px solid ${ui.accent}` : "2px solid transparent",
                      background: mentionHoverId === w.id ? ui.surface2 : "transparent",
                      boxSizing: "border-box"
                    }}
                  >
                    {w.title}
                  </button>
                ))}
              </div>
            ) : null}
            <div data-keep-edit="true" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div
                  data-keep-edit="true"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    padding: "8px",
                    borderRadius: 10,
                    border: `1px solid ${ui.border2}`,
                    background: ui.surface2,
                    overflow: "hidden"
                  }}
                >
                  {combinedEditRows.map((row, idx) => (
                    <div
                      data-keep-edit="true"
                      key={row.key}
                      style={{
                        borderTop: idx === 0 ? "none" : `1px solid ${ui.border}`
                      }}
                    >
                      {row.kind === "regular" ? (
                        <TaskDraftRow
                          ui={ui}
                          memoFontPx={memoFontPx}
                          value={row.entry.text}
                          placeholder={idx === 0 ? "예: 13:00 공부, 13:00 14:00 회의" : ""}
                          inputRef={(el) => {
                            if (el) taskRowInputRefs.current.set(row.index, el)
                            else taskRowInputRefs.current.delete(row.index)
                          }}
                          onFocus={() => {
                            activeTextareaRef.current = null
                            hideMentionMenu()
                          }}
                          onChange={(e) => handleTaskRowChange(row.index, e.target.value)}
                          onKeyDown={(e) => handleTaskRowKeyDown(row.index, e)}
                          onPaste={(e) => handleTaskRowPaste(row.index, e)}
                          onAction={() => handleDraftRowRecurringCreate(row.index)}
                        />
                      ) : (
                        <TaskDraftRow
                          ui={ui}
                          memoFontPx={memoFontPx}
                          value={getRecurringDraftText(row.item)}
                          onFocus={() => {
                            activeTextareaRef.current = null
                            hideMentionMenu()
                          }}
                          onChange={(e) => handleRecurringDraftChange(row.item, e.target.value)}
                          onBlur={() => {
                            const nextText = getRecurringDraftText(row.item)
                            onRecurringInlineSave?.(row.item, nextText)
                          }}
                          onPress={() =>
                            onRecurringSelect?.({
                              ...row.item,
                            rawLine: buildTaskMetaText(getRecurringDraftText(row.item), {
                                completed: row.item?.completed ?? false
                              })
                            })
                          }
                          onAction={() =>
                            onRecurringSelect?.({
                              ...row.item,
                            rawLine: buildTaskMetaText(getRecurringDraftText(row.item), {
                                completed: row.item?.completed ?? false
                              })
                            })
                          }
                          actionTitle="반복 설정"
                          rightMeta={
                            row.item?.repeatLabel ? (
                              <span
                                style={{
                                  ...REPEAT_BADGE_STYLE,
                                  border: `1px solid ${ui.border}`,
                                  background: ui.surface,
                                  color: ui.text2
                                }}
                              >
                                {row.item.repeatLabel}
                              </span>
                            ) : null
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}>
            {combinedReadRows.length > 0 ? (
              <SectionBox ui={ui} empty={false} onClick={!readOnly ? () => beginEditMode() : undefined}>
                {combinedReadRows.map((row, idx) => (
                  <div
                    key={row.key}
                    style={{
                      borderTop: idx === 0 ? "none" : `1px solid ${ui.border}`,
                      paddingTop: idx === 0 ? 0 : 6,
                      marginTop: idx === 0 ? 0 : 2
                    }}
                  >
                    {row.kind === "schedule" ? (
                      <ScheduleReadRow item={row.item} ui={ui} memoFontPx={memoFontPx} windowColorByTitle={windowColorByTitle} />
                    ) : null}
                    {row.kind === "recurring-schedule" ? (
                      <RecurringScheduleRow
                        item={row.item}
                        ui={ui}
                        memoFontPx={memoFontPx}
                        windowColorByTitle={windowColorByTitle}
                        onOpen={(item) => {
                          if (readOnly) return
                          onRecurringSelect?.(item)
                        }}
                      />
                    ) : null}
                    {row.kind === "task" ? (
                      <RegularTaskReadRow
                        item={row.item}
                        ui={ui}
                        memoFontPx={memoFontPx}
                        onOpen={(item) => {
                          if (readOnly) return
                          beginEditMode(Number.isInteger(item?.lineIndex) ? item.lineIndex : 0)
                        }}
                        onToggle={onTaskToggle}
                        windowColorByTitle={windowColorByTitle}
                      />
                    ) : null}
                    {row.kind === "recurring-task" ? (
                      <RecurringTaskRow
                        item={row.item}
                        ui={ui}
                        memoFontPx={memoFontPx}
                        windowColorByTitle={windowColorByTitle}
                        onOpen={(item) => {
                          if (readOnly) return
                          onRecurringSelect?.(item)
                        }}
                        onToggle={onTaskToggle}
                      />
                    ) : null}
                  </div>
                ))}
              </SectionBox>
            ) : null}
            {combinedReadRows.length === 0 ? (
              <SectionBox ui={ui} empty onClick={!readOnly ? () => beginEditMode() : undefined}>
                <div style={{ color: ui.text2 }}>No content.</div>
              </SectionBox>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

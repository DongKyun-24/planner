import { useEffect, useMemo, useRef, useState } from "react"
import { dayOfWeek, keyToYMD } from "../utils/dateUtils"
import { WEEKDAY_LABELS, normalizeRepeatDays } from "../utils/recurringRules"

const MODAL_FONT_FAMILY =
  "Pretendard Variable, Pretendard, 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif"

const ALARM_LEAD_OPTIONS = [
  { key: 0, label: "정시" },
  { key: 5, label: "5분 전" },
  { key: 10, label: "10분 전" },
  { key: 30, label: "30분 전" }
]

function parseHexColor(value) {
  const raw = String(value ?? "").trim().replace("#", "")
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16)
  }
}

function isDarkSurface(ui) {
  const rgb = parseHexColor(ui?.surface || ui?.bg)
  if (!rgb) return false
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  return luminance < 0.42
}

function getReadableTextOnColor(value) {
  const rgb = parseHexColor(value)
  if (!rgb) return "#ffffff"
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  return luminance > 0.72 ? "#0f172a" : "#ffffff"
}

function buildModalPalette(ui) {
  const dark = isDarkSurface(ui)
  return {
    dark,
    backdrop: dark ? "rgba(2, 6, 23, 0.62)" : "rgba(15, 23, 42, 0.35)",
    modalBg: dark
      ? `linear-gradient(180deg, ${ui.surface2} 0%, ${ui.surface} 100%)`
      : ui.surface,
    fieldBg: dark ? "rgba(255, 255, 255, 0.055)" : "rgba(248, 250, 252, 0.72)",
    fieldFocusBg: dark ? "rgba(255, 255, 255, 0.075)" : ui.surface,
    fieldDisabledBg: dark ? "rgba(255, 255, 255, 0.035)" : "rgba(248, 250, 252, 0.52)",
    fieldDisabledText: dark ? "rgba(230, 232, 236, 0.48)" : ui.text2,
    controlBg: dark ? "rgba(255, 255, 255, 0.06)" : ui.surface2,
    chipBg: dark ? "rgba(255, 255, 255, 0.055)" : "rgba(248, 250, 252, 0.72)",
    switchOffBg: dark ? "rgba(255, 255, 255, 0.08)" : ui.surface2,
    switchThumbOff: dark ? "rgba(226, 232, 240, 0.78)" : "#ffffff",
    dangerBg: dark ? "rgba(239, 68, 68, 0.08)" : ui.surface,
    optionBg: dark ? ui.surface2 : ui.surface,
    shadow: dark ? "0 20px 52px rgba(0, 0, 0, 0.56)" : ui.shadow
  }
}

function buildFieldStyle(ui, palette) {
  return {
    width: "100%",
    minHeight: 46,
    borderRadius: 11,
    border: `1px solid ${ui.border}`,
    background: palette.fieldBg,
    color: ui.text,
    padding: "0 13px",
    fontFamily: "inherit",
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: 0,
    boxSizing: "border-box",
    outline: "none",
    colorScheme: palette.dark ? "dark" : "light",
    boxShadow: palette.dark ? "inset 0 1px 0 rgba(255, 255, 255, 0.03)" : "inset 0 1px 0 rgba(15, 23, 42, 0.02)",
    transition: "border-color 140ms ease, box-shadow 140ms ease, background 140ms ease"
  }
}

function buildLabelStyle(ui) {
  return {
    fontSize: 13,
    fontWeight: 650,
    lineHeight: 1.25,
    letterSpacing: 0,
    color: ui.text2
  }
}

function getDefaultWeeklyDays(dateKey) {
  const key = String(dateKey ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return []
  const { y, m, d } = keyToYMD(key)
  return [dayOfWeek(y, m, d)]
}

function normalizeAlarmLeadMinutes(value) {
  const n = Number.parseInt(String(value ?? "0"), 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return ALARM_LEAD_OPTIONS.some((option) => option.key === n) ? n : 0
}

function buildOptionList(categoryOptions, selectedTitle) {
  const seen = new Set([""])
  const out = [{ id: "", title: "없음", value: "" }]
  for (const option of Array.isArray(categoryOptions) ? categoryOptions : []) {
    const title = String(option?.title ?? option?.value ?? "").trim()
    const value = String(option?.value ?? title).trim()
    if (!title || seen.has(value)) continue
    seen.add(value)
    out.push({ id: String(option?.id ?? value), title, value, color: String(option?.color ?? "").trim() })
  }
  const selected = String(selectedTitle ?? "").trim()
  if (selected && !seen.has(selected)) out.push({ id: selected, title: selected, value: selected, color: "" })
  return out
}

function splitTimeRange(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return { startTime: "", endTime: "" }
  const match = raw.match(/^(\d{1,2}:\d{2})(?:\s*[~-]\s*|\s+)(\d{1,2}:\d{2})$/)
  if (match) return { startTime: match[1], endTime: match[2] }
  return { startTime: raw, endTime: "" }
}

function normalizeTimeInput(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  const match = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return raw
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return raw
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return raw
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function SelectChevron({ ui }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        right: 12,
        top: "50%",
        transform: "translateY(-50%)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        pointerEvents: "none",
        color: ui.text
      }}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path
          d="M5.5 7.7 10 12.2l4.5-4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

function buildSelectFieldStyle(fieldStyle, extra = {}) {
  return {
    ...fieldStyle,
    paddingRight: 44,
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    ...extra
  }
}

function parseTimeParts(value) {
  const normalized = normalizeTimeInput(value)
  const match = normalized.match(/^(\d{2}):(\d{2})$/)
  const hour24 = match ? Number(match[1]) : 9
  const minute = match ? Number(match[2]) : 0
  const period = hour24 >= 12 ? "pm" : "am"
  const hour12 = hour24 % 12 || 12
  return {
    hour24: Math.max(0, Math.min(23, Number.isFinite(hour24) ? hour24 : 9)),
    minute: Math.max(0, Math.min(59, Number.isFinite(minute) ? minute : 0)),
    period,
    hour12
  }
}

function buildTimeFromParts(currentValue, patch = {}) {
  const current = parseTimeParts(currentValue)
  const nextPeriod = patch.period ?? current.period
  const nextHour12 = Math.max(1, Math.min(12, Number(patch.hour12 ?? current.hour12) || current.hour12))
  const nextMinute = Math.max(0, Math.min(59, Number(patch.minute ?? current.minute) || 0))
  let hour24 = nextHour12 % 12
  if (nextPeriod === "pm") hour24 += 12
  return `${String(hour24).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`
}

function formatModalTimeLabel(value) {
  const normalized = normalizeTimeInput(value)
  if (!normalized) return ""
  const { hour24, minute } = parseTimeParts(normalized)
  const period = hour24 >= 12 ? "오후" : "오전"
  const hour12 = hour24 % 12 || 12
  return `${period} ${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function addMinutesToTime(value, minutesToAdd = 60) {
  const normalized = normalizeTimeInput(value)
  if (!normalized) return ""
  const [hourText, minuteText] = normalized.split(":")
  const total = (Number(hourText) * 60 + Number(minuteText) + minutesToAdd + 24 * 60) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

function TimeField({
  value,
  defaultValue,
  placeholder,
  ui,
  palette,
  fieldStyle,
  onOpen,
  onChange,
  allowClear = true,
  active = false,
  ariaLabel = "시간 선택"
}) {
  const normalizedValue = normalizeTimeInput(value)
  const pickerValue = normalizedValue || normalizeTimeInput(defaultValue) || "09:00"
  const hasValue = Boolean(normalizedValue)

  return (
    <div
      className={`plan-setting-field plan-time-field ${hasValue ? "has-value" : "is-empty"} ${active ? "is-active-field" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen?.()
        }
      }}
      style={{
        ...fieldStyle,
        minHeight: 58,
        padding: "9px 11px 9px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        cursor: "pointer"
      }}
    >
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: hasValue ? ui.text : palette.fieldDisabledText,
          fontWeight: 680
        }}
      >
        {hasValue ? formatModalTimeLabel(pickerValue) : placeholder}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {allowClear ? (
          <button
            type="button"
            className={`plan-time-clear-button ${hasValue ? "" : "is-muted"}`}
            onClick={(event) => {
              event.stopPropagation()
              if (hasValue) onChange?.("")
            }}
            style={{
              height: 24,
              minWidth: 40,
              padding: "0 9px",
              borderRadius: 999,
              border: `1px solid ${ui.border}`,
              background: palette.chipBg,
              color: ui.text2,
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 700,
              cursor: hasValue ? "pointer" : "default",
              opacity: hasValue ? 1 : 0.68
            }}
          >
            없음
          </button>
        ) : null}
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false" style={{ color: ui.text2 }}>
          <circle cx="10" cy="10" r="7.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M10 5.8v4.4l3 1.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  )
}

function TimePickerPanel({ value, defaultValue, ui, palette, onClose, onChange, allowClear = true }) {
  const normalizedValue = normalizeTimeInput(value)
  const pickerValue = normalizedValue || normalizeTimeInput(defaultValue) || "09:00"
  const current = parseTimeParts(pickerValue)
  const hourOptions = useMemo(() => Array.from({ length: 12 }, (_, index) => index + 1), [])
  const minuteOptions = useMemo(() => Array.from({ length: 60 }, (_, index) => index), [])

  function applyTimePatch(patch) {
    const next = buildTimeFromParts(pickerValue, patch)
    onChange?.(next)
  }

  return (
    <div
      className="plan-time-picker-panel"
      onClick={(event) => event.stopPropagation()}
      style={{
        borderRadius: 14,
        border: `1px solid ${ui.border}`,
        background: palette.optionBg,
        boxShadow: palette.dark ? "0 14px 32px rgba(0,0,0,0.30)" : "0 12px 28px rgba(15,23,42,0.12)",
        padding: 8
      }}
    >
            <div
              className="plan-time-picker-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "72px minmax(0, 1fr) minmax(0, 1fr)",
                gap: 7,
                alignItems: "stretch"
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 5, alignSelf: "start", paddingTop: 20 }}>
                {[
                  ["am", "오전"],
                  ["pm", "오후"]
                ].map(([period, text]) => {
                  const active = current.period === period
                  return (
                    <button
                      key={`period-${period}`}
                      type="button"
                      className={`plan-time-option plan-time-period-option ${active ? "is-active" : ""}`}
                      onClick={() => applyTimePatch({ period })}
                      style={{
                        height: 34,
                          borderRadius: 9,
                          border: `1px solid ${active ? ui.accent : ui.border}`,
                          background: active ? ui.accentSoft : palette.chipBg,
                        color: active ? ui.accent : ui.text2,
                        outline: "none",
                        fontFamily: "inherit",
                        fontSize: 13,
                        fontWeight: 780,
                        cursor: "pointer"
                      }}
                    >
                      {text}
                    </button>
                  )
                })}
              </div>

              <div>
                <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 780, color: ui.text2 }}>시</div>
                <div className="plan-time-scroll-list" style={{ maxHeight: 148, overflowY: "auto", paddingRight: 3 }}>
                  <div style={{ display: "grid", gap: 5 }}>
                  {hourOptions.map((hour) => {
                    const active = current.hour12 === hour
                    return (
                      <button
                        key={`hour-${hour}`}
                        type="button"
                        className={`plan-time-option ${active ? "is-active" : ""}`}
                        onClick={() => applyTimePatch({ hour12: hour })}
                        style={{
                          height: 29,
                          borderRadius: 8,
                          border: `1px solid ${active ? ui.accent : ui.border}`,
                          background: active ? ui.accent : palette.chipBg,
                          color: active ? getReadableTextOnColor(ui.accent) : ui.text,
                          outline: "none",
                          fontFamily: "inherit",
                          fontSize: 13,
                          fontWeight: 780,
                          cursor: "pointer"
                        }}
                      >
                        {String(hour).padStart(2, "0")}
                      </button>
                    )
                  })}
                  </div>
                </div>
              </div>

              <div>
                <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 780, color: ui.text2 }}>분</div>
                <div className="plan-time-scroll-list" style={{ maxHeight: 148, overflowY: "auto", paddingRight: 3 }}>
                  <div style={{ display: "grid", gap: 5 }}>
                  {minuteOptions.map((minute) => {
                    const active = current.minute === minute
                    return (
                      <button
                        key={`minute-${minute}`}
                        type="button"
                        className={`plan-time-option ${active ? "is-active" : ""}`}
                        onClick={() => applyTimePatch({ minute })}
                        style={{
                          height: 29,
                          borderRadius: 8,
                          border: `1px solid ${active ? ui.accent : ui.border}`,
                          background: active ? ui.accent : palette.chipBg,
                          color: active ? getReadableTextOnColor(ui.accent) : ui.text,
                          outline: "none",
                          fontFamily: "inherit",
                          fontSize: 13,
                          fontWeight: 780,
                          cursor: "pointer"
                        }}
                      >
                        {String(minute).padStart(2, "0")}
                      </button>
                    )
                  })}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
              {allowClear ? (
                <button
                  type="button"
                  className="plan-time-secondary-action"
                  onClick={() => {
                    onChange?.("")
                    onClose?.()
                  }}
                  style={{
                    height: 28,
                    padding: "0 11px",
                    borderRadius: 9,
                    border: `1px solid ${ui.border}`,
                    background: "transparent",
                    color: palette.fieldDisabledText,
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 740,
                    cursor: "pointer",
                    marginRight: 8
                  }}
                >
                  없음
                </button>
              ) : null}
              <button
                type="button"
                className="plan-time-primary-action"
                onClick={onClose}
                style={{
                  height: 28,
                  padding: "0 11px",
                  borderRadius: 9,
                  border: `1px solid ${ui.border}`,
                  background: palette.chipBg,
                  color: ui.text,
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 740,
                  cursor: "pointer"
                }}
              >
                완료
              </button>
            </div>
    </div>
  )
}

function QuickCreateModalBody({
  ui,
  editMode = "create",
  sourceItem = null,
  initialDateKey = "",
  initialEndDateKey = "",
  initialTime = "",
  initialRepeat = "none",
  initialRepeatInterval = 1,
  initialRepeatDays = [],
  initialRepeatOpenEnded = false,
  initialAlarmEnabled = true,
  initialAlarmLeadMinutes = 0,
  defaultCategoryTitle = "",
  initialContent = "",
  initialCompleted = false,
  showCategory = true,
  categoryOptions = [],
  onClose,
  onCreate,
  onDelete
}) {
  const contentInputRef = useRef(null)
  const initialDateValue = String(initialDateKey ?? "").trim()
  const initialRepeatValue = String(initialRepeat ?? "none").trim() || "none"
  const initialEndDateValue = String(initialEndDateKey ?? "").trim()
  const initialIsOpenEndedRepeat = initialRepeatValue !== "none" && Boolean(initialRepeatOpenEnded || !initialEndDateValue)
  const initialHasEndDate =
    !initialIsOpenEndedRepeat &&
    (initialRepeatValue !== "none" || Boolean(initialEndDateValue && initialEndDateValue !== initialDateValue))
  const [dateKey, setDateKey] = useState(initialDateValue)
  const [endDateKey, setEndDateKey] = useState(initialHasEndDate ? initialEndDateValue || initialDateValue : "")
  const [endDateOpenEnded, setEndDateOpenEnded] = useState(initialIsOpenEndedRepeat)
  const initialTimeRange = useMemo(() => splitTimeRange(initialTime), [initialTime])
  const [startTime, setStartTime] = useState(String(initialTimeRange.startTime ?? "").trim())
  const [endTime, setEndTime] = useState(String(initialTimeRange.endTime ?? "").trim())
  const [categoryTitle, setCategoryTitle] = useState(String(defaultCategoryTitle ?? "").trim())
  const [content, setContent] = useState(String(initialContent ?? "").trim())
  const isTask = true
  const completed = Boolean(initialCompleted)
  const [repeat, setRepeat] = useState(initialRepeatValue)
  const [repeatInterval, setRepeatInterval] = useState(Math.max(1, Number.parseInt(String(initialRepeatInterval ?? "1"), 10) || 1))
  const [repeatDays, setRepeatDays] = useState(() => {
    const normalized = normalizeRepeatDays(initialRepeatDays)
    return normalized.length > 0 ? normalized : getDefaultWeeklyDays(initialDateKey)
  })
  const [alarmEnabled, setAlarmEnabled] = useState(Boolean(initialAlarmEnabled ?? true))
  const [alarmLeadMinutes, setAlarmLeadMinutes] = useState(normalizeAlarmLeadMinutes(initialAlarmLeadMinutes))
  const [error, setError] = useState("")
  const [openTimePicker, setOpenTimePicker] = useState(null)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      contentInputRef.current?.focus?.()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose?.()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  const palette = useMemo(() => buildModalPalette(ui), [ui])
  const fieldStyle = buildFieldStyle(ui, palette)
  const labelStyle = buildLabelStyle(ui)
  const saveTextColor = getReadableTextOnColor(ui.accent)
  const options = useMemo(
    () => buildOptionList(categoryOptions, categoryTitle),
    [categoryOptions, categoryTitle]
  )
  const isEditing = editMode === "edit"
  const selectedCategoryOption = options.find((option) => option.value === categoryTitle)
  const selectedCategoryColor = String(selectedCategoryOption?.color ?? "").trim()
  const isRepeatNone = repeat === "none"
  const hasStartTime = Boolean(normalizeTimeInput(startTime))
  const hasEndDate = Boolean(String(endDateKey ?? "").trim())
  const hasRepeatSettings = endDateOpenEnded || hasEndDate

  useEffect(() => {
    if (repeat === "none") return
    if (endDateOpenEnded) return
    setEndDateKey((prev) => {
      const current = String(prev ?? "").trim()
      const fallback = String(dateKey ?? "").trim()
      if (!current || current < fallback) return fallback
      return current
    })
  }, [dateKey, repeat, endDateOpenEnded])

  useEffect(() => {
    if (repeat !== "weekly") return
    if (normalizeRepeatDays(repeatDays).length > 0) return
    setRepeatDays(getDefaultWeeklyDays(dateKey))
  }, [dateKey, repeat, repeatDays])

  function toggleRepeatDay(dayIndex) {
    setRepeatDays((prev) => {
      const current = normalizeRepeatDays(prev)
      if (current.includes(dayIndex)) {
        const next = current.filter((value) => value !== dayIndex)
        return next.length > 0 ? next : current
      }
      return normalizeRepeatDays([...current, dayIndex])
    })
  }

  function handleSubmit() {
    const normalizedDateKey = String(dateKey ?? "").trim()
    const hasEndDateForSave = Boolean(String(endDateKey ?? "").trim())
    const hasRepeatForSave = endDateOpenEnded || hasEndDateForSave
    const normalizedEndDateKey = endDateOpenEnded ? "" : hasEndDateForSave ? String(endDateKey ?? "").trim() : normalizedDateKey
    const effectiveRepeat = hasRepeatForSave ? (repeat === "none" ? "daily" : repeat) : "none"
    const effectiveRepeatDays =
      effectiveRepeat === "weekly"
        ? normalizeRepeatDays(repeatDays).length > 0
          ? normalizeRepeatDays(repeatDays)
          : getDefaultWeeklyDays(normalizedDateKey)
        : []
    const normalizedContent = String(content ?? "").trim()
    const normalizedStartTime = normalizeTimeInput(startTime)
    const normalizedEndTime = normalizeTimeInput(endTime)
    const normalizedAlarmEnabled = Boolean(normalizedStartTime) && Boolean(alarmEnabled)

    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateKey)) {
      setError("날짜 형식은 YYYY-MM-DD 이어야 합니다.")
      return
    }
    if (!endDateOpenEnded && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedEndDateKey)) {
      setError("마감일 형식은 YYYY-MM-DD 이어야 합니다.")
      return
    }
    if (!endDateOpenEnded && normalizedEndDateKey < normalizedDateKey) {
      setError("마감일은 시작일보다 빠를 수 없습니다.")
      return
    }
    if (!normalizedContent) {
      setError("내용을 입력해 주세요.")
      return
    }

    setError("")
    onCreate?.({
      sourceItem,
      editMode,
      mode: "task",
      dateKey: normalizedDateKey,
      startDateKey: normalizedDateKey,
      endDateKey: normalizedEndDateKey,
      untilDateKey: normalizedEndDateKey,
      repeatOpenEnded: endDateOpenEnded && effectiveRepeat !== "none",
      time: [normalizedStartTime, normalizedEndTime].filter(Boolean).join(" "),
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
      repeat: effectiveRepeat,
      repeatInterval: effectiveRepeat === "none" ? 1 : repeatInterval,
      repeatDays: effectiveRepeatDays,
      alarmEnabled: normalizedAlarmEnabled,
      alarmLeadMinutes: normalizedAlarmEnabled ? normalizeAlarmLeadMinutes(alarmLeadMinutes) : 0,
      categoryTitle: String(categoryTitle ?? "").trim(),
      content: normalizedContent,
      isTask,
      completed
    })
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: palette.backdrop,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 220
      }}
    >
      <style>{`
        .plan-settings-modal .plan-setting-field:focus {
          border-color: ${ui.accent} !important;
          box-shadow: 0 0 0 3px ${ui.accentSoft}, inset 0 1px 0 ${palette.dark ? "rgba(255, 255, 255, 0.04)" : "rgba(15, 23, 42, 0.02)"} !important;
          background: ${palette.fieldFocusBg} !important;
        }
        .plan-settings-modal .plan-setting-field:disabled {
          color: ${palette.fieldDisabledText};
          background: ${palette.fieldDisabledBg} !important;
          opacity: 1;
          cursor: not-allowed;
        }
        .plan-settings-modal .plan-setting-field::placeholder {
          color: ${palette.dark ? "rgba(230, 232, 236, 0.46)" : "rgba(71, 85, 105, 0.68)"};
        }
        .plan-settings-modal option {
          background: ${palette.optionBg};
          color: ${ui.text};
        }
        .plan-settings-modal input[type="date"]::-webkit-calendar-picker-indicator,
        .plan-settings-modal input[type="time"]::-webkit-calendar-picker-indicator {
          opacity: ${palette.dark ? 0.82 : 0.78};
          filter: ${palette.dark ? "invert(1) brightness(1.35)" : "none"};
        }
        .plan-settings-modal button {
          letter-spacing: 0;
        }
        .plan-settings-modal .plan-time-field {
          transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease, transform 140ms ease;
        }
        .plan-settings-modal .plan-time-field:hover {
          border-color: ${ui.accent} !important;
          background: ${palette.fieldFocusBg} !important;
          box-shadow: 0 0 0 3px ${ui.accentSoft}, ${palette.dark ? "inset 0 1px 0 rgba(255, 255, 255, 0.04)" : "inset 0 1px 0 rgba(15, 23, 42, 0.02)"} !important;
        }
        .plan-settings-modal .plan-time-field.is-active-field {
          border-color: ${ui.accent} !important;
          background: ${palette.fieldFocusBg} !important;
          box-shadow: 0 0 0 3px ${ui.accentSoft}, ${palette.dark ? "inset 0 1px 0 rgba(255, 255, 255, 0.04)" : "inset 0 1px 0 rgba(15, 23, 42, 0.02)"} !important;
        }
        .plan-settings-modal .plan-time-field.is-empty {
          border-style: dashed;
        }
        .plan-settings-modal .plan-time-option,
        .plan-settings-modal .plan-time-clear-button,
        .plan-settings-modal .plan-time-close-button,
        .plan-settings-modal .plan-time-secondary-action,
        .plan-settings-modal .plan-time-primary-action {
          transition: border-color 140ms ease, background 140ms ease, color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
        }
        .plan-settings-modal .plan-time-option:hover:not(.is-active),
        .plan-settings-modal .plan-time-clear-button:hover:not(.is-muted),
        .plan-settings-modal .plan-time-close-button:hover,
        .plan-settings-modal .plan-time-secondary-action:hover,
        .plan-settings-modal .plan-time-primary-action:hover {
          border-color: ${ui.accent} !important;
          background: ${palette.dark ? "rgba(96, 165, 250, 0.15)" : "rgba(37, 99, 235, 0.08)"} !important;
          color: ${ui.accent} !important;
          box-shadow: 0 6px 16px ${palette.dark ? "rgba(0, 0, 0, 0.22)" : "rgba(37, 99, 235, 0.10)"};
          transform: translateY(-1px);
        }
        .plan-settings-modal .plan-time-option.is-active,
        .plan-settings-modal .plan-time-option.is-active:hover {
          border-color: ${ui.accent} !important;
          background: ${ui.accent} !important;
          color: ${getReadableTextOnColor(ui.accent)} !important;
          box-shadow: 0 6px 16px ${palette.dark ? "rgba(0, 0, 0, 0.28)" : "rgba(37, 99, 235, 0.16)"};
          transform: none;
        }
        .plan-settings-modal .plan-time-period-option.is-active,
        .plan-settings-modal .plan-time-period-option.is-active:hover {
          background: ${ui.accentSoft} !important;
          color: ${ui.accent} !important;
          box-shadow: none;
        }
        .plan-settings-modal .plan-time-scroll-list {
          scrollbar-width: thin;
          scrollbar-color: ${palette.dark ? "rgba(148, 163, 184, 0.52)" : "rgba(100, 116, 139, 0.38)"} transparent;
        }
        .plan-settings-modal .plan-time-scroll-list::-webkit-scrollbar {
          width: 6px;
        }
        .plan-settings-modal .plan-time-scroll-list::-webkit-scrollbar-track {
          background: transparent;
        }
        .plan-settings-modal .plan-time-scroll-list::-webkit-scrollbar-thumb {
          background: ${palette.dark ? "rgba(148, 163, 184, 0.52)" : "rgba(100, 116, 139, 0.38)"};
          border-radius: 999px;
        }
        @media (max-width: 560px) {
          .plan-settings-modal .plan-time-fields-grid {
            grid-template-columns: 1fr !important;
          }
          .plan-settings-modal .plan-time-picker-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
      <div
        className="plan-settings-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="계획 설정"
        style={{
          width: "min(640px, 92vw)",
          maxHeight: "calc(100vh - 32px)",
          borderRadius: 18,
          border: `1px solid ${ui.border}`,
          background: palette.modalBg,
          color: ui.text,
          boxShadow: palette.shadow,
          padding: "24px 24px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          fontFamily: MODAL_FONT_FAMILY,
          overflowY: "auto"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          {showCategory ? (
            <div style={{ position: "relative", flex: "1 1 auto", maxWidth: 300 }}>
              {selectedCategoryColor ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    background: selectedCategoryColor,
                    zIndex: 1,
                    pointerEvents: "none"
                  }}
                />
              ) : null}
              <select
                className="plan-setting-field"
                value={categoryTitle}
                onChange={(event) => setCategoryTitle(String(event.target.value ?? "").trim())}
                style={buildSelectFieldStyle(
                  {
                    ...fieldStyle,
                    minHeight: 42,
                    height: 42,
                    borderRadius: 11,
                    background: palette.controlBg,
                    fontSize: 16,
                    fontWeight: 760
                  },
                  { paddingLeft: selectedCategoryColor ? 30 : 13 }
                )}
                aria-label="탭 선택"
              >
                {options.map((option) => (
                  <option key={option.id} value={option.value}>
                    {option.title}
                  </option>
                ))}
              </select>
              <SelectChevron ui={ui} />
            </div>
          ) : (
            <div style={{ fontSize: 20, lineHeight: 1.2, fontWeight: 760, letterSpacing: 0 }}>계획 설정</div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              style={{
                width: 40,
                height: 40,
                borderRadius: 11,
                border: `1px solid ${ui.border}`,
                background: palette.controlBg,
                color: ui.text,
                fontFamily: "inherit",
                fontSize: 23,
                lineHeight: 1,
                fontWeight: 520,
                cursor: "pointer"
              }}
            >
              ×
            </button>
          </div>
        </div>

        <label style={{ order: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={labelStyle}>내용</span>
          <textarea
            className="plan-setting-field"
            ref={contentInputRef}
            value={content}
            onChange={(event) => setContent(String(event.target.value ?? ""))}
            placeholder="무엇을 할까요?"
            style={{
              ...fieldStyle,
              minHeight: 112,
              padding: "14px 16px",
              resize: "vertical",
              lineHeight: 1.5,
              fontSize: 17,
              fontWeight: 640
            }}
          />
        </label>

        <div style={{ order: 2, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={labelStyle}>일정</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <input
              className="plan-setting-field"
              type="date"
              value={dateKey}
                onChange={(event) => {
                  const next = String(event.target.value ?? "").trim()
                  setDateKey(next)
                  setEndDateKey((prev) => {
                    const current = String(prev ?? "").trim()
                    if (!hasEndDate) return ""
                    return !current || current < next ? next : current
                  })
                }}
              style={fieldStyle}
              aria-label="시작일"
            />
            <div style={{ position: "relative" }}>
              <input
                className="plan-setting-field"
                type="date"
                value={endDateOpenEnded ? "" : endDateKey}
                min={dateKey || undefined}
                onChange={(event) => {
                  const next = String(event.target.value ?? "").trim()
                  setEndDateOpenEnded(false)
                  setEndDateKey(next)
                  if (!next) {
                    setRepeat("none")
                    setRepeatInterval(1)
                    return
                  }
                  if (repeat === "none") {
                    setRepeat("daily")
                    setRepeatInterval(1)
                  }
                }}
                style={{
                  ...fieldStyle,
                  width: "100%",
                  paddingRight: 126,
                  color: endDateOpenEnded ? "transparent" : hasEndDate ? ui.text : palette.fieldDisabledText
                }}
                aria-label="마감일"
              />
              {endDateOpenEnded ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 13,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: ui.text,
                    fontSize: 15,
                    fontWeight: 700,
                    pointerEvents: "none"
                  }}
                >
                  계속 반복
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setEndDateOpenEnded(true)
                  setEndDateKey("")
                  if (repeat === "none") {
                    setRepeat("daily")
                    setRepeatInterval(1)
                  }
                }}
                style={{
                  position: "absolute",
                  right: 65,
                  top: "50%",
                  transform: "translateY(-50%)",
                  height: 28,
                  padding: "0 11px",
                  borderRadius: 999,
                  border: `1px solid ${endDateOpenEnded ? ui.accent : ui.border}`,
                  background: endDateOpenEnded ? ui.accentSoft : palette.chipBg,
                  color: endDateOpenEnded ? ui.accent : ui.text2,
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 720,
                  cursor: "pointer"
                }}
              >
                계속
              </button>
              <button
                type="button"
                onClick={() => {
                  setEndDateOpenEnded(false)
                  setEndDateKey("")
                  setRepeat("none")
                  setRepeatInterval(1)
                }}
                style={{
                  position: "absolute",
                  right: 9,
                  top: "50%",
                  transform: "translateY(-50%)",
                  height: 28,
                  padding: "0 11px",
                  borderRadius: 999,
                  border: `1px solid ${ui.border}`,
                  background: palette.chipBg,
                  color: hasRepeatSettings ? ui.text2 : palette.fieldDisabledText,
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 720,
                  cursor: hasRepeatSettings ? "pointer" : "default"
                }}
              >
                없음
              </button>
            </div>
          </div>
        </div>

        <div style={{ order: 4, display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={labelStyle}>시간</span>
          {hasStartTime ? (
            <div
              className="plan-time-fields-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 10
              }}
            >
              <TimeField
                value={startTime || "09:00"}
                defaultValue="09:00"
                placeholder="오전 09:00"
                ui={ui}
                palette={palette}
                fieldStyle={fieldStyle}
                onOpen={() => setOpenTimePicker("start")}
                allowClear={false}
                active={openTimePicker === "start"}
                ariaLabel="시작 시간 선택"
                onChange={(nextValue) => {
                  const next = normalizeTimeInput(nextValue)
                  setStartTime(next)
                  setAlarmEnabled(true)
                }}
              />
              <TimeField
                value={endTime}
                defaultValue={addMinutesToTime(startTime || "09:00", 60)}
                placeholder="설정 안 함"
                ui={ui}
                palette={palette}
                fieldStyle={fieldStyle}
                onOpen={() => setOpenTimePicker("end")}
                active={openTimePicker === "end"}
                ariaLabel="종료 시간 선택"
                onChange={(nextValue) => setEndTime(normalizeTimeInput(nextValue))}
              />
            </div>
          ) : null}
          {hasStartTime && openTimePicker ? (
            <TimePickerPanel
              value={openTimePicker === "start" ? startTime || "09:00" : endTime}
              defaultValue={openTimePicker === "start" ? "09:00" : addMinutesToTime(startTime || "09:00", 60)}
              ui={ui}
              palette={palette}
              allowClear={openTimePicker === "end"}
              onClose={() => setOpenTimePicker(null)}
              onChange={(nextValue) => {
                const next = normalizeTimeInput(nextValue)
                if (openTimePicker === "start") {
                  setStartTime(next)
                  setAlarmEnabled(true)
                  return
                }
                setEndTime(next)
              }}
            />
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                minHeight: 36,
                color: hasStartTime ? ui.text : ui.text2,
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              <input
                type="checkbox"
                checked={hasStartTime}
                onChange={(event) => {
                  const enabled = event.target.checked
                  if (!enabled) {
                    setStartTime("")
                    setEndTime("")
                    setAlarmEnabled(false)
                    setOpenTimePicker(null)
                    return
                  }
                  const nextStart = startTime || "09:00"
                  setStartTime(nextStart)
                  setEndTime("")
                  setAlarmEnabled(true)
                }}
                style={{
                  width: 19,
                  height: 19,
                  accentColor: ui.accent,
                  cursor: "pointer"
                }}
              />
              시간 설정
            </label>
          </div>
        </div>

        {hasStartTime ? (
        <div style={{ order: 5, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={labelStyle}>알림</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, opacity: hasStartTime ? 1 : 0.58 }}>
            <button
              type="button"
              disabled={!hasStartTime}
              onClick={() => {
                if (!hasStartTime) return
                setAlarmEnabled(false)
              }}
              style={{
                height: 34,
                padding: "0 13px",
                borderRadius: 10,
                border: `1px solid ${hasStartTime && !alarmEnabled ? ui.accent : ui.border}`,
                background: hasStartTime && !alarmEnabled ? ui.accentSoft : palette.chipBg,
                color: hasStartTime && !alarmEnabled ? ui.accent : hasStartTime ? ui.text2 : palette.fieldDisabledText,
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 700,
                cursor: hasStartTime ? "pointer" : "not-allowed"
              }}
            >
              알림 없음
            </button>
            {ALARM_LEAD_OPTIONS.map((option) => {
              const active =
                hasStartTime && alarmEnabled && normalizeAlarmLeadMinutes(alarmLeadMinutes) === option.key
              return (
                <button
                  key={`alarm-lead-${option.key}`}
                  type="button"
                  disabled={!hasStartTime}
                  onClick={() => {
                    if (!hasStartTime) return
                    setAlarmEnabled(true)
                    setAlarmLeadMinutes(option.key)
                  }}
                  style={{
                    height: 34,
                    padding: "0 13px",
                    borderRadius: 10,
                    border: `1px solid ${active ? ui.accent : ui.border}`,
                    background: active ? ui.accentSoft : palette.chipBg,
                    color: active ? ui.accent : hasStartTime ? ui.text2 : palette.fieldDisabledText,
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: hasStartTime ? "pointer" : "not-allowed"
                  }}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
        ) : null}

        {hasRepeatSettings ? (
        <div style={{ order: 3, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={labelStyle}>반복</span>
            <div style={{ position: "relative" }}>
              <select
                className="plan-setting-field"
                value={repeat}
                onChange={(event) => {
                  const nextRepeat = event.target.value
                  setRepeat(nextRepeat)
                  if (nextRepeat === "none") {
                    setEndDateOpenEnded(false)
                    setEndDateKey("")
                    setRepeatInterval(1)
                    return
                  }
                  if (!endDateOpenEnded && !endDateKey) setEndDateKey(String(dateKey ?? "").trim())
                  if (nextRepeat === "weekly" && normalizeRepeatDays(repeatDays).length === 0) {
                    setRepeatDays(getDefaultWeeklyDays(dateKey))
                  }
                }}
                style={buildSelectFieldStyle(fieldStyle)}
              >
                <option value="none">반복 안함</option>
                <option value="daily">매일</option>
                <option value="weekly">매주</option>
                <option value="monthly">매월</option>
                <option value="yearly">매년</option>
              </select>
              <SelectChevron ui={ui} />
            </div>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={labelStyle}>반복 간격</span>
            <input
              className="plan-setting-field"
              type="number"
              min="1"
              value={repeatInterval}
              onChange={(event) =>
                setRepeatInterval(Math.max(1, Number.parseInt(event.target.value || "1", 10) || 1))
              }
              disabled={isRepeatNone}
              style={{ ...fieldStyle, opacity: 1 }}
            />
          </label>
        </div>
        ) : null}

        {hasRepeatSettings && repeat === "weekly" ? (
          <div style={{ order: 3, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={labelStyle}>요일</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {WEEKDAY_LABELS.map((label, dayIndex) => {
                const active = normalizeRepeatDays(repeatDays).includes(dayIndex)
                return (
                  <button
                    key={`${label}-${dayIndex}`}
                    type="button"
                    onClick={() => toggleRepeatDay(dayIndex)}
                    style={{
                      height: 34,
                      minWidth: 40,
                      padding: "0 12px",
                      borderRadius: 10,
                      border: `1px solid ${active ? ui.accent : ui.border}`,
                      background: active ? ui.accentSoft : palette.chipBg,
                      color: active ? ui.accent : ui.text2,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 13,
                      fontWeight: 650
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {error ? <div style={{ order: 6, fontSize: 12, fontWeight: 650, color: "#dc2626" }}>{error}</div> : null}

        <div style={{ order: 7, display: "flex", justifyContent: "space-between", gap: 10 }}>
          {isEditing ? (
            <button
              type="button"
              onClick={() => onDelete?.({ sourceItem })}
              style={{
                height: 42,
                padding: "0 16px",
                borderRadius: 11,
                border: "1px solid #ef4444",
                background: palette.dangerBg,
                color: "#dc2626",
                fontFamily: "inherit",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              삭제
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                height: 42,
                padding: "0 16px",
                borderRadius: 11,
                border: `1px solid ${ui.border}`,
                background: palette.controlBg,
                color: ui.text,
                fontFamily: "inherit",
                fontSize: 14,
                fontWeight: 650,
                cursor: "pointer"
              }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              style={{
                height: 42,
                padding: "0 18px",
                borderRadius: 11,
                border: `1px solid ${ui.accent}`,
                background: ui.accent,
                color: saveTextColor,
                fontFamily: "inherit",
                fontSize: 14,
                fontWeight: 760,
                cursor: "pointer"
              }}
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function QuickCreateModal({ open, ...props }) {
  if (!open) return null
  return (
    <QuickCreateModalBody
      key={[
        props.editMode ?? "create",
        props.sourceItem?.id ?? "",
        props.mode ?? "task",
        props.initialDateKey ?? "",
        props.initialEndDateKey ?? "",
        props.initialRepeat ?? "",
        props.initialRepeatOpenEnded ? "open" : "finite",
        JSON.stringify(props.initialRepeatDays ?? []),
        props.initialAlarmEnabled == null ? "" : String(Boolean(props.initialAlarmEnabled)),
        props.initialAlarmLeadMinutes ?? "",
        props.defaultCategoryTitle ?? ""
      ].join("|")}
      {...props}
    />
  )
}

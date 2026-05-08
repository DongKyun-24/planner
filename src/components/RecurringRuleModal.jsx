import { useEffect, useMemo, useRef, useState } from "react"
import {
  REPEAT_NONE,
  REPEAT_DAILY,
  REPEAT_WEEKLY,
  REPEAT_MONTHLY,
  REPEAT_YEARLY,
  WEEKDAY_LABELS,
  isValidDateKey,
  normalizeRepeatDays,
  normalizeRepeatInterval,
  normalizeRepeatType
} from "../utils/recurringRules"
import { dayOfWeek, keyToYMD } from "../utils/dateUtils"
import { stripTaskSuffix } from "../utils/taskMarkers"
import { normalizeTimeTokenOrRange, parseTimePrefix } from "../utils/plannerText"

function getDefaultWeeklyDays(dateKey) {
  if (!isValidDateKey(dateKey)) return []
  const { y, m, d } = keyToYMD(dateKey)
  return [dayOfWeek(y, m, d)]
}

function normalizeCompactRecurringLine(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  return raw.replace(
    /^(\d{1,2}:\d{2}(?:(?:\s*[~-]\s*|\s+)\d{1,2}:\d{2})?)\s*@/,
    "$1;@"
  )
}

function composeRecurringRawLine(rawLine, time = "") {
  const stripped = stripTaskSuffix(rawLine)
  const baseText = String(stripped.text ?? "").trim()
  if (!baseText) return ""
  const baseRaw = buildRecurringDraftLine({ time, text: baseText })
  return `${baseRaw};X`
}

function splitRecurringDraftLine(rawLine) {
  const stripped = stripTaskSuffix(rawLine)
  const source = normalizeCompactRecurringLine(String(stripped.text ?? rawLine ?? "").trim())
  if (!source) return { time: "", group: "", text: "" }

  const semicolonParts = source.includes(";") ? source.split(";") : []
  const semicolonTime = semicolonParts.length > 1 ? normalizeTimeTokenOrRange(semicolonParts[0]) : ""
  if (semicolonTime) {
    const second = String(semicolonParts[1] ?? "").trim()
    const group = second.startsWith("@") ? second.slice(1).trim() : ""
    return {
      time: String(semicolonTime ?? "").trim(),
      group,
      text: String((group ? semicolonParts.slice(2) : semicolonParts.slice(1)).join(";") ?? "").trim()
    }
  }

  if (semicolonParts.length > 1 && String(semicolonParts[0] ?? "").trim().startsWith("@")) {
    return {
      time: "",
      group: String(semicolonParts[0] ?? "").trim().slice(1).trim(),
      text: String(semicolonParts.slice(1).join(";") ?? "").trim()
    }
  }

  const timed = parseTimePrefix(source)
  if (timed) {
    let text = String(timed.text ?? "").trim()
    let group = ""
    if (text.startsWith("@")) {
      const parts = text.split(";")
      group = String(parts[0] ?? "").slice(1).trim()
      text = String(parts.slice(1).join(";") ?? "").trim()
    }
    return {
      time: String(timed.time ?? "").trim(),
      group,
      text
    }
  }

  return { time: "", group: "", text: source }
}

function buildRecurringDraftLine({ time = "", text = "" } = {}) {
  const content = String(text ?? "").trim()
  if (!content) return ""
  const parts = []
  const timeToken = String(time ?? "").trim()
  if (timeToken) parts.push(timeToken)
  parts.push(content)
  return parts.join(";")
}

function buildDraft({
  initialDateKey,
  editingOccurrence,
  defaultCategoryTitle,
  defaultRawLine = ""
}) {
  if (editingOccurrence) {
    const parsedLine = splitRecurringDraftLine(editingOccurrence.rawLine)
    return {
      startDateKey: String(editingOccurrence.familyStartDateKey ?? editingOccurrence.dateKey ?? initialDateKey ?? "").trim(),
      untilDateKey: String(
        editingOccurrence.repeatUntilKey ?? editingOccurrence.familyUntilDateKey ?? editingOccurrence.dateKey ?? initialDateKey ?? ""
      ).trim(),
      repeat: normalizeRepeatType(editingOccurrence.repeat),
      repeatInterval: normalizeRepeatInterval(editingOccurrence.repeatInterval),
      repeatDays: normalizeRepeatDays(editingOccurrence.repeatDays),
      time: parsedLine.time,
      rawLine: parsedLine.text,
      kind: "task",
      categoryTitle: String(parsedLine.group || editingOccurrence.title || defaultCategoryTitle || "").trim()
    }
  }

  const parsedDefaultLine = splitRecurringDraftLine(defaultRawLine)
  return {
    startDateKey: String(initialDateKey ?? "").trim(),
    untilDateKey: String(initialDateKey ?? "").trim(),
    repeat: REPEAT_NONE,
    repeatInterval: 1,
    repeatDays: getDefaultWeeklyDays(initialDateKey),
    time: parsedDefaultLine.time,
    rawLine: parsedDefaultLine.text,
    kind: "task",
    categoryTitle: String(parsedDefaultLine.group || defaultCategoryTitle || "").trim()
  }
}

function normalizeComparableDraft(draft) {
  const repeat = normalizeRepeatType(draft?.repeat)
  const kind = "task"
  const categoryTitle = String(draft?.categoryTitle ?? "").trim()
  const rawLine = String(draft?.rawLine ?? "").trim()
  const time = normalizeTimeTokenOrRange(draft?.time)
  return {
    startDateKey: String(draft?.startDateKey ?? "").trim(),
    untilDateKey: String(draft?.untilDateKey ?? "").trim(),
    repeat,
    repeatInterval: normalizeRepeatInterval(draft?.repeatInterval),
    repeatDays: repeat === REPEAT_WEEKLY ? normalizeRepeatDays(draft?.repeatDays) : [],
    rawLine: composeRecurringRawLine(rawLine, time),
    kind,
    categoryTitle
  }
}

function buildFieldStyle(ui) {
  return {
    height: 44,
    borderRadius: 12,
    border: `1px solid ${ui.border}`,
    background: ui.surface2,
    color: ui.text,
    padding: "0 12px",
    fontWeight: 700
  }
}

function CalendarIcon({ ui }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ color: ui.text2, flexShrink: 0 }}>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 3.5v4M17 3.5v4M3.5 9.5h17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function ScopeOverlay({ ui, title, hint, dateKey, options, onCancel, onSelect }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(15, 23, 42, 0.22)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        backdropFilter: "blur(2px)"
      }}
    >
      <div
        style={{
          width: "min(430px, 88vw)",
          borderRadius: 16,
          border: `1px solid ${ui.border}`,
          background: ui.surface,
          color: ui.text,
          boxShadow: ui.shadow,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 14
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>{title}</div>
          <div style={{ color: ui.text2, lineHeight: 1.45, fontSize: 13 }}>기준 날짜 {dateKey}</div>
          <div style={{ color: ui.text2, lineHeight: 1.45, fontSize: 13, whiteSpace: "pre-line" }}>{hint}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          {options.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              style={{
                height: 42,
                padding: "0 14px",
                borderRadius: 12,
                border: `1px solid ${ui.border}`,
                background: ui.surface2,
                color: ui.text,
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 850,
                textAlign: "left"
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          style={{
            alignSelf: "flex-end",
            height: 38,
            padding: "0 14px",
            borderRadius: 11,
            border: `1px solid ${ui.border}`,
            background: ui.surface,
            color: ui.text,
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 800
          }}
        >
          취소
        </button>
      </div>
    </div>
  )
}

function RecurringRuleModalBody({
  ui,
  editingOccurrence = null,
  initialDateKey = "",
  defaultCategoryTitle = "",
  defaultKind = "schedule",
  defaultRawLine = "",
  editableWindows = [],
  onClose,
  onCreate,
  onSave,
  onDelete
}) {
  const [draft, setDraft] = useState(() =>
    buildDraft({ initialDateKey, editingOccurrence, defaultCategoryTitle, defaultKind, defaultRawLine })
  )
  const [pendingAction, setPendingAction] = useState(null)
  const lastFiniteUntilDateRef = useRef(String(initialDateKey ?? "").trim())
  const startDateInputRef = useRef(null)
  const untilDateInputRef = useRef(null)
  const categoryMenuRef = useRef(null)
  const [openCategoryMenu, setOpenCategoryMenu] = useState(false)

  useEffect(() => {
    if (!isValidDateKey(draft?.untilDateKey)) return
    lastFiniteUntilDateRef.current = String(draft.untilDateKey).trim()
  }, [draft?.untilDateKey])

  useEffect(() => {
    if (!openCategoryMenu) return undefined
    const handlePointerDown = (event) => {
      if (categoryMenuRef.current?.contains?.(event.target)) return
      setOpenCategoryMenu(false)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [openCategoryMenu])

  const isEditing = Boolean(editingOccurrence)
  const originalComparable = useMemo(
    () =>
      normalizeComparableDraft(
        buildDraft({ initialDateKey, editingOccurrence, defaultCategoryTitle, defaultKind, defaultRawLine })
      ),
    [initialDateKey, editingOccurrence, defaultCategoryTitle, defaultKind, defaultRawLine]
  )
  const currentComparable = useMemo(() => normalizeComparableDraft(draft), [draft])
  const isDirty = JSON.stringify(originalComparable) !== JSON.stringify(currentComparable)
  const isOpenEnded = draft.repeat !== REPEAT_NONE && !draft.untilDateKey

  function closeAll() {
    setPendingAction(null)
    setOpenCategoryMenu(false)
    onClose?.()
  }

  function handleRepeatChange(nextRepeat) {
    const repeat = normalizeRepeatType(nextRepeat)
    setDraft((prev) => ({
      ...prev,
      repeat,
      repeatDays:
        repeat === REPEAT_WEEKLY
          ? normalizeRepeatDays(prev.repeatDays).length > 0
            ? normalizeRepeatDays(prev.repeatDays)
            : getDefaultWeeklyDays(prev.startDateKey)
          : []
    }))
  }

  function toggleRepeatDay(dayIndex) {
    setDraft((prev) => {
      const current = normalizeRepeatDays(prev.repeatDays)
      if (current.includes(dayIndex)) {
        const next = current.filter((item) => item !== dayIndex)
        return { ...prev, repeatDays: next.length > 0 ? next : current }
      }
      return { ...prev, repeatDays: normalizeRepeatDays([...current, dayIndex]) }
    })
  }

  function openUntilDatePicker() {
    const node = untilDateInputRef.current
    if (!node) return
    if (typeof node.showPicker === "function") {
      node.showPicker()
      return
    }
    node.click()
  }

  function openStartDatePicker() {
    const node = startDateInputRef.current
    if (!node) return
    if (typeof node.showPicker === "function") {
      node.showPicker()
      return
    }
    node.click()
  }

  function handleSaveClick() {
    if (!currentComparable.rawLine) return
    if (!isEditing) {
      onCreate?.(currentComparable)
      closeAll()
      return
    }
    if (!isDirty) {
      closeAll()
      return
    }
    setPendingAction("save")
  }

  function handleDeleteClick() {
    if (!isEditing) return
    setPendingAction("delete")
  }

  function runScopedAction(scope) {
    if (pendingAction === "save") {
      onSave?.(currentComparable, scope)
      closeAll()
      return
    }
    if (pendingAction === "delete") {
      onDelete?.(scope)
      closeAll()
    }
  }

  const fieldStyle = buildFieldStyle(ui)

  const scopeTitle = pendingAction === "delete" ? "삭제 범위 선택" : "수정 범위 선택"
  const scopeHint =
    pendingAction === "save"
      ? "'이번 항목만 분리'를 선택하면 해당 날짜의 항목만\n일반 Task로 바뀝니다."
      : "삭제할 범위를 선택하세요."
  const scopeOptions =
    pendingAction === "delete"
      ? [
          { id: "future", label: "이후 삭제" },
          { id: "all", label: "전체 삭제" },
          { id: "single", label: "이번 항목만 삭제" }
        ]
      : [
          { id: "future", label: "이후 반복 수정" },
          { id: "all", label: "전체 반복 수정" },
          { id: "single", label: "이번 항목만 분리" }
        ]

  const showRepeatControls = draft.repeat !== REPEAT_NONE
  const categoryOptions = useMemo(() => {
    const seen = new Set([""])
    const out = [{ id: "", title: "없음", value: "", color: "" }]
    for (const windowItem of Array.isArray(editableWindows) ? editableWindows : []) {
      const title = String(windowItem?.title ?? "").trim()
      if (!title || seen.has(title)) continue
      seen.add(title)
      out.push({
        id: String(windowItem?.id ?? title),
        title,
        value: title,
        color: String(windowItem?.color ?? "").trim()
      })
    }
    const selected = String(draft.categoryTitle ?? "").trim()
    if (selected && !seen.has(selected)) out.push({ id: selected, title: selected, value: selected, color: "" })
    return out
  }, [editableWindows, draft.categoryTitle])
  const selectedCategoryOption = categoryOptions.find((item) => item.value === draft.categoryTitle) ?? categoryOptions[0]
  const selectedCategoryColor = String(selectedCategoryOption?.color ?? "").trim() || "#94a3b8"
  const selectedCategoryLabel = String(selectedCategoryOption?.title ?? "없음").trim() || "없음"
  const repeatUnitLabel =
    draft.repeat === REPEAT_DAILY
      ? "일"
      : draft.repeat === REPEAT_WEEKLY
        ? "주"
        : draft.repeat === REPEAT_MONTHLY
          ? "개월"
          : draft.repeat === REPEAT_YEARLY
            ? "년"
            : ""

  return (
    <div
      onClick={closeAll}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 220
      }}
    >
      <style>{`
        .recurring-settings-modal button,
        .recurring-settings-modal input,
        .recurring-settings-modal textarea {
          letter-spacing: 0;
        }
        .recurring-settings-modal .recurring-field {
          transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
        }
        .recurring-settings-modal .recurring-field:hover,
        .recurring-settings-modal .recurring-field:focus {
          border-color: ${ui.accent} !important;
          background: ${ui.surface} !important;
          box-shadow: 0 0 0 3px ${ui.accentSoft};
          outline: none;
        }
        .recurring-settings-modal .recurring-chip {
          transition: border-color 140ms ease, background 140ms ease, color 140ms ease, transform 140ms ease;
        }
        .recurring-settings-modal .recurring-chip:hover {
          border-color: ${ui.accent} !important;
          color: ${ui.accent} !important;
          transform: translateY(-1px);
        }
        @media (max-width: 560px) {
          .recurring-settings-modal .recurring-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
      <div
        className="recurring-settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="반복 일정 설정"
        style={{
          width: "min(640px, 92vw)",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          position: "relative",
          background: ui.surface,
          color: ui.text,
          borderRadius: 18,
          border: `1px solid ${ui.border}`,
          boxShadow: ui.shadow,
          padding: "24px 24px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 16
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div ref={categoryMenuRef} style={{ position: "relative", flex: "0 0 auto", maxWidth: "calc(100vw - 116px)" }}>
            <button
              type="button"
              onClick={() => setOpenCategoryMenu((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={openCategoryMenu}
              style={{
                height: 34,
                maxWidth: 176,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                border: "none",
                background: "transparent",
                color: ui.text,
                padding: "0 6px",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 800
              }}
            >
              <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 999, background: selectedCategoryColor, flexShrink: 0 }} />
              <span style={{ minWidth: 0, maxWidth: 112, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 16 }}>
                {selectedCategoryLabel}
              </span>
              <span aria-hidden="true" style={{ color: ui.text2, fontSize: 12, lineHeight: 1 }}>▼</span>
            </button>
            {openCategoryMenu ? (
              <div
                role="listbox"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 38,
                  zIndex: 20,
                  width: 168,
                  maxHeight: 246,
                  overflowY: "auto",
                  padding: 6,
                  borderRadius: 12,
                  border: `1px solid ${ui.border}`,
                  background: ui.surface2,
                  boxShadow: ui.shadow
                }}
              >
                {categoryOptions.map((option) => {
                  const active = option.value === draft.categoryTitle
                  const optionColor = String(option?.color ?? "").trim() || "#94a3b8"
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        setDraft((prev) => ({ ...prev, categoryTitle: String(option.value ?? "").trim() }))
                        setOpenCategoryMenu(false)
                      }}
                      style={{
                        width: "100%",
                        height: 34,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        border: "none",
                        borderRadius: 9,
                        background: active ? ui.accentSoft : "transparent",
                        color: active ? ui.accent : ui.text,
                        padding: "0 9px",
                        fontFamily: "inherit",
                        fontSize: 14,
                        fontWeight: 760,
                        textAlign: "left",
                        cursor: "pointer"
                      }}
                    >
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: optionColor, flexShrink: 0 }} />
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {option.title}
                      </span>
                      {active ? <span aria-hidden="true" style={{ fontSize: 13, fontWeight: 900 }}>✓</span> : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={closeAll}
            aria-label="닫기"
            style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              border: `1px solid ${ui.border}`,
              background: ui.surface2,
              color: ui.text,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 23,
              lineHeight: 1,
              fontWeight: 520
            }}
          >
            ×
          </button>
        </div>

        <textarea
          className="recurring-field"
          value={draft.rawLine}
          onChange={(e) => {
            const nextRawLine = e.target.value
            setDraft((prev) => ({ ...prev, rawLine: nextRawLine }))
          }}
          placeholder="무엇을 할까요?"
          style={{
            ...fieldStyle,
            width: "100%",
            minHeight: 156,
            padding: "16px 18px",
            resize: "vertical",
            lineHeight: 1.5,
            fontSize: 19,
            fontWeight: 640
          }}
        />

        <div className="recurring-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="recurring-field"
              onClick={openStartDatePicker}
              style={{
                ...fieldStyle,
                width: "100%",
                minHeight: 58,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                textAlign: "left",
                cursor: "pointer"
              }}
            >
              <span>{draft.startDateKey}</span>
              <CalendarIcon ui={ui} />
            </button>
            <input
              ref={startDateInputRef}
              type="date"
              value={draft.startDateKey}
              onChange={(e) => {
                const nextDate = e.target.value
                setDraft((prev) => ({
                  ...prev,
                  startDateKey: nextDate,
                  untilDateKey:
                    !prev.untilDateKey
                      ? ""
                      : !isValidDateKey(prev.untilDateKey) || prev.untilDateKey < nextDate
                        ? nextDate
                        : prev.untilDateKey,
                  repeatDays:
                    prev.repeat === REPEAT_WEEKLY && normalizeRepeatDays(prev.repeatDays).length === 0
                      ? getDefaultWeeklyDays(nextDate)
                      : prev.repeatDays
                }))
              }}
              style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
              tabIndex={-1}
            />
          </div>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="recurring-field"
              onClick={openUntilDatePicker}
              style={{
                ...fieldStyle,
                width: "100%",
                minHeight: 58,
                paddingRight: 142,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                color: isOpenEnded || !showRepeatControls ? ui.text2 : ui.text,
                textAlign: "left",
                cursor: "pointer"
              }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {isOpenEnded ? "계속 반복" : showRepeatControls ? draft.untilDateKey || draft.startDateKey : "종료일 없음"}
              </span>
              <CalendarIcon ui={ui} />
            </button>
            <div
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                display: "flex",
                alignItems: "center",
                gap: 7,
                zIndex: 2
              }}
            >
              <button
                type="button"
                className="recurring-chip"
                onClick={() => {
                  setDraft((prev) => ({
                    ...prev,
                    repeat: prev.repeat === REPEAT_NONE ? REPEAT_DAILY : prev.repeat,
                    repeatInterval: normalizeRepeatInterval(prev.repeatInterval),
                    untilDateKey: ""
                  }))
                }}
                style={{
                  height: 28,
                  padding: "0 11px",
                  borderRadius: 999,
                  border: `1px solid ${isOpenEnded ? ui.accent : ui.border}`,
                  background: isOpenEnded ? ui.accentSoft : ui.surface,
                  color: isOpenEnded ? ui.accent : ui.text2,
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
                className="recurring-chip"
                onClick={() => {
                  setDraft((prev) => ({
                    ...prev,
                    repeat: REPEAT_NONE,
                    repeatInterval: 1,
                    repeatDays: [],
                    untilDateKey: ""
                  }))
                }}
                style={{
                  height: 28,
                  padding: "0 11px",
                  borderRadius: 999,
                  border: `1px solid ${!showRepeatControls ? ui.accent : ui.border}`,
                  background: !showRepeatControls ? ui.accentSoft : ui.surface,
                  color: !showRepeatControls ? ui.accent : ui.text2,
                  fontFamily: "inherit",
                  fontSize: 12,
                  fontWeight: 720,
                  cursor: "pointer"
                }}
              >
                없음
              </button>
            </div>
            <input
              ref={untilDateInputRef}
              type="date"
              value={draft.untilDateKey || draft.startDateKey}
              min={draft.startDateKey || undefined}
              onChange={(e) => {
                const nextDate = String(e.target.value ?? "").trim()
                if (!nextDate) return
                lastFiniteUntilDateRef.current = nextDate
                setDraft((prev) => ({
                  ...prev,
                  repeat: prev.repeat === REPEAT_NONE ? REPEAT_DAILY : prev.repeat,
                  repeatInterval: normalizeRepeatInterval(prev.repeatInterval),
                  untilDateKey: nextDate < prev.startDateKey ? String(prev.startDateKey ?? "").trim() : nextDate
                }))
              }}
              style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
              tabIndex={-1}
            />
          </div>
        </div>

        {showRepeatControls ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {[
                [REPEAT_DAILY, "매일"],
                [REPEAT_WEEKLY, "매주"],
                [REPEAT_MONTHLY, "매월"],
                [REPEAT_YEARLY, "매년"]
              ].map(([value, label]) => {
                const active = draft.repeat === value
                return (
                  <button
                    key={value}
                    type="button"
                    className="recurring-chip"
                    onClick={() => handleRepeatChange(value)}
                    style={{
                      height: 36,
                      minWidth: 72,
                      padding: "0 14px",
                      borderRadius: 11,
                      border: `1px solid ${active ? ui.accent : ui.border}`,
                      background: active ? ui.accentSoft : ui.surface2,
                      color: active ? ui.accent : ui.text2,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 14,
                      fontWeight: 800
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            <div
              className="recurring-field"
              style={{
                ...fieldStyle,
                minHeight: 48,
                display: "flex",
                alignItems: "center",
                gap: 10
              }}
            >
              <span style={{ color: ui.text2, fontWeight: 800 }}>매</span>
              <button
                type="button"
                className="recurring-chip"
                onClick={() =>
                  setDraft((prev) => ({ ...prev, repeatInterval: Math.max(1, normalizeRepeatInterval(prev.repeatInterval) - 1) }))
                }
                style={{
                  width: 32,
                  height: 30,
                  borderRadius: 9,
                  border: `1px solid ${ui.border}`,
                  background: ui.surface,
                  color: ui.text2,
                  cursor: "pointer",
                  fontWeight: 900
                }}
              >
                -
              </button>
              <input
                value={draft.repeatInterval}
                onChange={(e) => {
                  const next = e.target.value
                  setDraft((prev) => ({ ...prev, repeatInterval: next === "" ? "" : normalizeRepeatInterval(next) }))
                }}
                onBlur={() => setDraft((prev) => ({ ...prev, repeatInterval: normalizeRepeatInterval(prev.repeatInterval) }))}
                inputMode="numeric"
                style={{
                  width: 54,
                  border: "none",
                  background: "transparent",
                  color: ui.text,
                  fontFamily: "inherit",
                  fontSize: 17,
                  fontWeight: 850,
                  textAlign: "center",
                  outline: "none"
                }}
              />
              <button
                type="button"
                className="recurring-chip"
                onClick={() => setDraft((prev) => ({ ...prev, repeatInterval: normalizeRepeatInterval(prev.repeatInterval) + 1 }))}
                style={{
                  width: 32,
                  height: 30,
                  borderRadius: 9,
                  border: `1px solid ${ui.border}`,
                  background: ui.surface,
                  color: ui.text2,
                  cursor: "pointer",
                  fontWeight: 900
                }}
              >
                +
              </button>
              <span style={{ color: ui.text, fontWeight: 800 }}>{repeatUnitLabel}</span>
            </div>

            {draft.repeat === REPEAT_WEEKLY ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {WEEKDAY_LABELS.map((label, dayIndex) => {
                  const active = normalizeRepeatDays(draft.repeatDays).includes(dayIndex)
                  return (
                    <button
                      key={`${label}-${dayIndex}`}
                      type="button"
                      className="recurring-chip"
                      onClick={() => toggleRepeatDay(dayIndex)}
                      style={{
                        height: 34,
                        minWidth: 40,
                        padding: "0 12px",
                        borderRadius: 10,
                        border: `1px solid ${active ? ui.accent : ui.border}`,
                        background: active ? ui.accentSoft : ui.surface2,
                        color: active ? ui.accent : ui.text2,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: 13,
                        fontWeight: 760
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ position: "relative" }}>
          <input
            className="recurring-field"
            value={draft.time ?? ""}
            onChange={(e) => setDraft((prev) => ({ ...prev, time: e.target.value }))}
            onBlur={() =>
              setDraft((prev) => ({
                ...prev,
                time: normalizeTimeTokenOrRange(prev.time) || String(prev.time ?? "").trim()
              }))
            }
            placeholder="시간 없음"
            style={{
              ...fieldStyle,
              width: "100%",
              minHeight: 58,
              paddingRight: 72,
              fontSize: 17
            }}
          />
          <button
            type="button"
            className="recurring-chip"
            onClick={() => setDraft((prev) => ({ ...prev, time: "" }))}
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              height: 28,
              padding: "0 11px",
              borderRadius: 999,
              border: `1px solid ${ui.border}`,
              background: ui.surface,
              color: ui.text2,
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: 720,
              cursor: "pointer"
            }}
          >
            없음
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 2 }}>
          {isEditing ? (
            <button
              type="button"
              onClick={handleDeleteClick}
              style={{
                height: 42,
                padding: "0 18px",
                borderRadius: 12,
                border: "1px solid rgba(239, 68, 68, 0.55)",
                background: "rgba(239, 68, 68, 0.08)",
                color: "#dc2626",
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 800
              }}
            >
              삭제
            </button>
          ) : (
            <div />
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={closeAll}
              style={{
                height: 42,
                padding: "0 18px",
                borderRadius: 12,
                border: `1px solid ${ui.border}`,
                background: ui.surface,
                color: ui.text,
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 800
              }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSaveClick}
              style={{
                height: 42,
                padding: "0 20px",
                borderRadius: 12,
                border: "1px solid transparent",
                background: ui.accent,
                color: "#fff",
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 850
              }}
            >
              저장
            </button>
          </div>
        </div>

        {pendingAction ? (
          <ScopeOverlay
            ui={ui}
            title={scopeTitle}
            hint={scopeHint}
            dateKey={editingOccurrence?.dateKey ?? initialDateKey}
            options={scopeOptions}
            onCancel={() => setPendingAction(null)}
            onSelect={runScopedAction}
          />
        ) : null}
      </div>
    </div>
  )
}

export default function RecurringRuleModal({ open, ...props }) {
  if (!open) return null
  return (
    <RecurringRuleModalBody
      key={[
        props.initialDateKey ?? "",
        props.defaultCategoryTitle ?? "",
        props.defaultKind ?? "schedule",
        props.editingOccurrence?.dateKey ?? "",
        props.editingOccurrence?.rawLine ?? ""
      ].join("|")}
      {...props}
    />
  )
}

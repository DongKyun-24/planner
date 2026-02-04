import { useEffect, useMemo, useRef, useState } from "react"

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

export default function DayListModal({
  open,
  onClose,
  readOnly = false,
  ui,
  dayListTitle,
  dayListMode,
  setDayListMode,
  dayListEditText,
  setDayListEditText,
  applyDayListEdit,
  dayListReadItems,
  memoFontPx,
  editableWindows = []
}) {
  const textareaRef = useRef(null)
  const [mentionState, setMentionState] = useState({
    visible: false,
    query: "",
    anchorPos: -1,
    tokenEnd: -1
  })
  const [mentionHoverId, setMentionHoverId] = useState(null)

  const effectiveMode = readOnly ? "read" : dayListMode
  const mentionMatches = useMemo(
    () => buildMentionMatches(editableWindows, mentionState.query),
    [editableWindows, mentionState.query]
  )

  function hideMentionMenu() {
    setMentionState((prev) =>
      prev.visible || prev.query || prev.anchorPos !== -1 || prev.tokenEnd !== -1
        ? { visible: false, query: "", anchorPos: -1, tokenEnd: -1 }
        : prev
    )
  }

  function refreshMentionMenu() {
    if (readOnly || effectiveMode !== "edit") {
      hideMentionMenu()
      return
    }
    const ta = textareaRef.current
    if (!ta) return
    if (document.activeElement !== ta || ta.selectionStart !== ta.selectionEnd) {
      hideMentionMenu()
      return
    }

    const value = ta.value ?? ""
    const caret = ta.selectionStart ?? 0
    const context = getMentionContext(value, caret)
    if (!context) {
      hideMentionMenu()
      return
    }

    const nextMatches = buildMentionMatches(editableWindows, context.query)
    if (nextMatches.length === 0) {
      hideMentionMenu()
      return
    }

    setMentionState({
      visible: true,
      query: context.query,
      anchorPos: context.anchorPos,
      tokenEnd: context.tokenEnd
    })
    setMentionHoverId((prev) => (nextMatches.some((item) => item.id === prev) ? prev : nextMatches[0]?.id ?? null))
  }

  function updateDayListText(nextText) {
    setDayListEditText(nextText)
    applyDayListEdit(nextText)
  }

  function handleMentionPick(title) {
    const ta = textareaRef.current
    if (!ta) return
    const value = ta.value ?? ""
    const caret = ta.selectionStart ?? 0
    const context =
      getMentionContext(value, caret) ??
      (mentionState.anchorPos >= 0 && mentionState.tokenEnd >= mentionState.anchorPos
        ? { anchorPos: mentionState.anchorPos, tokenEnd: mentionState.tokenEnd }
        : null)
    if (!context) return

    const replaceEnd = Math.max(context.tokenEnd, context.anchorPos + 1)
    const nextChar = value[replaceEnd] ?? ""
    const insert = `@${title}${nextChar === ";" ? "" : ";"}`
    const nextText = value.slice(0, context.anchorPos) + insert + value.slice(replaceEnd)
    const nextCaret = context.anchorPos + insert.length

    updateDayListText(nextText)
    hideMentionMenu()
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCaret, nextCaret)
      refreshMentionMenu()
    })
  }

  useEffect(() => {
    if (!open || effectiveMode !== "edit") {
      hideMentionMenu()
    }
  }, [open, effectiveMode])

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
                background: effectiveMode === "read" ? ui.accent : ui.surface,
                color: effectiveMode === "read" ? "#fff" : ui.text,
                cursor: "pointer",
                fontWeight: 800
              }}
            >
              Read
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setDayListMode("edit")}
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 8,
                  border: `1px solid ${ui.border}`,
                  background: effectiveMode === "edit" ? ui.accent : ui.surface,
                  color: effectiveMode === "edit" ? "#fff" : ui.text,
                  cursor: "pointer",
                  fontWeight: 800
                }}
              >
                Edit
              </button>
            )}
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
            <textarea
              ref={textareaRef}
              value={dayListEditText}
              onFocus={refreshMentionMenu}
              onChange={(e) => {
                const next = e.target.value
                updateDayListText(next)
                requestAnimationFrame(refreshMentionMenu)
              }}
              onClick={refreshMentionMenu}
              onSelect={refreshMentionMenu}
              onKeyUp={refreshMentionMenu}
              onBlur={hideMentionMenu}
              onKeyDown={(e) => {
                if (!mentionState.visible || mentionMatches.length === 0) return
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault()
                  setMentionHoverId((prev) => {
                    const currentIndex = mentionMatches.findIndex((item) => item.id === prev)
                    const baseIndex = currentIndex >= 0 ? currentIndex : 0
                    const delta = e.key === "ArrowDown" ? 1 : -1
                    const nextIndex = (baseIndex + delta + mentionMatches.length) % mentionMatches.length
                    return mentionMatches[nextIndex]?.id ?? null
                  })
                  return
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault()
                  const target =
                    mentionMatches.find((item) => item.id === mentionHoverId) ?? mentionMatches[0]
                  if (target) handleMentionPick(target.title)
                  return
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  hideMentionMenu()
                }
              }}
              placeholder="Type your schedule notes"
              style={{
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
          </div>
        ) : (
          <div
            onClick={() => {
              if (!readOnly) setDayListMode("edit")
            }}
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
              gap: 2,
              cursor: readOnly ? "default" : "text"
            }}
          >
            {dayListReadItems ? (
              dayListReadItems.isAll ? (
                <>
                  {dayListReadItems.timedItems.map((item, idx) => (
                    <div key={`daylist-timed-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      {item.time} {item.title ? `[${item.title}] ` : ""}
                      {item.text}
                    </div>
                  ))}
                  {dayListReadItems.noTimeGroupItems.map((item, idx) => (
                    <div key={`daylist-group-notime-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      [{item.title}] {item.text}
                    </div>
                  ))}
                  {dayListReadItems.general.map((line, idx) => (
                    <div key={`daylist-general-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      {line}
                    </div>
                  ))}
                  {dayListReadItems.general.length === 0 &&
                    dayListReadItems.noTimeGroupItems.length === 0 &&
                    dayListReadItems.timedItems.length === 0 && <div style={{ color: ui.text2 }}>No content.</div>}
                </>
              ) : (
                <>
                  {dayListReadItems.timedItems.map((item, idx) => (
                    <div key={`daylist-timed-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      {item.time} {item.text}
                    </div>
                  ))}
                  {dayListReadItems.noTimeItems.map((line, idx) => (
                    <div key={`daylist-notime-${idx}`} style={{ color: ui.text, lineHeight: 1.25 }}>
                      {line}
                    </div>
                  ))}
                  {dayListReadItems.noTimeItems.length === 0 && dayListReadItems.timedItems.length === 0 && (
                    <div style={{ color: ui.text2 }}>No content.</div>
                  )}
                </>
              )
            ) : (
              <span style={{ color: ui.text2 }}>No content.</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

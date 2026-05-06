import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

function ArrowIcon({ direction }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">
      {direction === "left" ? (
        <path
          d="M12.5 4.5L7 10l5.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M7.5 4.5L13 10l-5.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

export default function WindowTabs({
  windows,
  activeWindowId,
  setActiveWindowId,
  editingWindowId,
  setEditingWindowId,
  titleInputRef,
  commitWindowTitleChange,
  tabFontPx,
  setDeleteConfirm,
  draggingWindowIdRef,
  reorderWindows,
  addWindow,
  scrollTabs,
  tabsScrollRef,
  canScrollTabsLeft,
  canScrollTabsRight,
  ui,
  iconButton,
  WINDOW_COLORS,
  setWindows
}) {
  const [colorPickerId, setColorPickerId] = useState(null)
  const [colorPickerPos, setColorPickerPos] = useState(null)
  const colorPickerPanelRef = useRef(null)

  const colorPickerWindow = useMemo(
    () => windows.find((w) => w.id === colorPickerId) ?? null,
    [windows, colorPickerId]
  )

  useEffect(() => {
    if (!colorPickerId) return

    function onDocPointerDown(e) {
      const panel = colorPickerPanelRef.current
      const t = e.target
      if (!(t instanceof Node)) return
      if (t instanceof Element) {
        const trigger = t.closest("[data-color-picker-trigger='true']")
        if (trigger) return
      }
      if (panel && panel.contains(t)) return
      setColorPickerId(null)
      setColorPickerPos(null)
    }

    document.addEventListener("pointerdown", onDocPointerDown, true)
    return () => document.removeEventListener("pointerdown", onDocPointerDown, true)
  }, [colorPickerId])

  useLayoutEffect(() => {
    if (!colorPickerId || !colorPickerPos) return
    const panel = colorPickerPanelRef.current
    if (!panel) return

    const rect = panel.getBoundingClientRect()
    const pad = 8
    let nextLeft = colorPickerPos.left
    let nextTop = colorPickerPos.top

    if (rect.right > window.innerWidth - pad) {
      nextLeft = Math.max(pad, window.innerWidth - rect.width - pad)
    }
    if (rect.left < pad) nextLeft = pad
    if (rect.bottom > window.innerHeight - pad) {
      nextTop = Math.max(pad, window.innerHeight - rect.height - pad)
    }
    if (rect.top < pad) nextTop = pad

    if (nextLeft !== colorPickerPos.left || nextTop !== colorPickerPos.top) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setColorPickerPos({ left: nextLeft, top: nextTop })
    }
  }, [colorPickerId, colorPickerPos])

  const topToolbarButtonStyle = {
    width: 30,
    height: 30,
    borderRadius: 6,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "none",
    flexShrink: 0,
    userSelect: "none"
  }

  const topAddButtonStyle = {
    ...iconButton,
    ...topToolbarButtonStyle,
    border: `1px solid ${ui.border}`,
    background: ui.surface,
    color: ui.text,
    cursor: "pointer",
    fontWeight: 400,
    lineHeight: 1,
    position: "relative"
  }

  function getTopArrowButtonStyle(enabled) {
    return {
      ...topToolbarButtonStyle,
      border: enabled ? `1px solid ${ui.border}` : "1px solid transparent",
      background: enabled ? ui.surface : "transparent",
      color: enabled ? ui.text : ui.text2,
      cursor: enabled ? "pointer" : "default",
      opacity: enabled ? 1 : 0.2
    }
  }

  const topTabHeight = 30

  return (
    <div
      className="window-tabs"
      style={{
        padding: "8px 12px",
        borderBottom: `1px solid ${ui.border}`,
        background: ui.surface2,
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0
      }}
    >
      <button
        type="button"
        onClick={() => scrollTabs(-1)}
        disabled={!canScrollTabsLeft}
        className="no-hover-outline"
        style={getTopArrowButtonStyle(canScrollTabsLeft)}
        title={canScrollTabsLeft ? "왼쪽으로 이동" : "왼쪽 끝"}
        aria-label={canScrollTabsLeft ? "왼쪽으로 이동" : "왼쪽 끝"}
      >
        <ArrowIcon direction="left" />
      </button>
      <div
        className="tabs-scroll"
        ref={tabsScrollRef}
        style={{
          flex: "1 1 auto",
          overflowX: "auto",
          whiteSpace: "nowrap",
          display: "flex",
          gap: 6,
          paddingBottom: 0,
          paddingTop: 0
        }}
      >
        {windows.map((w) => {
          const isActive = activeWindowId === w.id
          const isFixed = w.fixed || w.id === "all"
          const isIntegrated = w.id === "all"

          return (
            <div
              key={w.id}
              className={`tab-pill${isActive ? " is-active" : ""}`}
              data-window-id={w.id}
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                border: `1px solid ${isActive ? ui.accent : ui.border}`,
                background: isActive ? ui.accentSoft : ui.surface,
                padding: isIntegrated ? "0 10px" : "0 2px 0 8px",
                minWidth: isIntegrated ? 88 : undefined,
                height: topTabHeight,
                gap: isIntegrated ? 6 : 4,
                cursor: "pointer",
                flexShrink: 0
              }}
              onClick={() => setActiveWindowId(w.id)}
              title={w.title}
              draggable={!isFixed}
              onDragStart={(e) => {
                if (isFixed) return
                draggingWindowIdRef.current = w.id
                e.dataTransfer.effectAllowed = "move"
              }}
              onDragOver={(e) => {
                if (isFixed) return
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
              }}
              onDrop={(e) => {
                e.preventDefault()
                const dragId = draggingWindowIdRef.current
                draggingWindowIdRef.current = null
                if (!dragId || isFixed) return
                reorderWindows(dragId, w.id)
              }}
            >
              {w.id !== "all" && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isFixed) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    setColorPickerId((prev) => {
                      const next = prev === w.id ? null : w.id
                      if (next) setColorPickerPos({ top: rect.bottom + 8, left: rect.left })
                      else setColorPickerPos(null)
                      return next
                    })
                  }}
                  data-color-picker-trigger="true"
                  aria-label="색상 선택"
                  title={isFixed ? "" : "색상 선택"}
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: w.color,
                    border: `1px solid ${ui.border}`,
                    cursor: isFixed ? "default" : "pointer",
                    padding: 0,
                    display: "inline-block"
                  }}
                />
              )}

              {editingWindowId === w.id ? (
                <input
                  ref={titleInputRef}
                  autoFocus
                  defaultValue={w.title}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    commitWindowTitleChange(w.id, e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur()
                    if (e.key === "Escape") setEditingWindowId(null)
                  }}
                  style={{
                    width: 90,
                    fontWeight: 620,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: ui.text,
                    fontSize: tabFontPx
                  }}
                />
              ) : (
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    if (isFixed && w.id !== "all") return
                    setEditingWindowId(w.id)
                  }}
                  style={{
                    maxWidth: 100,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontWeight: 620,
                    whiteSpace: "nowrap",
                    cursor: isFixed ? "default" : "text",
                    fontSize: tabFontPx,
                    lineHeight: 1.1
                  }}
                >
                  {w.title}
                </span>
              )}

              {!isFixed && (
                <button
                  className="tab-pill__delete no-hover-outline"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm({ id: w.id, title: w.title })
                  }}
                  aria-label="탭 삭제"
                  title="탭 삭제"
                  style={{
                    border: "none",
                    background: "transparent",
                    color: ui.text2,
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 13,
                    lineHeight: 1,
                    padding: "0 4px"
                  }}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => scrollTabs(1)}
        disabled={!canScrollTabsRight}
        className="no-hover-outline"
        style={getTopArrowButtonStyle(canScrollTabsRight)}
        title={canScrollTabsRight ? "오른쪽으로 이동" : "오른쪽 끝"}
        aria-label={canScrollTabsRight ? "오른쪽으로 이동" : "오른쪽 끝"}
      >
        <ArrowIcon direction="right" />
      </button>
      <button
        type="button"
        onClick={addWindow}
        className="no-hover-outline"
        style={topAddButtonStyle}
        title="새 창 추가"
        aria-label="새 창 추가"
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: Math.max(tabFontPx, 12),
            lineHeight: 1,
            fontWeight: 400,
            transform: "translateY(1px)",
            pointerEvents: "none"
          }}
        >
          +
        </span>
      </button>

      {colorPickerWindow && colorPickerPos && (
        <div
          ref={colorPickerPanelRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: colorPickerPos.top,
            left: colorPickerPos.left,
            zIndex: 120,
            background: ui.surface,
            border: `1px solid ${ui.border}`,
            boxShadow: ui.shadow,
            borderRadius: 12,
            padding: 6,
            display: "grid",
            gridTemplateColumns: "repeat(6, 14px)",
            gap: 6
          }}
        >
          {WINDOW_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setWindows((prev) => prev.map((x) => (x.id === colorPickerWindow.id ? { ...x, color: c } : x)))
                setColorPickerId(null)
                setColorPickerPos(null)
              }}
              aria-label={`색상 ${c}`}
              title={c}
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                background: c,
                border: c === colorPickerWindow.color ? `2px solid ${ui.accent}` : `1px solid ${ui.border}`,
                cursor: "pointer",
                padding: 0
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

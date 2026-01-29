export default function MemoEditor({
  ui,
  memoOverlayStyle,
  memoTextareaStyle,
  leftOverlayLines,
  leftOverlayInnerRef,
  mentionGhostText,
  mentionGhostPos,
  memoFontPx,
  textareaRef,
  value,
  onFocus,
  onChange,
  onBlur,
  onClick,
  onKeyUp,
  onKeyDown,
  onSelect,
  onWheel,
  onScroll,
  placeholder,
  showTabMentionMenu,
  tabMentionMenu,
  tabMentionRef,
  editableWindows,
  tabMentionHoverId,
  setTabMentionHoverId,
  handleTabMentionPick,
  tabMentionMouseDownRef
}) {
  return (
    <>
      <div style={memoOverlayStyle} aria-hidden="true">
        <div ref={leftOverlayInnerRef} style={{ transform: "translateY(0px)", willChange: "transform" }}>
          {leftOverlayLines.map((line, i) => (
            <div
              key={`memo-left-line-${i}`}
              className={line.isHeader ? "memo-overlay__line memo-overlay__line--header" : "memo-overlay__line"}
            >
              {line.groupParts ? (
                <>
                  {line.groupParts.prefix}
                  {line.groupParts.suffix ? <span>{line.groupParts.suffix}</span> : null}
                </>
              ) : line.text === "" ? (
                " "
              ) : (
                line.text
              )}
            </div>
          ))}
        </div>
      </div>
      {mentionGhostText ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: mentionGhostPos.top,
            left: mentionGhostPos.left,
            fontSize: memoFontPx,
            lineHeight: 1.55,
            fontFamily: "inherit",
            fontWeight: 400,
            color: ui.text2,
            whiteSpace: "pre",
            pointerEvents: "none",
            zIndex: 2
          }}
        >
          {mentionGhostText}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        className="memo-input"
        value={value}
        onFocus={onFocus}
        onChange={onChange}
        onBlur={onBlur}
        onClick={onClick}
        onKeyUp={onKeyUp}
        onKeyDown={onKeyDown}
        onSelect={onSelect}
        onWheel={onWheel}
        onScroll={onScroll}
        style={memoTextareaStyle}
        placeholder={placeholder}
      />
      {showTabMentionMenu ? (
        <div
          ref={tabMentionRef}
          style={{
            position: "absolute",
            top: tabMentionMenu.top,
            left: tabMentionMenu.left,
            minWidth: 120,
            borderRadius: 8,
            border: `1px solid ${ui.border}`,
            background: ui.surface,
            boxShadow: ui.shadow,
            zIndex: 5,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden"
          }}
        >
          {editableWindows.map((w) => (
            <button
              key={w.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                tabMentionMouseDownRef.current = true
                handleTabMentionPick(w.title)
              }}
              onMouseEnter={() => setTabMentionHoverId(w.id)}
              onMouseLeave={() => {
                setTabMentionHoverId((prev) => (prev === w.id ? null : prev))
              }}
              style={{
                height: 30,
                padding: "0 10px",
                border: "none",
                background: tabMentionHoverId === w.id ? ui.surface2 : "transparent",
                color: ui.text,
                textAlign: "left",
                cursor: "pointer",
                fontWeight: 700,
                border: tabMentionHoverId === w.id ? `2px solid ${ui.accent}` : "2px solid transparent",
                boxSizing: "border-box"
              }}
            >
              {w.title}
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}

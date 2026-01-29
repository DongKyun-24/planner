export default function RightMemoEditor({
  memoOverlayStyle,
  memoTextareaStyle,
  rightOverlayLines,
  rightOverlayInnerRef,
  rightTextareaRef,
  rightMemoText,
  setRightMemoText,
  activeWindowId,
  syncCombinedRightText,
  ensureRightMemoSectionHeaders,
  onFocus,
  onScroll,
  placeholder
}) {
  return (
    <>
      <div style={memoOverlayStyle} aria-hidden="true">
        <div ref={rightOverlayInnerRef} style={{ transform: "translateY(0px)", willChange: "transform" }}>
          {rightOverlayLines.map((line, i) => (
            <div
              key={`memo-right-line-${i}`}
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
      <textarea
        ref={rightTextareaRef}
        className="memo-input"
        value={rightMemoText}
        onChange={(e) => {
          const next = e.target.value
          setRightMemoText(next)
          if (activeWindowId === "all") {
            syncCombinedRightText(next)
          }
        }}
        onBlur={(e) => {
          if (activeWindowId !== "all") return
          const raw = e.currentTarget.value
          const sanitized = ensureRightMemoSectionHeaders(raw)
          if (sanitized === raw) return
          setRightMemoText(sanitized)
          syncCombinedRightText(sanitized)
        }}
        onFocus={onFocus}
        onScroll={onScroll}
        style={memoTextareaStyle}
        placeholder={placeholder}
      />
    </>
  )
}

export default function MemoReadView({
  blocks,
  isAll,
  ui,
  highlightTokens,
  todayKey,
  hoveredReadDateKey,
  setHoveredReadDateKey,
  collapsedForActive,
  toggleDashboardCollapse,
  keyToYMD,
  buildHeaderLine,
  activeWindowId,
  setReadBlockRef,
  handleReadBlockClick,
  readScrollMarginTop,
  emptyText = "읽기모드입니다. 클릭하여 편집하세요."
}) {
  if (!blocks || blocks.length === 0) {
    return (
      <div style={{ color: ui.text2, fontWeight: 600, lineHeight: 1.45 }}>
        {emptyText}
      </div>
    )
  }

  return (
    <>
      {blocks.map((block) => {
        if (!block?.dateKey) return null
        const { y, m, d } = keyToYMD(block.dateKey)
        const header = buildHeaderLine(y, m, d)
        const isCollapsed = Boolean(collapsedForActive[block.dateKey])
        const isToday = block.dateKey === todayKey
        const isHovered = hoveredReadDateKey === block.dateKey
        const blockBorderColor = isHovered
          ? highlightTokens.hover.ring
          : isToday
            ? highlightTokens.today.ring
            : "transparent"

        let hasContent = false
        let orderedItems = []
        const useOrderedEntries = isAll && Array.isArray(block.entries)
        const blockGeneral = Array.isArray(block.general) ? block.general : []
        const blockGroups = Array.isArray(block.groups) ? block.groups : []
        const blockTimed = Array.isArray(block.timed) ? block.timed : []

        if (isAll) {
          if (useOrderedEntries) {
            const entries = block.entries ?? []
            for (const item of entries) {
              const text = (item.text ?? "").trim()
              if (!text) continue
              orderedItems.push({
                time: item.time || "",
                text,
                title: item.title || "",
                order: item.order ?? 0
              })
            }
            hasContent = orderedItems.length > 0
          } else {
            const groups = blockGroups
            const groupItemCount = groups.reduce((sum, group) => sum + (group.items?.length ?? 0), 0)
            hasContent = blockGeneral.length > 0 || blockTimed.length > 0 || groupItemCount > 0
            if (hasContent) {
              for (const group of groups) {
                for (const item of group.items ?? []) {
                  const text = (item.text ?? "").trim()
                  if (!text) continue
                  const entry = {
                    time: item.time || "",
                    text,
                    title: group.title,
                    order: item.order ?? 0
                  }
                  orderedItems.push(entry)
                }
              }
              for (const item of blockTimed) {
                const text = (item.text ?? "").trim()
                if (!text) continue
                orderedItems.push({ time: item.time || "", text, title: "", order: item.order ?? 0 })
              }
              for (const line of blockGeneral) {
                const text = String(line ?? "").trim()
                if (!text) continue
                orderedItems.push({ time: "", text, title: "", order: Number.MAX_SAFE_INTEGER })
              }
              orderedItems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            }
          }
        } else {
          if (Array.isArray(block.items)) {
            for (const item of block.items) {
              const text = (item.text ?? "").trim()
              if (!text) continue
              orderedItems.push({ time: item.time || "", text, order: item.order ?? 0 })
            }
          }
          hasContent = orderedItems.length > 0
        }

        if (!hasContent) return null

        return (
          <div
            key={block.dateKey}
            ref={setReadBlockRef(block.dateKey)}
            onClick={(e) => {
              e.stopPropagation()
              handleReadBlockClick(block.dateKey)
            }}
            onMouseEnter={() => setHoveredReadDateKey(block.dateKey)}
            onMouseLeave={() => {
              setHoveredReadDateKey((prev) => (prev === block.dateKey ? null : prev))
            }}
            style={{
              marginBottom: 16,
              scrollMarginTop: readScrollMarginTop,
              cursor: "pointer",
              position: "relative",
              border: `1px solid ${blockBorderColor}`,
              borderRadius: 10,
              padding: "6px 8px",
              paddingLeft: isToday ? 14 : 8,
              boxShadow: isToday ? `0 0 0 2px ${highlightTokens.today.soft}` : "none",
              background: isToday
                ? `linear-gradient(90deg, ${highlightTokens.today.soft}, rgba(0,0,0,0) 55%)`
                : "transparent"
            }}
          >
            {isToday && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: 4,
                  top: 6,
                  bottom: 6,
                  width: 4,
                  borderRadius: 999,
                  background: highlightTokens.today.ring
                }}
              />
            )}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                fontWeight: 900
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div>{header}</div>
                {isToday && (
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 900,
                      color: highlightTokens.today.pillText,
                      border: `1px solid ${highlightTokens.today.pillText}`,
                      background: highlightTokens.today.soft
                    }}
                  >
                    오늘
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleDashboardCollapse(block.dateKey)
                }}
                style={{
                  border: `1px solid ${ui.border}`,
                  background: ui.surface,
                  color: ui.text2,
                  borderRadius: 999,
                  width: 24,
                  height: 24,
                  cursor: "pointer",
                  fontWeight: 900,
                  lineHeight: 1
                }}
                title={isCollapsed ? "펼치기" : "접기"}
              >
                {isCollapsed ? "▸" : "▾"}
              </button>
            </div>
            {!isCollapsed && (
              <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                {orderedItems.map((item, idx) => (
                  <div
                    key={`${block.dateKey}-${activeWindowId ?? "tab"}-item-${idx}`}
                    style={{ fontWeight: 400, color: ui.text, lineHeight: 1.25 }}
                  >
                    {item.time ? `${item.time} ` : ""}
                    {isAll && item.title ? `[${item.title}] ` : ""}
                    {item.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

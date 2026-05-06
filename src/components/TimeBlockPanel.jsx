import { useMemo, useRef, useState } from "react"

const DAY_START_MIN = 5 * 60
const DAY_END_MIN = 24 * 60
const SNAP_MIN = 15
const PX_PER_MIN = 0.82
const MIN_BLOCK_MIN = 15
const DEFAULT_BLOCK_MIN = 60

function clampNumber(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function pad2(value) {
  return String(value).padStart(2, "0")
}

function minutesToClock(value) {
  const minutes = clampNumber(Math.round(Number(value) || 0), 0, 24 * 60)
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${pad2(hour)}:${pad2(minute)}`
}

function snapMinutes(value) {
  return Math.round((Number(value) || 0) / SNAP_MIN) * SNAP_MIN
}

function parseClockMinutes(value) {
  const match = String(value ?? "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null
  if (hour === 24 && minute !== 0) return null
  return hour * 60 + minute
}

function getTimeRange(item) {
  const start = Number.isFinite(item?.startMinutes) ? item.startMinutes : null
  const end = Number.isFinite(item?.endMinutes) ? item.endMinutes : null
  if (start != null) {
    return {
      startMinutes: start,
      endMinutes: end != null && end > start ? end : Math.min(DAY_END_MIN, start + DEFAULT_BLOCK_MIN)
    }
  }

  const raw = String(item?.time ?? "").trim()
  const match = raw.match(/^(\d{1,2}:\d{2})(?:\s*[~-]\s*(\d{1,2}:\d{2}))?$/)
  if (!match) return null
  const parsedStart = parseClockMinutes(match[1])
  if (parsedStart == null) return null
  const parsedEnd = match[2] ? parseClockMinutes(match[2]) : null
  return {
    startMinutes: parsedStart,
    endMinutes: parsedEnd != null && parsedEnd > parsedStart ? parsedEnd : Math.min(DAY_END_MIN, parsedStart + DEFAULT_BLOCK_MIN)
  }
}

function buildLanes(items) {
  const sorted = items
    .map((item) => ({ ...item, range: getTimeRange(item) }))
    .filter((item) => item.range)
    .sort((a, b) => {
      const startDiff = a.range.startMinutes - b.range.startMinutes
      if (startDiff !== 0) return startDiff
      return a.range.endMinutes - b.range.endMinutes
    })

  const out = []
  let cluster = []
  let clusterEnd = -1

  function flushCluster() {
    if (cluster.length === 0) return
    const laneEnds = []
    const placed = []
    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => end <= item.range.startMinutes)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(item.range.endMinutes)
      } else {
        laneEnds[lane] = item.range.endMinutes
      }
      placed.push({ ...item, lane })
    }
    const laneCount = Math.max(1, laneEnds.length)
    for (const item of placed) out.push({ ...item, laneCount })
    cluster = []
    clusterEnd = -1
  }

  for (const item of sorted) {
    if (cluster.length > 0 && item.range.startMinutes >= clusterEnd) flushCluster()
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.range.endMinutes)
  }
  flushCluster()
  return out
}

function formatDateLabel(dateKey) {
  const match = String(dateKey ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return String(dateKey ?? "")
  return `${match[1]}.${match[2]}.${match[3]}`
}

export default function TimeBlockPanel({
  dateKey,
  items = [],
  ui,
  theme = "light",
  onPrevDay,
  onNextDay,
  onToday,
  onAdd,
  onOpenItem,
  onBlockTimeChange
}) {
  const [dragState, setDragState] = useState(null)
  const [draggingFloatingId, setDraggingFloatingId] = useState("")
  const noTimeDropRef = useRef(null)

  const isDark = theme === "dark"
  const timedItems = useMemo(() => buildLanes(items), [items])
  const noTimeItems = useMemo(() => (Array.isArray(items) ? items.filter((item) => !getTimeRange(item)) : []), [items])
  const timelineHeight = (DAY_END_MIN - DAY_START_MIN) * PX_PER_MIN
  const hourRows = useMemo(() => {
    const out = []
    for (let minute = DAY_START_MIN; minute <= DAY_END_MIN; minute += 60) out.push(minute)
    return out
  }, [])

  function minutesFromClientY(clientY, target) {
    const rect = target.getBoundingClientRect()
    const offset = clampNumber(clientY - rect.top, 0, timelineHeight)
    return snapMinutes(DAY_START_MIN + offset / PX_PER_MIN)
  }

  function beginMove(event, item) {
    if (!item?.canEdit) {
      onOpenItem?.(item)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const range = getTimeRange(item)
    if (!range) return
    setDragState({
      id: item.id,
      pointerId: event.pointerId,
      mode: "move",
      originY: event.clientY,
      originStart: range.startMinutes,
      originEnd: range.endMinutes,
      currentStart: range.startMinutes,
      currentEnd: range.endMinutes,
      moved: false
    })
  }

  function beginResize(event, item) {
    if (!item?.canEdit) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const range = getTimeRange(item)
    if (!range) return
    setDragState({
      id: item.id,
      pointerId: event.pointerId,
      mode: "resize",
      originY: event.clientY,
      originStart: range.startMinutes,
      originEnd: range.endMinutes,
      currentStart: range.startMinutes,
      currentEnd: range.endMinutes,
      moved: false
    })
  }

  function updateDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const delta = snapMinutes((event.clientY - dragState.originY) / PX_PER_MIN)
    if (dragState.mode === "resize") {
      const nextEnd = clampNumber(
        snapMinutes(dragState.originEnd + delta),
        dragState.originStart + MIN_BLOCK_MIN,
        DAY_END_MIN
      )
      setDragState((prev) => ({ ...prev, currentEnd: nextEnd, moved: prev.moved || Math.abs(delta) >= SNAP_MIN }))
      return
    }

    const duration = Math.max(MIN_BLOCK_MIN, dragState.originEnd - dragState.originStart)
    const nextStart = clampNumber(
      snapMinutes(dragState.originStart + delta),
      DAY_START_MIN,
      Math.max(DAY_START_MIN, DAY_END_MIN - duration)
    )
    setDragState((prev) => ({
      ...prev,
      currentStart: nextStart,
      currentEnd: nextStart + duration,
      moved: prev.moved || Math.abs(delta) >= SNAP_MIN
    }))
  }

  function endDrag(event, item) {
    if (!dragState || dragState.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const finished = dragState
    setDragState(null)
    if (!finished.moved) {
      onOpenItem?.(item)
      return
    }
    const dropRect = noTimeDropRef.current?.getBoundingClientRect?.()
    if (
      dropRect &&
      event.clientX >= dropRect.left &&
      event.clientX <= dropRect.right &&
      event.clientY >= dropRect.top &&
      event.clientY <= dropRect.bottom
    ) {
      onBlockTimeChange?.(item, null, null)
      return
    }
    onBlockTimeChange?.(item, finished.currentStart, finished.currentEnd)
  }

  function handleDrop(event) {
    if (!draggingFloatingId) return
    event.preventDefault()
    const target = event.currentTarget
    const item = noTimeItems.find((candidate) => String(candidate?.id) === draggingFloatingId)
    setDraggingFloatingId("")
    if (!item?.canEdit) return
    const start = clampNumber(minutesFromClientY(event.clientY, target), DAY_START_MIN, DAY_END_MIN - DEFAULT_BLOCK_MIN)
    onBlockTimeChange?.(item, start, start + DEFAULT_BLOCK_MIN)
  }

  const gridLine = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(148, 163, 184, 0.18)"
  const gridLineStrong = isDark ? "rgba(255, 255, 255, 0.14)" : "rgba(100, 116, 139, 0.28)"

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "2px 2px 0"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <button type="button" onClick={onPrevDay} className="arrow-button timeblock-nav-button" aria-label="이전 날짜">
            <span aria-hidden="true">‹</span>
          </button>
          <div
            style={{
              fontSize: 14,
              fontWeight: 900,
              color: ui.text,
              minWidth: 104,
              textAlign: "center",
              lineHeight: 1
            }}
          >
            {formatDateLabel(dateKey)}
          </div>
          <button type="button" onClick={onNextDay} className="arrow-button timeblock-nav-button" aria-label="다음 날짜">
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" onClick={onToday} className="timeblock-pill-button">
            Today
          </button>
        </div>
        <button type="button" onClick={onAdd} className="timeblock-pill-button">
          Add
        </button>
      </div>

      <div
        ref={noTimeDropRef}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 8px",
          border: `1px solid ${ui.border}`,
          borderRadius: 8,
          background: ui.surface2,
          overflowX: "auto",
          minHeight: 44
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 900, color: ui.text2, flexShrink: 0 }}>미배치</div>
        {noTimeItems.length > 0 ? (
          noTimeItems.map((item) => (
            <button
              key={item.id}
              type="button"
              draggable={Boolean(item.canEdit)}
              onDragStart={(event) => {
                if (!item.canEdit) return
                setDraggingFloatingId(String(item.id))
                event.dataTransfer.effectAllowed = "move"
                event.dataTransfer.setData("text/plain", String(item.id))
              }}
              onDragEnd={() => setDraggingFloatingId("")}
              onClick={() => onOpenItem?.(item)}
              style={{
                maxWidth: 220,
                height: 28,
                padding: "0 10px",
                borderRadius: 8,
                border: `1px solid ${ui.border}`,
                background: ui.surface,
                color: ui.text,
                fontSize: 12,
                fontWeight: 800,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                cursor: item.canEdit ? "grab" : "pointer",
                borderLeft: `4px solid ${item.color || ui.accent}`
              }}
              title={item.text}
            >
              {item.text}
            </button>
          ))
        ) : (
          <div style={{ color: ui.text2, fontSize: 12, fontWeight: 700 }}>
            시간 블록을 여기로 끌면 미배치로 돌아갑니다.
          </div>
        )}
      </div>

      <div
        style={{
          minHeight: 0,
          flex: "1 1 auto",
          overflow: "auto",
          border: `1px solid ${ui.border}`,
          borderRadius: 8,
          background: ui.surface
        }}
      >
        <div
          onDragOver={(event) => {
            if (!draggingFloatingId) return
            event.preventDefault()
            event.dataTransfer.dropEffect = "move"
          }}
          onDrop={handleDrop}
          style={{
            position: "relative",
            minHeight: timelineHeight,
            marginLeft: 0,
            background: ui.surface
          }}
        >
          {hourRows.map((minute) => (
            <div
              key={minute}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: (minute - DAY_START_MIN) * PX_PER_MIN,
                height: 1,
                background: minute % 180 === 0 ? gridLineStrong : gridLine
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 10,
                  top: minute === DAY_START_MIN ? 2 : -7,
                  width: 46,
                  color: ui.text2,
                  fontSize: 10,
                  fontWeight: 900,
                  lineHeight: 1,
                  textAlign: "right"
                }}
              >
                {minutesToClock(minute)}
              </div>
            </div>
          ))}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 64,
              top: 0,
              bottom: 0,
              width: 1,
              background: gridLineStrong
            }}
          />

          {timedItems.map((item) => {
            const activeDrag = dragState?.id === item.id ? dragState : null
            const start = activeDrag?.currentStart ?? item.range.startMinutes
            const end = activeDrag?.currentEnd ?? item.range.endMinutes
            const top = Math.max(0, (start - DAY_START_MIN) * PX_PER_MIN)
            const height = Math.max(28, (end - start) * PX_PER_MIN)
            const laneGap = 6
            const trackLeft = 74
            const laneWidth = `calc((100% - ${trackLeft + 10}px - ${(item.laneCount - 1) * laneGap}px) / ${item.laneCount})`
            const left = `calc(${trackLeft}px + (${laneWidth} + ${laneGap}px) * ${item.lane})`

            return (
              <div
                key={item.id}
                onPointerDown={(event) => beginMove(event, item)}
                onPointerMove={updateDrag}
                onPointerUp={(event) => endDrag(event, item)}
                onPointerCancel={() => setDragState(null)}
                style={{
                  position: "absolute",
                  top,
                  left,
                  width: laneWidth,
                  height,
                  minWidth: 0,
                  borderRadius: 8,
                  border: `1px solid ${colorWithAlpha(item.color || ui.accent, isDark ? 0.52 : 0.34)}`,
                  borderLeft: `5px solid ${item.color || ui.accent}`,
                  background: isDark
                    ? colorWithAlpha(item.color || ui.accent, 0.18)
                    : colorWithAlpha(item.color || ui.accent, 0.12),
                  color: ui.text,
                  padding: "6px 8px 7px",
                  boxShadow: activeDrag
                    ? "0 14px 28px rgba(15, 23, 42, 0.24)"
                    : isDark
                      ? "0 8px 18px rgba(0, 0, 0, 0.18)"
                      : "0 8px 18px rgba(15, 23, 42, 0.10)",
                  cursor: item.canEdit ? (activeDrag ? "grabbing" : "grab") : "pointer",
                  zIndex: activeDrag ? 5 : 2,
                  userSelect: "none",
                  touchAction: "none",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 4
                }}
                title={`${minutesToClock(start)}-${minutesToClock(end)} ${item.text}`}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 900,
                      color: ui.text2,
                      lineHeight: 1,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}
                  >
                    {minutesToClock(start)}-{minutesToClock(end)}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 13,
                      fontWeight: item.completed ? 700 : 850,
                      lineHeight: 1.18,
                      color: item.completed ? ui.text2 : ui.text,
                      textDecoration: item.completed ? "line-through" : "none",
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: height < 48 ? 1 : 2,
                      WebkitBoxOrient: "vertical"
                    }}
                  >
                    {item.text}
                  </div>
                </div>
                {item.sourceTitle ? (
                  <div
                    style={{
                      alignSelf: "flex-start",
                      maxWidth: "100%",
                      height: 18,
                      padding: "0 7px",
                      borderRadius: 999,
                      border: `1px solid ${ui.border}`,
                      background: ui.surface,
                      color: ui.text2,
                      fontSize: 10,
                      fontWeight: 800,
                      lineHeight: "18px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}
                  >
                    {item.sourceTitle}
                  </div>
                ) : null}
                {item.canEdit ? (
                  <div
                    onPointerDown={(event) => beginResize(event, item)}
                    onPointerMove={updateDrag}
                    onPointerUp={(event) => endDrag(event, item)}
                    onPointerCancel={() => setDragState(null)}
                    style={{
                      position: "absolute",
                      left: 8,
                      right: 8,
                      bottom: 2,
                      height: 10,
                      cursor: "ns-resize",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                    aria-label="블록 길이 조절"
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 28,
                        height: 3,
                        borderRadius: 999,
                        background: colorWithAlpha(item.color || ui.accent, isDark ? 0.72 : 0.44)
                      }}
                    />
                  </div>
                ) : null}
              </div>
            )
          })}

          {timedItems.length === 0 && noTimeItems.length === 0 ? (
            <div
              style={{
                position: "absolute",
                left: 74,
                right: 12,
                top: 28,
                height: 46,
                borderRadius: 8,
                border: `1px dashed ${ui.border}`,
                background: ui.surface2,
                color: ui.text2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 800
              }}
            >
              일정 없음
            </div>
          ) : null}
        </div>
      </div>

      <style>{`
        .timeblock-nav-button {
          width: 30px;
          height: 30px;
          border-radius: 8px;
          border: 1px solid ${ui.border};
          background: ${ui.surface};
          color: ${ui.text};
          font-size: 22px;
          font-weight: 900;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          cursor: pointer;
          line-height: 1;
        }
        .timeblock-pill-button {
          height: 30px;
          padding: 0 10px;
          border-radius: 8px;
          border: 1px solid ${ui.border};
          background: ${ui.surface};
          color: ${ui.text};
          font-family: inherit;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
        }
      `}</style>
    </div>
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

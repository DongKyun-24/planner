import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

// ===== 달력 보조 =====
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}
function dayOfWeek(year, month, day) {
  return new Date(year, month - 1, day).getDay()
}
function keyToYMD(key) {
  return {
    y: Number(key.slice(0, 4)),
    m: Number(key.slice(5, 7)),
    d: Number(key.slice(8, 10))
  }
}
function keyToTime(key) {
  return new Date(key).getTime()
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

// ===== 요일/공휴일 =====
const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"]

const FIXED_HOLIDAYS_MMDD = {
  "01-01": "신정",
  "03-01": "삼일절",
  "05-05": "어린이날",
  "06-06": "현충일",
  "08-15": "광복절",
  "10-03": "개천절",
  "10-09": "한글날",
  "12-25": "크리스마스"
}

// 연도별 변동 공휴일 수동 추가용
const YEAR_HOLIDAYS = {}

function getHolidayName(year, month, day) {
  const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  const mmdd = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  const byYear = YEAR_HOLIDAYS[year]?.[key]
  return byYear || FIXED_HOLIDAYS_MMDD[mmdd] || ""
}

function buildHeaderLine(year, month, day) {
  const w = WEEKDAYS_KO[dayOfWeek(year, month, day)]
  const holiday = getHolidayName(year, month, day)
  return holiday ? `${month}/${day} (${w}) ${holiday}` : `${month}/${day} (${w})`
}

// ===== 라인 시작 위치 배열(문자 인덱스) =====
function buildLineStartPositions(s) {
  const starts = [0]
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\n") starts.push(i + 1)
  }
  return starts
}

// ===== 날짜 헤더 파서 =====
const mdOnlyRegex = /^\s*(\d{1,2})\/(\d{1,2})(?:\s+.*)?\s*$/
const ymdOnlyRegex = /^\s*(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+.*)?\s*$/
const timeOnlyRegex = /^\s*(\d{1,2}):(\d{2})\s+(.+)\s*$/
const tabTitleRegex = /^\s*\[.+\]\s*$/

function parseBlocksAndItems(rawText, baseYear) {
  const s = rawText ?? ""
  const lines = s.split("\n")
  const lineStarts = buildLineStartPositions(s)

  const blocks = []
  const items = {}

  // 1) 헤더 라인 찾기
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()

    let key = null
    let m = trimmed.match(mdOnlyRegex)
    if (m) {
      key = `${baseYear}-${String(Number(m[1])).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`
    } else {
      m = trimmed.match(ymdOnlyRegex)
      if (m && Number(m[1]) === baseYear)
        key = `${baseYear}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`
    }

    if (key) {
      const headerStartPos = lineStarts[i] ?? 0
      const headerEndPos = headerStartPos + raw.length
      const bodyStartPos = headerEndPos + 1
      blocks.push({
        dateKey: key,
        blockStartPos: headerStartPos,
        headerStartPos,
        headerEndPos,
        bodyStartPos,
        blockEndPos: s.length
      })
    }
  }

  // 2) 블록 끝 범위 설정
  for (let bi = 0; bi < blocks.length; bi++) {
    const cur = blocks[bi]
    const next = blocks[bi + 1]
    cur.blockEndPos = next ? next.blockStartPos : s.length
  }

  // 3) 달력 요약용 items 생성
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi]
    const body = s.slice(b.bodyStartPos, b.blockEndPos)
    const bodyLines = body.split("\n")

    let globalLineIndex = s.slice(0, b.bodyStartPos).split("\n").length - 1
    for (let li = 0; li < bodyLines.length; li++) {
      const line = bodyLines[li]
      const t = line.trim()
      if (!t) {
        globalLineIndex++
        continue
      }

      let time = ""
      let text = t
      const mm = t.match(timeOnlyRegex)
      if (mm) {
        const hh = String(Number(mm[1])).padStart(2, "0")
        time = `${hh}:${mm[2]}`
        text = mm[3]
      }

      if (!items[b.dateKey]) items[b.dateKey] = []
      items[b.dateKey].push({
        id: `b${bi}-l${li}`,
        time,
        text,
        lineIndex: globalLineIndex
      })
      globalLineIndex++
    }
  }

  return { blocks, items }
}

function isMemoHeaderLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return false
  return tabTitleRegex.test(trimmed) || mdOnlyRegex.test(trimmed) || ymdOnlyRegex.test(trimmed)
}

function buildMemoOverlayLines(text) {
  return (text ?? "").split("\n").map((line) => ({
    text: line,
    isHeader: isMemoHeaderLine(line)
  }))
}

function syncOverlayScroll(textarea, overlayInner) {
  if (!textarea || !overlayInner) return
  overlayInner.style.transform = `translateY(${-textarea.scrollTop}px)`
}

function normalizePrettyAndMerge(text, baseYear) {
  const s = text ?? ""
  const lines = s.split("\n")

  const preamble = []
  const rawBlocks = []

  let currentKey = null
  let currentBody = []
  let seenAnyDate = false

  function flush() {
    if (!currentKey) return
    rawBlocks.push({ key: currentKey, bodyLines: currentBody })
    currentKey = null
    currentBody = []
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()

    let key = null
    let m = trimmed.match(mdOnlyRegex)
    if (m) key = `${baseYear}-${String(Number(m[1])).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`
    else {
      m = trimmed.match(ymdOnlyRegex)
      if (m && Number(m[1]) === baseYear)
        key = `${baseYear}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`
    }

    if (key) {
      seenAnyDate = true
      flush()
      currentKey = key
      currentBody = []
      continue
    }

    if (!seenAnyDate) preamble.push(raw)
    else if (currentKey) currentBody.push(raw)
  }
  flush()

  if (rawBlocks.length === 0) return s.trimEnd()

  const merged = new Map()
  const order = []
  for (const b of rawBlocks) {
    if (!merged.has(b.key)) {
      merged.set(b.key, { key: b.key, chunks: [b.bodyLines], idx: order.length })
      order.push(b.key)
    } else {
      merged.get(b.key).chunks.push(b.bodyLines)
    }
  }

  const blocks = order.map((k) => {
    const v = merged.get(k)
    const out = []
    for (const chunk of v.chunks) {
      for (const line of chunk) {
        if (line.trim() === "") continue
        out.push(line)
      }
    }
    return { key: v.key, idx: v.idx, body: out }
  })

  blocks.sort((a, b) => {
    const ta = keyToTime(a.key)
    const tb = keyToTime(b.key)
    if (ta !== tb) return ta - tb
    return a.idx - b.idx
  })

  const outBlocks = blocks.map((b) => {
    const { m, d } = keyToYMD(b.key)
    const header = buildHeaderLine(baseYear, m, d)
    if (b.body.length === 0) return header
    return `${header}\n${b.body.join("\n")}`.trimEnd()
  })

  const pre = preamble.join("\n").trimEnd()
  const body = outBlocks.join("\n\n").trimEnd()
  return pre ? `${pre}\n\n${body}` : body
}

// ===== textarea 픽셀 스크롤용 미러 =====
function getDateKeyFromLine(line, baseYear) {
  const trimmed = line.trim()
  let m = trimmed.match(mdOnlyRegex)
  if (m) {
    return `${baseYear}-${String(Number(m[1])).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`
  }
  m = trimmed.match(ymdOnlyRegex)
  if (m && Number(m[1]) === baseYear) {
    return `${baseYear}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`
  }
  return null
}

function renderItemsToLines(items) {
  if (!items || items.length === 0) return []
  return items.map((it) => (it.time ? `${it.time} ${it.text}` : it.text))
}

function buildTextFromDateLines(dateLines, baseYear) {
  if (!dateLines || dateLines.size === 0) return ""
  const keys = Array.from(dateLines.keys()).sort((a, b) => keyToTime(a) - keyToTime(b))
  const blocks = []
  for (const key of keys) {
    const lines = dateLines.get(key) || []
    const { m, d } = keyToYMD(key)
    const header = buildHeaderLine(baseYear, m, d)
    if (lines.length === 0) {
      blocks.push(header)
    } else {
      blocks.push(`${header}\n${lines.join("\n")}`.trimEnd())
    }
  }
  return blocks.join("\n\n").trimEnd()
}

function buildCombinedText(baseYear, commonText, windows, filters, windowTexts) {
  const commonParsed = parseBlocksAndItems(commonText, baseYear)
  const commonItems = commonParsed.items

  const dateKeys = new Set(Object.keys(commonItems))
  const windowItemsById = new Map()

  for (const w of windows) {
    if (filters && filters[w.id] === false) continue
    const raw = windowTexts[w.id] ?? ""
    const parsed = parseBlocksAndItems(raw, baseYear)
    windowItemsById.set(w.id, parsed.items)
    Object.keys(parsed.items).forEach((k) => dateKeys.add(k))
  }

  const sortedKeys = Array.from(dateKeys).sort((a, b) => keyToTime(a) - keyToTime(b))
  const blocks = []

  for (const key of sortedKeys) {
    const { m, d } = keyToYMD(key)
    const header = buildHeaderLine(baseYear, m, d)
    const lines = []

    lines.push(...renderItemsToLines(commonItems[key]))

    for (const w of windows) {
      if (filters && filters[w.id] === false) continue
      const items = windowItemsById.get(w.id)?.[key] || []
      if (items.length === 0) continue
      lines.push(`[${w.title}]`)
      lines.push(...renderItemsToLines(items))
    }

    if (lines.length === 0) blocks.push(header)
    else blocks.push(`${header}\n${lines.join("\n")}`.trimEnd())
  }

  return blocks.join("\n\n").trimEnd()
}

function splitCombinedTextByWindow(text, baseYear, windows) {
  const titleToId = new Map(windows.map((w) => [w.title, w.id]))
  const allLinesByDate = new Map()
  const windowLinesById = new Map(windows.map((w) => [w.id, new Map()]))
  const seenWindowIds = new Set()

  let currentKey = null
  let currentSection = "all"

  const lines = (text ?? "").split("\n")
  for (const rawLine of lines) {
    const dateKey = getDateKeyFromLine(rawLine, baseYear)
    if (dateKey) {
      currentKey = dateKey
      currentSection = "all"
      continue
    }

    if (!currentKey) continue

    const trimmed = rawLine.trim()
    if (!trimmed) continue

    const labelMatch = trimmed.match(/^\[(.+)\]$/)
    if (labelMatch) {
      const title = labelMatch[1]
      const id = titleToId.get(title)
      if (id) {
        currentSection = id
        seenWindowIds.add(id)
        continue
      }
    }

    if (currentSection === "all") {
      const bucket = allLinesByDate.get(currentKey) ?? []
      bucket.push(rawLine)
      allLinesByDate.set(currentKey, bucket)
      continue
    }

    if (!windowLinesById.has(currentSection)) {
      windowLinesById.set(currentSection, new Map())
    }
    const byDate = windowLinesById.get(currentSection)
    const bucket = byDate.get(currentKey) ?? []
    bucket.push(rawLine)
    byDate.set(currentKey, bucket)
  }

  return { allLinesByDate, windowLinesById, seenWindowIds }
}

function buildCombinedRightText(commonText, windows, filters, windowTexts) {
  const lines = []
  if ((commonText ?? "").trim()) lines.push(commonText.trimEnd())

  let prevSectionHadBody = false

  for (const w of windows) {
    if (filters && filters[w.id] === false) continue
    const body = (windowTexts[w.id] ?? "").trimEnd()
    if (prevSectionHadBody) lines.push("")
    lines.push(`[${w.title}]`)
    if (body) {
      lines.push(body)
      prevSectionHadBody = true
    } else {
      prevSectionHadBody = false
    }
  }

  return lines.join("\n").trimEnd()
}

function splitCombinedRightText(text, windows) {
  const titleToId = new Map(windows.map((w) => [w.title, w.id]))
  const commonLines = []
  const windowLinesById = new Map(windows.map((w) => [w.id, []]))
  const seenWindowIds = new Set()
  let currentSection = "all"

  const lines = (text ?? "").split("\n")
  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    const labelMatch = trimmed.match(/^\[(.+)\]$/)
    if (labelMatch) {
      const title = labelMatch[1]
      const id = titleToId.get(title)
      if (id) {
        currentSection = id
        seenWindowIds.add(id)
        continue
      }
    }

    if (currentSection === "all") {
      commonLines.push(rawLine)
    } else {
      const bucket = windowLinesById.get(currentSection) ?? []
      bucket.push(rawLine)
      windowLinesById.set(currentSection, bucket)
    }
  }

  return { commonLines, windowLinesById, seenWindowIds }
}

function extractTabTitlesFromText(text) {
  const titles = new Set()
  const lines = (text ?? "").split("\n")
  for (const raw of lines) {
    const trimmed = raw.trim()
    const match = trimmed.match(/^\[(.+)\]$/)
    if (!match) continue
    const title = match[1].trim()
    if (title) titles.add(title)
  }
  return Array.from(titles)
}

function pruneEmptyLabelSections(bodyText) {
  const lines = (bodyText ?? "").replace(/\r\n/g, "\n").split("\n")
  const out = []
  let currentLabel = null
  let buffer = []

  function flush() {
    const hasContent = buffer.some((line) => line.trim() !== "")
    if (currentLabel) {
      if (hasContent) {
        out.push(currentLabel)
        out.push(...buffer)
      }
    } else if (hasContent) {
      out.push(...buffer)
    }
    buffer = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (tabTitleRegex.test(trimmed)) {
      flush()
      currentLabel = trimmed
      continue
    }
    buffer.push(line)
  }
  flush()
  return out.join("\n").trimEnd()
}

function getDateBlockBodyText(text, baseYear, dateKey) {
  const parsed = parseBlocksAndItems(text, baseYear)
  const block = parsed.blocks.find((b) => b.dateKey === dateKey)
  if (!block) return ""
  const body = text.slice(block.bodyStartPos, block.blockEndPos)
  return body.replace(/^\n+/, "").replace(/\n+$/, "")
}

function updateDateBlockBody(text, baseYear, dateKey, bodyText) {
  const normalized = (bodyText ?? "").replace(/\r\n/g, "\n").trimEnd()
  const parsed = parseBlocksAndItems(text, baseYear)
  const block = parsed.blocks.find((b) => b.dateKey === dateKey)
  if (!block) {
    const { y, m, d } = keyToYMD(dateKey)
    const headerLine = buildHeaderLine(y, m, d)
    const targetTime = keyToTime(dateKey)
    const sorted = [...parsed.blocks].sort(
      (a, b) => keyToTime(a.dateKey) - keyToTime(b.dateKey) || a.blockStartPos - b.blockStartPos
    )
    let insertPos = text.length
    for (const b of sorted) {
      if (keyToTime(b.dateKey) > targetTime) {
        insertPos = b.blockStartPos
        break
      }
    }
    const inserted = insertDateBlockAt(text, insertPos, headerLine)
    return updateDateBlockBody(inserted.newText, baseYear, dateKey, bodyText)
  }

  const after = text.slice(block.blockEndPos)
  let body = ""
  if (normalized) {
    body = normalized + (after.length > 0 ? "\n\n" : "")
  } else if (after.length > 0) {
    body = "\n"
  }
  return text.slice(0, block.bodyStartPos) + body + after
}

function getIntegratedLabels(windows, filters) {
  return windows.filter((w) => !filters || filters[w.id] !== false).map((w) => `[${w.title}]`)
}

function injectIntegratedLabels(text, baseYear, windows, filters) {
  return (text ?? "").trimEnd()
}

function isIntegratedBlockBodyEmpty(text, block, labels) {
  const body = text.slice(block.bodyStartPos, block.blockEndPos)
  const lines = body.split("\n")
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (labels.includes(t)) continue
    return false
  }
  return true
}

function syncMirrorStyleFromTextarea(ta, mirror) {
  const cs = window.getComputedStyle(ta)
  mirror.style.width = cs.width
  mirror.style.fontFamily = cs.fontFamily
  mirror.style.fontSize = cs.fontSize
  mirror.style.fontWeight = cs.fontWeight
  mirror.style.fontStyle = cs.fontStyle
  mirror.style.letterSpacing = cs.letterSpacing
  mirror.style.lineHeight = cs.lineHeight
  mirror.style.padding = cs.padding
  mirror.style.border = cs.border
  mirror.style.boxSizing = cs.boxSizing
  mirror.style.whiteSpace = cs.whiteSpace
  mirror.style.wordBreak = cs.wordBreak
  mirror.style.overflowWrap = cs.overflowWrap
  mirror.style.tabSize = cs.tabSize
}
function getLineHeightPx(ta) {
  const lh = window.getComputedStyle(ta).lineHeight
  const n = Number(String(lh).replace("px", ""))
  return Number.isFinite(n) && n > 0 ? n : 20
}
function measureCharTopPx(ta, mirror, marker, s, charPos) {
  const pos = Math.max(0, Math.min(charPos ?? 0, s.length))
  syncMirrorStyleFromTextarea(ta, mirror)

  const before = s.slice(0, pos)
  const after = s.slice(pos)

  mirror.innerHTML = ""
  mirror.appendChild(document.createTextNode(before))
  marker.textContent = "\u200b"
  mirror.appendChild(marker)
  mirror.appendChild(document.createTextNode(after))

  return marker.offsetTop
}
function scrollCharPosToTopOffset(ta, mirror, marker, s, charPos, topOffsetLines = 1) {
  const topPx = measureCharTopPx(ta, mirror, marker, s, charPos)
  const lh = getLineHeightPx(ta)
  const desiredVisibleY = topOffsetLines * lh

  const target = Math.max(0, topPx - desiredVisibleY)
  const maxTop = Math.max(0, ta.scrollHeight - ta.clientHeight)
  ta.scrollTop = Math.min(target, maxTop)
}

// ===== 블록 기반 삽입 =====
function insertDateBlockAt(text, insertPos, headerLine) {
  const before = text.slice(0, insertPos)
  const after = text.slice(insertPos)

  let prefix = ""
  if (before.length > 0) {
    if (before.endsWith("\n\n")) prefix = ""
    else if (before.endsWith("\n")) prefix = "\n"
    else prefix = "\n\n"
  }

  let insert = `${prefix}${headerLine}\n\n`
  if (after.length > 0) insert += "\n"

  const newText = before + insert + after
  const headerStartPos = (before + prefix).length
  const bodyStartPos = headerStartPos + headerLine.length + 1
  return { newText, headerStartPos, bodyStartPos }
}

// ===== caret -> 블록 찾기 =====
function findBlockIndexByCaret(blocks, caretPos) {
  if (!blocks || blocks.length === 0) return -1
  let lo = 0
  let hi = blocks.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const b = blocks[mid]
    if (caretPos < b.blockStartPos) hi = mid - 1
    else if (caretPos >= b.blockEndPos) lo = mid + 1
    else return mid
  }
  return Math.max(0, hi)
}

function afterTwoFrames(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

function ensureOneBlankLineAtBlockEnd(text, block) {
  const endPos = block.blockEndPos
  let i = endPos - 1
  let nl = 0
  while (i >= 0 && text[i] === "\n") {
    nl++
    i--
  }

  const need = Math.max(0, 2 - nl)
  if (need === 0) {
    const caretPos = Math.max(0, endPos - 1)
    return { newText: text, caretPos }
  }

  const insert = "\n".repeat(need)
  const newText = text.slice(0, endPos) + insert + text.slice(endPos)
  const newEndPos = endPos + insert.length
  const caretPos = Math.max(0, newEndPos - 1)
  return { newText, caretPos }
}

// ===== (추가) 빈 날짜 블록 삭제 유틸 =====
function isBlockBodyEmpty(text, block) {
  const body = text.slice(block.bodyStartPos, block.blockEndPos)
  return body.trim().length === 0
}

function removeBlockRange(text, block) {
  let start = block.blockStartPos
  const end = block.blockEndPos

  while (start > 0 && text[start - 1] === "\n" && text[start] === "\n") {
    start--
  }

  let out = text.slice(0, start) + text.slice(end)
  out = out.replace(/\n{3,}/g, "\n\n").trimEnd()

  const caretPos = Math.min(start, out.length)
  return { newText: out, caretPos }
}

function removeEmptyBlockByDateKey(text, baseYear, dateKey) {
  const parsed = parseBlocksAndItems(text, baseYear)
  const b = parsed.blocks.find((x) => x.dateKey === dateKey)
  if (!b) return { newText: text, changed: false, caretPos: null }
  if (!isBlockBodyEmpty(text, b)) return { newText: text, changed: false, caretPos: null }
  const { newText, caretPos } = removeBlockRange(text, b)
  return { newText, changed: true, caretPos }
}

function removeIntegratedEmptyBlocks(text, baseYear, labels) {
  const parsed = parseBlocksAndItems(text, baseYear)
  let out = text
  let changed = false
  for (let i = parsed.blocks.length - 1; i >= 0; i--) {
    const b = parsed.blocks[i]
    if (!isIntegratedBlockBodyEmpty(out, b, labels)) continue
    const r = removeBlockRange(out, b)
    out = r.newText
    changed = true
  }
  return { newText: out, changed }
}

function App() {
  const textareaRef = useRef(null)
  const rightTextareaRef = useRef(null)
  const mirrorRef = useRef(null)
  const markerRef = useRef(null)
  const leftOverlayInnerRef = useRef(null)
  const rightOverlayInnerRef = useRef(null)

  // ===== 창(캘린더) 탭 =====
  const WINDOWS_KEY = "planner-windows-v1"

  const DEFAULT_WINDOWS = [{ id: "all", title: "통합", color: "#2563eb", fixed: true }]

  function genWindowId() {
  try {
    if (crypto?.randomUUID) return `w-${crypto.randomUUID()}`
  } catch {}
  return `w-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  function loadWindows() {
  try {
    const raw = localStorage.getItem(WINDOWS_KEY)
    if (!raw) return DEFAULT_WINDOWS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_WINDOWS

    const normalized = parsed
      .filter((w) => w && typeof w.id === "string")
      .map((w) => ({
        id: w.id,
        title: typeof w.title === "string" && w.title.trim() ? w.title : "제목없음",
        color: typeof w.color === "string" ? w.color : "#2563eb",
        fixed: Boolean(w.fixed) || w.id === "all"
      }))

    const hasAll = normalized.some((w) => w.id === "all")
    if (!hasAll) normalized.unshift(DEFAULT_WINDOWS[0])
    return normalized
  } catch {
    return DEFAULT_WINDOWS
  }
  }

  function saveWindows(ws) {
  try {
    localStorage.setItem(WINDOWS_KEY, JSON.stringify(ws))
  } catch {}
  }

  const WINDOW_COLORS = ["#2563eb", "#22c55e", "#ef4444", "#a855f7", "#f59e0b", "#14b8a6"]

  function nextColor(cur) {
    const i = WINDOW_COLORS.indexOf(cur)
    return WINDOW_COLORS[(i + 1) % WINDOW_COLORS.length]
  }

  function pickNextWindowColor(ws) {
    const used = new Set(ws.map((w) => w.color))
    const available = WINDOW_COLORS.find((c) => !used.has(c))
    return available ?? WINDOW_COLORS[ws.length % WINDOW_COLORS.length]
  }


  const [text, setText] = useState("")
  const today = useMemo(() => new Date(), [])
  const todayKey = useMemo(() => {
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, "0")
    const d = String(today.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }, [today])

  // ===== 연도(메모 기준) =====
  const [baseYear, setBaseYear] = useState(today.getFullYear())
  const baseYearRef = useRef(baseYear)
  useEffect(() => {
    baseYearRef.current = baseYear
  }, [baseYear])

  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])

  const overrideLoadRef = useRef(null) // { year:number, text:string } | null

  // ===== 달력 뷰 =====
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 })
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  // 상시 수정 가능한 연/월 입력값 (즉시 반영)
  const [ymYear, setYmYear] = useState(view.year)
  const [ymMonth, setYmMonth] = useState(view.month)

  // ===== 레이아웃/폰트 =====
  const layoutRef = useRef(null)
  const calendarPanelRef = useRef(null)
  const calendarTopRef = useRef(null)
  const calendarBodyRef = useRef(null)

  const LAYOUT_KEY = "planner-layout"
  const PREF_KEY = "planner-preferences"

  const MIN_LEFT_PX = 320
  const MIN_RIGHT_PX = 360
  const DEFAULT_SPLIT = 0.58
  const DIVIDER_W = 10
  const OUTER_EDGE_PAD = 24

  const FONT_MIN = 12
  const FONT_MAX = 26

  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT)
  const [outerCollapsed, setOuterCollapsed] = useState("none") // "none" | "left" | "right"
  const lastSplitRatioRef = useRef(DEFAULT_SPLIT)
  const [memoFontPx, setMemoFontPx] = useState(16)
  const [memoFontInput, setMemoFontInput] = useState("16")
  const [tabFontPx, setTabFontPx] = useState(15)
  const [tabFontInput, setTabFontInput] = useState("15")

  // ✅ 설정 패널(톱니) 토글
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const settingsPanelRef = useRef(null)

  // 달력 셀 높이 자동 계산용
  const [calendarCellH, setCalendarCellH] = useState(110)

  // ===== 테마/레이아웃 프리셋 =====
  const [theme, setTheme] = useState("light") // "light" | "dark"
  const [layoutPreset, setLayoutPreset] = useState("memo-left") // "memo-left" | "calendar-left"
  const isSwapped = layoutPreset === "calendar-left"

  // ===== ✅ 메모 패널 내부(좌/우 메모) 스플릿 =====
  const MEMO_INNER_KEY = "planner-memo-inner-split"
  const MIN_MEMO_LEFT_PX = 240
  const MIN_MEMO_RIGHT_PX = 240
  const DEFAULT_MEMO_INNER_SPLIT = 0.62
  const MEMO_DIVIDER_W = 10
  const MEMO_INNER_GAP = 10

  const [memoInnerSplit, setMemoInnerSplit] = useState(DEFAULT_MEMO_INNER_SPLIT)
  const [memoInnerCollapsed, setMemoInnerCollapsed] = useState("none") // "none" | "left" | "right"
  const [rightMemoText, setRightMemoText] = useState("") // ✅ 오른쪽 메모(기능 없음)
  // ✅ 창 목록/활성 탭
  const [windows, setWindows] = useState(() => loadWindows())
  const [activeWindowId, setActiveWindowId] = useState("all")
  const [editingWindowId, setEditingWindowId] = useState(null)
  const titleInputRef = useRef(null)
  const [colorPickerId, setColorPickerId] = useState(null)
  const [colorPickerPos, setColorPickerPos] = useState(null) // 어떤 탭의 색상 팔레트를 열지
  const colorPickerPanelRef = useRef(null)
  const draggingWindowIdRef = useRef(null)
  const FILTER_KEY = "planner-integrated-filters-v1"
  const [integratedFilters, setIntegratedFilters] = useState({})
  const [filterOpen, setFilterOpen] = useState(false)
  const filterBtnRef = useRef(null)
  const filterPanelRef = useRef(null)
  const tabsScrollRef = useRef(null)

  useEffect(() => {
  if (!editingWindowId) return
  // 다음 프레임에 select (렌더 완료 후)
  requestAnimationFrame(() => {
    const el = titleInputRef.current
    if (el) el.select()
  })
}, [editingWindowId])


  useEffect(() => {
  if (!colorPickerId) return

  function onDocPointerDown(e) {
    const panel = colorPickerPanelRef.current
    if (!panel) return
    const t = e.target
    if (!(t instanceof Node)) return
    if (panel.contains(t)) return
    setColorPickerId(null)
    setColorPickerPos(null)
  }

  document.addEventListener("pointerdown", onDocPointerDown, true)
  return () => document.removeEventListener("pointerdown", onDocPointerDown, true)
}, [colorPickerId])
  
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILTER_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") setIntegratedFilters(parsed)
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(integratedFilters))
    } catch {}
  }, [integratedFilters])

  useEffect(() => {
    if (!filterOpen) return

    function onDocPointerDown(e) {
      const btn = filterBtnRef.current
      const panel = filterPanelRef.current
      const t = e.target
      if (!(t instanceof Node)) return
      if ((btn && btn.contains(t)) || (panel && panel.contains(t))) return
      setFilterOpen(false)
    }

    document.addEventListener("pointerdown", onDocPointerDown, true)
    return () => document.removeEventListener("pointerdown", onDocPointerDown, true)
  }, [filterOpen])

  function scrollTabs(dir) {
    const el = tabsScrollRef.current
    if (!el) return
    const amount = Math.max(80, Math.floor(el.clientWidth * 0.6))
    el.scrollBy({ left: dir * amount, behavior: "smooth" })
  }

  useEffect(() => {
    function onDocPointerDown(e) {
      const t = e.target
      if (!(t instanceof Node)) return
      const calendar = calendarPanelRef.current
      const memo = textareaRef.current
      const rightMemo = rightTextareaRef.current
      const inLeftMemo = memo && memo.contains(t)
      const inRightMemo = rightMemo && rightMemo.contains(t)
      const inMemo = inLeftMemo || inRightMemo

      if (!inLeftMemo && document.activeElement === memo) {
        onTextareaBlur()
      }

      if (calendar && calendar.contains(t)) return
      if (inRightMemo) {
        setSelectedDateKey(null)
        lastActiveDateKeyRef.current = null
        return
      }
      if (inLeftMemo) return

      setSelectedDateKey(null)
      lastActiveDateKeyRef.current = null
    }

    document.addEventListener("pointerdown", onDocPointerDown, true)
    return () => document.removeEventListener("pointerdown", onDocPointerDown, true)
  }, [])

  useEffect(() => {
    setIntegratedFilters((prev) => {
      const next = { ...prev }
      let changed = false
      for (const w of windows) {
        if (w.id === "all") continue
        if (next[w.id] == null) {
          next[w.id] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [windows])


  useEffect(() => {
  setSelectedDateKey(null)
  lastActiveDateKeyRef.current = null
  setFilterOpen(false)
  }, [activeWindowId])
 
  
  useEffect(() => {
    saveWindows(windows)
  }, [windows])

  useEffect(() => {
    const titles = extractTabTitlesFromText(text)
    if (titles.length === 0) return
    setWindows((prev) => {
      const existing = new Set(prev.map((w) => w.title))
      const toAdd = titles.filter((t) => !existing.has(t))
      if (toAdd.length === 0) return prev
      const next = [...prev]
      for (const title of toAdd) {
        next.push({
          id: genWindowId(),
          title,
          color: pickNextWindowColor(next)
        })
      }
      return next
    })
  }, [text])

  function addWindow() {
    const id = genWindowId()
    const newWin = {
      id,
      title: "제목없음",
      color: "#22c55e"
    }
    setWindows((prev) => [...prev, newWin])
    setActiveWindowId(id)
    requestAnimationFrame(() => {
      const el = tabsScrollRef.current
      if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" })
    })
  }

  function removeWindow(id) {
  setWindows((prev) => prev.filter((w) => w.id !== id))

  // 현재 보고 있는 탭을 지웠다면 통합으로 이동
  if (activeWindowId === id) {
    setActiveWindowId("all")
  }

  // (선택) 해당 창의 메모 데이터도 정리하고 싶으면 여기서 삭제
  // localStorage.removeItem(`planner-text-${baseYear}-${id}`)
  }

  function reorderWindows(dragId, overId) {
    if (!dragId || !overId || dragId === overId) return
    setWindows((prev) => {
      const fixed = prev.filter((w) => w.id === "all")
      const rest = prev.filter((w) => w.id !== "all")
      const fromIdx = rest.findIndex((w) => w.id === dragId)
      const toIdx = rest.findIndex((w) => w.id === overId)
      if (fromIdx < 0 || toIdx < 0) return prev
      const next = [...rest]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return [...fixed, ...next]
    })
  }


  const memoInnerWrapRef = useRef(null)
  const memoInnerDraggingRef = useRef(false)
  const memoInnerStartXRef = useRef(0)
  const memoInnerStartRatioRef = useRef(0)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MEMO_INNER_KEY)
      if (raw != null) {
        const n = Number(raw)
        if (Number.isFinite(n)) setMemoInnerSplit(clamp(n, 0.15, 0.85))
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(MEMO_INNER_KEY, String(memoInnerSplit))
    } catch {}
  }, [memoInnerSplit])

  function beginMemoInnerDrag(e) {
    memoInnerDraggingRef.current = true
    memoInnerStartXRef.current = e.clientX
    memoInnerStartRatioRef.current = memoInnerSplit
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  function onMemoInnerDragMove(e) {
    if (!memoInnerDraggingRef.current) return
    const wrap = memoInnerWrapRef.current
    if (!wrap) return

    const rect = wrap.getBoundingClientRect()
    const w = rect.width
    if (!w) return

    const dx = e.clientX - memoInnerStartXRef.current
    const nextLeftPx = memoInnerStartRatioRef.current * w + dx

    const minRatio = MIN_MEMO_LEFT_PX / w
    const maxRatio = 1 - MIN_MEMO_RIGHT_PX / w
    const next = clamp(nextLeftPx / w, minRatio, maxRatio)

    setMemoInnerSplit(next)
  }

  function endMemoInnerDrag() {
    memoInnerDraggingRef.current = false
  }

  function resetMemoInnerSplit() {
    setMemoInnerSplit(DEFAULT_MEMO_INNER_SPLIT)
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (typeof parsed.splitRatio === "number") setSplitRatio(clamp(parsed.splitRatio, 0.15, 0.85))
        if (typeof parsed.memoFontPx === "number") setMemoFontPx(clamp(parsed.memoFontPx, FONT_MIN, FONT_MAX))
        if (typeof parsed.tabFontPx === "number") setTabFontPx(clamp(parsed.tabFontPx, FONT_MIN, FONT_MAX))
      }
    } catch {}

    try {
      const raw2 = localStorage.getItem(PREF_KEY)
      if (raw2) {
        const p = JSON.parse(raw2)
        if (p && (p.theme === "light" || p.theme === "dark")) setTheme(p.theme)
        if (p && (p.layoutPreset === "memo-left" || p.layoutPreset === "calendar-left")) setLayoutPreset(p.layoutPreset)
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setMemoFontInput(String(memoFontPx))
  }, [memoFontPx])

  useEffect(() => {
    setTabFontInput(String(tabFontPx))
  }, [tabFontPx])

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ splitRatio, memoFontPx, tabFontPx }))
    } catch {}
  }, [splitRatio, memoFontPx, tabFontPx])

  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ theme, layoutPreset }))
    } catch {}
  }, [theme, layoutPreset])

  // 연도 동기화
  useEffect(() => {
    if (view.year !== baseYear) {
      setView((v) => ({ ...v, year: baseYear }))
      viewRef.current = { ...viewRef.current, year: baseYear }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseYear])

  useEffect(() => {
    if (baseYear !== view.year) setBaseYear(view.year)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.year])

  // view가 바뀌면 입력값도 동기화
  useEffect(() => {
    setYmYear(view.year)
    setYmMonth(view.month)
  }, [view.year, view.month])

  // ✅ 연/월 상시 수정: 입력 변경 즉시 view 반영(약간의 안전장치)
  useEffect(() => {
    const y = Number(ymYear)
    if (!Number.isFinite(y) || y < 1) return
    setView((v) => {
      if (v.year === y) return v
      const next = { ...v, year: y }
      viewRef.current = next
      return next
    })
  }, [ymYear])

  useEffect(() => {
    const m = Number(ymMonth)
    if (!Number.isFinite(m)) return
    const mm = clamp(m, 1, 12)
    setView((v) => {
      if (v.month === mm) return v
      const next = { ...v, month: mm }
      viewRef.current = next
      return next
    })
  }, [ymMonth])

  const viewYear = view.year
  const viewMonth = view.month

  // ===== 저장(연도별) =====
  const memoKey = useMemo(() => `planner-text-${baseYear}-${activeWindowId}`, [baseYear, activeWindowId])
  const MIGRATED_FLAG = "planner-text-migrated-v2"
  const LEGACY_KEY = "planner-text"
  const suppressSaveRef = useRef(false)

  // ✅ 오른쪽 메모(연도별)
  const rightMemoKey = useMemo(
    () => `planner-right-text-${baseYear}-${activeWindowId}`,
    [baseYear, activeWindowId]
  )
  const suppressRightSaveRef = useRef(false)
  const editableWindows = useMemo(() => windows.filter((w) => w.id !== "all"), [windows])

  function getWindowTextSync(year, windowId) {
    try {
      const key = `planner-text-${year}-${windowId}`
      return localStorage.getItem(key) ?? ""
    } catch {
      return ""
    }
  }

  function setWindowTextSync(year, windowId, value) {
    try {
      const key = `planner-text-${year}-${windowId}`
      localStorage.setItem(key, value)
    } catch {}
  }

  function buildCombinedTextForYear(year) {
    const windowTexts = {}
    for (const w of editableWindows) {
      windowTexts[w.id] = getWindowTextSync(year, w.id)
    }
    const commonText = getWindowTextSync(year, "all")
    return buildCombinedText(year, commonText, editableWindows, integratedFilters, windowTexts)
  }

  function getRightWindowTextSync(year, windowId) {
    try {
      const key = `planner-right-text-${year}-${windowId}`
      return localStorage.getItem(key) ?? ""
    } catch {
      return ""
    }
  }

  function setRightWindowTextSync(year, windowId, value) {
    try {
      const key = `planner-right-text-${year}-${windowId}`
      localStorage.setItem(key, value)
    } catch {}
  }

  function buildCombinedRightTextForYear(year) {
    const windowTexts = {}
    for (const w of editableWindows) {
      windowTexts[w.id] = getRightWindowTextSync(year, w.id)
    }
    const commonText = getRightWindowTextSync(year, "all")
    return buildCombinedRightText(commonText, editableWindows, integratedFilters, windowTexts)
  }

  function syncCombinedText(nextText, year = baseYear) {
    const { allLinesByDate, windowLinesById, seenWindowIds } = splitCombinedTextByWindow(
      nextText,
      year,
      editableWindows
    )

    const nextCommon = buildTextFromDateLines(allLinesByDate, year)
    const normalizedCommon = normalizePrettyAndMerge(nextCommon, year)
    setWindowTextSync(year, "all", normalizedCommon)

    for (const w of editableWindows) {
      if (!seenWindowIds.has(w.id)) continue
      const lines = windowLinesById.get(w.id) ?? new Map()
      const nextTextForWindow = buildTextFromDateLines(lines, year)
      const normalized = normalizePrettyAndMerge(nextTextForWindow, year)
      setWindowTextSync(year, w.id, normalized)
    }
  }

  function syncCombinedRightText(nextText, year = baseYear) {
    const { commonLines, windowLinesById, seenWindowIds } = splitCombinedRightText(nextText, editableWindows)
    setRightWindowTextSync(year, "all", commonLines.join("\n").trimEnd())
    for (const w of editableWindows) {
      if (!seenWindowIds.has(w.id)) continue
      const lines = windowLinesById.get(w.id) ?? []
      setRightWindowTextSync(year, w.id, lines.join("\n").trimEnd())
    }
  }

  function updateEditorText(nextText, syncAll = true) {
    setText(nextText)
    textRef.current = nextText
    if (activeWindowId === "all" && syncAll) syncCombinedText(nextText)
  }


  useEffect(() => {
    suppressSaveRef.current = true

    if (activeWindowId === "all") {
      const combined = buildCombinedTextForYear(baseYear)
      setText(combined)
      textRef.current = combined
      return
    }

    if (overrideLoadRef.current && overrideLoadRef.current.year === baseYear) {
      const forced = overrideLoadRef.current.text ?? ""
      overrideLoadRef.current = null
      setText(forced)
      return
    }

    const saved = localStorage.getItem(memoKey)
    if (saved != null) {
      setText(saved)
      return
    }

    const migrated = localStorage.getItem(MIGRATED_FLAG) === "1"
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (!migrated && legacy) {
      localStorage.setItem(memoKey, legacy)
      localStorage.setItem(MIGRATED_FLAG, "1")
      localStorage.removeItem(LEGACY_KEY)
      setText(legacy)
      return
    }

    setText("")
  }, [memoKey, baseYear, activeWindowId, editableWindows, integratedFilters])

  // ✅ 오른쪽 메모(연도별) 로드
useEffect(() => {
  suppressRightSaveRef.current = true
  try {
    if (activeWindowId === "all") {
      const combined = buildCombinedRightTextForYear(baseYear)
      setRightMemoText(combined)
      return
    }
    const saved = localStorage.getItem(rightMemoKey)
    setRightMemoText(saved ?? "")
  } catch {
    setRightMemoText("")
  }
}, [rightMemoKey, baseYear, activeWindowId, editableWindows, integratedFilters])


  useEffect(() => {
    if (suppressSaveRef.current) {
      suppressSaveRef.current = false
      return
    }
    if (activeWindowId === "all") return
    localStorage.setItem(memoKey, text)
  }, [memoKey, text, activeWindowId])

  // ✅ 오른쪽 메모(연도별) 저장
useEffect(() => {
  if (suppressRightSaveRef.current) {
    suppressRightSaveRef.current = false
    return
  }
  if (activeWindowId === "all") return
  try {
    localStorage.setItem(rightMemoKey, rightMemoText)
  } catch {}
}, [rightMemoKey, rightMemoText, activeWindowId])

  const leftOverlayLines = useMemo(() => buildMemoOverlayLines(text), [text])
  const rightOverlayLines = useMemo(() => buildMemoOverlayLines(rightMemoText), [rightMemoText])

  useEffect(() => {
    syncOverlayScroll(textareaRef.current, leftOverlayInnerRef.current)
  }, [text, memoFontPx, memoInnerSplit])

  useEffect(() => {
    syncOverlayScroll(rightTextareaRef.current, rightOverlayInnerRef.current)
  }, [rightMemoText, memoFontPx, memoInnerSplit])


  function getEditorTextSync(year) {
    if (activeWindowId === "all") return buildCombinedTextForYear(year)
    return getWindowTextSync(year, activeWindowId)
  }

  // ===== 파싱 =====
  const parsed = useMemo(() => parseBlocksAndItems(text, baseYear), [text, baseYear])
  const blocks = parsed.blocks
  const itemsByDate = useMemo(() => {
    if (activeWindowId !== "all") return parsed.items
    const colorByTitle = new Map(windows.map((w) => [w.title, w.color]))
    const out = {}
    for (const [key, items] of Object.entries(parsed.items)) {
      let currentTitle = null
      const next = []
      for (const it of items) {
        const labelMatch = it.text.match(/^\s*\[(.+)\]\s*$/)
        if (labelMatch) {
          currentTitle = labelMatch[1]
          continue
        }
        next.push({
          ...it,
          sourceTitle: currentTitle,
          color: currentTitle ? colorByTitle.get(currentTitle) ?? null : null
        })
      }
      if (next.length > 0) out[key] = next
    }
    return out
  }, [parsed, activeWindowId, windows])
  const activeWindowColor = useMemo(
    () => windows.find((w) => w.id === activeWindowId)?.color ?? null,
    [windows, activeWindowId]
  )

  // ===== 선택된 날짜 =====
  const [selectedDateKey, setSelectedDateKey] = useState(null)
  const lastActiveDateKeyRef = useRef(null)
  const calendarInteractingRef = useRef(false)
  const [dayListModal, setDayListModal] = useState(null)
  const [dayListEditText, setDayListEditText] = useState("")

  useEffect(() => {
    if (!dayListModal) {
      setDayListEditText("")
      return
    }
    const current = textRef.current ?? text
    const body = getDateBlockBodyText(current, baseYear, dayListModal.key)
    if (!body && activeWindowId === "all") {
      const labels = getIntegratedLabels(editableWindows, integratedFilters)
      const seeded = labels.join("\n")
      setDayListEditText(seeded)
      if (seeded) applyDayListEdit(seeded)
      return
    }
    setDayListEditText(body)
  }, [dayListModal ? dayListModal.key : null, baseYear])

  function setActiveDateKey(key) {
    if (!key) return
    lastActiveDateKeyRef.current = key
    setSelectedDateKey(key)

    const { y, m } = keyToYMD(key)
    if (viewRef.current.year !== y || viewRef.current.month !== m) {
      setView({ year: y, month: m })
      viewRef.current = { year: y, month: m }
    }
  }

  function applyDayListEdit(nextBody) {
    if (!dayListModal) return
    const current = textRef.current ?? text
    const nextText = updateDateBlockBody(current, baseYear, dayListModal.key, nextBody)
    if (nextText === current) return
    if (activeWindowId === "all") updateEditorText(nextText)
    else {
      setText(nextText)
      textRef.current = nextText
    }
  }

  function confirmDayListEdit() {
    if (!dayListModal) return
    const current = textRef.current ?? text
    const nextBody =
      activeWindowId === "all" ? pruneEmptyLabelSections(dayListEditText) : dayListEditText.trimEnd()
    const updated = updateDateBlockBody(current, baseYear, dayListModal.key, nextBody)

    let normalized = normalizePrettyAndMerge(updated, baseYear)
    if (activeWindowId === "all") {
      normalized = injectIntegratedLabels(normalized, baseYear, editableWindows, integratedFilters)
      const labels = getIntegratedLabels(editableWindows, integratedFilters)
      const r = removeIntegratedEmptyBlocks(normalized, baseYear, labels)
      if (r.changed) normalized = r.newText
    } else {
      const r = removeEmptyBlockByDateKey(normalized, baseYear, dayListModal.key)
      if (r.changed) normalized = r.newText
    }

    if (normalized !== current) {
      if (activeWindowId === "all") updateEditorText(normalized)
      else {
        setText(normalized)
        textRef.current = normalized
      }
    }
    setDayListEditText(getDateBlockBodyText(normalized, baseYear, dayListModal.key))
  }

  // ===== 점프 스케줄 =====
  const pendingJumpRef = useRef(null)

  useLayoutEffect(() => {
    const a = pendingJumpRef.current
    if (!a) return

    const ta = textareaRef.current
    const mirror = mirrorRef.current
    const marker = markerRef.current
    if (!ta || !mirror || !marker) {
      pendingJumpRef.current = null
      return
    }

    afterTwoFrames(() => {
      const ta2 = textareaRef.current
      const mirror2 = mirrorRef.current
      const marker2 = markerRef.current
      if (!ta2 || !mirror2 || !marker2) return

      ta2.focus()
      ta2.setSelectionRange(a.caretPos, a.caretPos)
      scrollCharPosToTopOffset(ta2, mirror2, marker2, ta2.value ?? "", a.headerPos, a.topOffsetLines ?? 1)

      requestAnimationFrame(() => {
        const ta3 = textareaRef.current
        const mirror3 = mirrorRef.current
        const marker3 = markerRef.current
        if (!ta3 || !mirror3 || !marker3) return
        scrollCharPosToTopOffset(ta3, mirror3, marker3, ta3.value ?? "", a.headerPos, a.topOffsetLines ?? 1)
      })

      pendingJumpRef.current = null
    })
  }, [text, baseYear])

  function scheduleJump(headerPos, caretPos, topOffsetLines = 1) {
    pendingJumpRef.current = { headerPos, caretPos, topOffsetLines }

    afterTwoFrames(() => {
      const a = pendingJumpRef.current
      if (!a) return
      const ta = textareaRef.current
      const mirror = mirrorRef.current
      const marker = markerRef.current
      if (!ta || !mirror || !marker) return

      ta.focus()
      ta.setSelectionRange(a.caretPos, a.caretPos)
      scrollCharPosToTopOffset(ta, mirror, marker, ta.value ?? "", a.headerPos, a.topOffsetLines ?? 1)

      requestAnimationFrame(() => {
        const ta2 = textareaRef.current
        const mirror2 = mirrorRef.current
        const marker2 = markerRef.current
        if (!ta2 || !mirror2 || !marker2) return
        scrollCharPosToTopOffset(ta2, mirror2, marker2, ta2.value ?? "", a.headerPos, a.topOffsetLines ?? 1)
      })

      pendingJumpRef.current = null
    })
  }

  // ===== 메모 커서 → 달력 =====
  function updateCalendarFromMemoCaret() {
    if (calendarInteractingRef.current) return
    const ta = textareaRef.current
    if (!ta) return
    const caret = ta.selectionStart ?? 0
    const idx = findBlockIndexByCaret(blocks, caret)
    if (idx < 0) return
    const key = blocks[idx]?.dateKey
    if (!key) return
    setActiveDateKey(key)
  }

  function onTextareaSelectOrKeyUp() {
    updateCalendarFromMemoCaret()
  }

  // ===== blur 정리 + 빈 블록이면 삭제 =====
  function onTextareaBlur() {
    const ta = textareaRef.current
    if (!ta) return
    const current = ta.value ?? ""

    let normalized = normalizePrettyAndMerge(current, baseYear)
    if (activeWindowId === "all") {
      normalized = injectIntegratedLabels(normalized, baseYear, editableWindows, integratedFilters)
    }

    if (activeWindowId === "all") {
      const labels = getIntegratedLabels(editableWindows, integratedFilters)
      const r = removeIntegratedEmptyBlocks(normalized, baseYear, labels)
      if (r.changed) normalized = r.newText
    } else {
      const key = lastActiveDateKeyRef.current
      if (key) {
        const r = removeEmptyBlockByDateKey(normalized, baseYear, key)
        if (r.changed) normalized = r.newText
      }
    }

    if (normalized !== current) {
      if (activeWindowId === "all") updateEditorText(normalized)
      else setText(normalized)
    }
    if (!calendarInteractingRef.current) {
      setSelectedDateKey(null)
      lastActiveDateKeyRef.current = null
    }
  }

  // ===== 달력 클릭 =====
  function handleDayClick(day) {
    const { year, month } = viewRef.current
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    setActiveDateKey(key)

    const currentText = textareaRef.current ? textareaRef.current.value : text
    const existing = blocks.find((b) => b.dateKey === key)

    if (existing) {
      const { newText, caretPos } = ensureOneBlankLineAtBlockEnd(currentText, existing)
      if (newText !== currentText) {
        pendingJumpRef.current = { headerPos: existing.headerStartPos, caretPos, topOffsetLines: 1 }
        if (activeWindowId === "all") updateEditorText(newText)
        else setText(newText)
      } else {
        scheduleJump(existing.headerStartPos, caretPos, 1)
      }
      return
    }

    const targetTime = keyToTime(key)
    const byDate = [...blocks].sort((a, b) => keyToTime(a.dateKey) - keyToTime(b.dateKey) || a.blockStartPos - b.blockStartPos)

    let insertPos = currentText.length
    for (const b of byDate) {
      if (keyToTime(b.dateKey) > targetTime) {
        insertPos = b.blockStartPos
        break
      }
    }

    const headerLine = buildHeaderLine(year, month, day)
    const { newText: insertedText, headerStartPos, bodyStartPos } = insertDateBlockAt(currentText, insertPos, headerLine)
    let newText = insertedText
    if (activeWindowId === "all") {
      const labels = getIntegratedLabels(editableWindows, integratedFilters)
      const labelsText = labels.length > 0 ? `\n${labels.join("\n")}\n` : ""
      if (labelsText) {
        newText = newText.slice(0, bodyStartPos) + labelsText + newText.slice(bodyStartPos)
      }
    }

    pendingJumpRef.current = { headerPos: headerStartPos, caretPos: bodyStartPos, topOffsetLines: 1 }
    if (activeWindowId === "all") updateEditorText(newText)
    else setText(newText)
  }

  // ===== Today 버튼 동작 =====
  function goToday() {
    const y = today.getFullYear()
    const m = today.getMonth() + 1
    const d = today.getDate()
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`

    setView({ year: y, month: m })
    viewRef.current = { year: y, month: m }
    lastActiveDateKeyRef.current = key
    setSelectedDateKey(key)

    const switchingYear = baseYearRef.current !== y

    const yearText = switchingYear
      ? getEditorTextSync(y)
      : (textareaRef.current ? textareaRef.current.value : textRef.current) ?? ""
    let workingText = yearText

    const parsedNow = parseBlocksAndItems(workingText, y)
    const blocksNow = parsedNow.blocks
    const existing = blocksNow.find((b) => b.dateKey === key)

    if (existing) {
      const { newText, caretPos } = ensureOneBlankLineAtBlockEnd(workingText, existing)
      pendingJumpRef.current = { headerPos: existing.headerStartPos, caretPos, topOffsetLines: 1 }
      if (newText !== workingText) workingText = newText
    } else {
      const targetTime = keyToTime(key)
      const byDate = [...blocksNow].sort(
        (a, b) => keyToTime(a.dateKey) - keyToTime(b.dateKey) || a.blockStartPos - b.blockStartPos
      )

      let insertPos = workingText.length
      for (const b of byDate) {
        if (keyToTime(b.dateKey) > targetTime) {
          insertPos = b.blockStartPos
          break
        }
      }

      const headerLine = buildHeaderLine(y, m, d)
      const { newText: insertedText, headerStartPos, bodyStartPos } = insertDateBlockAt(workingText, insertPos, headerLine)
      let newText = insertedText
      if (activeWindowId === "all") {
        const labels = getIntegratedLabels(editableWindows, integratedFilters)
        const labelsText = labels.length > 0 ? `\n${labels.join("\n")}\n` : ""
        if (labelsText) {
          newText = newText.slice(0, bodyStartPos) + labelsText + newText.slice(bodyStartPos)
        }
      }
      pendingJumpRef.current = { headerPos: headerStartPos, caretPos: bodyStartPos, topOffsetLines: 1 }
      workingText = newText
    }

    if (switchingYear) {
      if (activeWindowId === "all") {
        syncCombinedText(workingText, y)
      } else {
        setWindowTextSync(y, activeWindowId, workingText)
        overrideLoadRef.current = { year: y, text: workingText }
      }

      suppressSaveRef.current = true
      baseYearRef.current = y
      setBaseYear(y)
      setText(workingText)
      textRef.current = workingText
      return
    }

    const currentSameYearText = (textareaRef.current ? textareaRef.current.value : textRef.current) ?? ""
    if (workingText !== currentSameYearText) {
      if (activeWindowId === "all") updateEditorText(workingText)
      else setText(workingText)
      textRef.current = workingText
      return
    }

    const a = pendingJumpRef.current
    if (a) scheduleJump(a.headerPos, a.caretPos, a.topOffsetLines ?? 1)
  }

  // ===== 달력 월 이동 =====
  function goPrevMonth() {
    setView((v) => {
      const next = v.month === 1 ? { year: v.year - 1, month: 12 } : { year: v.year, month: v.month - 1 }
      viewRef.current = next
      return next
    })
  }
  function goNextMonth() {
    setView((v) => {
      const next = v.month === 12 ? { year: v.year + 1, month: 1 } : { year: v.year, month: v.month + 1 }
      viewRef.current = next
      return next
    })
  }
  function basePrevYear() {
    setBaseYear((y) => y - 1)
  }
  function baseNextYear() {
    setBaseYear((y) => y + 1)
  }

  const lastDay = daysInMonth(viewYear, viewMonth)
  const firstWeekday = dayOfWeek(viewYear, viewMonth, 1)
  const weeks = Math.ceil((firstWeekday + lastDay) / 7)

  // ===== 달력: 셀 높이 자동 =====
  useEffect(() => {
    const panel = calendarPanelRef.current
    const top = calendarTopRef.current
    if (!panel || !top) return

    const ro = new ResizeObserver(() => {
      const panelH = panel.clientHeight
      const topH = top.offsetHeight
      const paddingAndGaps = 6 * 2 + 22
      const usable = Math.max(0, panelH - topH - paddingAndGaps)
      const h = usable > 0 ? Math.floor(usable / weeks) : 110
      setCalendarCellH(clamp(h, 86, 140))
    })

    ro.observe(panel)
    ro.observe(top)

    return () => ro.disconnect()
  }, [weeks])

  // ===== 리사이즈(달력/메모 스플릿) =====
  const draggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartRatioRef = useRef(0)

  function beginDrag(e) {
    if (outerCollapsed !== "none") return
    draggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartRatioRef.current = splitRatio
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  function onDragMove(e) {
    if (outerCollapsed !== "none") return
    // ✅ 메모 내부 드래그 중이면, 바깥 스플릿은 반응하지 않게
    if (memoInnerDraggingRef.current) return
    if (!draggingRef.current) return
    const el = layoutRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const containerW = rect.width
    if (!containerW) return

    const dx = e.clientX - dragStartXRef.current
    const signedDx = isSwapped ? -dx : dx
    const nextMemoPx = dragStartRatioRef.current * containerW + signedDx

    const minRatio = MIN_LEFT_PX / containerW
    const maxRatio = 1 - MIN_RIGHT_PX / containerW

    const next = clamp(nextMemoPx / containerW, minRatio, maxRatio)
    setSplitRatio(next)
  }

  function endDrag() {
    draggingRef.current = false
  }

  function resetSplit() {
    setOuterCollapsed("none")
    setSplitRatio(DEFAULT_SPLIT)
    lastSplitRatioRef.current = DEFAULT_SPLIT
  }

  function collapseLeftPanel() {
    if (outerCollapsed === "left") return
    lastSplitRatioRef.current = splitRatio
    setOuterCollapsed("left")
  }

  function collapseRightPanel() {
    if (outerCollapsed === "right") return
    lastSplitRatioRef.current = splitRatio
    setOuterCollapsed("right")
  }

  function expandPanels() {
    if (outerCollapsed === "none") return
    setOuterCollapsed("none")
    setSplitRatio(lastSplitRatioRef.current)
  }

  // ===== Ctrl + Wheel 폰트 확대 =====
  function onMemoWheel(e) {
    if (!e.ctrlKey) return
    e.preventDefault()

    const delta = e.deltaY
    const step = 1
    setMemoFontPx((prev) => {
      const next = delta > 0 ? prev - step : prev + step
      return clamp(next, FONT_MIN, FONT_MAX)
    })
  }

  // ===== 테마 토큰 =====
  const themes = useMemo(() => {
    const light = {
      bg: "#f6f7fb",
      surface: "#ffffff",
      surface2: "#fbfbfd",
      text: "#0f172a",
      text2: "#475569",
      border: "#e2e8f0",
      border2: "#cbd5e1",
      accent: "#2563eb",
      accentSoft: "#dbeafe",
      shadow: "0 6px 20px rgba(15, 23, 42, 0.08)",
      radius: 12,
      todayRing: "#0ea5e9",
      todaySoft: "#e0f2fe",
      holiday: "#dc2626",
      saturday: "#2563eb"
    }
    const dark = {
      bg: "#0b1220",
      surface: "#0f172a",
      surface2: "#111c33",
      text: "#e5e7eb",
      text2: "#9ca3af",
      border: "#22304a",
      border2: "#2b3b5c",
      accent: "#60a5fa",
      accentSoft: "rgba(96,165,250,0.18)",
      shadow: "0 10px 28px rgba(0,0,0,0.45)",
      radius: 12,
      todayRing: "#38bdf8",
      todaySoft: "rgba(56,189,248,0.18)",
      holiday: "#f87171",
      saturday: "#60a5fa"
    }
    return { light, dark }
  }, [])

  const ui = theme === "dark" ? themes.dark : themes.light

  const iconButton = {
    width: 28,
    height: 26,
    borderRadius: 10,
    border: `1px solid ${ui.border}`,
    background: ui.surface,
    color: ui.text,
    cursor: "pointer",
    fontWeight: 800,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: theme === "dark" ? "none" : "0 1px 0 rgba(15, 23, 42, 0.04)"
  }

  const controlInput = {
    height: 34,
    padding: "0 10px",
    borderRadius: 10,
    border: `1px solid ${ui.border}`,
    background: ui.surface,
    color: ui.text,
    fontFamily: "inherit",
    fontWeight: 800,
    outline: "none"
  }

  const pillButton = {
    height: 34,
    padding: "0 12px",
    borderRadius: 10,
    border: `1px solid ${ui.border}`,
    background: ui.surface,
    color: ui.text,
    fontFamily: "inherit",
    cursor: "pointer",
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    whiteSpace: "nowrap"
  }

  const memoInputWrap = {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: 0,
    border: `1px solid ${ui.border}`,
    borderRadius: 12,
    background: ui.surface,
    overflow: "hidden",
    boxShadow: theme === "dark" ? "none" : "inset 0 1px 0 rgba(15, 23, 42, 0.03)"
  }

  const memoOverlay = {
    position: "absolute",
    inset: 0,
    padding: "12px 12px",
    paddingBottom: "80vh",
    boxSizing: "border-box",
    pointerEvents: "none",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: "break-word",
    fontSize: memoFontPx,
    lineHeight: 1.55,
    fontFamily: "inherit",
    fontWeight: 400,
    color: ui.text,
    zIndex: 0
  }

  function openDayList(key, items) {
    setDayListModal({ key, items })
  }

  function toggleLeftMemo() {
    setMemoInnerCollapsed((prev) => (prev === "left" ? "none" : "left"))
  }

  function toggleRightMemo() {
    setMemoInnerCollapsed((prev) => (prev === "right" ? "none" : "right"))
  }

  const memoTextareaStyle = {
    width: "100%",
    height: "100%",
    minHeight: 0,
    resize: "none",
    border: "none",
    borderRadius: 0,
    padding: "12px 12px",
    boxSizing: "border-box",
    background: "transparent",
    color: "transparent",
    caretColor: ui.text,
    outline: "none",
    fontSize: memoFontPx,
    lineHeight: 1.55,
    fontFamily: "inherit",
    fontWeight: 400,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: "break-word",
    paddingBottom: "80vh",
    position: "relative",
    zIndex: 1
  }

  const isLeftCollapsed = memoInnerCollapsed === "left"
  const isRightCollapsed = memoInnerCollapsed === "right"
  const leftMemoFlex = isLeftCollapsed ? "0 0 0px" : isRightCollapsed ? "1 1 0" : `0 0 ${memoInnerSplit * 100}%`
  const rightMemoFlex = isRightCollapsed ? "0 0 0px" : "1 1 0"

  function ThemeToggle() {
    const isDark = theme === "dark"
    const ring = ui.accent
    const baseBorder = ui.border2

    return (
      <button
        onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        title="테마 전환"
        aria-label="테마 전환"
        style={{
          height: 34,
          padding: "0 10px",
          borderRadius: 999,
          border: `1px solid ${ui.border}`,
          background: ui.surface,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 8
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            borderRadius: 999,
            background: "#ffffff",
            border: `2px solid ${isDark ? baseBorder : ring}`,
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.10)"
          }}
        />
        <span
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            borderRadius: 999,
            background: "#0b1220",
            border: `2px solid ${isDark ? ring : baseBorder}`,
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)"
          }}
        />
      </button>
    )
  }

  // ✅ "설정 창 밖 클릭" 처리: 패널/버튼 밖이면 닫기
  useEffect(() => {
    if (!settingsOpen) return

    function onDocPointerDown(e) {
      const btn = settingsBtnRef.current
      const panel = settingsPanelRef.current
      const t = e.target

      if (!(t instanceof Node)) return
      if ((btn && btn.contains(t)) || (panel && panel.contains(t))) return

      setSettingsOpen(false)
    }

    document.addEventListener("pointerdown", onDocPointerDown, true)
    return () => document.removeEventListener("pointerdown", onDocPointerDown, true)
  }, [settingsOpen])

  // ===== 메모 패널 (좌/우 메모로 분할 + 내부 드래그) =====
  const memoPanelFlex =
    outerCollapsed === "none"
      ? `0 0 ${splitRatio * 100}%`
      : layoutPreset === "memo-left"
        ? outerCollapsed === "right"
          ? "1 1 0"
          : `0 0 ${splitRatio * 100}%`
        : outerCollapsed === "left"
          ? "1 1 0"
          : `0 0 ${splitRatio * 100}%`

  const showMemoPanel = layoutPreset === "memo-left" ? outerCollapsed !== "left" : outerCollapsed !== "right"
  const showCalendarPanel = layoutPreset === "memo-left" ? outerCollapsed !== "right" : outerCollapsed !== "left"

  const memoPanel = (
    <div
      style={{
        flex: memoPanelFlex,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        borderRadius: ui.radius,
        background: ui.surface,
        border: `1px solid ${ui.border}`,
        boxShadow: ui.shadow,
        overflow: "hidden"
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: `1px solid ${ui.border}`,
          background: ui.surface2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          minWidth: 0,
          position: "relative"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <button onClick={basePrevYear} style={iconButton} title="이전 연도" aria-label="이전 연도">
            ◀
          </button>
          <div style={{ fontWeight: 900 }}>{baseYear}</div>
          <button onClick={baseNextYear} style={iconButton} title="다음 연도" aria-label="다음 연도">
            ▶
          </button>
          <button
            onClick={goToday}
            style={{ ...pillButton, padding: "0 10px 2px", borderRadius: 12, lineHeight: 1 }}
            title="오늘로 이동"
            aria-label="오늘로 이동"
          >
            Today
          </button>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 32,
              borderRadius: 10,
              border: `1px solid ${ui.border}`,
              background: ui.surface,
              overflow: "hidden"
            }}
          >
            <button
              onClick={toggleLeftMemo}
              style={{
                width: 30,
                height: 32,
                border: "none",
                background: "transparent",
                color: ui.text,
                cursor: "pointer",
                fontWeight: 800,
                lineHeight: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: isLeftCollapsed ? 0.4 : 1
              }}
              title={isLeftCollapsed ? "왼쪽 메모 펼치기" : "왼쪽 메모 접기"}
              aria-label={isLeftCollapsed ? "왼쪽 메모 펼치기" : "왼쪽 메모 접기"}
            >
              L
            </button>
            <div style={{ width: 1, height: 32, background: ui.border2 }} />
            <button
              onClick={toggleRightMemo}
              style={{
                width: 30,
                height: 32,
                border: "none",
                background: "transparent",
                color: ui.text,
                cursor: "pointer",
                fontWeight: 800,
                lineHeight: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: isRightCollapsed ? 0.4 : 1
              }}
              title={isRightCollapsed ? "오른쪽 메모 펼치기" : "오른쪽 메모 접기"}
              aria-label={isRightCollapsed ? "오른쪽 메모 펼치기" : "오른쪽 메모 접기"}
            >
              R
            </button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {activeWindowId === "all" && (
            <div style={{ position: "relative" }}>
              <button
                ref={filterBtnRef}
                onClick={() => setFilterOpen((v) => !v)}
                style={{
                  ...pillButton,
                  padding: 0,
                  fontSize: 22,
                  width: 36,
                  height: 32,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
                title="통합 필터"
                aria-label="통합 필터"
              >
                <span style={{ display: "inline-block", transform: "translateY(-1px)" }}>≡</span>
              </button>
              {filterOpen && (
                <div
                  ref={filterPanelRef}
                  style={{
                    position: "absolute",
                    top: 40,
                    right: 0,
                    width: 220,
                    borderRadius: 12,
                    border: `1px solid ${ui.border}`,
                    background: ui.surface,
                    boxShadow: ui.shadow,
                    padding: 12,
                    zIndex: 60
                  }}
                >
                  <div style={{ fontWeight: 950, marginBottom: 10 }}>통합 필터</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {editableWindows.map((w) => (
                      <label
                        key={w.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontWeight: 800,
                          color: ui.text
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={integratedFilters[w.id] !== false}
                          onChange={(e) => {
                            const next = e.target.checked
                            setIntegratedFilters((prev) => ({ ...prev, [w.id]: next }))
                          }}
                        />
                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {w.title}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            ref={settingsBtnRef}
            onClick={() => setSettingsOpen((v) => !v)}
            title="설정"
            aria-label="설정"
            style={{
              width: 38,
              height: 34,
              borderRadius: 10,
              border: `1px solid ${ui.border}`,
              background: ui.surface,
              color: ui.text,
              cursor: "pointer",
              fontWeight: 900,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            ⚙️
              </button>
          {layoutPreset === "memo-left" && (
            <button
              onClick={() => setLayoutPreset((p) => (p === "memo-left" ? "calendar-left" : "memo-left"))}
              style={{ ...pillButton, padding: "0 10px" }}
              title="메모/달력 위치 변경"
              aria-label="메모/달력 위치 변경"
            >
              ⇆
            </button>
          )}
        </div>

        {settingsOpen && (
        <div
          ref={settingsPanelRef}
          style={{
            position: "absolute",
            top: 48,
            right: 12,
            width: 260,
            borderRadius: 12,
            border: `1px solid ${ui.border}`,
            background: ui.surface,
            boxShadow: ui.shadow,
            padding: 12,
            zIndex: 50,
            fontFamily: '"2026", ui-sans-serif'
          }}
        >
            <div style={{ fontWeight: 600, marginBottom: 10 }}>설정</div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 600, color: ui.text2 }}>테마</div>
              <ThemeToggle />
            </div>

            <div style={{ height: 10 }} />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 600, color: ui.text2 }}>{"제목"}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number"
                  inputMode="numeric"
                  min={FONT_MIN}
                  max={FONT_MAX}
                  value={tabFontInput}
                  onChange={(e) => {
                    const raw = e.target.value
                    setTabFontInput(raw)
                    if (raw.trim() === "") return
                    const n = Number(raw)
                    if (!Number.isFinite(n)) return
                    setTabFontPx(n)
                  }}
                  onBlur={(e) => {
                    const n = Number(e.target.value)
                    if (!Number.isFinite(n)) {
                      setTabFontInput(String(tabFontPx))
                      return
                    }
                    const clamped = clamp(n, FONT_MIN, FONT_MAX)
                    setTabFontPx(clamped)
                    setTabFontInput(String(clamped))
                  }}
                  style={{ ...controlInput, width: 86, textAlign: "right" }}
                  title={"탭 글씨 크기(px)"}
                />
                <div style={{ fontSize: 12, color: ui.text2, fontWeight: 900 }}>px</div>
              </div>
            </div>

            <div style={{ height: 10 }} />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 600, color: ui.text2 }}>{"본문"}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number"
                  inputMode="numeric"
                  min={FONT_MIN}
                  max={FONT_MAX}
                  value={memoFontInput}
                  onChange={(e) => {
                    const raw = e.target.value
                    setMemoFontInput(raw)
                    if (raw.trim() === "") return
                    const n = Number(raw)
                    if (!Number.isFinite(n)) return
                    setMemoFontPx(n)
                  }}
                  onBlur={(e) => {
                    const n = Number(e.target.value)
                    if (!Number.isFinite(n)) {
                      setMemoFontInput(String(memoFontPx))
                      return
                    }
                    const clamped = clamp(n, FONT_MIN, FONT_MAX)
                    setMemoFontPx(clamped)
                    setMemoFontInput(String(clamped))
                  }}
                  style={{ ...controlInput, width: 86, textAlign: "right" }}
                  title={"본문 글씨 크기(px)"}
                />
                <div style={{ fontSize: 12, color: ui.text2, fontWeight: 900 }}>px</div>
              </div>
            </div>

            <div style={{ height: 12 }} />

            <button
              onClick={() => setSettingsOpen(false)}
              style={{
                width: "100%",
                height: 34,
                borderRadius: 10,
                border: `1px solid ${ui.border}`,
                background: ui.surface2,
                color: ui.text,
                cursor: "pointer",
                fontWeight: 900
              }}
            >
              닫기
            </button>
          </div>
        )}
      </div>
      {/* ✅ 창 탭 바 */}
      <div
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
          onClick={() => scrollTabs(-1)}
          style={{ ...iconButton, flexShrink: 0 }}
          title="왼쪽으로 이동"
          aria-label="왼쪽으로 이동"
        >
          ◀
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
            paddingBottom: 0
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
                  height: Math.max(30, tabFontPx + 14),
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
      {/* 색 점 (통합 탭은 숨김) */}
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

      {!isFixed && colorPickerId === w.id && colorPickerPos && (
  <div
    ref={colorPickerPanelRef}
    onClick={(e) => e.stopPropagation()}
    style={{
      position: "fixed",
      top: colorPickerPos.top,
      left: colorPickerPos.left,
      zIndex: 100,
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
          setWindows((prev) => prev.map((x) => (x.id === w.id ? { ...x, color: c } : x)))
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
          border: c === w.color ? `2px solid ${ui.accent}` : `1px solid ${ui.border}`,
          cursor: "pointer",
          padding: 0
        }}
      />
    ))}
  </div>
)}



      {/* 제목 */}
      {editingWindowId === w.id ? (
  <input
    ref={titleInputRef}
    autoFocus
    defaultValue={w.title}
    onClick={(e) => e.stopPropagation()}
    onBlur={(e) => {
      const v = e.target.value.trim() || "제목없음"
      setWindows((prev) => prev.map((x) => (x.id === w.id ? { ...x, title: v } : x)))
      setEditingWindowId(null)
    }}
    onKeyDown={(e) => {
      if (e.key === "Enter") e.currentTarget.blur()
      if (e.key === "Escape") setEditingWindowId(null)
    }}
    style={{
      width: 90,
      fontWeight: 900,
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
      fontWeight: 900,
      whiteSpace: "nowrap",
      cursor: isFixed ? "default" : "text",
      fontSize: tabFontPx,
      lineHeight: 1.1
    }}
  >
    {w.title}
  </span>
)}


      {/* ❌ 삭제 버튼 (통합 제외) */}
      {!isFixed && (
        <button
          className="tab-pill__delete"
          onClick={(e) => {
            e.stopPropagation() // 탭 클릭 방지
            removeWindow(w.id)
          }}
          aria-label="탭 삭제"
          title="탭 삭제"
          style={{
            border: "none",
            background: "transparent",
            color: ui.text2,
            cursor: "pointer",
            fontWeight: 900,
            fontSize: 14,
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
          onClick={() => scrollTabs(1)}
          style={{ ...iconButton, flexShrink: 0 }}
          title="오른쪽으로 이동"
          aria-label="오른쪽으로 이동"
        >
          ▶
        </button>
        <button onClick={addWindow} style={{ ...iconButton, flexShrink: 0 }} title="새 창 추가" aria-label="새 창 추가">
          +
        </button>
      </div>
      {/* ✅ 메모 2분할 + 내부 드래그 */}
      <div style={{ minHeight: 0, padding: "6px 8px", marginTop: 0 }}>
        <div
          ref={memoInnerWrapRef}
          style={{
            position: "relative",
            display: "flex",
            gap: memoInnerCollapsed === "none" ? MEMO_INNER_GAP : 0,
            height: "100%",
            minHeight: 0
          }}
          onPointerMove={onMemoInnerDragMove}
          onPointerUp={endMemoInnerDrag}
          onPointerCancel={endMemoInnerDrag}
        >
          {/* 왼쪽 메모 (기존 기능 유지) */}
          <div
            style={{
              flex: leftMemoFlex,
              minWidth: 0,
              minHeight: 0,
              display: isLeftCollapsed ? "none" : "block"
            }}
          >
            <div style={memoInputWrap}>
              <div style={memoOverlay} aria-hidden="true">
                <div ref={leftOverlayInnerRef} style={{ transform: "translateY(0px)", willChange: "transform" }}>
                  {leftOverlayLines.map((line, i) => (
                    <div
                      key={`memo-left-line-${i}`}
                      className={line.isHeader ? "memo-overlay__line memo-overlay__line--header" : "memo-overlay__line"}
                    >
                      {line.text === "" ? " " : line.text}
                    </div>
                  ))}
                </div>
              </div>
              <textarea
                ref={textareaRef}
                className="memo-input"
                value={text}
                onChange={(e) => {
                  const next = e.target.value
                  if (activeWindowId === "all") updateEditorText(next)
                  else setText(next)
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || activeWindowId !== "all") return
                  const ta = textareaRef.current
                  if (!ta) return
                  const value = ta.value ?? ""
                  const start = ta.selectionStart ?? 0
                  const end = ta.selectionEnd ?? start
                  if (start !== end) return

                  const lineStart = value.lastIndexOf("\n", start - 1) + 1
                  const lineEnd = (() => {
                    const idx = value.indexOf("\n", start)
                    return idx === -1 ? value.length : idx
                  })()

                  if (start !== lineEnd) return

                  const line = value.slice(lineStart, lineEnd).trim()
                  const dateKey = getDateKeyFromLine(line, baseYear)
                  if (!dateKey) return
                  const { m, d } = keyToYMD(dateKey)
                  const headerLine = buildHeaderLine(baseYear, m, d)

                const labels = getIntegratedLabels(editableWindows, integratedFilters)
                if (labels.length === 0) return
                const parsedNow = parseBlocksAndItems(value, baseYear)
                const blockNow = parsedNow.blocks.find((b) => b.dateKey === dateKey)
                if (blockNow && !isBlockBodyEmpty(value, blockNow)) return

                e.preventDefault()
                  const before = value.slice(0, lineStart)
                  const after = value.slice(lineEnd)
                  const insert = `\n\n${labels.join("\n")}\n`
                  const newText = `${before}${headerLine}${insert}${after}`
                  const caretPos = lineStart + headerLine.length + 1
                  updateEditorText(newText)
                  requestAnimationFrame(() => {
                    const ta2 = textareaRef.current
                    if (ta2) ta2.setSelectionRange(caretPos, caretPos)
                  })
                }}
                onBlur={onTextareaBlur}
                onClick={onTextareaSelectOrKeyUp}
                onKeyUp={onTextareaSelectOrKeyUp}
                onSelect={onTextareaSelectOrKeyUp}
                onWheel={onMemoWheel}
                onScroll={(e) => syncOverlayScroll(e.currentTarget, leftOverlayInnerRef.current)}
                style={memoTextareaStyle}
                placeholder={`왼쪽 메모장(기존 기능)

1) 달력에서 날짜를 클릭하면, 메모에 날짜가 자동으로 생깁니다.
2) 그 아래 줄에 할 일을 적으면 됩니다.

예)
1/5
09:00 회의
장보기
운동
`}
              />
            </div>
          </div>

          <div
            style={{
              flex: rightMemoFlex,
              minWidth: 0,
              minHeight: 0,
              display: isRightCollapsed ? "none" : "block"
            }}
          >
            <div style={memoInputWrap}>
              <div style={memoOverlay} aria-hidden="true">
                <div ref={rightOverlayInnerRef} style={{ transform: "translateY(0px)", willChange: "transform" }}>
                  {rightOverlayLines.map((line, i) => (
                    <div
                      key={`memo-right-line-${i}`}
                      className={line.isHeader ? "memo-overlay__line memo-overlay__line--header" : "memo-overlay__line"}
                    >
                      {line.text === "" ? " " : line.text}
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
                  if (activeWindowId === "all") {
                    setRightMemoText(next)
                    syncCombinedRightText(next)
                  } else {
                    setRightMemoText(next)
                  }
                }}
                onFocus={() => {
                  setSelectedDateKey(null)
                  lastActiveDateKeyRef.current = null
                }}
                onScroll={(e) => syncOverlayScroll(e.currentTarget, rightOverlayInnerRef.current)}
                style={memoTextareaStyle}
                placeholder={`오른쪽 메모장 (아무 기능 없음)

- 일단은 자유 메모로만 사용`}
              />
            </div>
          </div>

          {/* ?? divider */}
          <div
            onPointerDown={beginMemoInnerDrag}
            onDoubleClick={resetMemoInnerSplit}
            role="separator"
            aria-orientation="vertical"
            title="드래그로 비율 조절 / 더블클릭 리셋"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `calc(${memoInnerSplit * 100}% + ${MEMO_INNER_GAP / 2}px)`,
              transform: "translateX(-50%)",
              width: MEMO_DIVIDER_W,
              borderRadius: 999,
              background: memoInnerDraggingRef.current ? ui.accentSoft : "transparent",
              cursor: "col-resize",
              userSelect: "none",
              touchAction: "none",
              zIndex: 10,
              display: memoInnerCollapsed === "none" ? "block" : "none"
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 10,
                bottom: 10,
                width: 2,
                transform: "translateX(-50%)",
                borderRadius: 999,
                background: ui.border2
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )

  // ===== 달력 패널 =====
  const calendarPanel = (
    <div
      ref={calendarPanelRef}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        minHeight: 0,
        borderRadius: 8,
        background: ui.surface,
        fontFamily: "inherit",
        border: `1px solid ${ui.border}`,
        boxShadow: ui.shadow,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <div
        ref={calendarTopRef}
        style={{
          padding: "8px 12px",
          borderBottom: `1px solid ${ui.border}`,
          background: ui.surface2
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            minWidth: 0
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <input
              type="number"
              value={ymYear}
              onChange={(e) => setYmYear(e.target.value)}
              style={{ ...controlInput, width: 84 }}
              aria-label="연도 입력"
            />
            <select
              value={ymMonth}
              onChange={(e) => setYmMonth(Number(e.target.value))}
              style={{ ...controlInput, width: 84 }}
              aria-label="월 선택"
            >
              {Array.from({ length: 12 }).map((_, i) => {
                const m = i + 1
                return (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                )
              })}
            </select>

            <button onClick={goPrevMonth} style={iconButton} title="이전 달" aria-label="이전 달">
              ◀
            </button>
            <button onClick={goNextMonth} style={iconButton} title="다음 달" aria-label="다음 달">
              ▶
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {layoutPreset === "calendar-left" && (
              <button
                onClick={() => setLayoutPreset((p) => (p === "memo-left" ? "calendar-left" : "memo-left"))}
                style={{ ...pillButton, padding: "0 10px" }}
                title="메모/달력 위치 변경"
                aria-label="메모/달력 위치 변경"
              >
                ⇆
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        ref={calendarBodyRef}
        style={{
          padding: 6,
          overflow: "auto",
          minHeight: 0
        }}
      >
        <div
          style={{
            border: `1px solid ${ui.border2}`,
            borderRadius: 8,
            overflow: "hidden",
            background: ui.surface
          }}
        >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 0,
                fontWeight: 800,
                color: ui.text2,
                fontSize: 11,
                textAlign: "center",
                userSelect: "none",
                background: ui.surface2
              }}
            >
              {[
                { label: "Sun", color: ui.holiday },
                { label: "Mon", color: ui.text2 },
                { label: "Tue", color: ui.text2 },
                { label: "Wed", color: ui.text2 },
                { label: "Thu", color: ui.text2 },
                { label: "Fri", color: ui.text2 },
                { label: "Sat", color: ui.saturday }
              ].map((w, i) => (
                <div
                  key={`weekday-${i}`}
                  style={{
                    padding: "4px 0 6px",
                    lineHeight: 1,
                    borderRight: i % 7 === 6 ? "none" : `1px solid ${ui.border2}`,
                    borderBottom: "none",
                    color: w.color
                  }}
                >
                  {w.label}
                </div>
              ))}
            </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 0,
              gridAutoRows: `${calendarCellH}px`
            }}
          >
            {Array.from({ length: firstWeekday }).map((_, i) => {
              const col = i % 7
              const row = Math.floor(i / 7)
              const isLastCol = col === 6
              const isLastRow = row === weeks - 1
              return (
                <div
                  key={`empty-${i}`}
                  style={{
                    borderRight: isLastCol ? "none" : `1px solid ${ui.border2}`,
                    borderBottom: isLastRow ? "none" : `1px solid ${ui.border2}`,
                    background: ui.surface
                  }}
                />
              )
            })}

            {Array.from({ length: lastDay }).map((_, i) => {
              const day = i + 1
              const key = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`
              const cellIndex = firstWeekday + i
              const col = cellIndex % 7
              const row = Math.floor(cellIndex / 7)
              const isLastCol = col === 6
              const isLastRow = row === weeks - 1

              const items = itemsByDate[key] || []
              const itemLineH = 14
              const headerH = 28
              const maxItems = Math.max(1, Math.floor((calendarCellH - headerH) / itemLineH))
              const visibleCount = Math.min(items.length, maxItems)
              const recent = visibleCount > 0 ? items.slice(0, visibleCount) : []
              const hiddenCount = items.length - visibleCount

              const isSelected = selectedDateKey === key
              const isToday = key === todayKey

              const dow = dayOfWeek(viewYear, viewMonth, day)
              const holidayName = getHolidayName(viewYear, viewMonth, day)
              const isHoliday = Boolean(holidayName)
              const isSunday = dow === 0
              const isSaturday = dow === 6

              const borderColor = isSelected ? ui.accent : isToday ? ui.todayRing : ui.border2
              const bgColor = isSelected ? ui.accentSoft : isToday ? ui.todaySoft : ui.surface

              const dayColor = isHoliday || isSunday ? ui.holiday : isSaturday ? ui.saturday : ui.text

              return (
                <div
                  key={key}
                  className="calendar-day-cell"
                  onPointerDown={() => {
                    calendarInteractingRef.current = true
                  }}
                  onPointerUp={() => {
                    setTimeout(() => {
                      calendarInteractingRef.current = false
                    }, 0)
                  }}
                  onPointerCancel={() => {
                    calendarInteractingRef.current = false
                  }}
                  onClick={() => handleDayClick(day)}
                  style={{
                    borderRight: isLastCol ? "none" : `1px solid ${ui.border2}`,
                    borderBottom: isLastRow ? "none" : `1px solid ${ui.border2}`,
                    borderRadius: 0,
                    padding: "2px 4px",
                    boxSizing: "border-box",
                    overflow: "hidden",
                    cursor: "pointer",
                    userSelect: "none",
                    background: bgColor,
                    boxShadow: isSelected
                      ? theme === "dark"
                        ? "0 0 0 1px rgba(96,165,250,0.22)"
                        : "0 2px 10px rgba(37, 99, 235, 0.12)"
                      : "none",
                    transition: "transform 80ms ease, box-shadow 120ms ease, background 120ms ease",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 0
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-1px)"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0px)"
                  }}
                >
                  {isSelected && (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 2,
                      background: ui.accent
                    }}
                  />
                  )}

                  {isToday && !isSelected && (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 2,
                        background: ui.todayRing,
                        opacity: 0.9
                      }}
                    />
                  )}

                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 8
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 900,
                          fontSize: 11,
                          color: dayColor,
                          lineHeight: 1,
                          marginTop: 0
                        }}
                      >
                        {day}
                      </div>
                      {holidayName ? (
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 900,
                            color: ui.holiday,
                            lineHeight: 1,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: 60
                          }}
                          title={holidayName}
                        >
                          {holidayName}
                        </div>
                      ) : null}
                    </div>

                    {items.length > 0 ? (
                      hiddenCount > 0 ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openDayList(key, items)
                          }}
                          style={{
                            fontSize: 10,
                            fontWeight: 900,
                            padding: "1px 6px",
                            borderRadius: 999,
                            border: `1px solid ${ui.border}`,
                            background: ui.surface,
                            color: ui.text2,
                            flexShrink: 0,
                            cursor: "pointer"
                          }}
                          title="전체 일정 보기"
                        >
                          +{hiddenCount}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openDayList(key, items)
                          }}
                          style={{
                            fontSize: 10,
                            fontWeight: 900,
                            padding: "1px 6px",
                            borderRadius: 999,
                            border: `1px solid ${ui.border}`,
                            background: ui.surface,
                            color: ui.text2,
                            flexShrink: 0,
                            cursor: "pointer"
                          }}
                          title="메모 항목 보기"
                        >
                          {items.length}개
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openDayList(key, items)
                        }}
                        style={{
                          fontSize: 10,
                          fontWeight: 900,
                          padding: "1px 6px",
                          borderRadius: 999,
                          border: `1px solid ${ui.border}`,
                          background: ui.surface,
                          color: ui.text2,
                          flexShrink: 0,
                          cursor: "pointer"
                        }}
                        title="메모 추가"
                      >
                        +
                      </button>
                    )}
                  </div>

                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 10,
                      lineHeight: 1.2,
                      color: ui.text,
                      minWidth: 0
                    }}
                  >
                    {recent.map((it) => (
                      <div
                        key={it.id}
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          display: "flex",
                          gap: 4,
                          minWidth: 0
                        }}
                      >
                        {(it.color || (activeWindowId !== "all" && activeWindowColor)) && (
                          <span
                            title={it.sourceTitle ? `[${it.sourceTitle}]` : "항목"}
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 999,
                              background: it.color || activeWindowColor,
                              flexShrink: 0,
                              marginTop: 4
                            }}
                          />
                        )}
                        {it.time ? (
                          <span style={{ color: ui.text2, fontWeight: 900, flexShrink: 0, fontSize: 9 }}>
                            {it.time}
                          </span>
                        ) : null}
                        <span style={{ fontWeight: 650, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {it.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )

  const dividerLeft =
    outerCollapsed === "left"
      ? `${OUTER_EDGE_PAD / 2}px`
      : outerCollapsed === "right"
        ? `calc(100% - ${OUTER_EDGE_PAD / 2}px)`
        : isSwapped
          ? `calc(${(1 - splitRatio) * 100}% - 6px)`
          : `calc(${splitRatio * 100}% + 6px)`
  const dayListTitle = dayListModal
    ? (() => {
        const { y, m, d } = keyToYMD(dayListModal.key)
        return buildHeaderLine(y, m, d)
      })()
    : ""
  return (
    <div
      style={{
        height: "100vh",
        background: ui.bg,
        color: ui.text,
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji",
        boxSizing: "border-box",
        padding: "6px 6px 0"
      }}
      onPointerMove={onDragMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        ref={mirrorRef}
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
        <span ref={markerRef} />
      </div>

      <div
        ref={layoutRef}
        style={{
          position: "relative",
          display: "flex",
          height: "100%",
          width: "100%",
          minHeight: 0,
          gap: 12,
          paddingLeft: outerCollapsed === "left" ? OUTER_EDGE_PAD : 0,
          paddingRight: outerCollapsed === "right" ? OUTER_EDGE_PAD : 0
        }}
      >
        {layoutPreset === "memo-left" ? (
          <>
            {showMemoPanel ? memoPanel : null}
            {showCalendarPanel ? calendarPanel : null}
          </>
        ) : (
          <>
            {showCalendarPanel ? calendarPanel : null}
            {showMemoPanel ? memoPanel : null}
          </>
        )}

        {/* 바깥 divider (메모/달력) */}
        <div
          onPointerDown={beginDrag}
          onDoubleClick={resetSplit}
          role="separator"
          aria-orientation="vertical"
          title="드래그로 비율 조절 / 더블클릭 리셋"
          className="outer-divider"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: dividerLeft,
            transform: "translateX(-50%)",
            width: DIVIDER_W,
            borderRadius: 999,
            background: draggingRef.current ? ui.accentSoft : "transparent",
            cursor: "col-resize",
            userSelect: "none",
            touchAction: "none",
            zIndex: 10
          }}
        >
          <div className="outer-divider__buttons">
            {outerCollapsed === "none" && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  if (outerCollapsed === "left") return
                  if (outerCollapsed === "none") collapseLeftPanel()
                  else expandPanels()
                }}
                aria-label={outerCollapsed === "none" ? "왼쪽 패널 접기" : "패널 펼치기"}
                title={outerCollapsed === "none" ? "왼쪽 패널 접기" : "패널 펼치기"}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  border: `1px solid ${ui.border}`,
                  background: ui.surface,
                  color: ui.text,
                  fontWeight: 900,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                &lt;
              </button>
            )}
            {outerCollapsed === "none" && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  if (outerCollapsed === "right") return
                  if (outerCollapsed === "none") collapseRightPanel()
                  else expandPanels()
                }}
                aria-label={outerCollapsed === "none" ? "오른쪽 패널 접기" : "패널 펼치기"}
                title={outerCollapsed === "none" ? "오른쪽 패널 접기" : "패널 펼치기"}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  border: `1px solid ${ui.border}`,
                  background: ui.surface,
                  color: ui.text,
                  fontWeight: 900,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                &gt;
              </button>
            )}
            {outerCollapsed === "right" && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={expandPanels}
                aria-label="패널 펼치기"
                title="패널 펼치기"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  border: `1px solid ${ui.border}`,
                  background: ui.surface,
                  color: ui.text,
                  fontWeight: 900,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                &lt;
              </button>
            )}
            {outerCollapsed === "left" && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={expandPanels}
                aria-label="패널 펼치기"
                title="패널 펼치기"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  border: `1px solid ${ui.border}`,
                  background: ui.surface,
                  color: ui.text,
                  fontWeight: 900,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                &gt;
              </button>
            )}
          </div>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 10,
              bottom: 10,
              width: 2,
              transform: "translateX(-50%)",
              borderRadius: 999,
              background: ui.border2,
              zIndex: 1
            }}
          />
        </div>
      </div>

      {dayListModal && (
        <div
          onClick={() => setDayListModal(null)}
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
                  onClick={confirmDayListEdit}
                  style={{
                    height: 28,
                    padding: "0 10px",
                    borderRadius: 8,
                    border: `1px solid ${ui.border}`,
                    background: ui.surface,
                    color: ui.text,
                    cursor: "pointer",
                    fontWeight: 800
                  }}
                >
                  확인
                </button>
                <button
                  type="button"
                  onClick={() => setDayListModal(null)}
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
                  닫기
                </button>
              </div>
            </div>
            <textarea
              value={dayListEditText}
              onChange={(e) => {
                const next = e.target.value
                setDayListEditText(next)
                applyDayListEdit(next)
              }}
              placeholder="할 일을 입력하세요"
              style={{
                marginTop: 10,
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
          </div>
        </div>
      )}

      <style>{`
        * { box-sizing: border-box; }
        textarea:focus, input:focus, select:focus {
          border-color: ${ui.accent};
          box-shadow: 0 0 0 3px ${theme === "dark" ? "rgba(96,165,250,0.18)" : "rgba(37, 99, 235, 0.15)"};
        }
        .memo-input {
          color: transparent;
          caret-color: ${ui.text};
        }
        .memo-input::placeholder {
          color: ${ui.text2};
        }
        .memo-overlay__line {
          white-space: pre-wrap;
          font-weight: 400;
        }
        .memo-overlay__line--header {
          font-weight: 400;
          text-shadow: 0 0 0 currentColor, 0.6px 0 0 currentColor, -0.6px 0 0 currentColor;
        }
        .tab-pill__delete {
          opacity: 0;
          pointer-events: none;
          transition: opacity 120ms ease;
        }
        .tab-pill:hover .tab-pill__delete,
        .tab-pill:focus-within .tab-pill__delete,
        .tab-pill.is-active .tab-pill__delete {
          opacity: 1;
          pointer-events: auto;
        }
        .calendar-day-cell:hover {
          outline: 1px solid #000;
          outline-offset: -1px;
        }
        .outer-divider__buttons {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          display: inline-flex;
          gap: 6px;
          opacity: 0;
          pointer-events: none;
          transition: opacity 120ms ease;
          z-index: 2;
        }
        .outer-divider:hover .outer-divider__buttons {
          opacity: 1;
          pointer-events: auto;
        }
        * { scrollbar-width: none; -ms-overflow-style: none; }
        ::-webkit-scrollbar { width: 0px; height: 0px; }
        button:active { transform: translateY(1px); }
      `}</style>
    </div>
  )
}

export default App

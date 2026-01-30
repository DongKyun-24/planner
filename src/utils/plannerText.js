import { buildHeaderLine } from "./holiday"
import { buildLineStartPositions, keyToTime, keyToYMD } from "./dateUtils"

export const groupLineRegex = /^\s*@(.+)\(([^)]*)\)\s*$/
export const groupLineStartRegex = /^\s*@(.+)\s*\(\s*$/
export const groupLineTitleOnlyRegex = /^\s*@(.+)\s*$/
export const groupLineCloseRegex = /^\s*\)\s*$/

export const timeTokenRegex = /^(\d{1,2}):(\d{2})$/
export const timeRangeRegex = /^(\d{1,2}):(\d{2})\s*([~-])\s*(\d{1,2}):(\d{2})$/
export const timePrefixRegex = /^(\d{1,2}):(\d{2})(?:\s*([~-])\s*(\d{1,2}):(\d{2}))?(?:\s*;\s*|\s+)(.+)$/

export const mdOnlyRegex = /^\s*(\d{1,2})\/(\d{1,2})(?:\s+.*)?\s*$/
export const ymdOnlyRegex = /^\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+.*)?\s*$/
export const timeOnlyRegex = /^\s*(\d{1,2}):(\d{2})(?:\s*([~-])\s*(\d{1,2}):(\d{2}))?\s+(.+)\s*$/
export const tabTitleRegex = /^\s*\[.+\]\s*$/

export function normalizeTimeToken(token) {
  const match = String(token ?? "").trim().match(timeTokenRegex)
  if (!match) return ""
  const hh = String(Number(match[1])).padStart(2, "0")
  return `${hh}:${match[2]}`
}

export function normalizeTimeRangeToken(token) {
  const match = String(token ?? "").trim().match(timeRangeRegex)
  if (!match) return ""
  const startH = String(Number(match[1])).padStart(2, "0")
  const endH = String(Number(match[4])).padStart(2, "0")
  return `${startH}:${match[2]}${match[3]}${endH}:${match[5]}`
}

export function normalizeTimeTokenOrRange(token) {
  return normalizeTimeToken(token) || normalizeTimeRangeToken(token)
}

export function parseTimePrefix(value) {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) return null
  const match = trimmed.match(timePrefixRegex)
  if (!match) return null
  const rawTime = match[3] ? `${match[1]}:${match[2]}${match[3]}${match[4]}:${match[5]}` : `${match[1]}:${match[2]}`
  const time = normalizeTimeTokenOrRange(rawTime)
  const text = (match[6] ?? "").trim()
  if (!text) return null
  return { time, text }
}

export function timeToMinutes(value) {
  const trimmed = String(value ?? "").trim()
  let match = trimmed.match(timeTokenRegex)
  if (match) return Number(match[1]) * 60 + Number(match[2])
  match = trimmed.match(timeRangeRegex)
  if (match) return Number(match[1]) * 60 + Number(match[2])
  return Number.MAX_SAFE_INTEGER
}

export function parseDashboardSemicolonLine(value, { allowEmptyText = false } = {}) {
  const raw = String(value ?? "").trim()
  if (!raw.includes(";")) return null
  const parts = raw.split(";")
  if (parts.length < 2) return null

  const first = parts[0].trim()
  const time = normalizeTimeTokenOrRange(first)
  let group = ""
  let text = ""

  if (time) {
    const second = (parts[1] ?? "").trim()
    const maybeGroup = second.startsWith("@") ? second.slice(1).trim() : ""
    if (maybeGroup) {
      group = maybeGroup
      text = parts.slice(2).join(";").trim()
    } else {
      text = parts.slice(1).join(";").trim()
    }
  } else if (first.startsWith("@")) {
    group = first.slice(1).trim()
    text = parts.slice(1).join(";").trim()
  } else {
    return null
  }

  if (!allowEmptyText && !text) return null
  return { time: time || "", group, text }
}

export function addGroupItem(groupIndex, groups, title, item) {
  if (!title) return
  const existing = groupIndex.get(title)
  if (existing) existing.items.push(item)
  else {
    const entry = { title, items: [item] }
    groupIndex.set(title, entry)
    groups.push(entry)
  }
}

export function normalizeGroupLineNewlines(text) {
  const s = (text ?? "").replace(/\r\n/g, "\n")
  const lines = s.split("\n")
  const out = []
  let pending = null

  const pushNormalizedGroup = (indent, title, inner) => {
    const normalizedInner = String(inner ?? "")
      .replace(/\r?\n+/g, ";")
      .replace(/\s+/g, " ")
      .trim()
    out.push(`${indent}@${String(title).trim()}(${normalizedInner})`)
  }

  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0] ?? ""
    const trimmed = line.trim()

    if (pending) {
      if (groupLineCloseRegex.test(trimmed)) {
        pushNormalizedGroup(pending.indent, pending.title, pending.items.join(";"))
        pending = null
        continue
      }
      if (trimmed) pending.items.push(trimmed)
      continue
    }

    if (!trimmed) {
      out.push(line)
      continue
    }

    if (trimmed.startsWith("@")) {
      const inlineMatch = trimmed.match(groupLineRegex)
      if (inlineMatch) {
        pushNormalizedGroup(indent, inlineMatch[1], inlineMatch[2])
        continue
      }

      const startMatch = trimmed.match(groupLineStartRegex)
      if (startMatch) {
        const title = String(startMatch[1] ?? "").trim()
        if (title) {
          pending = { title, indent, items: [] }
          continue
        }
      }

      const titleOnly = trimmed.match(groupLineTitleOnlyRegex)
      if (titleOnly) {
        const title = String(titleOnly[1] ?? "").trim()
        if (title) {
          out.push(`${indent}@${title}`)
          continue
        }
      }
    }

    out.push(line)
  }

  if (pending) {
    pushNormalizedGroup(pending.indent, pending.title, pending.items.join(";"))
  }

  return out.join("\n")
}

export function normalizeWindowTitle(value) {
  const trimmed = String(value ?? "").trim()
  return trimmed ? trimmed : "제목없음"
}

export function makeUniqueWindowTitle(baseTitle, windows, ignoreId = null) {
  const desired = normalizeWindowTitle(baseTitle)
  const existing = new Set(
    (windows ?? []).filter((w) => w && w.id !== ignoreId).map((w) => String(w.title ?? "").trim())
  )
  if (!existing.has(desired)) return desired

  let i = 2
  let next = `${desired} (${i})`
  while (existing.has(next)) {
    i += 1
    next = `${desired} (${i})`
  }
  return next
}

export function replaceGroupTitleInText(text, oldTitle, newTitle) {
  if (!text || !oldTitle || !newTitle || oldTitle === newTitle) return text ?? ""
  const lines = String(text).split("\n")
  let changed = false

  const nextLines = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return line
    const indent = line.match(/^\s*/)?.[0] ?? ""

    const semicolon = parseDashboardSemicolonLine(trimmed, { allowEmptyText: true })
    if (semicolon && semicolon.group === oldTitle) {
      const timePrefix = semicolon.time ? `${semicolon.time};` : ""
      const textPart = semicolon.text ?? ""
      changed = true
      return `${indent}${timePrefix}@${newTitle};${textPart}`
    }

    let m = trimmed.match(groupLineRegex)
    if (m && m[1].trim() === oldTitle) {
      changed = true
      return `${indent}@${newTitle}(${m[2]})`
    }

    m = trimmed.match(groupLineStartRegex)
    if (m && m[1].trim() === oldTitle) {
      changed = true
      return `${indent}@${newTitle}(`
    }

    m = trimmed.match(groupLineTitleOnlyRegex)
    if (m && m[1].trim() === oldTitle) {
      changed = true
      return `${indent}@${newTitle}`
    }

    return line
  })

  return changed ? nextLines.join("\n") : text
}

export function getGroupLineParts(line) {
  const trimmed = (line ?? "").trim()
  if (!trimmed) return null
  const indent = (line ?? "").match(/^\s*/)?.[0] ?? ""
  let m = trimmed.match(groupLineRegex)
  if (m) {
    const title = m[1].trim()
    if (!title) return null
    return { prefix: `${indent}@${title}`, suffix: `(${m[2]})` }
  }
  m = trimmed.match(groupLineStartRegex)
  if (m) {
    const title = m[1].trim()
    if (!title) return null
    return { prefix: `${indent}@${title}`, suffix: "(" }
  }
  m = trimmed.match(groupLineTitleOnlyRegex)
  if (m) {
    const title = m[1].trim()
    if (!title) return null
    return { prefix: `${indent}@${title}`, suffix: "" }
  }
  return null
}

export function parseDashboardBlockContent(body) {
  const general = []
  const groups = []
  const groupIndex = new Map()
  const timed = []
  const lines = normalizeGroupLineNewlines(body).split("\n")
  let order = 0
  for (const raw of lines) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const semicolon = parseDashboardSemicolonLine(trimmed)
    if (semicolon) {
      if (semicolon.group) {
        addGroupItem(groupIndex, groups, semicolon.group, { text: semicolon.text, time: semicolon.time, order })
      } else if (semicolon.time) {
        timed.push({ time: semicolon.time, text: semicolon.text, order })
      } else {
        general.push(semicolon.text)
      }
      order++
      continue
    }
    const emptySemicolon = parseDashboardSemicolonLine(trimmed, { allowEmptyText: true })
    if (emptySemicolon && !emptySemicolon.text) continue

    const match = trimmed.match(groupLineRegex)
    if (match) {
      const title = match[1].trim()
      const inner = match[2]
      if (!title) continue
      const items = inner
        .split(";")
        .map((x) => x.trim())
        .filter((x) => x !== "")
      for (const item of items) {
        const parsed = parseTimePrefix(item)
        addGroupItem(groupIndex, groups, title, {
          text: parsed ? parsed.text : item,
          time: parsed ? parsed.time : "",
          order
        })
        order++
      }
      continue
    }

    const timeLine = parseTimePrefix(trimmed)
    if (timeLine) {
      timed.push({ time: timeLine.time, text: timeLine.text, order })
      order++
      continue
    }

    general.push(trimmed)
    order++
  }
  return { general, groups, timed }
}

export function parseBlocksAndItems(rawText, baseYear, { allowAnyYear = false } = {}) {
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
      if (m && (allowAnyYear || Number(m[1]) === baseYear)) {
        const year = Number(m[1])
        const normalizedYear = Number.isFinite(year) ? year : baseYear
        key = `${normalizedYear}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`
      }
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
        if (mm[3]) {
          const endH = String(Number(mm[4])).padStart(2, "0")
          time = `${hh}:${mm[2]}${mm[3]}${endH}:${mm[5]}`
          text = mm[6]
        } else {
          time = `${hh}:${mm[2]}`
          text = mm[6]
        }
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

export function isMemoHeaderLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return false
  return tabTitleRegex.test(trimmed) || mdOnlyRegex.test(trimmed) || ymdOnlyRegex.test(trimmed)
}

export function buildMemoOverlayLines(text) {
  const lines = (text ?? "").split("\n")
  const overlay = []

  for (const line of lines) {
    const isHeader = isMemoHeaderLine(line)
    overlay.push({ text: line, isHeader, groupParts: getGroupLineParts(line) })
  }

  return overlay
}

export function syncOverlayScroll(textarea, overlayInner) {
  if (!textarea || !overlayInner) return
  overlayInner.style.transform = `translateY(${-textarea.scrollTop}px)`
}

export function normalizePrettyAndMerge(text, baseYear, { allowAnyYear = false } = {}) {
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
    if (m) {
      key = `${baseYear}-${String(Number(m[1])).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`
    } else {
      m = trimmed.match(ymdOnlyRegex)
      if (m && (allowAnyYear || Number(m[1]) === baseYear)) {
        const year = Number(m[1])
        const normalizedYear = Number.isFinite(year) ? year : baseYear
        key = `${normalizedYear}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`
      }
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
    const { y, m, d } = keyToYMD(b.key)
    const header = buildHeaderLine(y, m, d)
    if (b.body.length === 0) return header
    return `${header}\n${b.body.join("\n")}`.trimEnd()
  })

  const pre = preamble.join("\n").trimEnd()
  const body = outBlocks.join("\n\n").trimEnd()
  return pre ? `${pre}\n\n${body}` : body
}

export function getDateKeyFromLine(line, baseYear) {
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

export function buildCombinedRightText(commonText, windows, filters, windowTexts) {
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

export function splitCombinedRightText(text, windows) {
  const titleToId = new Map(windows.map((w) => [w.title, w.id]))
  const commonLines = []
  const windowLinesById = new Map(windows.map((w) => [w.id, []]))
  const seenWindowIds = new Set()
  let currentSection = "all"

  const lines = (text ?? "").split("\n")
  for (const rawLine of lines) {
    const headerMatch = rawLine.match(/^\s*\[(.+)\](.*)$/)
    if (headerMatch) {
      const title = headerMatch[1]
      const id = titleToId.get(title)
      if (id) {
        currentSection = id
        seenWindowIds.add(id)
        const rest = (headerMatch[2] ?? "").replace(/^\s+/, "")
        if (rest) {
          const bucket = windowLinesById.get(currentSection) ?? []
          bucket.push(rest)
          windowLinesById.set(currentSection, bucket)
        }
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

export function getDateBlockBodyText(text, baseYear, dateKey) {
  const parsed = parseBlocksAndItems(text, baseYear)
  const block = parsed.blocks.find((b) => b.dateKey === dateKey)
  if (!block) return ""
  const body = text.slice(block.bodyStartPos, block.blockEndPos)
  return body.replace(/^\n+/, "").replace(/\n+$/, "")
}

export function updateDateBlockBody(text, baseYear, dateKey, bodyText) {
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

export function syncMirrorStyleFromTextarea(ta, mirror) {
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

export function clampMemoCaretBelowHeader(text, caretPos) {
  if (caretPos <= 0) return 0
  const beforeLineBreak = text.lastIndexOf("\n", caretPos - 1)
  const lineStart = beforeLineBreak === -1 ? 0 : beforeLineBreak + 1
  const lineEnd = text.indexOf("\n", lineStart)
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd)
  if (isMemoHeaderLine(line)) {
    return lineEnd === -1 ? text.length : lineEnd + 1
  }
  return caretPos
}

export function normalizeCaretForTextarea(ta, caretPos) {
  if (!ta) return caretPos ?? 0
  const text = ta.value ?? ""
  const safePos = Math.max(0, Math.min(text.length, caretPos ?? 0))
  return clampMemoCaretBelowHeader(text, safePos)
}

export function getLineHeightPx(ta) {
  const lh = window.getComputedStyle(ta).lineHeight
  const n = Number(String(lh).replace("px", ""))
  return Number.isFinite(n) && n > 0 ? n : 20
}

export function measureCharTopPx(ta, mirror, marker, s, charPos) {
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

export function measureCharPosPx(ta, mirror, marker, s, charPos) {
  const pos = Math.max(0, Math.min(charPos ?? 0, s.length))
  syncMirrorStyleFromTextarea(ta, mirror)

  const before = s.slice(0, pos)
  const after = s.slice(pos)

  mirror.innerHTML = ""
  mirror.appendChild(document.createTextNode(before))
  marker.textContent = "\u200b"
  mirror.appendChild(marker)
  mirror.appendChild(document.createTextNode(after))

  return { top: marker.offsetTop, left: marker.offsetLeft }
}

export function scrollCharPosToTopOffset(ta, mirror, marker, s, charPos, topOffsetLines = 1) {
  const topPx = measureCharTopPx(ta, mirror, marker, s, charPos)
  const lh = getLineHeightPx(ta)
  const desiredVisibleY = topOffsetLines * lh

  const target = Math.max(0, topPx - desiredVisibleY)
  const maxTop = Math.max(0, ta.scrollHeight - ta.clientHeight)
  ta.scrollTop = Math.min(target, maxTop)
}

export function insertDateBlockAt(text, insertPos, headerLine) {
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

export function afterTwoFrames(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

export function ensureOneBlankLineAtBlockEnd(text, block) {
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

export function ensureBodyLineForBlock(text, block) {
  const body = text.slice(block.bodyStartPos, block.blockEndPos)
  if (body.trim().length > 0) {
    return ensureOneBlankLineAtBlockEnd(text, block)
  }
  const insertPos = block.bodyStartPos
  if (text[insertPos] === "\n") {
    return { newText: text, caretPos: insertPos }
  }
  const newText = text.slice(0, insertPos) + "\n" + text.slice(insertPos)
  return { newText, caretPos: insertPos }
}

export function ensureTabGroupLineAtDate(text, dateKey, title, year) {
  const source = text ?? ""
  const parsed = parseBlocksAndItems(source, year)
  const block = parsed.blocks.find((b) => b.dateKey === dateKey)
  if (!block || !title) return { newText: source, caretPos: null, headerPos: null }

  const body = source.slice(block.bodyStartPos, block.blockEndPos)
  if (body.trim().length > 0) {
    return { newText: source, caretPos: block.bodyStartPos, headerPos: block.headerStartPos }
  }

  const ensured = ensureBodyLineForBlock(source, block)
  return { newText: ensured.newText, caretPos: ensured.caretPos ?? block.bodyStartPos, headerPos: block.headerStartPos }
}

export function blockHasMeaningfulBody(text, block) {
  const body = text.slice(block.bodyStartPos, block.blockEndPos)
  const normalized = normalizeGroupLineNewlines(body)
  const lines = normalized.split("\n")
  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    const semicolon = parseDashboardSemicolonLine(trimmed, { allowEmptyText: true })
    if (semicolon) {
      if (!semicolon.text) continue
      return true
    }
    const match = trimmed.match(groupLineRegex)
    if (match) {
      if (match[2].trim().length > 0) return true
      continue
    }
    return true
  }
  return false
}

export function isBlockBodyEmpty(text, block) {
  return !blockHasMeaningfulBody(text, block)
}

export function removeBlockRange(text, block) {
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

export function removeEmptyBlockByDateKey(text, baseYear, dateKey) {
  const parsed = parseBlocksAndItems(text, baseYear)
  const b = parsed.blocks.find((x) => x.dateKey === dateKey)
  if (!b) return { newText: text, changed: false, caretPos: null }
  if (!isBlockBodyEmpty(text, b)) return { newText: text, changed: false, caretPos: null }
  const { newText, caretPos } = removeBlockRange(text, b)
  return { newText, changed: true, caretPos }
}

export function removeAllEmptyBlocks(text, baseYear, options = {}) {
  let current = text ?? ""
  let changed = false
  while (true) {
    const parsed = parseBlocksAndItems(current, baseYear, options)
    const emptyBlock = [...parsed.blocks].reverse().find((b) => isBlockBodyEmpty(current, b))
    if (!emptyBlock) break
    current = removeBlockRange(current, emptyBlock).newText
    changed = true
  }
  return { newText: current, changed }
}

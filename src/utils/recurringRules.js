import { dayOfWeek, keyToTime, keyToYMD } from "./dateUtils"
import { normalizeTimeTokenOrRange, parseTimePrefix } from "./plannerText"
import { stripTaskSuffix } from "./taskMarkers"

export const REPEAT_NONE = "none"
export const REPEAT_DAILY = "daily"
export const REPEAT_WEEKLY = "weekly"
export const REPEAT_MONTHLY = "monthly"
export const REPEAT_YEARLY = "yearly"

export const REPEAT_TYPES = [
  REPEAT_NONE,
  REPEAT_DAILY,
  REPEAT_WEEKLY,
  REPEAT_MONTHLY,
  REPEAT_YEARLY
]

export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"]

export function genRecurringId(prefix = "rec") {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`
    }
  } catch (err) {
    void err
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function normalizeRepeatType(value) {
  const repeat = String(value ?? REPEAT_NONE).trim().toLowerCase()
  return REPEAT_TYPES.includes(repeat) ? repeat : REPEAT_NONE
}

export function normalizeRepeatInterval(value) {
  const n = Number.parseInt(String(value ?? "1"), 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export function normalizeRepeatDays(value) {
  const list = Array.isArray(value) ? value : []
  const normalized = list
    .map((item) => Number(item))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
  return [...new Set(normalized)].sort((a, b) => a - b)
}

export function isValidDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim())
}

export function toDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function addDaysToKey(dateKey, amount) {
  const { y, m, d } = keyToYMD(dateKey)
  const next = new Date(y, m - 1, d)
  next.setDate(next.getDate() + Number(amount || 0))
  return toDateKey(next)
}

export function getPreviousDateKey(dateKey) {
  return addDaysToKey(dateKey, -1)
}

function addMonthsPreserveDay(dateKey, amount) {
  const { y, m, d } = keyToYMD(dateKey)
  const next = new Date(y, m - 1, d)
  const targetMonth = next.getMonth() + Number(amount || 0)
  next.setDate(1)
  next.setMonth(targetMonth)
  const daysInTarget = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(d, daysInTarget))
  return toDateKey(next)
}

function addYearsPreserveDay(dateKey, amount) {
  const { y, m, d } = keyToYMD(dateKey)
  const next = new Date(y, m - 1, d)
  next.setDate(1)
  next.setFullYear(next.getFullYear() + Number(amount || 0))
  const daysInTarget = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(d, daysInTarget))
  return toDateKey(next)
}

export function parseRecurringRawLine(rawLine, fallbackTitle = "") {
  const line = String(rawLine ?? "").trim()
  if (!line) {
    return {
      time: "",
      title: fallbackTitle,
      text: "",
      display: "",
      isTask: false,
      completed: false,
      baseRaw: ""
    }
  }
  const stripped = stripTaskSuffix(line)
  const source = stripped.text || line
  const isTask = stripped.completed != null
  const completed = Boolean(stripped.completed)

  const semicolonParts = source.includes(";") ? source.split(";") : []
  const semicolonTime = semicolonParts.length > 1 ? normalizeTimeTokenOrRange(semicolonParts[0]) : ""
  if (semicolonTime) {
    const title = String(fallbackTitle || "").trim()
    const text = String(semicolonParts.slice(1).join(";") ?? "").trim()
    const time = String(semicolonTime ?? "").trim()
    const display = `${time ? `${time} ` : ""}${title ? `[${title}] ` : ""}${text}`.trim()
    return { time, title, text, display, isTask, completed, baseRaw: source }
  }

  const timed = parseTimePrefix(source)
  if (timed) {
    const time = String(timed.time ?? "").trim()
    const title = String(fallbackTitle || "").trim()
    const text = String(timed.text ?? "").trim()
    const display = `${time ? `${time} ` : ""}${title ? `[${title}] ` : ""}${text}`.trim()
    return { time, title, text, display, isTask, completed, baseRaw: source }
  }

  const text = source
  const display = `${fallbackTitle ? `[${fallbackTitle}] ` : ""}${text}`.trim()
  return { time: "", title: fallbackTitle, text, display, isTask, completed, baseRaw: source }
}

export function getRepeatLabel(repeat, repeatInterval = 1) {
  const mode = normalizeRepeatType(repeat)
  const interval = normalizeRepeatInterval(repeatInterval)
  if (mode === REPEAT_NONE) return "반복 안함"
  if (mode === REPEAT_DAILY) return interval === 1 ? "매일" : `${interval}일마다`
  if (mode === REPEAT_WEEKLY) return interval === 1 ? "매주" : `${interval}주마다`
  if (mode === REPEAT_MONTHLY) return interval === 1 ? "매월" : `${interval}개월마다`
  if (mode === REPEAT_YEARLY) return interval === 1 ? "매년" : `${interval}년마다`
  return "반복 안함"
}

export function formatDateRangeLabel(startDateKey, untilDateKey) {
  const start = String(startDateKey ?? "").trim()
  const until = String(untilDateKey ?? "").trim()
  if (!start) return ""
  if (!until || until === start) return `${start} ~`
  return `${start} ~ ${until}`
}

export function buildOccurrenceDateKeys(rule, rangeStartKey, rangeEndKey) {
  const startDateKey = String(rule?.startDateKey ?? rule?.start_date ?? "").trim()
  const rawUntilDateKey = String(rule?.untilDateKey ?? rule?.until_date ?? "").trim()
  const untilDateKey = rawUntilDateKey || String(rangeEndKey ?? "").trim() || startDateKey
  const repeat = normalizeRepeatType(rule?.repeat ?? rule?.repeat_type)
  const interval = normalizeRepeatInterval(rule?.repeatInterval ?? rule?.repeat_interval)
  const startMs = keyToTime(startDateKey)
  const rangeStartMs = keyToTime(rangeStartKey)
  const rangeEndMs = keyToTime(rangeEndKey)
  const untilMs = keyToTime(untilDateKey)
  if (!startDateKey || !untilDateKey) return []
  if (!Number.isFinite(startMs) || !Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs) || !Number.isFinite(untilMs)) {
    return []
  }
  const hardEndMs = Math.min(untilMs, rangeEndMs)
  if (hardEndMs < startMs) return []

  if (repeat === REPEAT_NONE) {
    if (startMs < rangeStartMs || startMs > hardEndMs) return []
    return [startDateKey]
  }

  const out = []
  if (repeat === REPEAT_DAILY) {
    for (let key = startDateKey; keyToTime(key) <= hardEndMs; key = addDaysToKey(key, interval)) {
      if (keyToTime(key) >= rangeStartMs) out.push(key)
    }
    return out
  }

  if (repeat === REPEAT_WEEKLY) {
    const targets = normalizeRepeatDays(rule?.repeatDays ?? rule?.repeat_days)
    const startYmd = keyToYMD(startDateKey)
    const baseWeekday = dayOfWeek(startYmd.y, startYmd.m, startYmd.d)
    const weekdays = targets.length > 0 ? targets : [baseWeekday]
    const startWeek = new Date(startYmd.y, startYmd.m - 1, startYmd.d)
    startWeek.setDate(startWeek.getDate() - startWeek.getDay())
    for (let key = startDateKey; keyToTime(key) <= hardEndMs; key = addDaysToKey(key, 1)) {
      const currentMs = keyToTime(key)
      if (currentMs < rangeStartMs) continue
      const { y, m, d } = keyToYMD(key)
      const currentWeekday = dayOfWeek(y, m, d)
      if (!weekdays.includes(currentWeekday)) continue
      const currentWeek = new Date(y, m - 1, d)
      currentWeek.setDate(currentWeek.getDate() - currentWeek.getDay())
      const diffWeeks = Math.floor((currentWeek.getTime() - startWeek.getTime()) / (7 * 24 * 60 * 60 * 1000))
      if (diffWeeks >= 0 && diffWeeks % interval === 0) out.push(key)
    }
    return out
  }

  if (repeat === REPEAT_MONTHLY) {
    for (let key = startDateKey; keyToTime(key) <= hardEndMs; key = addMonthsPreserveDay(key, interval)) {
      if (keyToTime(key) >= rangeStartMs) out.push(key)
    }
    return out
  }

  if (repeat === REPEAT_YEARLY) {
    for (let key = startDateKey; keyToTime(key) <= hardEndMs; key = addYearsPreserveDay(key, interval)) {
      if (keyToTime(key) >= rangeStartMs) out.push(key)
    }
    return out
  }

  return []
}

function normalizeRule(rule) {
  const startDateKey = String(rule?.startDateKey ?? rule?.start_date ?? "").trim()
  const untilDateKey = String(rule?.untilDateKey ?? rule?.until_date ?? "").trim()
  const repeat = normalizeRepeatType(rule?.repeat ?? rule?.repeat_type)
  const repeatInterval = normalizeRepeatInterval(rule?.repeatInterval ?? rule?.repeat_interval)
  return {
    ...rule,
    id: String(rule?.id ?? "").trim(),
    familyId: String(rule?.familyId ?? rule?.family_id ?? rule?.id ?? "").trim(),
    categoryTitle: String(rule?.categoryTitle ?? rule?.category_title ?? "").trim(),
    startDateKey,
    untilDateKey,
    repeat,
    repeatInterval,
    repeatDays: repeat === REPEAT_WEEKLY ? normalizeRepeatDays(rule?.repeatDays ?? rule?.repeat_days) : [],
    rawLine: String(rule?.rawLine ?? rule?.raw_line ?? "").trim()
  }
}

function normalizeOverride(item) {
  return {
    ...item,
    id: String(item?.id ?? "").trim(),
    familyId: String(item?.familyId ?? item?.family_id ?? item?.rule_id ?? "").trim(),
    ruleId: String(item?.ruleId ?? item?.rule_id ?? "").trim(),
    dateKey: String(item?.dateKey ?? item?.date ?? "").trim(),
    mode: String(item?.mode ?? "replace").trim(),
    rawLine: String(item?.rawLine ?? item?.raw_line ?? "").trim()
  }
}

export function buildRecurringByDate(rules, overrides, rangeStartKey, rangeEndKey, categoryFilter = null) {
  const normalizedRules = (Array.isArray(rules) ? rules : []).map(normalizeRule).filter((item) => item.id && item.rawLine)
  const normalizedOverrides = (Array.isArray(overrides) ? overrides : []).map(normalizeOverride).filter((item) => item.ruleId && item.dateKey)
  const rangeEndFallbackKey = String(rangeEndKey ?? "").trim()

  const familyRange = new Map()
  for (const rule of normalizedRules) {
    const familyId = rule.familyId || rule.id
    const effectiveUntilDateKey = rule.untilDateKey || rangeEndFallbackKey || rule.startDateKey
    const current = familyRange.get(familyId)
    if (!current) {
      familyRange.set(familyId, { startDateKey: rule.startDateKey, untilDateKey: effectiveUntilDateKey })
      continue
    }
    if (keyToTime(rule.startDateKey) < keyToTime(current.startDateKey)) current.startDateKey = rule.startDateKey
    if (keyToTime(effectiveUntilDateKey) > keyToTime(current.untilDateKey)) current.untilDateKey = effectiveUntilDateKey
  }

  const overrideMap = new Map()
  for (const override of normalizedOverrides) {
    overrideMap.set(`${override.ruleId}|${override.dateKey}`, override)
  }

  const out = {}
  for (const rule of normalizedRules) {
    const familyId = rule.familyId || rule.id
    const family = familyRange.get(familyId) ?? { startDateKey: rule.startDateKey, untilDateKey: rule.untilDateKey }
    for (const dateKey of buildOccurrenceDateKeys(rule, rangeStartKey, rangeEndKey)) {
      const override = overrideMap.get(`${rule.id}|${dateKey}`)
      if (override?.mode === "skip") continue
      const rawLine = override?.mode === "replace" && override.rawLine ? override.rawLine : rule.rawLine
      const parsed = parseRecurringRawLine(rawLine, rule.categoryTitle)
      if (!parsed.text) continue
      if (categoryFilter && parsed.title && parsed.title !== categoryFilter) continue
      if (categoryFilter && !parsed.title && categoryFilter) continue
      const occurrence = {
        id: `${familyId}-${rule.id}-${dateKey}`,
        ruleId: rule.id,
        familyId,
        dateKey,
        repeat: rule.repeat,
        repeatInterval: rule.repeatInterval,
        repeatDays: rule.repeatDays,
        rawLine,
        display: parsed.display,
        time: parsed.time,
        title: parsed.title,
        text: parsed.text,
        createdAt: String(rule.createdAt ?? rule.created_at ?? "").trim(),
        updatedAt: String(rule.updatedAt ?? rule.updated_at ?? "").trim(),
        familyStartDateKey: family.startDateKey,
        familyUntilDateKey: family.untilDateKey,
        repeatUntilKey: rule.untilDateKey
      }
      out[dateKey] = (out[dateKey] ?? []).concat(occurrence)
    }
  }

  for (const key of Object.keys(out)) {
    out[key].sort((a, b) => {
      const timeA = String(a.time ?? "")
      const timeB = String(b.time ?? "")
      if (timeA && timeB && timeA !== timeB) return timeA.localeCompare(timeB)
      if (timeA && !timeB) return -1
      if (!timeA && timeB) return 1
      const createdA = String(a.createdAt ?? "")
      const createdB = String(b.createdAt ?? "")
      if (createdA && createdB && createdA !== createdB) return createdA.localeCompare(createdB)
      return String(a.display ?? "").localeCompare(String(b.display ?? ""), "ko")
    })
  }

  return out
}


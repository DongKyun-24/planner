import { dayOfWeek } from "./dateUtils"

export const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"]

export const FIXED_HOLIDAYS_MMDD = {
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
export const YEAR_HOLIDAYS = {}
export const HOLIDAY_COUNTRY_CODE = "KR"
export const HOLIDAY_CACHE_PREFIX = "planner-holidays"
export const HOLIDAY_CACHE_TTL = 1000 * 60 * 60 * 24 * 30
export const HOLIDAY_CACHE_MAX_YEARS = 5

export function getHolidayCacheKey(year, countryCode = HOLIDAY_COUNTRY_CODE) {
  return `${HOLIDAY_CACHE_PREFIX}-${countryCode}-${year}`
}

export function readHolidayCache(year, countryCode = HOLIDAY_COUNTRY_CODE) {
  if (typeof window === "undefined") return null
  const key = getHolidayCacheKey(year, countryCode)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    const items = parsed.items
    const fetchedAt = Number(parsed.fetchedAt)
    if (!items || typeof items !== "object" || !Number.isFinite(fetchedAt)) return null
    return { items, fetchedAt }
  } catch (err) {
    void err
    return null
  }
}

export function listHolidayCacheEntries(countryCode = HOLIDAY_COUNTRY_CODE) {
  if (typeof window === "undefined") return []
  const prefix = `${HOLIDAY_CACHE_PREFIX}-${countryCode}-`
  const entries = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(prefix)) continue
      const year = Number(key.slice(prefix.length))
      if (!Number.isFinite(year)) continue
      const cached = readHolidayCache(year, countryCode)
      const fetchedAt = cached?.fetchedAt ?? 0
      entries.push({ key, year, fetchedAt })
    }
  } catch (err) {
    void err
  }
  return entries
}

export function pruneHolidayCache(countryCode = HOLIDAY_COUNTRY_CODE, maxYears = HOLIDAY_CACHE_MAX_YEARS) {
  if (typeof window === "undefined") return
  const entries = listHolidayCacheEntries(countryCode)
  if (entries.length <= maxYears) return
  entries.sort((a, b) => (b.fetchedAt || 0) - (a.fetchedAt || 0))
  const toRemove = entries.slice(maxYears)
  for (const entry of toRemove) {
    try {
      localStorage.removeItem(entry.key)
    } catch (err) {
      void err
    }
  }
}

export function writeHolidayCache(year, items, countryCode = HOLIDAY_COUNTRY_CODE) {
  if (typeof window === "undefined") return
  const key = getHolidayCacheKey(year, countryCode)
  try {
    localStorage.setItem(key, JSON.stringify({ items, fetchedAt: Date.now() }))
  } catch (err) {
    void err
  }
  pruneHolidayCache(countryCode)
}

export function isHolidayCacheFresh(entry) {
  if (!entry) return false
  return Date.now() - entry.fetchedAt < HOLIDAY_CACHE_TTL
}

export function normalizeHolidayItems(items) {
  if (!Array.isArray(items)) return {}
  const map = {}
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const date = String(item.date ?? "").trim()
    if (!date) continue
    const name = String(item.localName || item.name || "").trim()
    if (!name) continue
    if (Array.isArray(item.types) && item.types.length > 0 && !item.types.includes("Public")) continue
    map[date] = name
  }
  return map
}

export async function fetchHolidayYear(year, countryCode = HOLIDAY_COUNTRY_CODE) {
  const y = Number(year)
  if (!Number.isFinite(y)) return {}
  const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/${countryCode}`)
  if (!res.ok) throw new Error(`holiday fetch failed: ${res.status}`)
  const data = await res.json()
  return normalizeHolidayItems(data)
}

export function getHolidayName(year, month, day) {
  const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  const mmdd = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  const byYear = YEAR_HOLIDAYS[year]?.[key]
  return byYear || FIXED_HOLIDAYS_MMDD[mmdd] || ""
}

export function buildHeaderLine(year, month, day) {
  const w = WEEKDAYS_KO[dayOfWeek(year, month, day)]
  const holiday = getHolidayName(year, month, day)
  return holiday ? `${month}/${day} (${w}) ${holiday}` : `${month}/${day} (${w})`
}

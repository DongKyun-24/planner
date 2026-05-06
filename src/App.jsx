import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import CalendarPanel from "./components/CalendarPanel"
import QuickCreateModal from "./components/QuickCreateModal"
import DayListModal from "./components/DayListModal"
import DeleteConfirmModal from "./components/DeleteConfirmModal"
import MemoEditor from "./components/MemoEditor"
import MemoReadView from "./components/MemoReadView"
import MonthNavigator from "./components/MonthNavigator"
import RecurringRuleModal from "./components/RecurringRuleModal"
import RightMemoEditor from "./components/RightMemoEditor"
import SettingsPanel from "./components/SettingsPanel"
import WindowTabs from "./components/WindowTabs"
import { isSupabaseConfigured, supabase } from "./lib/supabase"
import { themes } from "./styles/themes"
import { daysInMonth, dayOfWeek, keyToYMD, keyToTime, clamp } from "./utils/dateUtils"
import {
  YEAR_HOLIDAYS,
  readHolidayCache,
  isHolidayCacheFresh,
  fetchHolidayYear,
  writeHolidayCache,
  buildHeaderLine
} from "./utils/holiday"
import {
  groupLineRegex,
  groupLineStartRegex,
  groupLineTitleOnlyRegex,
  groupLineCloseRegex,
  parseDashboardSemicolonLine,
  parseLeadingTimeDashboardLine,
  normalizeGroupLineNewlines,
  normalizeWindowTitle,
  makeUniqueWindowTitle,
  replaceGroupTitleInText,
  parseDashboardBlockContent,
  buildOrderedEntriesFromBody,
  parseBlocksAndItems,
  buildMemoOverlayLines,
  syncOverlayScroll,
  normalizePrettyAndMerge,
  getDateKeyFromLine,
  buildCombinedRightText,
  splitCombinedRightText,
  getDateBlockBodyText,
  updateDateBlockBody,
  normalizeCaretForTextarea,
  getLineHeightPx,
  measureCharPosPx,
  scrollCharPosToTopOffset,
  insertDateBlockAt,
  afterTwoFrames,
  ensureBodyLineForBlock,
  ensureTabGroupLineAtDate,
  removeEmptyBlockByDateKey,
  removeAllEmptyBlocks
} from "./utils/plannerText"
import {
  addDaysToKey,
  buildOccurrenceDateKeys,
  buildRecurringByDate,
  genRecurringId,
  getPreviousDateKey,
  isValidDateKey,
  normalizeRepeatDays,
  normalizeRepeatInterval,
  normalizeRepeatType,
  parseRecurringRawLine
} from "./utils/recurringRules"
import { extractTasksFromPlannerText, removeTaskLineFromBody, updateTaskLineStatusInBody } from "./utils/tasks"
import {
  buildTaskMetaText,
  decodeTaskLineBreaks,
  removeTaskLinesFromBody,
  stripTaskSuffix
} from "./utils/taskMarkers"
import {
  buildRightMemoCombinedText,
  getRightMemoDocDisplayTitle,
  normalizeRightMemoDocState,
  serializeRightMemoDocState
} from "./utils/rightMemoDocs"

const CATEGORY_ID_MAP = {}
const GENERAL_CATEGORY_ID = "__general__"

function normalizeCategoryId(value) {
  const key = String(value ?? "").trim()
  return CATEGORY_ID_MAP[key] || key
}

function isGeneralCategoryId(value) {
  const normalized = normalizeCategoryId(value)
  return !normalized || normalized === GENERAL_CATEGORY_ID
}

function normalizeWindowTitleValue(value) {
  return normalizeCategoryId(normalizeWindowTitle(value))
}

const CLIENT_ID_KEY = "planner-client-id"
const REMEMBER_CREDENTIALS_KEY = "planner-remember-credentials"
const AUTH_IDENTIFIER_EMAIL_DOMAIN = "planner.local"
const AUTH_MIN_PASSWORD_LENGTH = 6
const OFFLINE_RECURRING_RULES_KEY = "planner-recurring-rules-offline-v1"
const OFFLINE_RECURRING_OVERRIDES_KEY = "planner-recurring-overrides-offline-v1"
const USER_RECURRING_RULES_KEY_PREFIX = "planner-recurring-rules-user-v1"
const USER_RECURRING_OVERRIDES_KEY_PREFIX = "planner-recurring-overrides-user-v1"
const USER_RECURRING_CLOUD_MIGRATION_KEY_PREFIX = "planner-recurring-cloud-migrated-v1"
const OPEN_ENDED_REPEAT_LOOKAHEAD_DAYS = 730

function getClientId() {
  if (typeof window === "undefined") return "server"
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY)
    if (existing) return existing
    const next =
      (crypto?.randomUUID && `web-${crypto.randomUUID()}`) ||
      `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
    localStorage.setItem(CLIENT_ID_KEY, next)
    return next
  } catch {
    return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

function App() {
  const textareaRef = useRef(null)
  const rightTextareaRef = useRef(null)
  const mirrorRef = useRef(null)
  const markerRef = useRef(null)
  const leftOverlayInnerRef = useRef(null)
  const rightOverlayInnerRef = useRef(null)
  const readBlockRefs = useRef(new Map())
  const clientIdRef = useRef(getClientId())
  const endTimeSupportedRef = useRef(true)
  const repeatColumnsSupportedRef = useRef(true)
  const alarmColumnsSupportedRef = useRef(true)

  // ===== 창(캘린더) 탭 =====
  const WINDOWS_KEY = "planner-windows-v1"
  const OFFLINE_WINDOWS_KEY = "planner-windows-offline-v1"
  const WINDOWS_KEY_PREFIX = "planner-windows-user-v1"
  const LEGACY_KEY = "planner-text"
  const OFFLINE_MEMO_PREFIX = "planner-offline"
  const USER_MEMO_PREFIX = "planner-user"
  const OFFLINE_MEMO_MIGRATION_KEY = "planner-offline-memo-migrated-v1"
  const SYNC_BACKUP_KEY_PREFIX = "planner-sync-backup-v1"
  // Temporary safety mode: web reads plans from Supabase, but does not write plans from memo text.
  // Mobile remains the source of truth for schedule CRUD until web is migrated to row-based edits.
  const ENABLE_WEB_TEXT_PLAN_SYNC = false
  const ENABLE_WEB_ROW_PLAN_EDIT = true
  const ENABLE_AUTOMATIC_DIFF_DELETE = false

  const DEFAULT_WINDOWS = [{ id: "all", title: "통합", color: "#2563eb", fixed: true }]

  function genWindowId() {
  try {
    if (crypto?.randomUUID) return `w-${crypto.randomUUID()}`
  } catch (err) { void err }
  return `w-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  function getMemoStoragePrefix(userId) {
    return userId ? `${USER_MEMO_PREFIX}-${userId}` : OFFLINE_MEMO_PREFIX
  }

  function getRecurringRulesStorageKey(userId) {
    return userId ? `${USER_RECURRING_RULES_KEY_PREFIX}-${userId}` : OFFLINE_RECURRING_RULES_KEY
  }

  function getRecurringOverridesStorageKey(userId) {
    return userId ? `${USER_RECURRING_OVERRIDES_KEY_PREFIX}-${userId}` : OFFLINE_RECURRING_OVERRIDES_KEY
  }

  function getRecurringCloudMigrationKey(userId) {
    return userId ? `${USER_RECURRING_CLOUD_MIGRATION_KEY_PREFIX}-${userId}` : ""
  }

  function loadRecurringList(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  function saveRecurringList(storageKey, value) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.isArray(value) ? value : []))
    } catch (err) {
      void err
    }
  }

  function getMemoKey(prefix, year, windowId) {
    return `${prefix}-text-${year}-${windowId}`
  }

  function getLeftMemoKey(prefix, year) {
    return `${prefix}-left-text-${year}`
  }

  function getRightMemoKey(prefix, year, windowId) {
    return `${prefix}-right-text-${year}-${windowId}`
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  function getWindowsStorageKey(userId) {
    return userId ? `${WINDOWS_KEY_PREFIX}-${userId}` : OFFLINE_WINDOWS_KEY
  }

  function getSyncBackupKey(userId, year) {
    return `${SYNC_BACKUP_KEY_PREFIX}-${userId ?? "offline"}-${year}`
  }

  function pushSyncBackup(userId, year, text, reason = "sync") {
    try {
      const key = getSyncBackupKey(userId, year)
      const raw = localStorage.getItem(key)
      const parsed = JSON.parse(raw ?? "[]")
      const list = Array.isArray(parsed) ? parsed : []
      const nextText = String(text ?? "")
      const last = list[list.length - 1]
      if (last?.text === nextText) return
      const next = [...list, { at: new Date().toISOString(), reason, text: nextText }]
      localStorage.setItem(key, JSON.stringify(next.slice(-20)))
    } catch (err) { void err }
  }

  function hasStoredWindows(key) {
    try {
      return localStorage.getItem(key) != null
    } catch {
      return false
    }
  }

  const LEGACY_WINDOW_COLORS = [
    "#c40000",
    "#ff7a00",
    "#ff4a00",
    "#ffe94a",
    "#ffd21a",
    "#dff08a",
    "#86e000",
    "#0b7a0b",
    "#0a5a1f",
    "#7fe8d2",
    "#98ddff",
    "#cfe0ff",
    "#14a7d8",
    "#1f33d6",
    "#1b0f7d",
    "#6b2e8f",
    "#e1c2ff",
    "#ffd1e7"
  ]

  const WINDOW_COLORS = [
    "#d7686d",
    "#de8b5b",
    "#e28a67",
    "#d9c56a",
    "#d6ba58",
    "#c5d97b",
    "#93c96a",
    "#4f9d63",
    "#4e7f65",
    "#79c9b8",
    "#86c0e6",
    "#b2c8eb",
    "#5eaed1",
    "#5a78cf",
    "#5b62aa",
    "#8765b3",
    "#c9b4e8",
    "#e5b9cf"
  ]

  const WINDOW_COLOR_LEGACY_MAP = Object.freeze(
    LEGACY_WINDOW_COLORS.reduce((acc, legacy, index) => {
      acc[legacy] = WINDOW_COLORS[index] || legacy
      return acc
    }, {})
  )

  function normalizeWindowColor(value) {
    const key = String(value ?? "").trim().toLowerCase()
    if (!key) return ""
    return WINDOW_COLOR_LEGACY_MAP[key] || (WINDOW_COLORS.includes(key) ? key : key)
  }

  function loadWindows(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey ?? WINDOWS_KEY)
    if (!raw) return DEFAULT_WINDOWS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_WINDOWS

    const normalized = parsed
      .filter((w) => w && typeof w.id === "string")
      .map((w) => ({
        id: w.id,
        title: normalizeWindowTitleValue(w.title),
        color: normalizeWindowColor(typeof w.color === "string" ? w.color : "#2563eb") || "#2563eb",
        fixed: Boolean(w.fixed) || w.id === "all"
      }))

    const seen = new Set()
    let hasAll = false
    const deduped = []
    for (const w of normalized) {
      if (w.id === "all") {
        if (hasAll) continue
        hasAll = true
        deduped.push({ ...w, title: "통합", fixed: true })
        continue
      }
      if (!w.title) continue
      if (seen.has(w.title)) continue
      seen.add(w.title)
      deduped.push({ ...w, fixed: Boolean(w.fixed) })
    }
    if (!hasAll) deduped.unshift(DEFAULT_WINDOWS[0])
    return deduped
  } catch {
    return DEFAULT_WINDOWS
  }
  }

  function saveWindows(ws, storageKey) {
  try {
    const normalized = (Array.isArray(ws) ? ws : []).map((w) => ({
      ...w,
      color: normalizeWindowColor(w?.color) || "#2563eb"
    }))
    localStorage.setItem(storageKey ?? WINDOWS_KEY, JSON.stringify(normalized))
  } catch (err) { void err }
  }

  function hashAuthIdentifier(value = "") {
    let left = 0x811c9dc5
    let right = 0x9e3779b9
    const text = String(value ?? "")
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i)
      left ^= code
      left = Math.imul(left, 0x01000193) >>> 0
      right ^= code + 0x9e37
      right = Math.imul(right, 0x85ebca6b) >>> 0
    }
    return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`
  }

  function isValidAuthEmail(value = "") {
    const text = String(value ?? "").trim()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
  }

  function resolveAuthIdentifier(value = "") {
    const raw = String(value ?? "").trim()
    if (!raw) return { input: "", email: "", isEmail: false }
    if (isValidAuthEmail(raw)) {
      const normalizedEmail = raw.toLowerCase()
      return { input: raw, email: normalizedEmail, isEmail: true }
    }
    const normalizedId = raw.toLowerCase()
    return {
      input: raw,
      email: `id_${hashAuthIdentifier(normalizedId)}@${AUTH_IDENTIFIER_EMAIL_DOMAIN}`,
      isEmail: false
    }
  }

  // ===== Supabase (웹-앱 데이터 연동) =====
  const [session, setSession] = useState(null)
  const [authMode, setAuthMode] = useState("signIn") // "signIn" | "signUp"
  const [authEmail, setAuthEmail] = useState("")
  const [authPassword, setAuthPassword] = useState("")
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("")
  const [authLoading, setAuthLoading] = useState(false)
  const [authMessage, setAuthMessage] = useState("")
  const [loginModalOpen, setLoginModalOpen] = useState(false)
  const [rememberCredentials, setRememberCredentials] = useState(false)
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false)
  const [signupTermsAgreed, setSignupTermsAgreed] = useState(false)
  const [signupPrivacyAgreed, setSignupPrivacyAgreed] = useState(false)
  const [signupUpdatesAgreed, setSignupUpdatesAgreed] = useState(false)
  const [signupDetailsOpen, setSignupDetailsOpen] = useState(false)

  function persistCredentials(email) {
    if (typeof window === "undefined") return
    try {
      localStorage.setItem(REMEMBER_CREDENTIALS_KEY, JSON.stringify({ email }))
    } catch {
      /* ignore */
    }
  }

  function clearPersistedCredentials() {
    if (typeof window === "undefined") return
    try {
      localStorage.removeItem(REMEMBER_CREDENTIALS_KEY)
    } catch {
      /* ignore */
    }
  }

  function closeLoginModal() {
    setLoginModalOpen(false)
    setAuthMessage("")
    setAuthPasswordConfirm("")
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = localStorage.getItem(REMEMBER_CREDENTIALS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      const email = typeof parsed?.email === "string" ? parsed.email : ""
      if (email) setAuthEmail(email)
      if (email) setRememberCredentials(true)
    } catch {
      /* ignore */
    }
  }, [])
  const [remotePlans, setRemotePlans] = useState([])
  const [remoteLoaded, setRemoteLoaded] = useState(false)
  const applyingRemoteRef = useRef(false)
  const syncTimerRef = useRef(null)
  const lastCloudSyncRef = useRef({ year: null, text: "" })
  const forceRemoteApplyRef = useRef(false)
  const lastSessionIdRef = useRef(null)
  const remotePlansLoadSeqRef = useRef(0)
  const remotePlansIgnoreLoadsUntilRef = useRef(0)
  const openEndedRecurringSyncRef = useRef(false)
  const [remoteWindows, setRemoteWindows] = useState([])
  const [remoteWindowsLoaded, setRemoteWindowsLoaded] = useState(false)
  const applyingRemoteWindowsRef = useRef(false)
  const windowsSyncTimerRef = useRef(null)
  const hasCloudSession = Boolean(session?.user?.id && supabase)
  const canUseWebRowPlanEdit = Boolean(hasCloudSession && !ENABLE_WEB_TEXT_PLAN_SYNC && ENABLE_WEB_ROW_PLAN_EDIT)
  const isMainMemoReadOnly = Boolean(hasCloudSession && !ENABLE_WEB_TEXT_PLAN_SYNC)
  const isScheduleReadOnly = Boolean(isMainMemoReadOnly && !canUseWebRowPlanEdit)
  const dayListSyncTimerRef = useRef(null)
  const dayListPendingSyncRef = useRef(null)
  const dayListSyncQueueRef = useRef(Promise.resolve())
  const dayListEditGuardRef = useRef({ open: false, mode: "read", dirty: false })
  const sortOrderSupportedRef = useRef(true)
  const sortOrderSyncTimerRef = useRef(null)
  const recurringRulesStorageKey = useMemo(
    () => getRecurringRulesStorageKey(session?.user?.id ?? null),
    [session?.user?.id]
  )
  const recurringOverridesStorageKey = useMemo(
    () => getRecurringOverridesStorageKey(session?.user?.id ?? null),
    [session?.user?.id]
  )
  const recurringCloudMigrationKey = useMemo(
    () => getRecurringCloudMigrationKey(session?.user?.id ?? null),
    [session?.user?.id]
  )
  const [recurringRules, setRecurringRules] = useState(() => loadRecurringList(OFFLINE_RECURRING_RULES_KEY))
  const [recurringOverrides, setRecurringOverrides] = useState(() => loadRecurringList(OFFLINE_RECURRING_OVERRIDES_KEY))
  const [recurringModalState, setRecurringModalState] = useState(null)
  const recurringCloudMigrationRunningRef = useRef(false)
  const [quickCreateModalState, setQuickCreateModalState] = useState(null)

  const [text, setText] = useState("")
  const [today, setToday] = useState(() => new Date())
  const todayKey = useMemo(() => {
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, "0")
    const d = String(today.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }, [today])

  useEffect(() => {
    let timeoutId = null
    let intervalId = null

    const schedule = () => {
      const now = new Date()
      const next = new Date(now)
      next.setHours(24, 0, 0, 0)
      const ms = Math.max(0, next.getTime() - now.getTime())
      timeoutId = setTimeout(() => {
        setToday(new Date())
        intervalId = setInterval(() => setToday(new Date()), 24 * 60 * 60 * 1000)
      }, ms)
    }

    schedule()
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      if (intervalId) clearInterval(intervalId)
    }
  }, [])

  function pickNextWindowColor(ws) {
    const used = new Set(ws.map((w) => normalizeWindowColor(w?.color)).filter(Boolean))
    const available = WINDOW_COLORS.find((c) => !used.has(c))
    return available ?? WINDOW_COLORS[ws.length % WINDOW_COLORS.length]
  }

  function ensureWindowsForCategories(titles) {
    if (!titles || titles.size === 0) return
    setWindows((prev) => {
      const existingTitles = new Set(prev.map((w) => normalizeWindowTitleValue(w.title)))
      let changed = false
      let next = [...prev]
      for (const title of titles) {
        const trimmed = normalizeCategoryId(String(title ?? "").trim())
        if (!trimmed || trimmed === GENERAL_CATEGORY_ID || existingTitles.has(trimmed)) continue
        const color = pickNextWindowColor(next)
        next = [...next, { id: genWindowId(), title: trimmed, color, fixed: false }]
        existingTitles.add(trimmed)
        changed = true
      }
      return changed ? next : prev
    })
  }

  function parsePlanTimestampMs(value) {
    if (value == null) return null
    if (value instanceof Date) {
      const ms = value.getTime()
      return Number.isNaN(ms) ? null : ms
    }
    if (typeof value === "number" && Number.isFinite(value)) return value
    const ms = Date.parse(String(value))
    return Number.isNaN(ms) ? null : ms
  }

  function parsePlanOrderValue(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function normalizeClockTime(value) {
    const match = String(value ?? "")
      .trim()
      .match(/^(\d{1,2}):(\d{2})$/)
    if (!match) return ""
    const hour = Number(match[1])
    const minute = Number(match[2])
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return ""
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return ""
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  }

  function normalizeAlarmLeadMinutes(value) {
    const n = Number.parseInt(String(value ?? "0"), 10)
    if (!Number.isFinite(n) || n < 0) return 0
    return [0, 5, 10, 30].includes(n) ? n : 0
  }

  function parseTimeSpanToken(value) {
    const raw = String(value ?? "").trim()
    if (!raw) return { startTime: "", endTime: "", hasInput: false, isValid: true }
    const single = normalizeClockTime(raw)
    if (single) return { startTime: single, endTime: "", hasInput: true, isValid: true }
    const match = raw.match(/^(\d{1,2}):(\d{2})(?:\s*[~-]\s*|\s+)(\d{1,2}):(\d{2})$/)
    if (!match) return { startTime: "", endTime: "", hasInput: true, isValid: false }
    const startTime = normalizeClockTime(`${match[1]}:${match[2]}`)
    const endTime = normalizeClockTime(`${match[3]}:${match[4]}`)
    if (!startTime) return { startTime: "", endTime: "", hasInput: true, isValid: false }
    if (!endTime || endTime === startTime) return { startTime, endTime: "", hasInput: true, isValid: false }
    return { startTime, endTime, hasInput: true, isValid: true }
  }

  function parseLeadingPlanTimeText(value) {
    const raw = String(value ?? "").trim()
    if (!raw) return null
    const match = raw.match(/^(\d{1,2}:\d{2})(?:(?:\s*[~-]\s*|\s+)(\d{1,2}:\d{2}))?(?:\s*;\s*|\s+)(.+)$/)
    if (!match) return null
    const timeToken = match[2] ? `${match[1]}-${match[2]}` : match[1]
    const parsed = parseTimeSpanToken(timeToken)
    const content = String(match[3] ?? "").trim()
    if (!parsed.isValid || !parsed.startTime || !content) return null
    return {
      time: parsed.startTime,
      end_time: parsed.endTime || null,
      content
    }
  }

  function normalizePlanTimeFields(row) {
    const parsedFromTime = parseTimeSpanToken(row?.time)
    const explicitEnd = normalizeClockTime(row?.end_time ?? row?.endTime)
    const startTime = parsedFromTime.startTime
    if (!startTime) return { time: null, end_time: null }
    if (!endTimeSupportedRef.current) return { time: startTime, end_time: null }
    let endTime = explicitEnd || parsedFromTime.endTime
    if (endTime && endTime === startTime) endTime = ""
    return { time: startTime, end_time: endTime || null }
  }

  function buildTimeSpanLabel(time, endTime) {
    const start = normalizeClockTime(time)
    if (!start) return ""
    const end = normalizeClockTime(endTime)
    if (end && end !== start) return `${start}-${end}`
    return start
  }

  function genSeriesId() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
      const r = Math.floor(Math.random() * 16)
      const v = ch === "x" ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  function dateToKey(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  function getDefaultWeeklyDaysForDate(dateKey) {
    const key = String(dateKey ?? "").trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return []
    const { y, m, d } = keyToYMD(key)
    return [dayOfWeek(y, m, d)]
  }

  function getOpenEndedRepeatHorizonDateKey(baseDate = new Date(), lookaheadDays = OPEN_ENDED_REPEAT_LOOKAHEAD_DAYS) {
    const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate())
    start.setDate(start.getDate() + Math.max(1, Number(lookaheadDays) || OPEN_ENDED_REPEAT_LOOKAHEAD_DAYS))
    return dateToKey(start)
  }

  function getOpenEndedRepeatSpanDays(startDateKey, baseDate = new Date(), lookaheadDays = OPEN_ENDED_REPEAT_LOOKAHEAD_DAYS) {
    const startMs = keyToTime(startDateKey)
    if (!Number.isFinite(startMs)) return 365
    const horizonMs = keyToTime(getOpenEndedRepeatHorizonDateKey(baseDate, lookaheadDays))
    const diffDays = Math.ceil((horizonMs - startMs) / (24 * 60 * 60 * 1000))
    return Math.max(365, diffDays)
  }

  function normalizeRepeatMeta(row) {
    const repeatType = normalizeRepeatType(row?.repeat_type ?? row?.repeatType)
    const repeatInterval = repeatType === "none" ? 1 : normalizeRepeatInterval(row?.repeat_interval ?? row?.repeatInterval)
    const repeatDays = repeatType === "weekly" ? normalizeRepeatDays(row?.repeat_days ?? row?.repeatDays) : []
    const repeatUntil = repeatType === "none" ? "" : String(row?.repeat_until ?? row?.repeatUntil ?? "").trim()
    const seriesId = String(row?.series_id ?? row?.seriesId ?? "").trim()
    return { repeatType, repeatInterval, repeatDays, repeatUntil, seriesId }
  }

  function isRecurringPlanRow(row) {
    const repeatMeta = normalizeRepeatMeta(row)
    return repeatMeta.repeatType !== "none" || Boolean(repeatMeta.seriesId)
  }

  function buildRecurringRawLineFromPlanRow(row) {
    const taskAware = stripTaskSuffix(String(row?.content ?? "").trim())
    const baseText = String(taskAware.text ?? "").trim()
    if (!baseText) return ""
    const normalizedTime = normalizePlanTimeFields(row)
    const timeLabel = buildTimeSpanLabel(normalizedTime.time, normalizedTime.end_time)

    const parts = []
    if (timeLabel) parts.push(timeLabel)
    parts.push(baseText)

    return buildTaskMetaText(parts.join(";"), {
      completed: taskAware.completed
    })
  }

  function getNextSortOrderForDate(dateKey, planRows, excludedIds = null) {
    if (!sortOrderSupportedRef.current) return null
    const key = String(dateKey ?? "").trim()
    if (!key) return null
    const excludeSet = excludedIds instanceof Set ? excludedIds : null
    const list = (planRows ?? []).filter((row) => {
      if (!row || row?.deleted_at) return false
      if (String(row?.date ?? "").trim() !== key) return false
      const id = String(row?.id ?? "").trim()
      if (excludeSet && id && excludeSet.has(id)) return false
      return true
    })
    if (list.length === 0) return 0
    const values = list
      .map((row) => parsePlanOrderValue(row?.sort_order ?? row?.sortOrder ?? row?.order))
      .filter((n) => n != null)
    if (values.length === 0) return null
    return Math.max(...values) + 1
  }

  function comparePlanRowsForDefaultInsert(a, b) {
    const sortA = parsePlanOrderValue(a?.sort_order ?? a?.sortOrder ?? a?.order)
    const sortB = parsePlanOrderValue(b?.sort_order ?? b?.sortOrder ?? b?.order)
    if (sortA != null || sortB != null) {
      if (sortA == null) return 1
      if (sortB == null) return -1
      if (sortA !== sortB) return sortA - sortB
    }
    const timeA = buildTimeSpanLabel(a?.time, a?.end_time ?? a?.endTime)
    const timeB = buildTimeSpanLabel(b?.time, b?.end_time ?? b?.endTime)
    if (timeA && timeB && timeA !== timeB) return timeA.localeCompare(timeB)
    if (timeA && !timeB) return -1
    if (!timeA && timeB) return 1
    const createdA = parsePlanTimestampMs(a?.created_at ?? a?.createdAt)
    const createdB = parsePlanTimestampMs(b?.created_at ?? b?.createdAt)
    if (createdA != null || createdB != null) {
      if (createdA == null) return 1
      if (createdB == null) return -1
      if (createdA !== createdB) return createdA - createdB
    }
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""), "en")
  }

  function compareTimedPlanRowsByStart(a, b) {
    const normalizedA = normalizePlanTimeFields(a)
    const normalizedB = normalizePlanTimeFields(b)
    const timeA = String(normalizedA?.time ?? "").trim()
    const timeB = String(normalizedB?.time ?? "").trim()
    if (timeA && timeB && timeA !== timeB) return timeA.localeCompare(timeB)
    if (timeA && !timeB) return -1
    if (!timeA && timeB) return 1
    const endA = String(normalizedA?.end_time ?? "").trim()
    const endB = String(normalizedB?.end_time ?? "").trim()
    if (endA && endB && endA !== endB) return endA.localeCompare(endB)
    if (endA && !endB) return -1
    if (!endA && endB) return 1
    return comparePlanRowsForDefaultInsert(a, b)
  }

  function enforceTimedPlanOrderInSlots(rows) {
    const list = Array.isArray(rows) ? rows : []
    if (list.length <= 1) return list
    const timedRows = list
      .filter((row) => String(normalizePlanTimeFields(row)?.time ?? "").trim())
      .sort(compareTimedPlanRowsByStart)
    if (timedRows.length <= 1) return list
    let timedIndex = 0
    return list.map((row) =>
      String(normalizePlanTimeFields(row)?.time ?? "").trim() ? timedRows[timedIndex++] ?? row : row
    )
  }

  function buildDefaultInsertSortPlan(dateKey, planRows, nextRow) {
    if (!sortOrderSupportedRef.current) return null
    const key = String(dateKey ?? "").trim()
    if (!key) return null
    const rows = (planRows ?? [])
      .filter((row) => {
        if (!row || row?.deleted_at) return false
        return String(row?.date ?? "").trim() === key
      })
      .sort(comparePlanRowsForDefaultInsert)
    const nextTime = buildTimeSpanLabel(nextRow?.time, nextRow?.end_time ?? nextRow?.endTime)
    let insertIndex = rows.length
    if (nextTime) {
      const earlierTimedIndex = rows.findIndex((row) => {
        const rowTime = buildTimeSpanLabel(row?.time, row?.end_time ?? row?.endTime)
        return rowTime && rowTime.localeCompare(nextTime) > 0
      })
      if (earlierTimedIndex >= 0) {
        insertIndex = earlierTimedIndex
      } else {
        const lastTimedIndex = rows.reduce((last, row, idx) => {
          const rowTime = buildTimeSpanLabel(row?.time, row?.end_time ?? row?.endTime)
          return rowTime ? idx : last
        }, -1)
        insertIndex = lastTimedIndex >= 0 ? lastTimedIndex + 1 : 0
      }
    }
    const updates = rows
      .map((row, index) => {
        const rowId = String(row?.id ?? "").trim()
        if (!rowId) return null
        const order = index >= insertIndex ? index + 1 : index
        return { id: rowId, order }
      })
      .filter(Boolean)
    return { sortOrder: insertIndex, updates }
  }

  function buildCloudRecurringByDate(planRows, year, categoryFilter = null) {
    const yearPrefix = `${year}-`
    const familyRange = new Map()

    for (const row of planRows ?? []) {
      if (!row || row?.deleted_at || !isRecurringPlanRow(row)) continue
      const dateKey = String(row?.date ?? "").trim()
      if (!dateKey) continue
      const repeatMeta = normalizeRepeatMeta(row)
      const familyId = repeatMeta.seriesId || String(row?.id ?? "").trim()
      if (!familyId) continue
      const untilDateKey = repeatMeta.repeatUntil || dateKey
      const current = familyRange.get(familyId)
      if (!current) {
        familyRange.set(familyId, { startDateKey: dateKey, untilDateKey })
        continue
      }
      if (keyToTime(dateKey) < keyToTime(current.startDateKey)) current.startDateKey = dateKey
      if (keyToTime(untilDateKey) > keyToTime(current.untilDateKey)) current.untilDateKey = untilDateKey
    }

    const out = {}
    for (const row of planRows ?? []) {
      if (!row || row?.deleted_at || !isRecurringPlanRow(row)) continue
      const dateKey = String(row?.date ?? "").trim()
      if (!dateKey.startsWith(yearPrefix)) continue

      const rawLine = buildRecurringRawLineFromPlanRow(row)
      if (!rawLine) continue

      let categoryTitle = normalizeCategoryId(String(row?.category_id ?? "").trim())
      if (isGeneralCategoryId(categoryTitle)) categoryTitle = ""
      if (categoryFilter) {
        if (!categoryTitle || categoryTitle !== categoryFilter) continue
      }

      const repeatMeta = normalizeRepeatMeta(row)
      const familyId = repeatMeta.seriesId || String(row?.id ?? "").trim()
      const family = familyRange.get(familyId) ?? {
        startDateKey: dateKey,
        untilDateKey: repeatMeta.repeatUntil || dateKey
      }

      ;(out[dateKey] ??= []).push({
        id: `rec-plan-${String(row?.id ?? familyId)}`,
        planId: row?.id,
        row,
        ruleId: String(row?.id ?? "").trim(),
        familyId,
        dateKey,
        repeat: repeatMeta.repeatType,
        repeatInterval: repeatMeta.repeatInterval,
        repeatDays: repeatMeta.repeatDays,
        rawLine,
        display: "",
        time: "",
        title: categoryTitle,
        text: "",
        createdAt: String(row?.created_at ?? row?.createdAt ?? "").trim(),
        updatedAt: String(row?.updated_at ?? row?.updatedAt ?? "").trim(),
        familyStartDateKey: family.startDateKey,
        familyUntilDateKey: family.untilDateKey,
        repeatUntilKey: repeatMeta.repeatUntil || ""
      })
    }

    for (const dateKey of Object.keys(out)) {
      out[dateKey].sort((a, b) => {
        const rowA = a?.row ?? null
        const rowB = b?.row ?? null
        const sortA = parsePlanOrderValue(rowA?.sort_order ?? rowA?.sortOrder ?? rowA?.order)
        const sortB = parsePlanOrderValue(rowB?.sort_order ?? rowB?.sortOrder ?? rowB?.order)
        if (sortA != null || sortB != null) {
          if (sortA == null) return 1
          if (sortB == null) return -1
          if (sortA !== sortB) return sortA - sortB
        }
        const timeA = buildTimeSpanLabel(rowA?.time, rowA?.end_time ?? rowA?.endTime)
        const timeB = buildTimeSpanLabel(rowB?.time, rowB?.end_time ?? rowB?.endTime)
        if (timeA && timeB && timeA !== timeB) return timeA.localeCompare(timeB)
        if (timeA && !timeB) return -1
        if (!timeA && timeB) return 1
        const createdA = parsePlanTimestampMs(rowA?.created_at ?? rowA?.createdAt)
        const createdB = parsePlanTimestampMs(rowB?.created_at ?? rowB?.createdAt)
        if (createdA != null || createdB != null) {
          if (createdA == null) return 1
          if (createdB == null) return -1
          if (createdA !== createdB) return createdA - createdB
        }
        return String(rowA?.id ?? "").localeCompare(String(rowB?.id ?? ""), "en")
      })
    }

    return out
  }

  function isSortOrderColumnError(error) {
    const msg = String(error?.message ?? "").toLowerCase()
    return msg.includes("sort_order") || (msg.includes("column") && msg.includes("sort") && msg.includes("order"))
  }

  function isEndTimeColumnError(error) {
    const msg = String(error?.message ?? "").toLowerCase()
    return msg.includes("end_time") || (msg.includes("column") && msg.includes("end") && msg.includes("time"))
  }

  function isRepeatColumnError(error) {
    const msg = String(error?.message ?? "").toLowerCase()
    if (!msg) return false
    return (
      msg.includes("repeat_type") ||
      msg.includes("repeat_interval") ||
      msg.includes("repeat_days") ||
      msg.includes("repeat_until") ||
      msg.includes("series_id") ||
      msg.includes("invalid input syntax for type uuid")
    )
  }

  function isAlarmColumnError(error) {
    const msg = String(error?.message ?? "").toLowerCase()
    if (!msg) return false
    return (
      msg.includes("alarm_enabled") ||
      msg.includes("alarm_lead_minutes") ||
      (msg.includes("column") && msg.includes("alarm"))
    )
  }

  function markRepeatFallbackNotice() {
    if (!repeatColumnsSupportedRef.current) return
    repeatColumnsSupportedRef.current = false
    setAuthMessage("반복 일정 DB 컬럼이 없어 웹 반복 일정은 기기 간 동기화되지 않습니다. SQL 마이그레이션을 먼저 적용해야 합니다.")
  }

  function isRightMemoMetaColumnError(error) {
    const msg = String(error?.message ?? "").toLowerCase()
    if (!msg) return false
    return (
      msg.includes("right_memos") &&
      (msg.includes("client_id") || msg.includes("updated_at") || (msg.includes("column") && msg.includes("memo")))
    )
  }

  function stripEndTimeFromRows(rows) {
    const list = Array.isArray(rows) ? rows : []
    return list.map((row) => {
      const next = { ...(row ?? {}) }
      delete next.end_time
      return next
    })
  }

  function stripSortOrderFromRows(rows) {
    const list = Array.isArray(rows) ? rows : []
    return list.map((row) => {
      const next = { ...(row ?? {}) }
      delete next.sort_order
      return next
    })
  }

  function stripAlarmFromRows(rows) {
    const list = Array.isArray(rows) ? rows : []
    return list.map((row) => {
      const next = { ...(row ?? {}) }
      delete next.alarm_enabled
      delete next.alarm_lead_minutes
      return next
    })
  }

  function buildPlanContentWithMeta(
    baseText,
    { completed = null } = {}
  ) {
    return buildTaskMetaText(baseText, { completed })
  }

  function pushExtractedPlanRow(out, { dateKey, time = "", title = "", rawText = "", order = 0 } = {}) {
    const taskAware = stripTaskSuffix(rawText)
    const text = String(taskAware.text ?? "").trim()
    if (!text) return
    const normalizedTitle = normalizeCategoryId(String(title ?? "").trim())
    const timeFields = normalizePlanTimeFields({ time: String(time ?? "").trim() })
    out.push({
      date: String(dateKey ?? "").trim(),
      time: timeFields.time,
      end_time: timeFields.end_time,
      category_id: normalizedTitle || GENERAL_CATEGORY_ID,
      content: buildPlanContentWithMeta(text, {
        completed: taskAware.completed
      }),
      sort_order: Number.isFinite(order) ? order : 0
    })
  }

  function buildPlanOrderMapFromText(sourceText, year) {
    const map = new Map()
    const extracted = extractPlansFromText(sourceText ?? "", year)
    for (const row of extracted) {
      const key = buildPlanKey(row)
      if (!key || map.has(key)) continue
      const order = Number.isFinite(row?.sort_order) ? row.sort_order : map.size
      map.set(key, order)
    }
    return map
  }

  function buildTextFromPlans(plans, year, previousText = "") {
    const yearPrefix = `${year}-`
    const orderMap = buildPlanOrderMapFromText(previousText, year)

    const byDate = new Map()
    let rowIndex = 0
    for (const row of plans ?? []) {
      if (row?.deleted_at) continue
      if (isRecurringPlanRow(row)) continue
      const dateKey = String(row?.date ?? "")
      if (!dateKey.startsWith(yearPrefix)) continue
      const taskAware = stripTaskSuffix(row?.content)
      const baseContent = String(taskAware.text ?? "").trim()
      if (!baseContent) continue
      const category = normalizeCategoryId(String(row?.category_id ?? "").trim())
      const isGeneral = isGeneralCategoryId(category)
      const normalizedTime = normalizePlanTimeFields(row)
      const time = normalizedTime.time ?? ""
      const endTime = normalizedTime.end_time ?? ""
      const timeLabel = buildTimeSpanLabel(time, endTime)
      const categoryId = isGeneral ? GENERAL_CATEGORY_ID : category
      const content = buildPlanContentWithMeta(baseContent, {
        completed: taskAware.completed
      })
      const sortOrder = parsePlanOrderValue(row?.sort_order ?? row?.sortOrder ?? row?.order)
      const createdAtMs = parsePlanTimestampMs(row?.created_at ?? row?.createdAt)
      const updatedAtMs = parsePlanTimestampMs(row?.updated_at ?? row?.updatedAt)
      const key = buildPlanKey({ date: dateKey, time, end_time: endTime, category_id: categoryId, content })
      const preservedOrder = orderMap.has(key) ? orderMap.get(key) : null
      const bucket = byDate.get(dateKey) ?? []
      bucket.push({
        time,
        endTime,
        timeLabel,
        category: isGeneral ? "" : category,
        categoryId,
        content,
        baseContent,
        isTask: taskAware.completed != null,
        taskCompleted: Boolean(taskAware.completed),
        isGeneral,
        order: preservedOrder,
        sortOrder,
        createdAtMs,
        updatedAtMs,
        id: row?.id,
        idx: rowIndex++
      })
      byDate.set(dateKey, bucket)
    }

    const sortedDates = [...byDate.keys()].sort((a, b) => keyToTime(a) - keyToTime(b))
    const blocks = sortedDates.map((dateKey) => {
      const { m, d } = keyToYMD(dateKey)
      const header = buildHeaderLine(year, m, d)
      const items = byDate.get(dateKey) ?? []
      items.sort((a, b) => {
        const sa = a.sortOrder
        const sb = b.sortOrder
        if (sa != null || sb != null) {
          if (sa == null) return 1
          if (sb == null) return -1
          if (sa !== sb) return sa - sb
        }
        const oa = a.order
        const ob = b.order
        if (oa != null || ob != null) {
          if (oa == null) return 1
          if (ob == null) return -1
          if (oa !== ob) return oa - ob
        }
        const ca = a.createdAtMs
        const cb = b.createdAtMs
        if (ca != null || cb != null) {
          if (ca == null) return 1
          if (cb == null) return -1
          if (ca !== cb) return ca - cb
        }
        const ua = a.updatedAtMs
        const ub = b.updatedAtMs
        if (ua != null || ub != null) {
          if (ua == null) return 1
          if (ub == null) return -1
          if (ua !== ub) return ua - ub
        }
        const ia = a.id != null ? String(a.id) : ""
        const ib = b.id != null ? String(b.id) : ""
        if (ia && ib && ia !== ib) return ia.localeCompare(ib, "en")
        if (ia && !ib) return -1
        if (!ia && ib) return 1
        return (a.idx ?? 0) - (b.idx ?? 0)
      })
      const lines = items.map((item) => {
        const baseLine = item.isGeneral
          ? item.timeLabel
            ? `${item.timeLabel};${item.baseContent}`
            : item.baseContent
          : item.timeLabel
            ? `${item.timeLabel};@${item.category};${item.baseContent}`
            : `@${item.category};${item.baseContent}`
        let line = baseLine
        if (item.isTask) line += `;${item.taskCompleted ? "O" : "X"}`
        return line
      })
      return lines.length > 0 ? `${header}\n${lines.join("\n")}` : header
    })
    return blocks.join("\n\n").trimEnd()
  }

  function extractPlansFromText(sourceText, year) {
    const out = []
    const parsed = parseBlocksAndItems(sourceText ?? "", year)
    for (const block of parsed.blocks) {
      const body = normalizeGroupLineNewlines(
        (sourceText ?? "")
          .slice(block.bodyStartPos, block.blockEndPos)
      )
      const lines = body.split("\n")
      let order = 0
      for (const rawLine of lines) {
        const trimmed = String(rawLine ?? "").trim()
        if (!trimmed) continue

        const semicolon = parseDashboardSemicolonLine(trimmed)
        if (semicolon) {
          pushExtractedPlanRow(out, {
            dateKey: block.dateKey,
            time: semicolon.time || "",
            title: semicolon.group ?? "",
            rawText: semicolon.text,
            order
          })
          order += 1
          continue
        }

        const emptySemicolon = parseDashboardSemicolonLine(trimmed, { allowEmptyText: true })
        if (emptySemicolon && !emptySemicolon.text) continue

        const match = trimmed.match(groupLineRegex)
        if (match) {
          const title = normalizeCategoryId(String(match[1] ?? "").trim())
          if (!title) continue
          const items = String(match[2] ?? "")
            .split(";")
            .map((x) => x.trim())
            .filter((x) => x !== "")
          for (const item of items) {
            const parsedItem = parseLeadingTimeDashboardLine(item)
            pushExtractedPlanRow(out, {
              dateKey: block.dateKey,
              time: parsedItem ? parsedItem.time : "",
              title: parsedItem?.group || title,
              rawText: parsedItem ? parsedItem.text : item,
              order
            })
            order += 1
          }
          continue
        }

        const timeLine = parseLeadingTimeDashboardLine(trimmed)
        if (timeLine) {
          pushExtractedPlanRow(out, {
            dateKey: block.dateKey,
            time: timeLine.time || "",
            title: timeLine.group ?? "",
            rawText: timeLine.text,
            order
          })
          order += 1
          continue
        }

        pushExtractedPlanRow(out, {
          dateKey: block.dateKey,
          rawText: trimmed,
          order
        })
        order += 1
      }
    }
    return out
  }

  function buildPlanKey(row) {
    const date = String(row?.date ?? "").trim()
    const normalizedTime = normalizePlanTimeFields(row)
    const time = String(normalizedTime.time ?? "").trim()
    const endTime = String(normalizedTime.end_time ?? "").trim()
    let category = normalizeCategoryId(String(row?.category_id ?? row?.categoryId ?? "").trim())
    if (!category) category = GENERAL_CATEGORY_ID
    const content = String(row?.content ?? row?.text ?? "").trim()
    return `${date}|${time}|${endTime}|${category}|${content}`
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      String(value ?? "")
    )
  }

  function suspendRemotePlansLoads(ms = 2500) {
    remotePlansIgnoreLoadsUntilRef.current = Math.max(remotePlansIgnoreLoadsUntilRef.current, Date.now() + ms)
  }

  async function loadRemotePlans(userId, options = {}) {
    if (!supabase) return
    const force = Boolean(options?.force)
    const requestSeq = ++remotePlansLoadSeqRef.current
    const blockedUntilAtStart = remotePlansIgnoreLoadsUntilRef.current
    const { data, error } = await supabase
      .from("plans")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
    if (error) {
      console.error("load plans", error)
      return
    }
    if (requestSeq !== remotePlansLoadSeqRef.current) return
    if (
      !force &&
      (blockedUntilAtStart !== remotePlansIgnoreLoadsUntilRef.current ||
        Date.now() < remotePlansIgnoreLoadsUntilRef.current)
    ) {
      return
    }
    const updates = []
    const rows = (data ?? []).map((row) => {
      let normalized = normalizeCategoryId(row?.category_id)
      if (!normalized) normalized = GENERAL_CATEGORY_ID
      const timeFields = normalizePlanTimeFields(row)
      if (normalized && normalized !== row?.category_id) {
        updates.push({ id: row.id, category_id: normalized })
      }
      return { ...row, category_id: normalized, time: timeFields.time, end_time: timeFields.end_time }
    })
    if (updates.length > 0) {
      await Promise.all(
        updates.map((item) =>
          supabase.from("plans").update({ category_id: item.category_id }).eq("id", item.id).eq("user_id", userId)
        )
      )
    }
    setRemotePlans(rows)
    setRemoteLoaded(true)
    const titles = new Set(rows.map((row) => String(row.category_id ?? "").trim()).filter(Boolean))
    ensureWindowsForCategories(titles)
    ensureOpenEndedRecurringCoverage(userId, rows)
      .then((changed) => {
        if (!changed) return
        loadRemotePlans(userId, { force: true }).catch(() => {})
      })
      .catch(() => {})
  }

  async function loadRemoteWindows(userId) {
    if (!supabase) return
    const { data, error } = await supabase
      .from("windows")
      .select("*")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
    if (error) {
      console.error("load windows", error)
      return
    }

    const rows = (data ?? []).filter((row) => row && row.title).map((row) => ({
      id: row.id,
      title: normalizeWindowTitleValue(row.title),
      color: normalizeWindowColor(typeof row.color === "string" ? row.color : "#2563eb") || "#2563eb",
      fixed: Boolean(row.is_fixed)
    }))

    const seen = new Set()
    const normalized = []
    for (const w of rows) {
      if (!w.title) continue
      if (seen.has(w.title)) continue
      seen.add(w.title)
      normalized.push(w)
    }

    const nextWindows = [DEFAULT_WINDOWS[0], ...normalized]
    const currentActiveId = activeWindowId
    const currentActiveTitle =
      currentActiveId && currentActiveId !== "all"
        ? normalizeWindowTitleValue(windows.find((w) => w.id === currentActiveId)?.title)
        : null
    const nextActiveById = nextWindows.some((w) => w.id === currentActiveId) ? currentActiveId : null
    const nextActiveByTitle =
      currentActiveTitle &&
      nextWindows.find((w) => w.id !== "all" && w.title === currentActiveTitle)?.id
    const nextActiveId = nextActiveById ?? nextActiveByTitle ?? "all"

    applyingRemoteWindowsRef.current = true
    setRemoteWindows(rows)
    setRemoteWindowsLoaded(true)
    setWindows(nextWindows)
    setActiveWindowId(nextActiveId)
    setTimeout(() => {
      applyingRemoteWindowsRef.current = false
    }, 0)
  }

  async function syncWindowsToSupabase(nextWindows) {
    if (!supabase || !session?.user?.id || !remoteWindowsLoaded) return
    const userId = session.user.id
    const activeIdSnapshot = activeWindowId
    const activeTitleSnapshot =
      activeIdSnapshot && activeIdSnapshot !== "all"
        ? normalizeWindowTitleValue((nextWindows ?? windows).find((w) => w.id === activeIdSnapshot)?.title)
        : null
    const desired = (nextWindows ?? [])
      .filter((w) => w && w.id !== "all")
      .map((w, idx) => ({
        id: isUuid(w.id) ? w.id : null,
        title: normalizeWindowTitleValue(w.title),
        color: normalizeWindowColor(typeof w.color === "string" ? w.color : "#2563eb") || "#2563eb",
        sort_order: idx,
        is_fixed: Boolean(w.fixed)
      }))
      .filter((w) => w.title)

    const remoteById = new Map((remoteWindows ?? []).map((row) => [row.id, row]))
    const desiredIds = new Set(desired.map((w) => w.id).filter(Boolean))

    const toInsert = desired
      .filter((w) => !w.id || !remoteById.has(w.id))
      .map((w) => ({
        user_id: userId,
        title: w.title,
        color: w.color,
        sort_order: w.sort_order,
        is_fixed: w.is_fixed
      }))

    const toUpdate = desired
      .filter((w) => w.id && remoteById.has(w.id))
      .map((w) => ({
        id: w.id,
        user_id: userId,
        title: w.title,
        color: w.color,
        sort_order: w.sort_order,
        is_fixed: w.is_fixed
      }))

    const toDelete = (remoteWindows ?? []).filter((row) => !desiredIds.has(row.id))

    let insertedRows = []
    if (toInsert.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from("windows")
        .insert(toInsert)
        .select()
      if (insertError) {
        console.error("insert windows", insertError)
        return
      }
      insertedRows = inserted ?? []
    }

    if (toUpdate.length > 0) {
      const { error: updateError } = await supabase.from("windows").upsert(toUpdate)
      if (updateError) {
        console.error("update windows", updateError)
        return
      }
    }

    if (toDelete.length > 0) {
      const ids = toDelete.map((row) => row.id)
      const { error: deleteError } = await supabase
        .from("windows")
        .delete()
        .in("id", ids)
        .eq("user_id", userId)
      if (deleteError) {
        console.error("delete windows", deleteError)
        return
      }
    }

    if (insertedRows.length > 0) {
      const insertedIdByTitle = new Map(
        insertedRows.map((row) => [normalizeWindowTitleValue(row.title), row.id])
      )
      applyingRemoteWindowsRef.current = true
      setWindows((prev) => {
        let next = [...prev]
        for (const row of insertedRows) {
          const title = normalizeWindowTitleValue(row.title)
          const idx = next.findIndex((w) => w.id !== "all" && w.title === title && !isUuid(w.id))
          if (idx >= 0) {
            next[idx] = { ...next[idx], id: row.id }
          }
        }
        return next
      })
      if (activeTitleSnapshot && insertedIdByTitle.has(activeTitleSnapshot)) {
        const nextActiveId = insertedIdByTitle.get(activeTitleSnapshot)
        if (nextActiveId && activeIdSnapshot && !isUuid(activeIdSnapshot)) {
          setActiveWindowId(nextActiveId)
        }
      }
      setTimeout(() => {
        applyingRemoteWindowsRef.current = false
      }, 0)
    }

    const mergedRemote = (() => {
      const removed = new Set(toDelete.map((row) => row.id))
      const base = (remoteWindows ?? []).filter((row) => !removed.has(row.id))
      const updated = new Map(toUpdate.map((row) => [row.id, row]))
      const next = base.map((row) => (updated.has(row.id) ? { ...row, ...updated.get(row.id) } : row))
      for (const row of insertedRows) next.push(row)
      return next
    })()
    setRemoteWindows(mergedRemote)
  }

  function scheduleWindowsSync(nextWindows) {
    if (!supabase || !session?.user?.id || !remoteWindowsLoaded) return
    if (applyingRemoteWindowsRef.current) return
    if (windowsSyncTimerRef.current) clearTimeout(windowsSyncTimerRef.current)
    windowsSyncTimerRef.current = setTimeout(() => {
      syncWindowsToSupabase(nextWindows)
    }, 500)
  }

  async function syncYearToSupabase(sourceText, year) {
    if (!ENABLE_WEB_TEXT_PLAN_SYNC) return
    if (!supabase || !session?.user?.id) return
    const userId = session.user.id
    pushSyncBackup(userId, year, sourceText ?? "", "pre-sync")
    const desired = extractPlansFromText(sourceText ?? "", year)
    const baseMs = Date.now()
    const desiredMap = new Map()
    for (const row of desired) {
      const key = buildPlanKey(row)
      if (!key || desiredMap.has(key)) continue
      desiredMap.set(key, row)
    }

    const yearPrefix = `${year}-`
    const current = (remotePlans ?? []).filter(
      (row) =>
        row &&
        row.user_id === userId &&
        !row.deleted_at &&
        String(row?.date ?? "").startsWith(yearPrefix)
    )
    const currentMap = new Map()
    const duplicateRows = []
    for (const row of current) {
      const key = buildPlanKey(row)
      if (!key) continue
      if (currentMap.has(key)) {
        if (row?.id) duplicateRows.push(row)
        continue
      }
      currentMap.set(key, row)
    }

    const toInsert = []
    for (const [key, row] of desiredMap.entries()) {
      if (currentMap.has(key)) continue
      const desiredOrder = Number.isFinite(row?.sort_order) ? row.sort_order : 0
      toInsert.push({
        ...row,
        user_id: userId,
        client_id: clientIdRef.current,
        updated_at: new Date(baseMs + desiredOrder).toISOString()
      })
    }

    const toUpdate = []
    for (const [key, row] of desiredMap.entries()) {
      const currentRow = currentMap.get(key)
      if (!currentRow?.id) continue
      const desiredOrder = Number(row?.sort_order)
      if (!Number.isFinite(desiredOrder)) continue
      const currentOrder = Number(
        currentRow?.sort_order ?? currentRow?.sortOrder ?? currentRow?.order ?? Number.NaN
      )
      if (Number.isFinite(currentOrder) && desiredOrder === currentOrder) continue
      toUpdate.push({
        id: currentRow.id,
        user_id: userId,
        sort_order: desiredOrder,
        updated_at: new Date(baseMs + desiredOrder).toISOString(),
        client_id: clientIdRef.current
      })
    }

    const removedRows = []
    for (const [key, row] of currentMap.entries()) {
      if (desiredMap.has(key)) continue
      if (row?.id) removedRows.push(row)
    }
    const duplicateDeleteRows = duplicateRows.filter((row) => row?.id)

    let toDelete = [...duplicateDeleteRows]
    if (ENABLE_AUTOMATIC_DIFF_DELETE) {
      toDelete = [...removedRows, ...duplicateDeleteRows]

      // Safety net: never wipe an entire year from an empty/invalid parse result.
      if (currentMap.size > 0 && desiredMap.size === 0 && toInsert.length === 0 && toDelete.length >= currentMap.size) {
        console.warn("sync skipped: refusing to delete all yearly plans from empty parsed text", {
          year,
          currentCount: currentMap.size,
          sourceLength: String(sourceText ?? "").length
        })
        return
      }

      const MAX_AUTO_DELETE_PER_SYNC = 40
      if (removedRows.length > MAX_AUTO_DELETE_PER_SYNC) {
        console.warn("sync delete capped: refusing a large automatic delete batch", {
          year,
          removedCount: removedRows.length,
          duplicateCount: duplicateDeleteRows.length
        })
        // Keep duplicate cleanup, skip mass diff-based deletes.
        toDelete = [...duplicateDeleteRows]
      }
    } else if (removedRows.length > 0) {
      console.warn("auto diff delete disabled: skip removed rows", {
        year,
        removedCount: removedRows.length
      })
    }

    if (toDelete.length > 0) {
      const ids = toDelete.map((row) => row.id)
      const deletedAt = new Date().toISOString()
      const { error: deleteError } = await supabase
        .from("plans")
        .update({ deleted_at: deletedAt, updated_at: deletedAt, client_id: clientIdRef.current })
        .in("id", ids)
        .eq("user_id", userId)
      if (deleteError) {
        console.error("delete plans", deleteError)
        return
      }
    }

    let insertedRows = []
    if (toInsert.length > 0) {
      const rowsForInsert = endTimeSupportedRef.current ? toInsert : stripEndTimeFromRows(toInsert)
      const insertPayload = sortOrderSupportedRef.current ? rowsForInsert : stripSortOrderFromRows(rowsForInsert)
      let { data, error: insertError } = await supabase.from("plans").insert(insertPayload).select()
      if (insertError && isEndTimeColumnError(insertError)) {
        endTimeSupportedRef.current = false
        const retryRows = stripEndTimeFromRows(toInsert)
        const retryPayload = sortOrderSupportedRef.current ? retryRows : stripSortOrderFromRows(retryRows)
        const retry = await supabase.from("plans").insert(retryPayload).select()
        data = retry.data
        insertError = retry.error
      }
      if (insertError && isSortOrderColumnError(insertError)) {
        sortOrderSupportedRef.current = false
        const retryRows = endTimeSupportedRef.current ? toInsert : stripEndTimeFromRows(toInsert)
        const retry = await supabase.from("plans").insert(stripSortOrderFromRows(retryRows)).select()
        data = retry.data
        insertError = retry.error
      }
      if (insertError) {
        console.error("insert plans", insertError)
        return
      }
      insertedRows = (data ?? []).map((row) => ({
        ...row,
        ...normalizePlanTimeFields(row),
        category_id: normalizeCategoryId(row?.category_id)
      }))
    }

    if (toUpdate.length > 0 && sortOrderSupportedRef.current) {
      const chunkSize = 200
      for (let i = 0; i < toUpdate.length; i += chunkSize) {
        const chunk = toUpdate.slice(i, i + chunkSize)
        const { error: updateError } = await supabase.from("plans").upsert(chunk, { onConflict: "id" })
        if (updateError) {
          if (isSortOrderColumnError(updateError)) {
            sortOrderSupportedRef.current = false
          } else {
            console.error("update plan order", updateError)
          }
          break
        }
      }
    }

    lastCloudSyncRef.current = { year, text: sourceText ?? "" }
    setRemotePlans((prev) => {
      const removedIds = new Set(toDelete.map((row) => row.id))
      const updateMap = new Map(toUpdate.map((row) => [row.id, row]))
      const base = (prev ?? [])
        .filter((row) => !removedIds.has(row?.id))
        .map((row) => {
          const update = updateMap.get(row?.id)
          if (!update) return row
          return { ...row, sort_order: update.sort_order, updated_at: update.updated_at, client_id: update.client_id }
        })
      return insertedRows.length > 0 ? [...base, ...insertedRows] : base
    })
  }

  function extractPlansFromDayBody(bodyText, dateKey, scopedWindowTitle = null) {
    const out = []
    const scopedTitle = scopedWindowTitle ? normalizeCategoryId(scopedWindowTitle) : null
    const body = normalizeGroupLineNewlines(String(bodyText ?? ""))
    const lines = body.split("\n")
    let order = 0

    for (const rawLine of lines) {
      const trimmed = String(rawLine ?? "").trim()
      if (!trimmed) continue

      const semicolon = parseDashboardSemicolonLine(trimmed)
      if (semicolon) {
        const entryTitle = normalizeCategoryId(String(semicolon.group ?? "").trim())
        if (scopedTitle && entryTitle && entryTitle !== scopedTitle) {
          order += 1
          continue
        }
        pushExtractedPlanRow(out, {
          dateKey,
          time: semicolon.time || "",
          title: scopedTitle || entryTitle || "",
          rawText: semicolon.text,
          order
        })
        order += 1
        continue
      }

      const emptySemicolon = parseDashboardSemicolonLine(trimmed, { allowEmptyText: true })
      if (emptySemicolon && !emptySemicolon.text) continue

      const match = trimmed.match(groupLineRegex)
      if (match) {
        const title = normalizeCategoryId(String(match[1] ?? "").trim())
        if (!title) continue
        const items = String(match[2] ?? "")
          .split(";")
          .map((x) => x.trim())
          .filter((x) => x !== "")
        for (const item of items) {
          const parsedItem = parseLeadingTimeDashboardLine(item)
          if (scopedTitle && title !== scopedTitle) {
            order += 1
            continue
          }
          pushExtractedPlanRow(out, {
            dateKey,
            time: parsedItem ? parsedItem.time : "",
            title: scopedTitle || parsedItem?.group || title,
            rawText: parsedItem ? parsedItem.text : item,
            order
          })
          order += 1
        }
        continue
      }

      const timeLine = parseLeadingTimeDashboardLine(trimmed)
      if (timeLine) {
        const entryTitle = normalizeCategoryId(String(timeLine.group ?? "").trim())
        if (scopedTitle && entryTitle && entryTitle !== scopedTitle) {
          order += 1
          continue
        }
        pushExtractedPlanRow(out, {
          dateKey,
          time: timeLine.time || "",
          title: scopedTitle || entryTitle || "",
          rawText: timeLine.text,
          order
        })
        order += 1
        continue
      }

      pushExtractedPlanRow(out, {
        dateKey,
        title: scopedTitle || "",
        rawText: trimmed,
        order
      })
      order += 1
    }
    return out
  }

  async function syncDayBodyToSupabase(dateKey, bodyText, windowId) {
    if (!canUseWebRowPlanEdit) return
    if (!supabase || !session?.user?.id) return
    const userId = session.user.id
    suspendRemotePlansLoads()
    const scopedWindow =
      windowId && windowId !== "all" ? windows.find((w) => String(w?.id) === String(windowId)) : null
    if (windowId && windowId !== "all" && !scopedWindow) return
    const scopedTitle = scopedWindow ? normalizeCategoryId(scopedWindow.title) : null

    const desired = extractPlansFromDayBody(bodyText ?? "", dateKey, scopedTitle)
    const baseMs = Date.now()
    const desiredMap = new Map()
    for (const row of desired) {
      const key = buildPlanKey(row)
      if (!key || desiredMap.has(key)) continue
      desiredMap.set(key, row)
    }

    let query = supabase
      .from("plans")
      .select("*")
      .eq("user_id", userId)
      .eq("date", dateKey)
      .is("deleted_at", null)
    if (scopedTitle) query = query.eq("category_id", scopedTitle)
    const { data: currentRows, error: loadError } = await query
    if (loadError) {
      console.error("load day plans", loadError)
      return
    }

    const currentRowsFiltered = (currentRows ?? []).filter((row) => !isRecurringPlanRow(row))
    const currentMap = new Map()
    const duplicateRows = []
    for (const row of currentRowsFiltered) {
      const key = buildPlanKey(row)
      if (!key) continue
      if (currentMap.has(key)) {
        if (row?.id) duplicateRows.push(row)
        continue
      }
      currentMap.set(key, row)
    }

    const toInsert = []
    for (const [key, row] of desiredMap.entries()) {
      if (currentMap.has(key)) continue
      const desiredOrder = Number.isFinite(row?.sort_order) ? row.sort_order : 0
      toInsert.push({
        ...row,
        user_id: userId,
        client_id: clientIdRef.current,
        updated_at: new Date(baseMs + desiredOrder).toISOString()
      })
    }

    const toUpdate = []
    for (const [key, row] of desiredMap.entries()) {
      const currentRow = currentMap.get(key)
      if (!currentRow?.id) continue
      const desiredOrder = Number(row?.sort_order)
      if (!Number.isFinite(desiredOrder)) continue
      const currentOrder = Number(
        currentRow?.sort_order ?? currentRow?.sortOrder ?? currentRow?.order ?? Number.NaN
      )
      if (Number.isFinite(currentOrder) && desiredOrder === currentOrder) continue
      toUpdate.push({
        id: currentRow.id,
        user_id: userId,
        sort_order: desiredOrder,
        updated_at: new Date(baseMs + desiredOrder).toISOString(),
        client_id: clientIdRef.current
      })
    }

    const toDelete = []
    for (const [key, row] of currentMap.entries()) {
      if (desiredMap.has(key)) continue
      if (row?.id) toDelete.push(row)
    }
    for (const row of duplicateRows) {
      if (row?.id) toDelete.push(row)
    }

    if (toDelete.length > 0) {
      const ids = [...new Set(toDelete.map((row) => row.id).filter(Boolean))]
      const deletedAt = new Date().toISOString()
      const { error: deleteError } = await supabase
        .from("plans")
        .update({ deleted_at: deletedAt, updated_at: deletedAt, client_id: clientIdRef.current })
        .in("id", ids)
        .eq("user_id", userId)
      if (deleteError) {
        console.error("delete day plans", deleteError)
        return
      }
    }

    if (toInsert.length > 0) {
      const rowsForInsert = endTimeSupportedRef.current ? toInsert : stripEndTimeFromRows(toInsert)
      const insertPayload = sortOrderSupportedRef.current ? rowsForInsert : stripSortOrderFromRows(rowsForInsert)
      let { error: insertError } = await supabase.from("plans").insert(insertPayload)
      if (insertError && isEndTimeColumnError(insertError)) {
        endTimeSupportedRef.current = false
        const retryRows = stripEndTimeFromRows(toInsert)
        const retryPayload = sortOrderSupportedRef.current ? retryRows : stripSortOrderFromRows(retryRows)
        const retry = await supabase.from("plans").insert(retryPayload)
        insertError = retry.error
      }
      if (insertError && isSortOrderColumnError(insertError)) {
        sortOrderSupportedRef.current = false
        const retryRows = endTimeSupportedRef.current ? toInsert : stripEndTimeFromRows(toInsert)
        const retry = await supabase.from("plans").insert(stripSortOrderFromRows(retryRows))
        insertError = retry.error
      }
      if (insertError) {
        console.error("insert day plans", insertError)
        return
      }
    }

    if (toUpdate.length > 0 && sortOrderSupportedRef.current) {
      const chunkSize = 200
      for (let i = 0; i < toUpdate.length; i += chunkSize) {
        const chunk = toUpdate.slice(i, i + chunkSize)
        const { error: updateError } = await supabase.from("plans").upsert(chunk, { onConflict: "id" })
        if (updateError) {
          if (isSortOrderColumnError(updateError)) {
            sortOrderSupportedRef.current = false
          } else {
            console.error("update day plan order", updateError)
          }
          break
        }
      }
    }

    const categoryTitles = new Set(
      desired
        .map((row) => normalizeCategoryId(String(row?.category_id ?? "").trim()))
        .filter((title) => title && !isGeneralCategoryId(title))
    )
    ensureWindowsForCategories(categoryTitles)
    await loadRemotePlans(userId, { force: true })
  }

  function runPendingDayListSyncNow() {
    const payload = dayListPendingSyncRef.current
    dayListPendingSyncRef.current = null
    if (!payload || !payload.dateKey) return
    dayListSyncQueueRef.current = dayListSyncQueueRef.current
      .catch((err) => {
        console.error("day sync queue", err)
      })
      .then(() => syncDayBodyToSupabase(payload.dateKey, payload.bodyText, payload.windowId))
  }

  function enqueueDayListSync(dateKey, bodyText, windowId) {
    if (!canUseWebRowPlanEdit) return
    dayListPendingSyncRef.current = {
      dateKey,
      bodyText: String(bodyText ?? ""),
      windowId: windowId ?? "all"
    }
    if (dayListSyncTimerRef.current) clearTimeout(dayListSyncTimerRef.current)
    dayListSyncTimerRef.current = setTimeout(() => {
      dayListSyncTimerRef.current = null
      runPendingDayListSyncNow()
    }, 450)
  }

  function flushPendingDayListSync() {
    if (!canUseWebRowPlanEdit) return
    if (dayListSyncTimerRef.current) {
      clearTimeout(dayListSyncTimerRef.current)
      dayListSyncTimerRef.current = null
    }
    runPendingDayListSyncNow()
  }

  async function syncSortOrderFromText(sourceText, year) {
    if (!supabase || !session?.user?.id) return
    if (!sortOrderSupportedRef.current) return
    const userId = session.user.id
    const orderMap = buildPlanOrderMapFromText(sourceText ?? "", year)
    if (orderMap.size === 0) return

    const yearPrefix = `${year}-`
    const current = (remotePlans ?? []).filter(
      (row) =>
        row &&
        row.user_id === userId &&
        !row.deleted_at &&
        String(row?.date ?? "").startsWith(yearPrefix)
    )
    if (current.length === 0) return

    const baseMs = Date.now()
    const updates = []
    for (const row of current) {
      const key = buildPlanKey(row)
      if (!orderMap.has(key)) continue
      const desiredOrder = orderMap.get(key)
      if (!Number.isFinite(desiredOrder)) continue
      const currentOrder = Number(
        row?.sort_order ?? row?.sortOrder ?? row?.order ?? Number.NaN
      )
      if (Number.isFinite(currentOrder) && desiredOrder === currentOrder) continue
      updates.push({
        id: row.id,
        user_id: userId,
        sort_order: desiredOrder,
        updated_at: new Date(baseMs + desiredOrder).toISOString(),
        client_id: clientIdRef.current
      })
    }
    if (updates.length === 0) return

    const chunkSize = 200
    try {
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize)
        const { error } = await supabase.from("plans").upsert(chunk, { onConflict: "id" })
        if (error) {
          if (isSortOrderColumnError(error)) {
            sortOrderSupportedRef.current = false
          } else {
            console.error("sync sort_order", error)
          }
          return
        }
      }
      setRemotePlans((prev) => {
        const updateMap = new Map(updates.map((row) => [row.id, row]))
        return (prev ?? []).map((row) => {
          const update = updateMap.get(row?.id)
          if (!update) return row
          return { ...row, sort_order: update.sort_order, updated_at: update.updated_at, client_id: update.client_id }
        })
      })
    } catch (err) {
      console.error("sync sort_order", err)
    }
  }

  function scheduleCloudSync(sourceText, year) {
    if (!ENABLE_WEB_TEXT_PLAN_SYNC) return
    if (!supabase || !session?.user?.id || !remoteLoaded) return
    if (applyingRemoteRef.current) return
    const last = lastCloudSyncRef.current
    if (last.year === year && last.text === sourceText) return
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      syncYearToSupabase(sourceText, year)
    }, 800)
  }

  async function migrateGroupTitleInSupabase(oldTitle, newTitle) {
    if (!supabase || !session?.user?.id) return
    const userId = session.user.id
    const { error } = await supabase
      .from("plans")
      .update({ category_id: newTitle, updated_at: new Date().toISOString(), client_id: clientIdRef.current })
      .eq("user_id", userId)
      .eq("category_id", oldTitle)
    if (error) {
      console.error("rename category", error)
      return
    }
    setRemotePlans((prev) =>
      (prev ?? []).map((row) =>
        row.category_id === oldTitle ? { ...row, category_id: newTitle } : row
      )
    )
  }

  async function removeCategoryInSupabase(title) {
    if (!supabase || !session?.user?.id) return
    const userId = session.user.id
    const deletedAt = new Date().toISOString()
    const { error } = await supabase
      .from("plans")
      .update({ deleted_at: deletedAt, updated_at: deletedAt, client_id: clientIdRef.current })
      .eq("user_id", userId)
      .eq("category_id", title)
      .is("deleted_at", null)
    if (error) {
      console.error("remove category", error)
      return
    }
    setRemotePlans((prev) =>
      (prev ?? []).filter((row) => !(row?.category_id === title && row?.user_id === userId))
    )
  }

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session?.user?.id) loadRemotePlans(data.session.user.id)
    })
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_, nextSession) => {
      setSession(nextSession)
      if (nextSession?.user?.id) {
        loadRemotePlans(nextSession.user.id)
      } else {
        setRemotePlans([])
        setRemoteLoaded(false)
      }
    })
    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (session) {
      setLoginModalOpen(false)
      return
    }
    setAuthMessage("")
    setLoginModalOpen(true)
  }, [session])

  useEffect(() => {
    setAuthMessage("")
    if (authMode === "signIn") setAuthPasswordConfirm("")
  }, [authMode])

  useEffect(() => {
    const nextId = session?.user?.id ?? null
    if (nextId && nextId !== lastSessionIdRef.current) {
      forceRemoteApplyRef.current = true
    }
    lastSessionIdRef.current = nextId
  }, [session?.user?.id])

  useEffect(() => {
    setRecurringRules(loadRecurringList(recurringRulesStorageKey))
  }, [recurringRulesStorageKey])

  useEffect(() => {
    setRecurringOverrides(loadRecurringList(recurringOverridesStorageKey))
  }, [recurringOverridesStorageKey])

  useEffect(() => {
    saveRecurringList(recurringRulesStorageKey, recurringRules)
  }, [recurringRulesStorageKey, recurringRules])

  useEffect(() => {
    saveRecurringList(recurringOverridesStorageKey, recurringOverrides)
  }, [recurringOverridesStorageKey, recurringOverrides])

  useEffect(() => {
    const userId = session?.user?.id ?? null
    if (!supabase || !userId || !remoteLoaded) return
    if (!hasCloudSession) return
    if (recurringCloudMigrationRunningRef.current) return
    if (!recurringCloudMigrationKey) return

    const localRules = Array.isArray(recurringRules) ? recurringRules : []
    if (localRules.length === 0) return

    let alreadyMigrated = false
    try {
      alreadyMigrated = localStorage.getItem(recurringCloudMigrationKey) === "1"
    } catch {
      alreadyMigrated = false
    }
    if (alreadyMigrated) return

    const hasCloudRecurring = (remotePlans ?? []).some((row) => isRecurringPlanRow(row))
    if (hasCloudRecurring) {
      try {
        localStorage.setItem(recurringCloudMigrationKey, "1")
      } catch {
        // ignore
      }
      return
    }

    const localOverrides = Array.isArray(recurringOverrides) ? recurringOverrides : []
    const validRules = localRules.filter((rule) => {
      const startDateKey = String(rule?.startDateKey ?? rule?.start_date ?? "").trim()
      const untilDateKey = String(rule?.untilDateKey ?? rule?.until_date ?? "").trim()
      const rawLine = String(rule?.rawLine ?? rule?.raw_line ?? "").trim()
      return isValidDateKey(startDateKey) && (!untilDateKey || isValidDateKey(untilDateKey)) && rawLine
    })
    if (validRules.length === 0) {
      try {
        localStorage.setItem(recurringCloudMigrationKey, "1")
      } catch {
        // ignore
      }
      return
    }

    const rangeStartKey = validRules
      .map((rule) => String(rule?.startDateKey ?? rule?.start_date ?? "").trim())
      .sort()[0]
    const rangeEndKey = validRules
      .map((rule) => {
        const startDateKey = String(rule?.startDateKey ?? rule?.start_date ?? "").trim()
        const untilDateKey = String(rule?.untilDateKey ?? rule?.until_date ?? "").trim()
        return untilDateKey || addDaysToKey(startDateKey, getOpenEndedRepeatSpanDays(startDateKey))
      })
      .sort()
      .slice(-1)[0]
    const occurrencesByDate = buildRecurringByDate(validRules, localOverrides, rangeStartKey, rangeEndKey, null)
    const allDates = Object.keys(occurrencesByDate).sort()
    if (allDates.length === 0) {
      try {
        localStorage.setItem(recurringCloudMigrationKey, "1")
      } catch {
        // ignore
      }
      return
    }

    recurringCloudMigrationRunningRef.current = true
    let cancelled = false

    ;(async () => {
      try {
        const familySeriesMap = new Map()
        const sortSeeds = new Map()
        const rows = []

        for (const dateKey of allDates) {
          for (const occurrence of occurrencesByDate[dateKey] ?? []) {
            const familyKey = String(occurrence?.familyId ?? occurrence?.ruleId ?? "").trim()
            if (!familyKey) continue
            if (!familySeriesMap.has(familyKey)) familySeriesMap.set(familyKey, genSeriesId())
            const seriesId = familySeriesMap.get(familyKey)
            let sortOrderOverride = null
            if (sortOrderSupportedRef.current) {
              const existingSeed = sortSeeds.get(dateKey)
              if (existingSeed != null) {
                sortOrderOverride = existingSeed
                sortSeeds.set(dateKey, existingSeed + 1)
              } else {
                const seed = getNextSortOrderForDate(dateKey, remotePlans)
                if (seed != null) {
                  sortOrderOverride = seed
                  sortSeeds.set(dateKey, seed + 1)
                }
              }
            }
            const row = buildSingleRecurringPlanPayload(
              userId,
              {
                rawLine: occurrence?.rawLine,
                categoryTitle: occurrence?.title,
                repeat: occurrence?.repeat,
                repeatInterval: occurrence?.repeatInterval,
                repeatDays: occurrence?.repeatDays,
                untilDateKey: occurrence?.repeatUntilKey
              },
              dateKey,
              {
                seriesIdOverride: seriesId,
                repeatTypeOverride: occurrence?.repeat,
                sortOrderOverride
              }
            )
            if (row) rows.push(row)
          }
        }

        if (rows.length > 0) {
          suspendRemotePlansLoads()
          await insertRecurringPlanRows(rows)
        }

        if (cancelled) return
        setRecurringRules([])
        setRecurringOverrides([])
        try {
          localStorage.setItem(recurringCloudMigrationKey, "1")
        } catch {
          // ignore
        }
        ensureWindowsForCategories(
          new Set(rows.map((row) => normalizeCategoryId(String(row?.category_id ?? "").trim())).filter((title) => title && !isGeneralCategoryId(title)))
        )
        await loadRemotePlans(userId, { force: true })
      } catch (error) {
        console.error("migrate local recurring rules", error)
      } finally {
        recurringCloudMigrationRunningRef.current = false
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    hasCloudSession,
    recurringCloudMigrationKey,
    recurringOverrides,
    recurringRules,
    remoteLoaded,
    remotePlans,
    session?.user?.id
  ])

  useEffect(() => {
    if (!supabase || !session?.user?.id) return
    const channel = supabase
      .channel(`plans-changes-${session.user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plans", filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          const { eventType } = payload
          if (eventType === "DELETE") {
            const id = payload.old?.id
            if (!id) return
            setRemotePlans((prev) => (prev ?? []).filter((row) => row?.id !== id))
            return
          }

          const incoming = payload.new
          if (!incoming) return
          if (incoming.client_id && incoming.client_id === clientIdRef.current) return

          const normalized = {
            ...incoming,
            category_id: normalizeCategoryId(incoming?.category_id)
          }
          if (normalized?.deleted_at) {
            setRemotePlans((prev) => (prev ?? []).filter((row) => row?.id !== normalized.id))
            setRemoteLoaded(true)
            return
          }
          setRemotePlans((prev) => {
            const list = prev ?? []
            const idx = list.findIndex((row) => row?.id === normalized.id)
            if (idx >= 0) {
              const next = [...list]
              next[idx] = { ...list[idx], ...normalized }
              return next
            }
            return [...list, normalized]
          })
          setRemoteLoaded(true)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session?.user?.id])

  // Realtime fallback: periodically pull plans and refresh on tab focus/visibility.
  useEffect(() => {
    const userId = session?.user?.id
    if (!supabase || !userId) return
    if (typeof window === "undefined" || typeof document === "undefined") return
    let disposed = false
    let inflight = false
    const safePull = async () => {
      if (disposed || inflight) return
      inflight = true
      try {
        await loadRemotePlans(userId)
      } catch (err) {
        console.error("fallback pull plans", err)
      } finally {
        inflight = false
      }
    }
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") safePull()
    }

    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return
      safePull()
    }, 12000)

    window.addEventListener("focus", handleVisibilityOrFocus)
    document.addEventListener("visibilitychange", handleVisibilityOrFocus)

    return () => {
      disposed = true
      clearInterval(timer)
      window.removeEventListener("focus", handleVisibilityOrFocus)
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus)
    }
  }, [session?.user?.id])

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

  useEffect(() => {
    if (!session?.user?.id || !remoteLoaded) return
    const titles = new Set(
      remotePlans
        .filter((row) => !row?.deleted_at)
        .map((row) => String(row?.category_id ?? "").trim())
        .filter(Boolean)
    )
    ensureWindowsForCategories(titles)
  }, [remotePlans, session?.user?.id, remoteLoaded])


  // ===== 달력 뷰 =====
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 })
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  const [, setHolidayTick] = useState(0)
  const holidayLoadingRef = useRef(new Set())
  const ensureHolidayYear = useCallback((year) => {
    const y = Number(year)
    if (!Number.isFinite(y)) return
    if (YEAR_HOLIDAYS[y]) return
    if (holidayLoadingRef.current.has(y)) return

    holidayLoadingRef.current.add(y)

    const cached = readHolidayCache(y)
    if (cached?.items && typeof cached.items === "object") {
      YEAR_HOLIDAYS[y] = cached.items
      setHolidayTick((prev) => prev + 1)
    }

    const shouldFetch = !cached || !isHolidayCacheFresh(cached)
    if (!shouldFetch) {
      holidayLoadingRef.current.delete(y)
      return
    }

    fetchHolidayYear(y)
      .then((items) => {
        if (!items || Object.keys(items).length === 0) return
        YEAR_HOLIDAYS[y] = items
        writeHolidayCache(y, items)
        setHolidayTick((prev) => prev + 1)
      })
      .catch(() => {})
      .finally(() => {
        holidayLoadingRef.current.delete(y)
      })
  }, [])

  useEffect(() => {
    ensureHolidayYear(baseYear)
    if (view.year !== baseYear) ensureHolidayYear(view.year)
  }, [baseYear, view.year, ensureHolidayYear])

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

  const MIN_MEMO_PANEL_PX = 320
  const MIN_CALENDAR_PANEL_PX = 520
  const DEFAULT_SPLIT = 0.58
  const DIVIDER_W = 10
  const OUTER_SPLIT_GAP_PX = 12
  const OUTER_EDGE_PAD = 24

  const FONT_MIN = 12
  const FONT_MAX = 26
  const CALENDAR_FONT_MIN = 8
  const CALENDAR_FONT_MAX = 24

  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT)
  const [outerCollapsed, setOuterCollapsed] = useState("left") // "none" | "left" | "right"
  const lastSplitRatioRef = useRef(DEFAULT_SPLIT)
  const [memoFontPx, setMemoFontPx] = useState(15)
  const [memoFontInput, setMemoFontInput] = useState("15")
  const [memoTabFontPx, setMemoTabFontPx] = useState(15)
  const [memoTabFontInput, setMemoTabFontInput] = useState("15")
  const [memoBodyFontPx, setMemoBodyFontPx] = useState(15)
  const [memoBodyFontInput, setMemoBodyFontInput] = useState("15")
  const [tabFontPx, setTabFontPx] = useState(14)
  const [tabFontInput, setTabFontInput] = useState("14")
  const [calendarFontPx, setCalendarFontPx] = useState(10)
  const [calendarFontInput, setCalendarFontInput] = useState("10")

  // ? 설정 패널(톱니) 토글
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const settingsPanelRef = useRef(null)

  // 달력 셀 높이 자동 계산용
  const [calendarCellH, setCalendarCellH] = useState(110)

  // ===== 테마/레이아웃 프리셋 =====
  const [theme, setTheme] = useState("light") // "light" | "dark"
  const [layoutPreset, setLayoutPreset] = useState("memo-left") // "memo-left" | "calendar-left"
  const [calendarViewMode, setCalendarViewMode] = useState("month") // "month" | "blocks"
  const isSwapped = layoutPreset === "calendar-left"

  // ===== ? 메모 패널 내부(좌/우 메모) 스플릿 =====
  const MEMO_INNER_KEY = "planner-memo-inner-split"
  const MIN_MEMO_LEFT_PX = 240
  const MIN_MEMO_RIGHT_PX = 240
  const DEFAULT_MEMO_INNER_SPLIT = 0.62
  const MEMO_DIVIDER_W = 10
  const MEMO_INNER_GAP = 10

  const [memoInnerSplit, setMemoInnerSplit] = useState(DEFAULT_MEMO_INNER_SPLIT)
  const [memoInnerCollapsed, setMemoInnerCollapsed] = useState("right") // "left" | "right"
  const [memoCollapsedByWindow, setMemoCollapsedByWindow] = useState(() => ({}))
  const [rightMemoText, setRightMemoText] = useState("") // ? 오른쪽 메모(기능 없음)
  const rightMemoTextRef = useRef("")
  const [rightMemoJumpTarget, setRightMemoJumpTarget] = useState(null)
  const [integratedRightMemoSelectionByYear, setIntegratedRightMemoSelectionByYear] = useState({})
  const [tabEditText, setTabEditText] = useState("")
  const [dashboardSourceTick, setDashboardSourceTick] = useState(0)
  const [isEditingLeftMemo, setIsEditingLeftMemo] = useState(false)
  const [dashboardCollapsedByWindow, setDashboardCollapsedByWindow] = useState({})
  const [readDateDraft, setReadDateDraft] = useState(null)
  const [mentionGhostText, setMentionGhostText] = useState("")
  const [mentionGhostPos, setMentionGhostPos] = useState({ top: 0, left: 0 })
  const [tabMentionMenu, setTabMentionMenu] = useState({ visible: false, top: 0, left: 0 })
  const [tabMentionHoverId, setTabMentionHoverId] = useState(null)
  const tabMentionRef = useRef(null)
  const tabMentionMouseDownRef = useRef(false)
  // ? 창 목록/활성 탭

  useEffect(() => {
    rightMemoTextRef.current = rightMemoText
  }, [rightMemoText])
  const windowsKeyRef = useRef(getWindowsStorageKey(null))
  const [windows, setWindows] = useState(() => loadWindows(windowsKeyRef.current))
  const [activeWindowId, setActiveWindowId] = useState("all")

  useEffect(() => {
    const userId = session?.user?.id ?? null
    const nextKey = getWindowsStorageKey(userId)
    if (windowsKeyRef.current === nextKey) return
    windowsKeyRef.current = nextKey
    if (!userId) {
      const stored = hasStoredWindows(nextKey)
      let next = loadWindows(nextKey)
      if (!stored) {
        next = DEFAULT_WINDOWS
      }
      setWindows(next)
      setActiveWindowId("all")
      setRemoteWindows([])
      setRemoteWindowsLoaded(false)
      return
    }
    loadRemoteWindows(userId)
  }, [session?.user?.id])

  useEffect(() => {
    if (!session?.user?.id || !remoteLoaded) return
    const forceApply = forceRemoteApplyRef.current
    if (!forceApply && isEditingLeftMemo) {
      forceRemoteApplyRef.current = true
      return
    }
    const dayListGuard = dayListEditGuardRef.current
    if (!forceApply && dayListGuard.open && dayListGuard.mode === "edit") {
      forceRemoteApplyRef.current = true
      return
    }
    const last = lastCloudSyncRef.current
    if (ENABLE_WEB_TEXT_PLAN_SYNC && !forceApply && last.year === baseYear && last.text !== textRef.current) return
    const previousText = textRef.current ?? getWindowMemoTextSync(baseYear, "all") ?? ""
    if (!forceApply && (remotePlans ?? []).length === 0 && previousText.trim()) {
      return
    }
    const nextText = buildTextFromPlans(remotePlans, baseYear, previousText)
    if (nextText === textRef.current) {
      if (forceApply) {
        lastCloudSyncRef.current = { year: baseYear, text: nextText }
        forceRemoteApplyRef.current = false
      }
      return
    }
    applyingRemoteRef.current = true
    updateEditorText(nextText)
    setWindowMemoTextSync(baseYear, "all", nextText)
    setDashboardSourceTick((x) => x + 1)
    lastCloudSyncRef.current = { year: baseYear, text: nextText }
    forceRemoteApplyRef.current = false
    setTimeout(() => {
      applyingRemoteRef.current = false
    }, 0)
  }, [remotePlans, baseYear, session?.user?.id, remoteLoaded, isEditingLeftMemo])

  const [editingWindowId, setEditingWindowId] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const titleInputRef = useRef(null)
  const draggingWindowIdRef = useRef(null)
  useEffect(() => {
    if (!session?.user?.id || !remoteLoaded) return
    // Tab edits already call scheduleCloudSync() after they are merged into the "all" text.
    // Avoid syncing from stale all-text snapshots while typing in a tab.
    if (activeWindowId !== "all") return
    scheduleCloudSync(text, baseYear)
  }, [text, baseYear, session?.user?.id, remoteLoaded, activeWindowId])
  const FILTER_KEY = "planner-integrated-filters-v1"
  const FILTER_KEY_PREFIX = "planner-integrated-filters-user-v1"
  const filterKeyRef = useRef(FILTER_KEY)
  function getFilterStorageKey(userId) {
    return userId ? `${FILTER_KEY_PREFIX}-${userId}` : FILTER_KEY
  }
  const [integratedFilters, setIntegratedFilters] = useState({})
  const [filterOpen, setFilterOpen] = useState(false)
  const filterBtnRef = useRef(null)
  const filterPanelRef = useRef(null)
  const tabsScrollRef = useRef(null)
  const [tabScrollState, setTabScrollState] = useState({ left: false, right: false })

  useEffect(() => {
  if (!editingWindowId) return
  // 다음 프레임에 select (렌더 완료 후)
  requestAnimationFrame(() => {
    const el = titleInputRef.current
    if (el) el.select()
  })
}, [editingWindowId])


  
  useEffect(() => {
    const userId = session?.user?.id ?? null
    const nextKey = getFilterStorageKey(userId)
    if (filterKeyRef.current === nextKey) return
    filterKeyRef.current = nextKey
    try {
      const raw = localStorage.getItem(nextKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") setIntegratedFilters(parsed)
      } else {
        setIntegratedFilters({})
      }
    } catch (err) { void err }
  }, [session?.user?.id])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(filterKeyRef.current)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") setIntegratedFilters(parsed)
      }
    } catch (err) { void err }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(filterKeyRef.current, JSON.stringify(integratedFilters))
    } catch (err) { void err }
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

  const updateTabScrollState = useCallback(() => {
    const el = tabsScrollRef.current
    if (!el) return
    const children = Array.from(el.children).filter((node) => node instanceof HTMLElement)
    if (!children.length) {
      setTabScrollState((prev) => (!prev.left && !prev.right ? prev : { left: false, right: false }))
      return
    }
    const tolerance = 3
    const viewportRect = el.getBoundingClientRect()
    const firstRect = children[0].getBoundingClientRect()
    const lastRect = children[children.length - 1].getBoundingClientRect()
    const scrollMax = Math.max(0, el.scrollWidth - el.clientWidth)
    const hasOverflow = scrollMax > tolerance
    const left = hasOverflow && firstRect.left < viewportRect.left - tolerance
    const right = hasOverflow && lastRect.right > viewportRect.right + tolerance
    setTabScrollState((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])

  function scrollTabs(dir) {
    const el = tabsScrollRef.current
    if (!el) return
    const amount = Math.max(80, Math.floor(el.clientWidth * 0.6))
    el.scrollBy({ left: dir * amount, behavior: "smooth" })
    requestAnimationFrame(updateTabScrollState)
  }

  useEffect(() => {
    const el = tabsScrollRef.current
    if (!el) return
    const onScroll = () => updateTabScrollState()
    updateTabScrollState()
    el.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onScroll) : null
    resizeObserver?.observe(el)
    if (el.parentElement) resizeObserver?.observe(el.parentElement)
    return () => {
      el.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      resizeObserver?.disconnect()
    }
  }, [updateTabScrollState])

  useEffect(() => {
    updateTabScrollState()
  }, [updateTabScrollState, windows, tabFontPx, splitRatio, outerCollapsed, layoutPreset])

  useEffect(() => {
    function onDocPointerDown(e) {
      const t = e.target
      if (!(t instanceof Node)) return
      const calendar = calendarPanelRef.current
      const memo = textareaRef.current
      const rightMemo = rightTextareaRef.current
      const tabMenu = tabMentionRef.current
      const inTabMenu = tabMenu && tabMenu.contains(t)
      const inLeftMemo = (memo && memo.contains(t)) || inTabMenu
      const inRightMemo = rightMemo && rightMemo.contains(t)

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
    setIsEditingLeftMemo(false)
  }, [activeWindowId])

  useEffect(() => {
    const stored = memoCollapsedByWindow[activeWindowId]
    const next = stored === "left" ? "left" : "right"
    if (next !== memoInnerCollapsed) setMemoInnerCollapsed(next)
  }, [activeWindowId, memoCollapsedByWindow, memoInnerCollapsed])
 
  
  useEffect(() => {
    saveWindows(windows, windowsKeyRef.current)
  }, [windows])

  useEffect(() => {
    if (!session?.user?.id || !remoteWindowsLoaded) return
    scheduleWindowsSync(windows)
  }, [windows, session?.user?.id, remoteWindowsLoaded])

  function commitWindowTitleChange(windowId, rawTitle) {
    const target = windows.find((w) => w.id === windowId)
    if (!target) return
    const normalized = normalizeCategoryId(normalizeWindowTitle(rawTitle))
    const nextTitle = makeUniqueWindowTitle(normalized, windows, windowId)
    if (nextTitle === target.title) {
      setEditingWindowId(null)
      return
    }
    setWindows((prev) => prev.map((w) => (w.id === windowId ? { ...w, title: nextTitle } : w)))
    migrateGroupTitleAcrossAllYears(target.title, nextTitle)
    migrateGroupTitleInSupabase(target.title, nextTitle)
    setEditingWindowId(null)
  }

  function addWindow() {
    const id = genWindowId()
    setWindows((prev) => {
      const title = makeUniqueWindowTitle("제목없음", prev)
      const newWin = {
        id,
        title,
        color: pickNextWindowColor(prev)
      }
      return [...prev, newWin]
    })
    setActiveWindowId(id)
    requestAnimationFrame(() => {
      const el = tabsScrollRef.current
      if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" })
    })
  }

  function removeWindow(id) {
    const idx = windows.findIndex((w) => w.id === id)
    if (idx < 0) return
    const removed = windows[idx]
    const allowedTitles = new Set(windows.filter((w) => w.id !== "all" && w.id !== id).map((w) => w.title))

    setWindows((prev) => prev.filter((w) => w.id !== id))

    // 현재 보고 있는 탭을 지웠다면 통합으로 이동
    if (activeWindowId === id) {
      setActiveWindowId("all")
    }

    removeWindowDataFromAllYears(id, allowedTitles)
    if (removed?.title) removeCategoryInSupabase(removed.title)
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
    } catch (err) { void err }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(MEMO_INNER_KEY, String(memoInnerSplit))
    } catch (err) { void err }
  }, [memoInnerSplit])

  function beginMemoInnerDrag(e) {
    memoInnerDraggingRef.current = true
    memoInnerStartXRef.current = e.clientX
    memoInnerStartRatioRef.current = memoInnerSplit
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch (err) { void err }
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
        const legacyMemoFont =
          typeof parsed.memoFontPx === "number" ? clamp(parsed.memoFontPx, FONT_MIN, FONT_MAX) : null
        if (legacyMemoFont != null) setMemoFontPx(legacyMemoFont)
        if (typeof parsed.tabFontPx === "number") setTabFontPx(clamp(parsed.tabFontPx, FONT_MIN, FONT_MAX))
        if (typeof parsed.memoTabFontPx === "number") {
          setMemoTabFontPx(clamp(parsed.memoTabFontPx, FONT_MIN, FONT_MAX))
        } else if (legacyMemoFont != null) {
          setMemoTabFontPx(legacyMemoFont)
        }
        if (typeof parsed.memoBodyFontPx === "number") {
          setMemoBodyFontPx(clamp(parsed.memoBodyFontPx, FONT_MIN, FONT_MAX))
        } else if (legacyMemoFont != null) {
          setMemoBodyFontPx(legacyMemoFont)
        }
        if (typeof parsed.calendarFontPx === "number") {
          setCalendarFontPx(clamp(parsed.calendarFontPx, CALENDAR_FONT_MIN, CALENDAR_FONT_MAX))
        }
      }
    } catch (err) { void err }

    try {
      const raw2 = localStorage.getItem(PREF_KEY)
      if (raw2) {
        const p = JSON.parse(raw2)
        if (p && (p.theme === "light" || p.theme === "dark")) setTheme(p.theme)
      }
    } catch (err) { void err }
    setLayoutPreset("memo-left")
    setOuterCollapsed("left")
    setCalendarViewMode("month")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setMemoFontInput(String(memoFontPx))
  }, [memoFontPx])

  useEffect(() => {
    setMemoTabFontInput(String(memoTabFontPx))
  }, [memoTabFontPx])

  useEffect(() => {
    setMemoBodyFontInput(String(memoBodyFontPx))
  }, [memoBodyFontPx])

  useEffect(() => {
    setTabFontInput(String(tabFontPx))
  }, [tabFontPx])

  useEffect(() => {
    setCalendarFontInput(String(calendarFontPx))
  }, [calendarFontPx])

  useEffect(() => {
    try {
      localStorage.setItem(
        LAYOUT_KEY,
        JSON.stringify({
          splitRatio,
          memoFontPx,
          tabFontPx,
          memoTabFontPx,
          memoBodyFontPx,
          calendarFontPx
        })
      )
    } catch (err) { void err }
  }, [splitRatio, memoFontPx, tabFontPx, memoTabFontPx, memoBodyFontPx, calendarFontPx])

  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ theme, layoutPreset }))
    } catch (err) { void err }
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

  // ? 연/월 상시 수정: 입력 변경 즉시 view 반영(약간의 안전장치)
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
  const memoKeyPrefix = useMemo(
    () => getMemoStoragePrefix(session?.user?.id ?? null),
    [session?.user?.id]
  )
  const isOfflineMemo = !session?.user?.id
  const memoKey = useMemo(
    () => getMemoKey(memoKeyPrefix, baseYear, activeWindowId),
    [memoKeyPrefix, baseYear, activeWindowId]
  )
  const legacyLeftKey = useMemo(() => `planner-left-text-${baseYear}`, [baseYear])
  const suppressSaveRef = useRef(false)

  // ? 오른쪽 메모(연도별)
  const rightMemoKey = useMemo(
    () => getRightMemoKey(memoKeyPrefix, baseYear, activeWindowId),
    [memoKeyPrefix, baseYear, activeWindowId]
  )
  const suppressRightSaveRef = useRef(false)
  const rightMemoSyncTimerRef = useRef(null)
  const pendingRightMemoWritesRef = useRef({})
  const rightSaveSuppressResetRef = useRef(null)
  const rightMemoMetaColumnsSupportedRef = useRef(true)
  const editableWindows = useMemo(() => windows.filter((w) => w.id !== "all"), [windows])
  const windowTitlesOrder = useMemo(() => windows.filter((w) => w.id !== "all").map((w) => w.title), [windows])
  const windowTitleRank = useMemo(() => {
    return new Map(windowTitlesOrder.map((title, index) => [title, index]))
  }, [windowTitlesOrder])
  const windowColorByTitle = useMemo(() => {
    const map = new Map()
    for (const w of windows ?? []) {
      if (!w || w.id === "all") continue
      const title = String(w.title ?? "").trim()
      if (!title) continue
      map.set(title, typeof w.color === "string" ? w.color : "#999")
    }
    return map
  }, [windows])
  const planCategoryOptions = useMemo(
    () =>
      editableWindows.map((w) => ({
        id: String(w?.id ?? w?.title ?? ""),
        title: String(w?.title ?? "").trim(),
        value: String(w?.title ?? "").trim(),
        color: typeof w?.color === "string" ? w.color : "#999"
      })).filter((item) => item.title),
    [editableWindows]
  )

  function scheduleRightSaveUnsuppress() {
    if (typeof window === "undefined") {
      suppressRightSaveRef.current = false
      return
    }
    if (rightSaveSuppressResetRef.current != null) {
      cancelAnimationFrame(rightSaveSuppressResetRef.current)
    }
    rightSaveSuppressResetRef.current = requestAnimationFrame(() => {
      suppressRightSaveRef.current = false
      rightSaveSuppressResetRef.current = null
    })
  }

  function getLeftMemoTextSync(year) {
    try {
      const key = getLeftMemoKey(memoKeyPrefix, year)
      return localStorage.getItem(key) ?? ""
    } catch {
      return ""
    }
  }

  function setLeftMemoTextSync(year, value) {
    try {
      const key = getLeftMemoKey(memoKeyPrefix, year)
      localStorage.setItem(key, String(value ?? ""))
    } catch (err) { void err }
  }

  function getWindowMemoTextSync(year, windowId) {
    try {
      const key = getMemoKey(memoKeyPrefix, year, windowId)
      return localStorage.getItem(key) ?? ""
    } catch {
      return ""
    }
  }

  function setWindowMemoTextSync(year, windowId, value) {
    try {
      const key = getMemoKey(memoKeyPrefix, year, windowId)
      localStorage.setItem(key, String(value ?? ""))
    } catch (err) { void err }
  }

  function getRightWindowTextSync(year, windowId) {
    try {
      const key = getRightMemoKey(memoKeyPrefix, year, windowId)
      return localStorage.getItem(key) ?? ""
    } catch {
      return ""
    }
  }

  function setRightWindowTextSync(year, windowId, value) {
    try {
      const key = getRightMemoKey(memoKeyPrefix, year, windowId)
      localStorage.setItem(key, String(value ?? ""))
    } catch (err) { void err }
  }

  function buildCombinedRightTextForYear(year) {
    const windowTexts = {}
    for (const w of editableWindows) {
      windowTexts[w.id] = buildRightMemoCombinedText(getRightWindowTextSync(year, w.id))
    }
    const commonText = buildRightMemoCombinedText(getRightWindowTextSync(year, "all"))
    return buildCombinedRightText(commonText, editableWindows, integratedFilters, windowTexts)
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

  function ensureRightMemoSectionHeaders(nextText) {
    const { commonLines, windowLinesById } = splitCombinedRightText(nextText, editableWindows)
    const normalizedCommon = commonLines.join("\n").trimEnd()
    const windowTexts = {}
    for (const w of editableWindows) {
      windowTexts[w.id] = (windowLinesById.get(w.id) ?? []).join("\n").trimEnd()
    }
    return buildCombinedRightText(normalizedCommon, editableWindows, integratedFilters, windowTexts)
  }

  const allRightMemoGroups = useMemo(
    () => {
      const readWindowRaw = (windowId) => {
        if (activeWindowId !== "all" && windowId === activeWindowId) {
          return String(rightMemoText ?? "")
        }
        try {
          const key = `${memoKeyPrefix}-right-text-${baseYear}-${windowId}`
          return String(localStorage.getItem(key) ?? "")
        } catch {
          return ""
        }
      }

      return editableWindows
        .map((windowInfo) => {
          const state = normalizeRightMemoDocState(readWindowRaw(windowInfo.id))
          const docs = state.docs.map((doc, index) => {
            const rawContent = String(doc.content ?? "")
            const cleanedLines = rawContent
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
            const previewLine = cleanedLines[0] ?? ""
            const excerpt = cleanedLines.slice(0, 5).join("\n")

            return {
              id: doc.id,
              title: getRightMemoDocDisplayTitle(doc.title, index),
              content: rawContent,
              preview: previewLine,
              excerpt,
              lineCount: cleanedLines.length,
              hasContent: cleanedLines.length > 0
            }
          })
          const activeDocId =
            typeof state.activeDocId === "string" && state.docs.some((doc) => doc.id === state.activeDocId)
              ? state.activeDocId
              : docs[0]?.id || null

          return {
            windowId: windowInfo.id,
            title: windowInfo.title,
            color: windowInfo.color,
            activeDocId,
            docs
          }
        })
        .filter((group) => group.docs.length > 0)
    },
    [activeWindowId, baseYear, editableWindows, memoKeyPrefix, rightMemoText]
  )

  const integratedRightMemoSelection = useMemo(() => {
    const current = integratedRightMemoSelectionByYear?.[baseYear]
    return {
      selectedWindowId: typeof current?.selectedWindowId === "string" ? current.selectedWindowId : null,
      selectedDocIds: current?.selectedDocIds && typeof current.selectedDocIds === "object" ? current.selectedDocIds : {}
    }
  }, [baseYear, integratedRightMemoSelectionByYear])

  const updateIntegratedRightMemoSelection = useCallback((next) => {
    setIntegratedRightMemoSelectionByYear((prev) => {
      const current = prev?.[baseYear] ?? { selectedWindowId: null, selectedDocIds: {} }
      const resolved = typeof next === "function" ? next(current) : next
      return {
        ...(prev ?? {}),
        [baseYear]: {
          selectedWindowId: typeof resolved?.selectedWindowId === "string" ? resolved.selectedWindowId : null,
          selectedDocIds:
            resolved?.selectedDocIds && typeof resolved.selectedDocIds === "object" ? resolved.selectedDocIds : {}
        }
      }
    })
  }, [baseYear])

  const openRightMemoDocFromAll = useCallback((windowId, docId) => {
    if (!windowId || !docId) return
    setRightMemoJumpTarget({ windowId, docId })
    setActiveWindowId(windowId)
  }, [])

  const saveRightMemoDocFromAll = useCallback(
    async (windowId, docId, updates) => {
      if (!windowId || !docId) return

      const currentRaw = getRightWindowTextSync(baseYear, windowId)
      const state = normalizeRightMemoDocState(currentRaw)
      const nextDocs = state.docs.map((doc) => {
        if (doc.id !== docId) return doc
        return {
          ...doc,
          title: typeof updates?.title === "string" ? updates.title : doc.title,
          content: typeof updates?.content === "string" ? updates.content : doc.content
        }
      })

      const nextRaw = serializeRightMemoDocState({
        docs: nextDocs,
        activeDocId:
          typeof state.activeDocId === "string" && nextDocs.some((doc) => doc.id === state.activeDocId)
            ? state.activeDocId
            : docId
      })

      if (nextRaw === currentRaw) return

      setRightWindowTextSync(baseYear, windowId, nextRaw)

      if (activeWindowId === windowId) {
        suppressRightSaveRef.current = true
        setRightMemoText(nextRaw)
        scheduleRightSaveUnsuppress()
      }

      if (!supabase || !session?.user?.id) return

      try {
        await saveRightMemoToSupabase(session.user.id, baseYear, windowId, nextRaw)
      } catch (error) {
        console.error("save integrated right memo doc", error)
      }
    },
    [activeWindowId, baseYear, session?.user?.id, editableWindows, integratedFilters]
  )

  const saveRightMemoStateFromAll = useCallback(
    async (windowId, nextState) => {
      if (!windowId) return

      const currentRaw = getRightWindowTextSync(baseYear, windowId)
      const nextRaw =
        typeof nextState === "string"
          ? nextState
          : serializeRightMemoDocState(nextState)

      if (nextRaw === currentRaw) return

      setRightWindowTextSync(baseYear, windowId, nextRaw)

      if (activeWindowId === windowId) {
        suppressRightSaveRef.current = true
        setRightMemoText(nextRaw)
        scheduleRightSaveUnsuppress()
      }

      if (!supabase || !session?.user?.id) return

      try {
        await saveRightMemoToSupabase(session.user.id, baseYear, windowId, nextRaw)
      } catch (error) {
        console.error("save integrated right memo state", error)
      }
    },
    [activeWindowId, baseYear, session?.user?.id, editableWindows, integratedFilters]
  )

  async function handleAuthSubmit() {
    if (!supabase || authLoading) return
    const resolvedAuth = resolveAuthIdentifier(authEmail)
    if (!resolvedAuth.email || !authPassword) {
      setAuthMessage("아이디 또는 이메일과 비밀번호를 모두 입력하세요.")
      return
    }
    if (resolvedAuth.input !== authEmail) setAuthEmail(resolvedAuth.input)
    if (authMode === "signUp") {
      if (authPassword.length < AUTH_MIN_PASSWORD_LENGTH) {
        setAuthMessage(`비밀번호는 ${AUTH_MIN_PASSWORD_LENGTH}자 이상으로 입력해 주세요.`)
        return
      }
      if (authPassword !== authPasswordConfirm) {
        setAuthMessage("비밀번호 확인이 일치하지 않습니다.")
        return
      }
      if (!signupTermsAgreed || !signupPrivacyAgreed) {
        setAuthMessage("이용약관과 개인정보 수집·이용에 동의해 주세요.")
        return
      }
    }
    setAuthLoading(true)
    setAuthMessage("")
    try {
      let error = null
      if (authMode === "signIn") {
        const result = await supabase.auth.signInWithPassword({ email: resolvedAuth.email, password: authPassword })
        error = result.error
      } else {
        const result = await supabase.auth.signUp({
          email: resolvedAuth.email,
          password: authPassword,
          options: {
            ...(typeof window !== "undefined" ? { emailRedirectTo: window.location.origin } : {}),
            data: {
              login_id: resolvedAuth.input,
              login_kind: resolvedAuth.isEmail ? "email" : "id",
              terms_agreed: true,
              privacy_agreed: true,
              updates_agreed: Boolean(signupUpdatesAgreed)
            }
          }
        })
        error = result.error
      }
      if (error) {
        setAuthMessage(error.message)
        return
      }
      if (authMode === "signIn") {
        setAuthMessage("로그인 완료.")
        if (rememberCredentials) persistCredentials(authEmail)
      } else {
        setAuthPassword("")
        setAuthPasswordConfirm("")
        setSignupTermsAgreed(false)
        setSignupPrivacyAgreed(false)
        setSignupUpdatesAgreed(false)
        setSignupDetailsOpen(false)
        setAuthMessage(
          resolvedAuth.isEmail
            ? "가입 완료. 설정에 따라 이메일 인증이 필요할 수 있어요."
            : "가입 완료. 이제 아이디로 로그인해 주세요."
        )
        setAuthMode("signIn")
      }
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleSignOut() {
    if (!supabase) return
    const userId = session?.user?.id
    if (userId) {
      flushPendingDayListSync()
      try {
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
        const sourceText =
          activeWindowId === "all" ? (textRef.current ?? text) : getWindowMemoTextSync(baseYear, "all") ?? ""
        await syncYearToSupabase(sourceText, baseYear)
      } catch (err) {
        console.error("flush plans before sign out", err)
      }

      try {
        if (windowsSyncTimerRef.current) clearTimeout(windowsSyncTimerRef.current)
        if (remoteWindowsLoaded) await syncWindowsToSupabase(windows)
      } catch (err) {
        console.error("flush windows before sign out", err)
      }

      try {
        if (rightMemoSyncTimerRef.current) clearTimeout(rightMemoSyncTimerRef.current)
        if (activeWindowId !== "all") {
          await saveRightMemoToSupabase(userId, baseYear, activeWindowId, rightMemoText)
        }
      } catch (err) {
        console.error("flush right memo before sign out", err)
      }
    }
    await supabase.auth.signOut({ scope: "local" })
    setAuthMessage("")
  }

  async function runDeleteAccount() {
    if (!supabase || !session?.user?.id || deleteAccountLoading) return
    const accessToken = String(session?.access_token ?? "").trim()
    if (!accessToken) {
      setAuthMessage("로그인 세션을 확인하지 못했습니다. 다시 로그인 후 시도해 주세요.")
      return
    }
    setDeleteAccountLoading(true)
    setAuthMessage("")
    try {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        body: { confirm: true }
      })
      if (error) throw error
      if (data?.error) throw new Error(String(data.error))

      clearPersistedCredentials()
      setRememberCredentials(false)
      setAuthEmail("")
      setAuthPassword("")
      setAuthPasswordConfirm("")
      closeLoginModal()
      setSession(null)
      setRemotePlans([])
      setRemoteWindows([])
      setRemoteLoaded(false)
      setRemoteWindowsLoaded(false)
      await supabase.auth.signOut({ scope: "local" })
      setAuthMessage("계정 탈퇴가 완료됐습니다.")
    } catch (error) {
      setAuthMessage(String(error?.message ?? "계정 탈퇴에 실패했습니다."))
    } finally {
      setDeleteAccountLoading(false)
    }
  }

  async function handleDeleteAccount() {
    if (deleteAccountLoading) return
    const confirmation = typeof window !== "undefined"
      ? window.prompt("계정 탈퇴를 진행하려면 '탈퇴'를 입력하세요.")
      : null
    if (confirmation == null) return
    if (String(confirmation).trim() !== "탈퇴") {
      setAuthMessage("탈퇴 문구가 일치하지 않아 취소됐습니다.")
      return
    }
    const accepted =
      typeof window === "undefined"
        ? true
        : window.confirm("모든 일정, 메모, 설정이 삭제되고 되돌릴 수 없습니다. 계속할까요?")
    if (!accepted) return
    await runDeleteAccount()
  }

  function updateEditorText(nextText) {
    const normalized = String(nextText ?? "")
    setText(normalized)
    textRef.current = normalized
  }

  function handleLeftMemoChange(e) {
    const next = e.target.value
    if (activeWindowId === "all") updateEditorText(next)
    else setTabEditText(next)
    const key = getDateKeyAtCaret(next, e.target.selectionStart ?? 0)
    if (key) {
      lastCaretDateKeyRef.current = key
      editSessionRef.current.lastChangeKey = key
    }
  }

function parseTabEditItemsByDate(tabText, baseYear, title) {
    const parsedTab = parseBlocksAndItems(tabText ?? "", baseYear)
    const out = {}
    for (const block of parsedTab.blocks) {
      const body = (tabText ?? "").slice(block.bodyStartPos, block.blockEndPos)
      const normalizedBody = normalizeGroupLineNewlines(removeTaskLinesFromBody(body))
      const lines = normalizedBody.split("\n")
      const items = []
      let order = 0
      for (const rawLine of lines) {
        const trimmed = rawLine.trim()
        if (!trimmed) continue

        const match = trimmed.match(groupLineRegex)
        if (match) {
          const groupTitle = match[1].trim()
          if (!groupTitle || (title && groupTitle !== title)) continue
          const innerItems = match[2]
            .split(/;|\r?\n/)
            .map((x) => x.trim())
            .filter((x) => x !== "")
          for (const item of innerItems) {
          const parsed = parseLeadingTimeDashboardLine(item)
          items.push({ text: parsed ? parsed.text : item, time: parsed ? parsed.time : "", order })
            order++
          }
          continue
        }

        const semicolon = parseDashboardSemicolonLine(trimmed)
        if (semicolon) {
          const taskAware = stripTaskSuffix(semicolon.text)
          if (semicolon.group && title && semicolon.group !== title) continue
          items.push({ text: taskAware.text, time: semicolon.time, order })
          order++
          continue
        }
        const emptySemicolon = parseDashboardSemicolonLine(trimmed, { allowEmptyText: true })
        if (emptySemicolon && !emptySemicolon.text) continue

        const timeLine = parseLeadingTimeDashboardLine(trimmed)
        if (timeLine) {
          const taskAware = stripTaskSuffix(timeLine.text)
          if (timeLine.group && title && timeLine.group !== title) continue
          items.push({ text: taskAware.text, time: timeLine.time, order })
          order++
          continue
        }

        const taskAware = stripTaskSuffix(trimmed)
        items.push({ text: taskAware.text, time: "", order })
        order++
      }
      if (items.length > 0) out[block.dateKey] = items
    }
    return out
  }

  function parseTabEditGroupLineByDate(tabText, baseYear, title) {
    const itemsByDate = parseTabEditItemsByDate(tabText ?? "", baseYear, title)
    const out = {}
    for (const [dateKey, items] of Object.entries(itemsByDate)) {
      const lines = items
        .map((item) => {
          const text = (item.text ?? "").trim()
          if (!text) return ""
          if (item.time) return `${item.time};@${title};${text}`
          return `@${title};${text}`
        })
        .filter((line) => line !== "")
      if (lines.length > 0) out[dateKey] = lines.join("\n")
    }
    return out
  }

function parseTabEditItemsFromText(tabText, baseYear, title) {
    return parseTabEditItemsByDate(tabText, baseYear, title)
  }

  function updateGroupLineInBody(bodyText, title, groupLineText) {
    const source = bodyText ?? ""
    const lines = source.split("\n")
    const nextLines = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        const semicolon = parseDashboardSemicolonLine(trimmed, { allowEmptyText: true })
        if (semicolon?.group && semicolon.group === title) continue
        const match = trimmed.match(groupLineRegex)
        if (match && match[1].trim() === title) continue
      }
      nextLines.push(line)
    }

    const nextGroupText = groupLineText && groupLineText.trim() ? groupLineText.trim() : ""
    if (nextGroupText) {
      const groupLines = nextGroupText.split("\n")
      if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() !== "") {
        nextLines.push(...groupLines)
      } else {
        while (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() === "") nextLines.pop()
        nextLines.push(...groupLines)
      }
    } else {
      while (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() === "") nextLines.pop()
    }

    return nextLines.join("\n").trimEnd()
  }

function stripUnknownGroupLines(bodyText, allowedTitles) {
  const lines = (bodyText ?? "").split("\n")
  const nextLines = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) {
      const semicolon = parseDashboardSemicolonLine(trimmed, { allowEmptyText: true })
      if (semicolon?.group && !allowedTitles.has(semicolon.group)) continue
      const match = trimmed.match(groupLineRegex)
      if (match) {
        const title = match[1].trim()
        if (!allowedTitles.has(title)) continue
      }
    }
    nextLines.push(line)
  }
  return nextLines.join("\n").trimEnd()
}

function stripEmptyGroupLines(bodyText) {
  const lines = (bodyText ?? "").split("\n")
  const nextLines = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    const semicolon = parseDashboardSemicolonLine(trimmed, { allowEmptyText: true })
    if (semicolon && !semicolon.text) {
      continue
    }
    const match = trimmed.match(groupLineRegex)
    if (match) {
      if ((match[2] ?? "").trim().length === 0) continue
      nextLines.push(line)
      continue
    }
    const isTitleOnly = groupLineTitleOnlyRegex.test(trimmed)
    const isStartOnly = groupLineStartRegex.test(trimmed)
    if (isTitleOnly || isStartOnly) {
      let j = i + 1
      let contentFound = false
      if (isTitleOnly) {
        while (j < lines.length && lines[j].trim() === "") j++
        if (j >= lines.length) {
          nextLines.push(line)
          continue
        }
        const inlineMatch = lines[j].match(/^\s*\(([\s\S]*?)\)\s*$/)
        if (inlineMatch) {
          if ((inlineMatch[1] ?? "").trim().length === 0) {
            i = j
            continue
          }
          nextLines.push(line)
          continue
        }
        if (!/^\s*\(\s*$/.test(lines[j])) {
          nextLines.push(line)
          continue
        }
        j += 1
      }

      let closeIndex = null
      for (; j < lines.length; j++) {
        const t = lines[j].trim()
        if (groupLineCloseRegex.test(t)) {
          closeIndex = j
          break
        }
        if (t !== "") contentFound = true
      }
      if (closeIndex != null && !contentFound) {
        i = closeIndex
        continue
      }
    }
    nextLines.push(line)
  }
  return nextLines.join("\n").trimEnd()
}

  function collectStoredYears(prefix = memoKeyPrefix) {
    const years = new Set()
    const safePrefix = escapeRegExp(prefix)
    const textRe = new RegExp(`^${safePrefix}-text-(\\d{4})-`)
    const leftRe = new RegExp(`^${safePrefix}-left-text-(\\d{4})$`)
    const rightRe = new RegExp(`^${safePrefix}-right-text-(\\d{4})-`)
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key) continue
        let match = key.match(textRe)
        if (!match) match = key.match(leftRe)
        if (!match) match = key.match(rightRe)
        if (match) years.add(Number(match[1]))
      }
    } catch (err) { void err }
    return years
  }

  function migrateOfflineLegacyMemoKeys() {
    if (!isOfflineMemo) return
    try {
      if (localStorage.getItem(OFFLINE_MEMO_MIGRATION_KEY)) return
    } catch {
      return
    }

    const prefix = OFFLINE_MEMO_PREFIX
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key) continue
        let match = key.match(/^planner-text-(\d{4})-(.+)$/)
        if (match) {
          const nextKey = getMemoKey(prefix, match[1], match[2])
          if (localStorage.getItem(nextKey) == null) {
            localStorage.setItem(nextKey, localStorage.getItem(key) ?? "")
          }
          continue
        }
        match = key.match(/^planner-right-text-(\d{4})-(.+)$/)
        if (match) {
          const nextKey = getRightMemoKey(prefix, match[1], match[2])
          if (localStorage.getItem(nextKey) == null) {
            localStorage.setItem(nextKey, localStorage.getItem(key) ?? "")
          }
          continue
        }
        match = key.match(/^planner-left-text-(\d{4})$/)
        if (match) {
          const nextKey = getLeftMemoKey(prefix, match[1])
          if (localStorage.getItem(nextKey) == null) {
            localStorage.setItem(nextKey, localStorage.getItem(key) ?? "")
          }
        }
      }
      localStorage.setItem(OFFLINE_MEMO_MIGRATION_KEY, "1")
    } catch (err) { void err }
  }

  function migrateGroupTitleAcrossAllYears(oldTitle, newTitle) {
    if (!oldTitle || !newTitle || oldTitle === newTitle) return

    let changed = false
    const years = collectStoredYears()

    for (const year of years) {
      const allKey = getMemoKey(memoKeyPrefix, year, "all")
      const isActiveAllYear = activeWindowId === "all" && baseYearRef.current === year
      const storedAll = (() => {
        try {
          return localStorage.getItem(allKey)
        } catch {
          return null
        }
      })()
      const sourceAll = isActiveAllYear ? textRef.current ?? "" : storedAll

      if (sourceAll != null) {
        const nextAll = replaceGroupTitleInText(sourceAll, oldTitle, newTitle)
        if (nextAll !== sourceAll) {
          changed = true
          try {
            localStorage.setItem(allKey, nextAll)
          } catch (err) { void err }
          if (isActiveAllYear) updateEditorText(nextAll)
        }
      }

      if (isOfflineMemo) {
        const legacyLeftKey = `planner-left-text-${year}`
        try {
          const legacyLeft = localStorage.getItem(legacyLeftKey)
          if (legacyLeft != null) {
            const nextLeft = replaceGroupTitleInText(legacyLeft, oldTitle, newTitle)
            if (nextLeft !== legacyLeft) {
              localStorage.setItem(legacyLeftKey, nextLeft)
              changed = true
            }
          }
        } catch (err) { void err }
      }
    }

    if (isOfflineMemo) {
      try {
        const legacy = localStorage.getItem(LEGACY_KEY)
        if (legacy != null) {
          const nextLegacy = replaceGroupTitleInText(legacy, oldTitle, newTitle)
          if (nextLegacy !== legacy) {
            localStorage.setItem(LEGACY_KEY, nextLegacy)
            changed = true
          }
        }
      } catch (err) { void err }
    }

    if (changed) setDashboardSourceTick((x) => x + 1)
  }

  function pruneUnknownGroupsFromYear(year, allowedTitles, { skipTick = false } = {}) {
    const allText = getWindowMemoTextSync(year, "all")
    if (!allText) return false

    const parsedAll = parseBlocksAndItems(allText, year)
    if (parsedAll.blocks.length === 0) return false

    let nextAll = allText
    let changed = false
    for (const block of parsedAll.blocks) {
      const currentBody = getDateBlockBodyText(nextAll, year, block.dateKey)
      const updatedBody = stripUnknownGroupLines(currentBody, allowedTitles)
      if (updatedBody === currentBody) continue
      changed = true
      nextAll = updateDateBlockBody(nextAll, year, block.dateKey, updatedBody)
      const removeResult = removeEmptyBlockByDateKey(nextAll, year, block.dateKey)
      if (removeResult.changed) nextAll = removeResult.newText
    }

    if (!changed) return false

    nextAll = normalizePrettyAndMerge(nextAll, year)
    setWindowMemoTextSync(year, "all", nextAll)
    if (activeWindowId === "all" && baseYearRef.current === year) updateEditorText(nextAll)
    if (!skipTick) setDashboardSourceTick((x) => x + 1)
    return true
  }

  function pruneUnknownGroupsFromAllYears(allowedTitles) {
    const years = collectStoredYears()
    let changed = false
    for (const year of years) {
      const didChange = pruneUnknownGroupsFromYear(year, allowedTitles, { skipTick: true })
      if (didChange) changed = true
    }
    if (changed) setDashboardSourceTick((x) => x + 1)
  }

  function removeWindowDataFromAllYears(windowId, allowedTitles) {
    const years = collectStoredYears()
    for (const year of years) {
      try {
        localStorage.removeItem(getMemoKey(memoKeyPrefix, year, windowId))
        localStorage.removeItem(getRightMemoKey(memoKeyPrefix, year, windowId))
      } catch (err) { void err }
    }
    pruneUnknownGroupsFromAllYears(allowedTitles)
  }

  useEffect(() => {
    if (!windows || windows.length === 0) return
    let changed = false
    let next = windows.map((w) => ({ ...w }))
    const idsToRemove = new Set()
    const titleToId = new Map(next.map((w) => [String(w.title ?? "").trim(), w.id]))

    for (const w of next) {
      if (w.id === "all") continue
      const oldTitle = String(w.title ?? "").trim()
      const mapped = CATEGORY_ID_MAP[oldTitle]
      if (!mapped || mapped === oldTitle) continue

      migrateGroupTitleAcrossAllYears(oldTitle, mapped)
      migrateGroupTitleInSupabase(oldTitle, mapped)

      if (titleToId.has(mapped)) {
        idsToRemove.add(w.id)
        changed = true
        continue
      }

      titleToId.delete(oldTitle)
      titleToId.set(mapped, w.id)
      w.title = mapped
      changed = true
    }

    if (!changed) return
    if (idsToRemove.size > 0) {
      next = next.filter((w) => !idsToRemove.has(w.id))
      const allowedTitles = new Set(next.filter((w) => w.id !== "all").map((w) => w.title))
      for (const id of idsToRemove) {
        removeWindowDataFromAllYears(id, allowedTitles)
      }
    }
    setWindows(next)
  }, [windows, session?.user?.id])

  function applyTabEditToAllFromText(nextTabText) {
    if (activeWindowId === "all") return
    const targetWindow = windows.find((w) => w.id === activeWindowId)
    if (!targetWindow) return

    const allText = getWindowMemoTextSync(baseYear, "all")
    const tabGroupLinesByDate = parseTabEditGroupLineByDate(nextTabText ?? "", baseYear, targetWindow.title)

    let nextAll = allText
    const allParsed = parseBlocksAndItems(allText, baseYear)
    const allDates = new Set(allParsed.blocks.map((b) => b.dateKey))
    for (const key of Object.keys(tabGroupLinesByDate)) allDates.add(key)

    for (const key of allDates) {
      const currentBody = getDateBlockBodyText(nextAll, baseYear, key)
      const groupLine = tabGroupLinesByDate[key] ?? ""
      const updatedBody = updateGroupLineInBody(currentBody, targetWindow.title, groupLine)
      nextAll = updateDateBlockBody(nextAll, baseYear, key, updatedBody)
      const removeResult = removeEmptyBlockByDateKey(nextAll, baseYear, key)
      if (removeResult.changed) nextAll = removeResult.newText
    }

    nextAll = normalizePrettyAndMerge(nextAll, baseYear)
    setWindowMemoTextSync(baseYear, "all", nextAll)
    if (activeWindowId === "all") updateEditorText(nextAll)
    setDashboardSourceTick((x) => x + 1)
    scheduleCloudSync(nextAll, baseYear)
  }

  function applyTabEditToAll() {
    if (activeWindowId === "all") return
    const targetWindow = windows.find((w) => w.id === activeWindowId)
    if (!targetWindow) return

    const allText = getWindowMemoTextSync(baseYear, "all")
    const tabGroupLinesByDate = parseTabEditGroupLineByDate(tabEditText ?? "", baseYear, targetWindow.title)

    let nextAll = allText
    const allParsed = parseBlocksAndItems(allText, baseYear)
    const allDates = new Set(allParsed.blocks.map((b) => b.dateKey))
    for (const key of Object.keys(tabGroupLinesByDate)) allDates.add(key)

    for (const key of allDates) {
      const currentBody = getDateBlockBodyText(nextAll, baseYear, key)
      const groupLine = tabGroupLinesByDate[key] ?? ""
      const updatedBody = updateGroupLineInBody(currentBody, targetWindow.title, groupLine)
      nextAll = updateDateBlockBody(nextAll, baseYear, key, updatedBody)
      const removeResult = removeEmptyBlockByDateKey(nextAll, baseYear, key)
      if (removeResult.changed) nextAll = removeResult.newText
    }

    nextAll = normalizePrettyAndMerge(nextAll, baseYear)
    setWindowMemoTextSync(baseYear, "all", nextAll)
    if (activeWindowId === "all") updateEditorText(nextAll)
    setDashboardSourceTick((x) => x + 1)
    scheduleCloudSync(nextAll, baseYear)
  }

  useEffect(() => {
    if (isOfflineMemo) migrateOfflineLegacyMemoKeys()
  }, [isOfflineMemo])

  useEffect(() => {
    suppressSaveRef.current = true
    const saved = localStorage.getItem(memoKey)
    if (saved != null) {
      setText(saved)
      return
    }

    if (isOfflineMemo && activeWindowId === "all") {
      const legacyLeft = localStorage.getItem(legacyLeftKey)
      if (legacyLeft != null) {
        localStorage.setItem(memoKey, legacyLeft)
        setText(legacyLeft)
        return
      }

      const legacy = localStorage.getItem(LEGACY_KEY)
      if (legacy != null) {
        localStorage.setItem(memoKey, legacy)
        setText(legacy)
        return
      }
    }

    setText("")
  }, [memoKey, legacyLeftKey, isOfflineMemo])

  async function loadRightMemoFromSupabase(userId, year, windowId) {
    if (!supabase || !userId || !windowId) return null
    const { data, error } = await supabase
      .from("right_memos")
      .select("content")
      .eq("user_id", userId)
      .eq("year", year)
      .eq("window_id", windowId)
      .maybeSingle()
    if (error) return null
    return typeof data?.content === "string" ? data.content : ""
  }

  async function loadAllRightMemosForYearFromSupabase(userId, year) {
    if (!supabase || !userId) return {}
    const { data, error } = await supabase
      .from("right_memos")
      .select("window_id, content")
      .eq("user_id", userId)
      .eq("year", year)
    if (error) return {}
    const map = {}
    for (const row of data ?? []) {
      if (!row?.window_id) continue
      map[row.window_id] = typeof row?.content === "string" ? row.content : ""
    }
    return map
  }

  async function saveRightMemoToSupabase(userId, year, windowId, content) {
    if (!supabase || !userId || !windowId) return
    const nextText = String(content ?? "")
    const basePayload = {
      user_id: userId,
      year,
      window_id: windowId,
      content: nextText
    }
    if (rightMemoMetaColumnsSupportedRef.current) {
      const { error } = await supabase.from("right_memos").upsert(
        {
          ...basePayload,
          updated_at: new Date().toISOString(),
          client_id: clientIdRef.current
        },
        { onConflict: "user_id,year,window_id" }
      )
      if (!error) return
      if (!isRightMemoMetaColumnError(error)) throw error
      rightMemoMetaColumnsSupportedRef.current = false
    }
    const { error } = await supabase.from("right_memos").upsert(basePayload, {
      onConflict: "user_id,year,window_id"
    })
    if (error) throw error
  }

  function applyRemoteRightMemoWindowSync(windowId, rawText, year = baseYear) {
    const targetWindowId = String(windowId ?? "").trim()
    if (!targetWindowId) return
    const nextRaw = String(rawText ?? "")
    setRightWindowTextSync(year, targetWindowId, nextRaw)

    const isFocusedSpecificEditor =
      typeof document !== "undefined" &&
      rightTextareaRef.current &&
      document.activeElement === rightTextareaRef.current
    const hasPendingSpecificSave = Boolean(rightMemoSyncTimerRef.current)
    const pendingWrite = pendingRightMemoWritesRef.current?.[targetWindowId] ?? null
    if (pendingWrite && String(pendingWrite.text ?? "") === nextRaw) {
      delete pendingRightMemoWritesRef.current[targetWindowId]
    }

    if (activeWindowId === targetWindowId) {
      if (isFocusedSpecificEditor || hasPendingSpecificSave || (pendingWrite && String(pendingWrite.text ?? "") !== nextRaw)) return
      suppressRightSaveRef.current = true
      setRightMemoText(nextRaw)
      scheduleRightSaveUnsuppress()
      return
    }

    if (activeWindowId === "all") {
      if (pendingWrite && String(pendingWrite.text ?? "") !== nextRaw) return
      suppressRightSaveRef.current = true
      setRightMemoText(buildCombinedRightTextForYear(year))
      scheduleRightSaveUnsuppress()
    }
  }

  // ? 오른쪽 메모(연도별) 로드
  useEffect(() => {
    let cancelled = false
    suppressRightSaveRef.current = true

    if (activeWindowId === "all") {
      const fallbackAll = () => {
        const combined = buildCombinedRightTextForYear(baseYear)
        setRightMemoText(combined)
        scheduleRightSaveUnsuppress()
      }

      if (!supabase || !session?.user?.id) {
        fallbackAll()
        return
      }

      loadAllRightMemosForYearFromSupabase(session.user.id, baseYear)
        .then((windowTexts) => {
          if (cancelled) return
          const normalizedWindowTexts = {}
          for (const w of editableWindows) {
            const rawText = String(windowTexts?.[w.id] ?? "")
            normalizedWindowTexts[w.id] = buildRightMemoCombinedText(rawText)
            setRightWindowTextSync(baseYear, w.id, rawText)
          }
          const commonRawText = getRightWindowTextSync(baseYear, "all")
          const commonText = buildRightMemoCombinedText(commonRawText)
          setRightWindowTextSync(baseYear, "all", commonRawText)
          const combined = buildCombinedRightText(commonText, editableWindows, integratedFilters, normalizedWindowTexts)
          setRightMemoText(combined)
          scheduleRightSaveUnsuppress()
        })
        .catch(() => {
          if (cancelled) return
          fallbackAll()
        })

      return () => {
        cancelled = true
      }
    }

    const fallback = () => {
      try {
        const saved = localStorage.getItem(rightMemoKey)
        const rawText = String(saved ?? "")
        setRightMemoText(rawText)
        if (rawText && supabase && session?.user?.id) {
          saveRightMemoToSupabase(session.user.id, baseYear, activeWindowId, rawText)
        }
      } catch {
        setRightMemoText("")
      }
      scheduleRightSaveUnsuppress()
    }

    if (!supabase || !session?.user?.id) {
      fallback()
      return
    }

    loadRightMemoFromSupabase(session.user.id, baseYear, activeWindowId)
      .then((remoteText) => {
        if (cancelled) return
        if (remoteText != null) {
          const rawText = String(remoteText ?? "")
          setRightMemoText(rawText)
          try {
            localStorage.setItem(rightMemoKey, rawText)
          } catch (err) { void err }
          scheduleRightSaveUnsuppress()
        } else {
          fallback()
        }
      })
      .catch(() => {
        if (cancelled) return
        fallback()
      })

    return () => {
      cancelled = true
    }
  }, [rightMemoKey, baseYear, activeWindowId, editableWindows, integratedFilters, session?.user?.id])

  useEffect(() => {
    const userId = session?.user?.id
    if (!supabase || !userId) return
    const channel = supabase
      .channel(`right-memos-changes-${userId}-${baseYear}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "right_memos", filter: `user_id=eq.${userId}` },
        (payload) => {
          const changedYear = Number(payload?.new?.year ?? payload?.old?.year ?? NaN)
          if (Number.isFinite(changedYear) && changedYear !== baseYear) return

          const incomingClientId = String(payload?.new?.client_id ?? payload?.old?.client_id ?? "").trim()
          if (incomingClientId && incomingClientId === clientIdRef.current) return

          const targetWindowId = String(payload?.new?.window_id ?? payload?.old?.window_id ?? "").trim()
          if (!targetWindowId) return

          const nextRaw =
            payload?.eventType === "DELETE"
              ? ""
              : typeof payload?.new?.content === "string"
                ? payload.new.content
                : ""

          applyRemoteRightMemoWindowSync(targetWindowId, nextRaw, baseYear)
        }
      )
      .subscribe()

    return () => {
      try {
        supabase.removeChannel(channel)
      } catch (err) {
        void err
      }
    }
  }, [session?.user?.id, baseYear, activeWindowId, editableWindows, integratedFilters])


  useEffect(() => {
    if (suppressSaveRef.current) {
      suppressSaveRef.current = false
      return
    }
    localStorage.setItem(memoKey, text)
  }, [memoKey, text])

  useEffect(() => {
    return () => {
      if (rightSaveSuppressResetRef.current != null && typeof window !== "undefined") {
        cancelAnimationFrame(rightSaveSuppressResetRef.current)
        rightSaveSuppressResetRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (dayListSyncTimerRef.current) {
        clearTimeout(dayListSyncTimerRef.current)
        dayListSyncTimerRef.current = null
      }
      dayListPendingSyncRef.current = null
    }
  }, [])

  // ? 오른쪽 메모(연도별) 저장
  useEffect(() => {
    if (suppressRightSaveRef.current) {
      suppressRightSaveRef.current = false
      return
    }

    if (activeWindowId === "all") {
      return
    }

    try {
      localStorage.setItem(rightMemoKey, rightMemoText)
    } catch (err) { void err }

    const userId = session?.user?.id
    if (!supabase || !userId) return

    if (rightMemoSyncTimerRef.current) clearTimeout(rightMemoSyncTimerRef.current)

    const savedYear = baseYear
    const savedWindowId = activeWindowId
    const savedText = rightMemoText

    const flush = () => {
      if (savedWindowId === "all") {
        return
      }
      const latestText = savedWindowId === activeWindowId ? rightMemoTextRef.current : savedText
      pendingRightMemoWritesRef.current[savedWindowId] = {
        text: latestText,
        at: Date.now()
      }
      saveRightMemoToSupabase(userId, savedYear, savedWindowId, latestText)
    }

    const t = setTimeout(flush, 350)
    rightMemoSyncTimerRef.current = t

    return () => {
      if (rightMemoSyncTimerRef.current !== t) return
      clearTimeout(t)
      rightMemoSyncTimerRef.current = null
      flush()
    }
  }, [rightMemoKey, rightMemoText, activeWindowId, baseYear, session?.user?.id, editableWindows, integratedFilters])

  const leftOverlayLines = useMemo(() => {
    if (activeWindowId === "all") return buildMemoOverlayLines(text)
    return buildMemoOverlayLines(tabEditText)
  }, [activeWindowId, tabEditText, text])
  const rightOverlayLines = useMemo(() => {
    if (activeWindowId === "all") return []
    return buildMemoOverlayLines(rightMemoText)
  }, [activeWindowId, rightMemoText])

  useEffect(() => {
    syncOverlayScroll(textareaRef.current, leftOverlayInnerRef.current)
  }, [text, memoFontPx, memoInnerSplit])

  useEffect(() => {
    if (activeWindowId === "all") return
    syncOverlayScroll(rightTextareaRef.current, rightOverlayInnerRef.current)
  }, [activeWindowId, rightMemoText, memoFontPx, memoInnerSplit])

  useEffect(() => {
    updateMentionGhost()
  }, [activeWindowId, isEditingLeftMemo, tabEditText, windows])


  function getEditorTextSync(year) {
    return getLeftMemoTextSync(year)
  }

  const activeReadDateDraftKey =
    readDateDraft &&
    readDateDraft.windowId === activeWindowId &&
    readDateDraft.year === baseYear
      ? readDateDraft.dateKey
      : null

  // ===== 파싱 =====
  const parsed = useMemo(() => parseBlocksAndItems(text, baseYear), [text, baseYear])
  const dashboardSourceText = useMemo(() => {
    if (activeWindowId === "all") return text
    return getWindowMemoTextSync(baseYear, "all")
  }, [activeWindowId, baseYear, text, dashboardSourceTick])
  const dashboardParsed = useMemo(() => parseBlocksAndItems(dashboardSourceText, baseYear), [dashboardSourceText, baseYear])
  const dashboardBlocksSource = dashboardParsed.blocks
  const allowedDashboardGroupTitles = useMemo(() => {
    if (activeWindowId !== "all") return null
    const set = new Set()
    for (const w of windows) {
      if (w.id === "all") continue
      if (integratedFilters[w.id] !== false) set.add(w.title)
    }
    return set
  }, [activeWindowId, integratedFilters, windows])
  const activeRecurringCategoryTitle = useMemo(() => {
    if (activeWindowId === "all") return null
    return String(windows.find((w) => w.id === activeWindowId)?.title ?? "").trim()
  }, [activeWindowId, windows])
  const recurringItemsByDate = useMemo(() => {
    if (hasCloudSession) {
      return buildCloudRecurringByDate(remotePlans, baseYear, activeRecurringCategoryTitle || null)
    }
    const rangeStartKey = `${baseYear}-01-01`
    const rangeEndKey = `${baseYear}-12-31`
    return buildRecurringByDate(
      recurringRules,
      recurringOverrides,
      rangeStartKey,
      rangeEndKey,
      activeRecurringCategoryTitle || null
    )
  }, [baseYear, recurringRules, recurringOverrides, activeRecurringCategoryTitle, hasCloudSession, remotePlans])
  const tasksSourceText = useMemo(() => {
    if (activeWindowId === "all") return text
    return tabEditText ?? ""
  }, [activeWindowId, tabEditText, text])
  const textTasks = useMemo(() => extractTasksFromPlannerText(tasksSourceText, baseYear), [tasksSourceText, baseYear])
  const textTasksByDate = useMemo(() => {
    const map = {}
    for (const task of Array.isArray(textTasks) ? textTasks : []) {
      const dateKey = String(task?.dateKey ?? "").trim()
      if (!dateKey) continue
      ;(map[dateKey] ??= []).push({ ...task, sourceType: "text" })
    }
    for (const dateKey of Object.keys(map)) {
      map[dateKey].sort((a, b) => (a?.lineIndex ?? 0) - (b?.lineIndex ?? 0))
    }
    return map
  }, [textTasks])

  const cloudTaskItemsByDate = useMemo(() => {
    if (!hasCloudSession) return {}
    const map = {}
    const activeTitle =
      activeWindowId === "all"
        ? ""
        : normalizeCategoryId(String(windows.find((w) => w.id === activeWindowId)?.title ?? "").trim())

    for (const [index, row] of (remotePlans ?? []).entries()) {
      if (!row || row?.deleted_at || isRecurringPlanRow(row)) continue
      const dateKey = String(row?.date ?? "").trim()
      if (!dateKey.startsWith(`${baseYear}-`)) continue

      let category = normalizeCategoryId(String(row?.category_id ?? "").trim())
      if (isGeneralCategoryId(category)) category = ""
      if (activeWindowId === "all") {
        if (allowedDashboardGroupTitles && category && !allowedDashboardGroupTitles.has(category)) continue
      } else if (category !== activeTitle) {
        continue
      }

      const taskAware = stripTaskSuffix(String(row?.content ?? "").trim())
      const textValue = decodeTaskLineBreaks(String(taskAware?.text ?? "").trim())
      if (!textValue) continue
      const normalizedTime = normalizePlanTimeFields(row)
      const timeLabel = buildTimeSpanLabel(normalizedTime.time, normalizedTime.end_time)
      const sortOrder = parsePlanOrderValue(row?.sort_order ?? row?.sortOrder ?? row?.order)
      ;(map[dateKey] ??= []).push({
        id: `plan-${row.id ?? `${dateKey}-${index}`}`,
        rowId: row.id,
        row,
        dateKey,
        lineIndex: sortOrder ?? index,
        rawLine: buildPlanContentWithMeta(textValue, {
          completed: taskAware.completed
        }),
        baseRaw: textValue,
        completed: Boolean(taskAware.completed),
        time: timeLabel,
        title: category,
        sourceTitle: category,
        text: textValue,
        display: textValue,
        color: category ? windowColorByTitle.get(category) || "#64748b" : "#64748b",
        sourceType: "text",
        sortOrder,
        order: sortOrder ?? index
      })
    }

    for (const dateKey of Object.keys(map)) {
      map[dateKey].sort((a, b) => {
        const sortA = parsePlanOrderValue(a?.sortOrder)
        const sortB = parsePlanOrderValue(b?.sortOrder)
        if (sortA != null || sortB != null) {
          if (sortA == null) return 1
          if (sortB == null) return -1
          if (sortA !== sortB) return sortA - sortB
        }
        const timeA = String(a?.time ?? "")
        const timeB = String(b?.time ?? "")
        if (timeA && timeB && timeA !== timeB) return timeA.localeCompare(timeB)
        if (timeA && !timeB) return -1
        if (!timeA && timeB) return 1
        return String(a?.text ?? "").localeCompare(String(b?.text ?? ""), "ko")
      })
    }
    return map
  }, [
    activeWindowId,
    allowedDashboardGroupTitles,
    baseYear,
    hasCloudSession,
    remotePlans,
    windowColorByTitle,
    windows
  ])

  const recurringDisplayByDate = useMemo(() => {
    const recurringMap = {}
    const recurringTaskMap = {}
    for (const [dateKey, recurringItems] of Object.entries(recurringItemsByDate ?? {})) {
      for (const item of Array.isArray(recurringItems) ? recurringItems : []) {
        const parsed = parseRecurringRawLine(item?.rawLine, item?.title ?? "")
        if (!parsed.text) continue
      const baseItem = {
          ...item,
          display: parsed.display || item?.display || "",
          text: parsed.text,
          title: parsed.title || "",
          time: parsed.time || "",
          completed: Boolean(parsed.completed),
          isTask: true,
          baseRaw: parsed.baseRaw || String(item?.rawLine ?? "").trim(),
          sourceType: "recurring",
          sortOrder: parsePlanOrderValue(item?.row?.sort_order ?? item?.row?.sortOrder ?? item?.row?.order)
        }
        ;(recurringTaskMap[dateKey] ??= []).push(baseItem)
      }
    }
    for (const dateKey of Object.keys(recurringTaskMap)) {
      recurringTaskMap[dateKey].sort((a, b) => {
        const sortA = parsePlanOrderValue(a?.sortOrder)
        const sortB = parsePlanOrderValue(b?.sortOrder)
        if (sortA != null || sortB != null) {
          if (sortA == null) return 1
          if (sortB == null) return -1
          if (sortA !== sortB) return sortA - sortB
        }
        const timeA = String(a?.time ?? "")
        const timeB = String(b?.time ?? "")
        if (timeA && timeB && timeA !== timeB) return timeA.localeCompare(timeB)
        if (timeA && !timeB) return -1
        if (!timeA && timeB) return 1
        const createdA = String(a?.createdAt ?? "")
        const createdB = String(b?.createdAt ?? "")
        if (createdA && createdB && createdA !== createdB) return createdA.localeCompare(createdB)
        return String(a?.display ?? "").localeCompare(String(b?.display ?? ""), "ko")
      })
    }
    return { recurringMap, recurringTaskMap }
  }, [recurringItemsByDate])

  const recurringDisplayItemsByDate = recurringDisplayByDate.recurringMap
  const recurringTaskItemsByDate = recurringDisplayByDate.recurringTaskMap
  const combinedTaskItemsByDate = useMemo(() => {
    const map = {}
    const baseTaskItemsByDate = hasCloudSession ? cloudTaskItemsByDate : textTasksByDate
    for (const [dateKey, items] of Object.entries(baseTaskItemsByDate ?? {})) {
      map[dateKey] = [...items]
    }
    for (const [dateKey, items] of Object.entries(recurringTaskItemsByDate ?? {})) {
      map[dateKey] = [...(map[dateKey] ?? []), ...items]
      map[dateKey].sort((a, b) => {
        const sortA =
          parsePlanOrderValue(a?.sortOrder) ??
          (a?.sourceType === "text" && Number.isFinite(a?.lineIndex) ? a.lineIndex : null)
        const sortB =
          parsePlanOrderValue(b?.sortOrder) ??
          (b?.sourceType === "text" && Number.isFinite(b?.lineIndex) ? b.lineIndex : null)
        if (sortA != null || sortB != null) {
          if (sortA == null) return 1
          if (sortB == null) return -1
          if (sortA !== sortB) return sortA - sortB
        }
        const timeA = String(a?.time ?? "")
        const timeB = String(b?.time ?? "")
        if (timeA && timeB && timeA !== timeB) return timeA.localeCompare(timeB)
        if (timeA && !timeB) return -1
        if (!timeA && timeB) return 1
        if (a?.sourceType === "text" && b?.sourceType === "text") {
          return (a?.lineIndex ?? 0) - (b?.lineIndex ?? 0)
        }
        if (a?.sourceType === "recurring" && b?.sourceType === "recurring") {
          const createdA = String(a?.createdAt ?? "")
          const createdB = String(b?.createdAt ?? "")
          if (createdA && createdB && createdA !== createdB) return createdA.localeCompare(createdB)
        }
        return String(a?.display ?? "").localeCompare(String(b?.display ?? ""), "ko")
      })
    }
    return map
  }, [cloudTaskItemsByDate, hasCloudSession, textTasksByDate, recurringTaskItemsByDate])

  const dashboardByDate = useMemo(() => {
    const map = {}
    for (const block of dashboardBlocksSource) {
      const body = removeTaskLinesFromBody(dashboardSourceText.slice(block.bodyStartPos, block.blockEndPos))
      const parsedBlock = parseDashboardBlockContent(body)
      const entries = buildOrderedEntriesFromBody(body)
      const filteredGroups = allowedDashboardGroupTitles
        ? parsedBlock.groups.filter((group) => allowedDashboardGroupTitles.has(group.title))
        : parsedBlock.groups
      const filteredEntries = allowedDashboardGroupTitles
        ? entries.filter((entry) => !entry.title || allowedDashboardGroupTitles.has(entry.title))
        : entries
      if (filteredEntries.length === 0) continue
      map[block.dateKey] = {
        general: parsedBlock.general,
        groups: filteredGroups,
        timed: parsedBlock.timed,
        entries: filteredEntries
      }
    }
    return map
  }, [dashboardBlocksSource, dashboardSourceText, allowedDashboardGroupTitles])
  const dashboardBlocks = useMemo(() => {
    const out = []
    for (const block of dashboardBlocksSource) {
      const parsedBlock = dashboardByDate[block.dateKey]
      if (!parsedBlock) continue
      const orderedGroups = parsedBlock.groups
        .map((group, idx) => ({ group, idx }))
        .sort((a, b) => {
          const idxA = windowTitleRank.get(a.group.title)
          const idxB = windowTitleRank.get(b.group.title)
          const rankA = idxA != null ? idxA : Number.MAX_SAFE_INTEGER
          const rankB = idxB != null ? idxB : Number.MAX_SAFE_INTEGER
          if (rankA !== rankB) return rankA - rankB
          return a.idx - b.idx
        })
        .map((entry) => entry.group)
      out.push({
        dateKey: block.dateKey,
        general: parsedBlock.general,
        groups: orderedGroups,
        timed: parsedBlock.timed,
        entries: parsedBlock.entries ?? null
      })
    }
    if (activeWindowId === "all" && activeReadDateDraftKey && !out.some((block) => block.dateKey === activeReadDateDraftKey)) {
      out.push({
        dateKey: activeReadDateDraftKey,
        general: [],
        groups: [],
        timed: [],
        entries: [],
        forceVisible: true
      })
    }
    if (activeWindowId === "all") {
      for (const dateKey of Object.keys(recurringDisplayItemsByDate ?? {})) {
        if (out.some((block) => block.dateKey === dateKey)) continue
        out.push({
          dateKey,
          general: [],
          groups: [],
          timed: [],
          entries: [],
          forceVisible: true
        })
      }
      for (const dateKey of Object.keys(combinedTaskItemsByDate ?? {})) {
        if (out.some((block) => block.dateKey === dateKey)) continue
        out.push({
          dateKey,
          general: [],
          groups: [],
          timed: [],
          entries: [],
          forceVisible: true
        })
      }
    }
    out.sort((a, b) => keyToTime(a.dateKey) - keyToTime(b.dateKey))
    return out
  }, [
    activeReadDateDraftKey,
    activeWindowId,
    dashboardBlocksSource,
    dashboardByDate,
    windowTitleRank,
    recurringDisplayItemsByDate,
    combinedTaskItemsByDate
  ])

  function buildTabEditTextForTitle(title) {
    if (!title) return ""
    const out = []
    for (const block of dashboardBlocksSource) {
      const body = dashboardSourceText.slice(block.bodyStartPos, block.blockEndPos)
      const parsedBlock = parseDashboardBlockContent(body)
      const group = parsedBlock.groups.find((entry) => entry.title === title)
      const items = group?.items ?? []
      if (items.length === 0) continue
      const { y, m, d } = keyToYMD(block.dateKey)
      out.push(buildHeaderLine(y, m, d))
      for (const item of items) {
        const text = (item.text ?? "").trim()
        if (!text) continue
        out.push(item.time ? `${item.time};${text}` : text)
      }
      out.push("")
    }
    return out.join("\n").trimEnd()
  }

  function buildTabEditTextForTitleFromAllText(allText, year, title) {
    if (!title) return ""
    const source = allText ?? ""
    const parsed = parseBlocksAndItems(source, year)
    const out = []
    for (const block of parsed.blocks) {
      const body = source.slice(block.bodyStartPos, block.blockEndPos)
      const parsedBlock = parseDashboardBlockContent(body)
      const group = parsedBlock.groups.find((entry) => entry.title === title)
      const items = group?.items ?? []
      if (items.length === 0) continue
      const { y, m, d } = keyToYMD(block.dateKey)
      out.push(buildHeaderLine(y, m, d))
      for (const item of items) {
        const text = (item.text ?? "").trim()
        if (!text) continue
        out.push(item.time ? `${item.time};${text}` : text)
      }
      out.push("")
    }
    return out.join("\n").trimEnd()
  }

  const tabReadBlocks = useMemo(() => {
    if (activeWindowId === "all") return []
    const targetWindow = windows.find((w) => w.id === activeWindowId)
    if (!targetWindow) return []

    const tabItemsByDate = parseTabEditItemsFromText(tabEditText ?? "", baseYear, targetWindow.title)
    const out = Object.entries(tabItemsByDate)
      .filter(([, items]) => Array.isArray(items) && items.length > 0)
      .map(([dateKey, items]) => ({ dateKey, items }))
    if (activeReadDateDraftKey && !out.some((block) => block.dateKey === activeReadDateDraftKey)) {
      out.push({ dateKey: activeReadDateDraftKey, items: [], forceVisible: true })
    }
    for (const dateKey of Object.keys(recurringDisplayItemsByDate ?? {})) {
      if (out.some((block) => block.dateKey === dateKey)) continue
      out.push({ dateKey, items: [], forceVisible: true })
    }
    for (const dateKey of Object.keys(combinedTaskItemsByDate ?? {})) {
      if (out.some((block) => block.dateKey === dateKey)) continue
      out.push({ dateKey, items: [], forceVisible: true })
    }
    out.sort((a, b) => keyToTime(a.dateKey) - keyToTime(b.dateKey))
    return out
  }, [
    activeReadDateDraftKey,
    activeWindowId,
    baseYear,
    tabEditText,
    windows,
    recurringDisplayItemsByDate,
    combinedTaskItemsByDate
  ])

  const visibleMonthPrefix = `${viewYear}-${String(viewMonth).padStart(2, "0")}-`
  const visibleDashboardBlocks = useMemo(
    () => dashboardBlocks.filter((block) => String(block?.dateKey ?? "").startsWith(visibleMonthPrefix)),
    [dashboardBlocks, visibleMonthPrefix]
  )
  const visibleTabReadBlocks = useMemo(
    () => tabReadBlocks.filter((block) => String(block?.dateKey ?? "").startsWith(visibleMonthPrefix)),
    [tabReadBlocks, visibleMonthPrefix]
  )

  useEffect(() => {
    if (activeWindowId === "all") return
    if (isEditingLeftMemo) return
    const targetWindow = windows.find((w) => w.id === activeWindowId)
    if (!targetWindow) return
    setTabEditText(buildTabEditTextForTitle(targetWindow.title))
  }, [activeWindowId, baseYear, dashboardByDate, dashboardBlocksSource, isEditingLeftMemo, windows])

  useEffect(() => {
    if (activeWindowId === "all") return
    if (!isEditingLeftMemo) return
    const timer = setTimeout(() => {
      applyTabEditToAll()
    }, 250)
    return () => clearTimeout(timer)
  }, [activeWindowId, baseYear, isEditingLeftMemo, tabEditText, windows])
  const itemsByDate = useMemo(() => {
    const makeDisplayKey = (dateKey, item, fallbackTitle = "") => {
      const time = String(item?.time ?? "").trim()
      const title = String(item?.title ?? item?.sourceTitle ?? fallbackTitle ?? "").trim()
      const textValue = String(item?.text ?? item?.display ?? "").trim()
      return `${dateKey}|${time}|${title}|${textValue}`
    }
    const taskKeysByDate = new Map()
    for (const [dateKey, taskItems] of Object.entries(combinedTaskItemsByDate ?? {})) {
      const keys = new Set()
      for (const task of Array.isArray(taskItems) ? taskItems : []) {
        const textValue = String(task?.text ?? task?.display ?? "").trim()
        if (!textValue) continue
        keys.add(makeDisplayKey(dateKey, task))
      }
      taskKeysByDate.set(dateKey, keys)
    }
    const hasTaskDuplicate = (dateKey, item, fallbackTitle = "") =>
      taskKeysByDate.get(dateKey)?.has(makeDisplayKey(dateKey, item, fallbackTitle))

    if (activeWindowId === "all") {
      const out = {}
      for (const block of dashboardBlocksSource) {
        const parsedBlock = dashboardByDate[block.dateKey]
        if (!parsedBlock) continue
        const entries = parsedBlock.entries ?? []
        const orderedItems = []
        for (const entry of entries) {
          const text = String(entry?.text ?? "").trim()
          if (!text) continue
          const title = String(entry?.title ?? "").trim()
          if (allowedDashboardGroupTitles && title && !allowedDashboardGroupTitles.has(title)) continue
          if (hasTaskDuplicate(block.dateKey, { ...entry, text, title })) continue
          const color = title ? windowColorByTitle.get(title) || "#999" : "#999"
          const order = Number.isFinite(entry?.order) ? entry.order : 0
          const base = {
            id: `${block.dateKey}-${title || "general"}-${order}`,
            dateKey: block.dateKey,
            time: entry?.time ? String(entry.time).trim() : "",
            text,
            color,
            sourceTitle: title,
            isTask: false
          }
          orderedItems.push({ ...base, order })
        }
        orderedItems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        const bucket = orderedItems.map((item) => ({ ...item }))
        if (bucket.length > 0) out[block.dateKey] = bucket
      }
      for (const [dateKey, recurringItems] of Object.entries(recurringDisplayItemsByDate ?? {})) {
        const bucket = (Array.isArray(recurringItems) ? recurringItems : [])
          .map((item, idx) => {
            const text = String(item?.text ?? "").trim()
            if (!text) return null
            const title = String(item?.title ?? "").trim()
            if (hasTaskDuplicate(dateKey, { ...item, text, title })) return null
            const color = title ? windowColorByTitle.get(title) || "#999" : "#999"
            return {
              id: `${dateKey}-rec-${item.id}-${idx}`,
              dateKey,
              ...item,
              time: item?.time ? String(item.time).trim() : "",
              text,
              color,
              sourceTitle: title,
              sourceType: item?.sourceType ?? "recurring"
            }
          })
          .filter(Boolean)
        if (bucket.length > 0) out[dateKey] = (out[dateKey] ?? []).concat(bucket)
      }
    for (const [dateKey, taskItems] of Object.entries(combinedTaskItemsByDate ?? {})) {
      const bucket = (Array.isArray(taskItems) ? taskItems : [])
        .map((task, idx) => {
          const text = String(task?.text ?? task?.display ?? "").trim()
          if (!text) return null
          const title = String(task?.title ?? "").trim()
          if (allowedDashboardGroupTitles && title && !allowedDashboardGroupTitles.has(title)) return null
          return {
            id: `${dateKey}-task-${task.id}-${idx}`,
            dateKey,
            ...task,
            time: task?.time ? String(task.time).trim() : "",
            text,
            color: title ? windowColorByTitle.get(title) || "#999" : "#999",
            sourceTitle: title,
            isTask: true,
            completed: Boolean(task?.completed),
            sourceType: task?.sourceType ?? "text",
            order: Number.isFinite(task?.lineIndex) ? task.lineIndex : parsePlanOrderValue(task?.sortOrder ?? task?.order) ?? idx
          }
        })
        .filter(Boolean)
      if (bucket.length > 0) out[dateKey] = (out[dateKey] ?? []).concat(bucket)
      }
      return out
    }

    const targetWindow = windows.find((w) => w.id === activeWindowId)
    if (!targetWindow) return {}

    const tabItemsByDate = parseTabEditItemsFromText(tabEditText ?? "", baseYear, targetWindow.title)
    const out = {}
    for (const [key, items] of Object.entries(tabItemsByDate)) {
      if (!items || items.length === 0) continue
      const bucket = items
        .map((item, idx) => {
          const text = (item.text ?? "").trim()
          if (!text) return null
          if (hasTaskDuplicate(key, { ...item, text }, targetWindow.title)) return null
          return {
            id: `${key}-${targetWindow.id}-${idx}`,
            dateKey: key,
            time: item.time || "",
            text,
            color: targetWindow.color,
            sourceTitle: targetWindow.title,
            order: Number.isFinite(item?.order) ? item.order : idx,
            isTask: false
          }
        })
        .filter(Boolean)
      out[key] = (out[key] ?? []).concat(bucket)
    }
    for (const [dateKey, recurringItems] of Object.entries(recurringDisplayItemsByDate ?? {})) {
      const bucket = (Array.isArray(recurringItems) ? recurringItems : [])
        .map((item, idx) => {
          const text = String(item?.text ?? "").trim()
          if (!text) return null
          if (hasTaskDuplicate(dateKey, { ...item, text }, targetWindow.title)) return null
          return {
            id: `${dateKey}-rec-${targetWindow.id}-${idx}`,
            dateKey,
            ...item,
            time: item?.time ? String(item.time).trim() : "",
            text,
            color: targetWindow.color,
            sourceTitle: targetWindow.title,
            sourceType: item?.sourceType ?? "recurring"
          }
        })
        .filter(Boolean)
      if (bucket.length > 0) out[dateKey] = (out[dateKey] ?? []).concat(bucket)
    }
    for (const [dateKey, taskItems] of Object.entries(combinedTaskItemsByDate ?? {})) {
      const bucket = (Array.isArray(taskItems) ? taskItems : [])
        .map((task, idx) => {
          const text = String(task?.text ?? task?.display ?? "").trim()
          if (!text) return null
          return {
            id: `${dateKey}-task-${targetWindow.id}-${idx}`,
            dateKey,
            ...task,
            time: task?.time ? String(task.time).trim() : "",
            text,
            color: targetWindow.color,
            sourceTitle: targetWindow.title,
            isTask: true,
            completed: Boolean(task?.completed),
            sourceType: task?.sourceType ?? "text",
            order: Number.isFinite(task?.lineIndex) ? task.lineIndex : parsePlanOrderValue(task?.sortOrder ?? task?.order) ?? idx
          }
        })
        .filter(Boolean)
      if (bucket.length > 0) out[dateKey] = (out[dateKey] ?? []).concat(bucket)
    }
    return out
  }, [
    activeWindowId,
    baseYear,
    dashboardBlocksSource,
    dashboardByDate,
    parsed.items,
    tabEditText,
    windowTitleRank,
    windowColorByTitle,
    windows,
    allowedDashboardGroupTitles,
    recurringDisplayItemsByDate,
    combinedTaskItemsByDate
  ])

  function minutesToClockLabel(value) {
    const minutes = Math.max(0, Math.min(24 * 60, Math.round(Number(value) || 0)))
    const hour = Math.floor(minutes / 60)
    const minute = minutes % 60
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  }

  function clockToMinutes(value) {
    const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!match) return null
    const hour = Number(match[1])
    const minute = Number(match[2])
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
    if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null
    if (hour === 24 && minute !== 0) return null
    return hour * 60 + minute
  }

  function parseTimeBlockRange(time, endTime = "") {
    const raw = String(time ?? "").trim()
    const rawEnd = String(endTime ?? "").trim()
    if (!raw && !rawEnd) return { startMinutes: null, endMinutes: null }
    const match = raw.match(/^(\d{1,2}:\d{2})(?:\s*[~-]\s*(\d{1,2}:\d{2}))?$/)
    const start = clockToMinutes(match ? match[1] : raw)
    if (start == null) return { startMinutes: null, endMinutes: null }
    const parsedEnd = clockToMinutes(rawEnd) ?? clockToMinutes(match?.[2])
    const end = parsedEnd != null && parsedEnd > start ? parsedEnd : Math.min(24 * 60, start + 60)
    return { startMinutes: start, endMinutes: end }
  }

  function buildTimeBlockBodyWithUpdatedTime(bodyText, targetItem, nextTimeLabel) {
    const normalized = normalizeGroupLineNewlines(String(bodyText ?? ""))
    const lines = normalized.split("\n")
    const entries = []
    let order = 0

    function pushEntry({ time = "", title = "", rawText = "" }) {
      const text = String(rawText ?? "").trim()
      if (!text) return
      entries.push({
        time: String(time ?? "").trim(),
        title: normalizeCategoryId(String(title ?? "").trim()),
        rawText: text,
        order
      })
      order += 1
    }

    for (const rawLine of lines) {
      const trimmed = String(rawLine ?? "").trim()
      if (!trimmed) continue

      const semicolon = parseDashboardSemicolonLine(trimmed, { allowEmptyText: true })
      if (semicolon) {
        if (String(semicolon.text ?? "").trim()) {
          pushEntry({ time: semicolon.time || "", title: semicolon.group || "", rawText: semicolon.text })
        }
        continue
      }

      const groupMatch = trimmed.match(groupLineRegex)
      if (groupMatch) {
        const title = normalizeCategoryId(String(groupMatch[1] ?? "").trim())
        const parts = String(groupMatch[2] ?? "")
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)
        for (const part of parts) {
          const parsed = parseLeadingTimeDashboardLine(part, { allowEmptyText: true })
          pushEntry({
            time: parsed?.time || "",
            title: parsed?.group || title,
            rawText: parsed ? parsed.text : part
          })
        }
        continue
      }

      const leadingTime = parseLeadingTimeDashboardLine(trimmed, { allowEmptyText: true })
      if (leadingTime) {
        pushEntry({ time: leadingTime.time || "", title: leadingTime.group || "", rawText: leadingTime.text })
        continue
      }

      pushEntry({ rawText: trimmed })
    }

    const targetOrder = Number(targetItem?.order)
    const targetTitle = normalizeCategoryId(String(targetItem?.sourceTitle ?? targetItem?.title ?? "").trim())
    const targetText = String(targetItem?.text ?? targetItem?.display ?? "").trim()
    const targetTime = String(targetItem?.time ?? "").trim()
    let changed = false

    const nextEntries = entries.map((entry) => {
      if (changed) return entry
      const entryText = String(stripTaskSuffix(entry.rawText)?.text ?? entry.rawText ?? "").trim()
      const orderMatches = Number.isFinite(targetOrder) && entry.order === targetOrder
      const contentMatches =
        entryText === targetText &&
        normalizeCategoryId(entry.title) === targetTitle &&
        (!targetTime || String(entry.time ?? "").trim() === targetTime)
      if (!orderMatches && !contentMatches) return entry
      changed = true
      return { ...entry, time: nextTimeLabel }
    })

    if (!changed) return null
    return nextEntries
      .map((entry) => {
        const title = normalizeCategoryId(String(entry.title ?? "").trim())
        const rawText = String(entry.rawText ?? "").trim()
        if (!rawText) return ""
        if (title) return entry.time ? `${entry.time};@${title};${rawText}` : `@${title};${rawText}`
        return entry.time ? `${entry.time};${rawText}` : rawText
      })
      .filter(Boolean)
      .join("\n")
      .trimEnd()
  }

  function buildRecurringRawLineWithTime(item, nextTimeLabel = "") {
    const parsed = parseRecurringRawLine(item?.rawLine ?? item?.baseRaw ?? item?.text ?? "", item?.title ?? "")
    const textValue = String(parsed?.text ?? item?.text ?? item?.display ?? "").trim()
    if (!textValue) return ""
    const base = nextTimeLabel ? `${nextTimeLabel};${textValue}` : textValue
    return buildTaskMetaText(base, {
      completed: parsed?.isTask ? Boolean(parsed.completed) : null
    })
  }

  function updateRecurringTimeBlockOverride(item, nextTimeLabel = "") {
    const ruleId = String(item?.ruleId ?? item?.row?.id ?? "").trim()
    const dateKey = String(item?.dateKey ?? "").trim()
    if (!ruleId || !dateKey) return false
    const rawLine = buildRecurringRawLineWithTime(item, nextTimeLabel)
    if (!rawLine) return false
    const familyId = String(item?.familyId ?? ruleId).trim()
    const nextOverride = {
      id: genRecurringId("override"),
      familyId,
      ruleId,
      dateKey,
      mode: "replace",
      rawLine,
      updatedAt: new Date().toISOString()
    }
    setRecurringOverrides((prev) => {
      const list = Array.isArray(prev) ? prev : []
      const filtered = list.filter(
        (entry) =>
          !(
            String(entry?.ruleId ?? "").trim() === ruleId &&
            String(entry?.dateKey ?? "").trim() === dateKey
          )
      )
      return [...filtered, nextOverride]
    })
    return true
  }

  // ===== 선택된 날짜 =====
  const [selectedDateKey, setSelectedDateKey] = useState(null)
  const [lastEditedDateKey, setLastEditedDateKey] = useState(null)
  const timeBlockDateKey = selectedDateKey || lastEditedDateKey || todayKey
  const timeBlockItems = useMemo(() => {
    const dateKey = String(timeBlockDateKey ?? "").trim()
    if (!dateKey) return []
    const activeTitle =
      activeWindowId === "all"
        ? ""
        : normalizeCategoryId(String(windows.find((w) => w.id === activeWindowId)?.title ?? "").trim())

    if (hasCloudSession) {
      return (remotePlans ?? [])
        .filter((row) => {
          if (!row || row?.deleted_at) return false
          if (String(row?.date ?? "").trim() !== dateKey) return false
          let category = normalizeCategoryId(String(row?.category_id ?? "").trim())
          if (isGeneralCategoryId(category)) category = ""
          if (activeWindowId === "all") {
            if (allowedDashboardGroupTitles && category && !allowedDashboardGroupTitles.has(category)) return false
            return true
          }
          return category === activeTitle
        })
        .map((row, index) => {
          const taskAware = stripTaskSuffix(String(row?.content ?? "").trim())
          const textValue = String(taskAware?.text ?? "").trim()
          if (!textValue) return null
          let category = normalizeCategoryId(String(row?.category_id ?? "").trim())
          if (isGeneralCategoryId(category)) category = ""
          const normalizedTime = normalizePlanTimeFields(row)
          const timeLabel = buildTimeSpanLabel(normalizedTime.time, normalizedTime.end_time)
          const range = parseTimeBlockRange(normalizedTime.time, normalizedTime.end_time)
          const recurring = isRecurringPlanRow(row)
          return {
            id: `plan-${row.id ?? index}`,
            rowId: row.id,
            row,
            dateKey,
            time: timeLabel,
            startMinutes: range.startMinutes,
            endMinutes: range.endMinutes,
            text: textValue,
            color: category ? windowColorByTitle.get(category) || "#64748b" : "#64748b",
            sourceTitle: category,
            isTask: taskAware.completed != null,
            completed: Boolean(taskAware.completed),
            order: parsePlanOrderValue(row?.sort_order ?? row?.sortOrder ?? row?.order) ?? index,
            sourceType: recurring ? "recurring" : "text",
            canEdit: Boolean(row?.id)
          }
        })
        .filter(Boolean)
        .sort((a, b) => {
          const startA = Number.isFinite(a.startMinutes) ? a.startMinutes : Number.MAX_SAFE_INTEGER
          const startB = Number.isFinite(b.startMinutes) ? b.startMinutes : Number.MAX_SAFE_INTEGER
          if (startA !== startB) return startA - startB
          return (a.order ?? 0) - (b.order ?? 0)
        })
    }

    return (itemsByDate[dateKey] ?? []).map((item, index) => {
      const range = parseTimeBlockRange(item?.time)
      return {
        ...item,
        id: String(item?.id ?? `text-${dateKey}-${index}`),
        dateKey,
        startMinutes: range.startMinutes,
        endMinutes: range.endMinutes,
        color:
          item?.color ||
          windowColorByTitle.get(normalizeCategoryId(String(item?.sourceTitle ?? item?.title ?? "").trim())) ||
          "#64748b",
        sourceTitle: item?.sourceTitle ?? item?.title ?? "",
        order: Number.isFinite(item?.order) ? item.order : index,
        canEdit: !isScheduleReadOnly
      }
    })
  }, [
    activeWindowId,
    allowedDashboardGroupTitles,
    hasCloudSession,
    isScheduleReadOnly,
    itemsByDate,
    lastEditedDateKey,
    remotePlans,
    selectedDateKey,
    timeBlockDateKey,
    todayKey,
    windowColorByTitle,
    windows
  ])

  function selectTimeBlockDate(dateKey) {
    const key = String(dateKey ?? "").trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return
    const { y, m } = keyToYMD(key)
    if (baseYearRef.current !== y) {
      baseYearRef.current = y
      setBaseYear(y)
    }
    setView({ year: y, month: m })
    viewRef.current = { year: y, month: m }
    setActiveDateKey(key)
  }

  function shiftTimeBlockDate(amount) {
    const current = String(timeBlockDateKey ?? todayKey ?? "").trim()
    const next = addDaysToKey(current, amount)
    if (next) selectTimeBlockDate(next)
  }

  function openTimeBlockDate() {
    const key = String(timeBlockDateKey ?? todayKey ?? "").trim()
    selectTimeBlockDate(key)
    openPlanCreateModal(key)
  }

  async function handleTimeBlockChange(item, startMinutes, endMinutes) {
    const dateKey = String(item?.dateKey ?? timeBlockDateKey ?? "").trim()
    if (!dateKey) return
    const moveToNoTime = startMinutes == null || endMinutes == null
    const startTime = moveToNoTime ? "" : minutesToClockLabel(startMinutes)
    const endTime = moveToNoTime ? "" : minutesToClockLabel(endMinutes)
    const nextTimeLabel = moveToNoTime ? "" : `${startTime}-${endTime}`
    const isRecurringBlock = Boolean(
      item?.sourceType === "recurring" ||
        item?.repeatLabel ||
        item?.seriesId ||
        item?.familyId ||
        item?.row?.series_id ||
        item?.row?.seriesId
    )

    if (canUseWebRowPlanEdit && supabase && session?.user?.id && item?.rowId) {
      const userId = session.user.id
      const updatedAt = new Date().toISOString()
      const nextRowPatch = {
        time: startTime || null,
        updated_at: updatedAt,
        client_id: clientIdRef.current
      }
      if (endTimeSupportedRef.current) nextRowPatch.end_time = endTime || null
      if (isRecurringBlock && repeatColumnsSupportedRef.current) {
        Object.assign(nextRowPatch, {
          repeat_type: "none",
          repeat_interval: 1,
          repeat_days: null,
          repeat_until: null,
          series_id: null
        })
      }

      suspendRemotePlansLoads()
      setRemotePlans((prev) =>
        (prev ?? []).map((row) =>
          String(row?.id ?? "") === String(item.rowId)
            ? { ...row, ...nextRowPatch }
            : row
        )
      )

      const payload = { ...nextRowPatch }

      let { error } = await supabase
        .from("plans")
        .update(payload)
        .eq("id", item.rowId)
        .eq("user_id", userId)

      if (error && isEndTimeColumnError(error)) {
        endTimeSupportedRef.current = false
        const retryPayload = { ...payload }
        delete retryPayload.end_time
        const retry = await supabase
          .from("plans")
          .update(retryPayload)
          .eq("id", item.rowId)
          .eq("user_id", userId)
        error = retry.error
      }

      if (error && isRepeatColumnError(error)) {
        markRepeatFallbackNotice()
        const retryPayload = { ...payload }
        delete retryPayload.repeat_type
        delete retryPayload.repeat_interval
        delete retryPayload.repeat_days
        delete retryPayload.repeat_until
        delete retryPayload.series_id
        if (!endTimeSupportedRef.current) delete retryPayload.end_time
        const retry = await supabase
          .from("plans")
          .update(retryPayload)
          .eq("id", item.rowId)
          .eq("user_id", userId)
        error = retry.error
      }

      if (error && isEndTimeColumnError(error)) {
        endTimeSupportedRef.current = false
        const retryPayload = { ...payload }
        delete retryPayload.end_time
        if (!repeatColumnsSupportedRef.current) {
          delete retryPayload.repeat_type
          delete retryPayload.repeat_interval
          delete retryPayload.repeat_days
          delete retryPayload.repeat_until
          delete retryPayload.series_id
        }
        const retry = await supabase
          .from("plans")
          .update(retryPayload)
          .eq("id", item.rowId)
          .eq("user_id", userId)
        error = retry.error
      }

      if (error) {
        console.error("time block update", error)
        await loadRemotePlans(userId, { force: true })
      }
      return
    }

    if (isRecurringBlock) {
      updateRecurringTimeBlockOverride(item, nextTimeLabel)
      return
    }

    const isAll = activeWindowId === "all"
    const current = isAll ? textRef.current ?? text : tabEditText ?? ""
    const body = getDateBlockBodyText(current, baseYear, dateKey)
    const nextBody = buildTimeBlockBodyWithUpdatedTime(body, item, nextTimeLabel)
    if (nextBody == null || nextBody === body) return
    if (canUseWebRowPlanEdit) enqueueDayListSync(dateKey, nextBody, activeWindowId)
    if (isScheduleReadOnly) return
    const nextText = updateDateBlockBody(current, baseYear, dateKey, nextBody)
    if (nextText === current) return
    if (isAll) {
      updateEditorText(nextText)
      setWindowMemoTextSync(baseYear, "all", nextText)
      return
    }
    setTabEditText(nextText)
    setWindowMemoTextSync(baseYear, activeWindowId, nextText)
    applyTabEditToAllFromText(nextText)
  }

  function movePlanDraftToText(fields, targetIndex = null) {
    const rawLine = buildPlanRawLineFromDraftFields(fields)
    const sourceDateKey = String(fields.sourceItem?.dateKey ?? fields.dateKey ?? "").trim()
    const targetDateKey = String(fields.dateKey ?? "").trim()
    if (!sourceDateKey || !targetDateKey || !rawLine) return false

    const isAll = activeWindowId === "all"
    const current = isAll ? textRef.current ?? text : tabEditText ?? ""
    const sourceBody = getDateBlockBodyText(current, baseYear, sourceDateKey)
    const sourceEntries = collectPlanEntriesFromBody(sourceBody)
    const sourceIndex = sourceEntries.findIndex((entry) => planEntryMatchesItem(entry, fields.sourceItem))
    if (sourceIndex < 0) return false

    const replacementEntries = collectPlanEntriesFromBody(rawLine)
    const replacement = replacementEntries[0]
    if (!replacement) return false

    const requestedIndex = Number.isInteger(targetIndex) ? targetIndex : null
    let nextText = current
    let nextSourceBody = sourceBody
    let nextTargetBody = ""

    if (sourceDateKey === targetDateKey) {
      const nextEntries = [...sourceEntries]
      nextEntries.splice(sourceIndex, 1)
      let insertIndex = requestedIndex == null ? sourceIndex : requestedIndex
      if (requestedIndex != null && sourceIndex < insertIndex) insertIndex -= 1
      insertIndex = Math.max(0, Math.min(nextEntries.length, insertIndex))
      nextEntries.splice(insertIndex, 0, replacement)
      nextTargetBody = buildBodyFromPlanEntries(nextEntries)
      nextText = updateDateBlockBody(current, baseYear, sourceDateKey, nextTargetBody)
      nextSourceBody = nextTargetBody
    } else {
      const nextSourceEntries = [...sourceEntries]
      nextSourceEntries.splice(sourceIndex, 1)
      nextSourceBody = buildBodyFromPlanEntries(nextSourceEntries)
      nextText = updateDateBlockBody(current, baseYear, sourceDateKey, nextSourceBody)

      const targetBody = getDateBlockBodyText(nextText, baseYear, targetDateKey)
      const targetEntries = collectPlanEntriesFromBody(targetBody)
      const insertIndex = requestedIndex == null ? targetEntries.length : Math.max(0, Math.min(targetEntries.length, requestedIndex))
      targetEntries.splice(insertIndex, 0, replacement)
      nextTargetBody = buildBodyFromPlanEntries(targetEntries)
      nextText = updateDateBlockBody(nextText, baseYear, targetDateKey, nextTargetBody)
    }

    if (canUseWebRowPlanEdit) {
      enqueueDayListSync(sourceDateKey, nextSourceBody, activeWindowId)
      enqueueDayListSync(targetDateKey, nextTargetBody, activeWindowId)
    }
    if (isAll) {
      updateEditorText(nextText)
      setWindowMemoTextSync(baseYear, "all", nextText)
    } else {
      setTabEditText(nextText)
      setWindowMemoTextSync(baseYear, activeWindowId, nextText)
      applyTabEditToAllFromText(nextText)
    }
    return true
  }

  async function movePlanRowInCloud(item, targetDateKey, targetIndex = null) {
    if (!supabase || !session?.user?.id) return false
    const targetRow = item?.rowId || item?.row?.id ? item?.row ?? { id: item?.rowId } : findMatchingRemotePlanRow(item)
    const rowId = String(targetRow?.id ?? "").trim()
    if (!rowId) return false
    const userId = session.user.id
    const fullTargetRow = (remotePlans ?? []).find((row) => String(row?.id ?? "") === rowId) ?? targetRow
    const sourceDateKey = String(fullTargetRow?.date ?? item?.dateKey ?? "").trim()
    const nextDateKey = String(targetDateKey ?? "").trim()
    const canSetOrder = Boolean(sortOrderSupportedRef.current)
    const requestedIndex = Number.isInteger(targetIndex) ? targetIndex : null
    const updatedAtBase = Date.now()

    if (!canSetOrder) {
      if (sourceDateKey === nextDateKey) return false
      const updatedAt = new Date(updatedAtBase).toISOString()
      suspendRemotePlansLoads()
      setRemotePlans((prev) =>
        (prev ?? []).map((row) =>
          String(row?.id ?? "") === rowId ? { ...row, date: nextDateKey, updated_at: updatedAt, client_id: clientIdRef.current } : row
        )
      )
      const { error } = await supabase
        .from("plans")
        .update({ date: nextDateKey, updated_at: updatedAt, client_id: clientIdRef.current })
        .eq("id", rowId)
        .eq("user_id", userId)
      if (error) {
        console.error("move plan date", error)
        await loadRemotePlans(userId, { force: true })
        return false
      }
      return true
    }

    const rowsBefore = (remotePlans ?? [])
      .filter((row) => {
        if (!row || row?.deleted_at) return false
        return String(row?.date ?? "").trim() === nextDateKey
      })
      .sort((a, b) => {
        const orderA = parsePlanOrderValue(a?.sort_order ?? a?.sortOrder ?? a?.order)
        const orderB = parsePlanOrderValue(b?.sort_order ?? b?.sortOrder ?? b?.order)
        if (orderA != null || orderB != null) {
          if (orderA == null) return 1
          if (orderB == null) return -1
          if (orderA !== orderB) return orderA - orderB
        }
        const timeA = String(a?.time ?? "")
        const timeB = String(b?.time ?? "")
        if (timeA && timeB && timeA !== timeB) return timeA.localeCompare(timeB)
        if (timeA && !timeB) return -1
        if (!timeA && timeB) return 1
        return String(a?.content ?? "").localeCompare(String(b?.content ?? ""), "ko")
      })
    const currentIndex = rowsBefore.findIndex((row) => String(row?.id ?? "") === rowId)
    const rows = rowsBefore.filter((row) => String(row?.id ?? "") !== rowId)
    let insertIndex = requestedIndex == null ? rows.length : requestedIndex
    if (requestedIndex != null && currentIndex >= 0 && currentIndex < insertIndex) insertIndex -= 1
    insertIndex = Math.max(0, Math.min(rows.length, insertIndex))
    rows.splice(insertIndex, 0, { ...fullTargetRow, date: nextDateKey })
    const orderedRows = enforceTimedPlanOrderInSlots(rows)

    const updates = orderedRows
      .filter((row) => row?.id)
      .map((row, index) => ({
        id: row.id,
        user_id: userId,
        date: String(row?.id ?? "") === rowId ? nextDateKey : String(row?.date ?? nextDateKey).trim(),
        sort_order: index,
        updated_at: new Date(updatedAtBase + index).toISOString(),
        client_id: clientIdRef.current
      }))

    suspendRemotePlansLoads()
    const updateMap = new Map(updates.map((row) => [String(row.id), row]))
    setRemotePlans((prev) =>
      (prev ?? []).map((row) => {
        const update = updateMap.get(String(row?.id ?? ""))
        return update ? { ...row, ...update } : row
      })
    )

    const { error } = await supabase.from("plans").upsert(updates, { onConflict: "id" })
    if (error) {
      if (isSortOrderColumnError(error)) {
        sortOrderSupportedRef.current = false
        const updatedAt = new Date().toISOString()
        const retry = await supabase
          .from("plans")
          .update({ date: nextDateKey, updated_at: updatedAt, client_id: clientIdRef.current })
          .eq("id", rowId)
          .eq("user_id", userId)
        if (retry.error) {
          console.error("move plan date", retry.error)
          await loadRemotePlans(userId, { force: true })
          return false
        }
        return true
      }
      console.error("move plan order", error)
      await loadRemotePlans(userId, { force: true })
      return false
    }
    return true
  }

  async function handlePlanMoveDate(item, targetDateKey, targetIndex = null) {
    const nextDateKey = String(targetDateKey ?? "").trim()
    const sourceDateKey = String(item?.dateKey ?? "").trim()
    const hasTargetIndex = Number.isInteger(targetIndex)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDateKey) || !sourceDateKey) return
    if (sourceDateKey === nextDateKey && !hasTargetIndex) return
    const isRecurringMove = Boolean(
      item?.sourceType === "recurring" ||
        item?.repeatLabel ||
        item?.seriesId ||
        item?.familyId ||
        item?.row?.series_id
    )
    if (isRecurringMove) {
      const hasTime = Boolean(String(item?.time ?? item?.row?.time ?? "").trim())
      if (hasTime) {
        setAuthMessage("시간 있는 반복 일정은 시간순으로 고정돼요.")
        return
      }
      if (sourceDateKey !== nextDateKey) {
        setAuthMessage("반복 일정은 같은 날짜 안에서만 순서를 바꿀 수 있어요.")
        return
      }
      if (canUseWebRowPlanEdit && supabase && session?.user?.id) {
        const ok = await movePlanRowInCloud(item, nextDateKey, hasTargetIndex ? targetIndex : null)
        if (!ok) setAuthMessage("항목 이동에 실패했어요.")
      }
      setActiveDateKey(nextDateKey)
      return
    }
    const modalDraft = getPlanModalDraftFromItem(item, sourceDateKey)
    const fields = normalizePlanModalDraft({
      ...modalDraft,
      editMode: "edit",
      sourceItem: item,
      dateKey: nextDateKey
    })

    if (canUseWebRowPlanEdit && supabase && session?.user?.id) {
      const ok = await movePlanRowInCloud(item, nextDateKey, hasTargetIndex ? targetIndex : null)
      if (!ok) {
        setAuthMessage("항목 이동에 실패했어요.")
        return
      }
      setActiveDateKey(nextDateKey)
      return
    }

    if (movePlanDraftToText(fields, hasTargetIndex ? targetIndex : null)) {
      setActiveDateKey(nextDateKey)
    }
  }

  const collapsedForActive = dashboardCollapsedByWindow[activeWindowId] ?? {}

  function toggleDashboardCollapse(dateKey) {
    setDashboardCollapsedByWindow((prev) => {
      const next = { ...prev }
      const bucket = { ...(next[activeWindowId] ?? {}) }
      bucket[dateKey] = !bucket[dateKey]
      next[activeWindowId] = bucket
      return next
    })
  }

  function beginEditSession(entryKey) {
    editSessionRef.current = { id: editSessionRef.current.id + 1, entryKey: entryKey ?? null, lastChangeKey: null }
    lastCaretDateKeyRef.current = entryKey ?? null
  }

  function getDateKeyAtCaret(textValue, caretPos) {
    const s = String(textValue ?? "")
    const caret = clamp(Number(caretPos ?? 0), 0, s.length)
    const lines = s.split("\n")
    let lineIndex = 0
    let acc = 0
    for (let i = 0; i < lines.length; i++) {
      const len = lines[i].length
      if (caret <= acc + len) {
        lineIndex = i
        break
      }
      acc += len + 1
      lineIndex = i
    }
    for (let i = lineIndex; i >= 0; i--) {
      const key = getDateKeyFromLine(lines[i], baseYear)
      if (key) return key
    }
    return null
  }

  function enterEditMode() {
    if (isMainMemoReadOnly) return
    const targetKey = selectedDateKey ?? lastEditedDateKey ?? lastActiveDateKeyRef.current
    if (targetKey) {
      handleReadBlockClick(targetKey)
      return
    }
    beginEditSession(null)
    setIsEditingLeftMemo(true)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) el.focus()
    })
  }

  function handleReadBlockClick(dateKey) {
    if (!dateKey) return
    setActiveDateKey(dateKey)
    openPlanCreateModal(dateKey)
  }

  const READ_SCROLL_MARGIN_TOP = 16

  const readScrollContainerRef = useRef(null)
  const lastActiveDateKeyRef = useRef(null)
  const lastCaretDateKeyRef = useRef(null)
  const initialReadScrollPendingRef = useRef(true)
  const editSessionRef = useRef({ id: 0, entryKey: null, lastChangeKey: null })
  const calendarInteractingRef = useRef(false)
  const readDateCreateButtonRef = useRef(null)
  const readDateCreateInputRef = useRef(null)
  const [dayListModal, setDayListModal] = useState(null)
  const [dayListEditText, setDayListEditText] = useState("")
  const [dayListMode, setDayListMode] = useState("read")
  const dayListDirtyRef = useRef(false)
  const dayListView = useMemo(() => {
    if (!dayListModal) return null
    return parseDashboardBlockContent(removeTaskLinesFromBody(dayListEditText))
  }, [dayListModal, dayListEditText])
  const dayListReadItems = useMemo(() => {
    if (!dayListView) return null
    const isAll = activeWindowId === "all"
    const entries = buildOrderedEntriesFromBody(removeTaskLinesFromBody(dayListEditText))
    const filtered = isAll && allowedDashboardGroupTitles
      ? entries.filter((entry) => !entry.title || allowedDashboardGroupTitles.has(entry.title))
      : entries
    const orderedItems = filtered
      .map((entry) => ({
        time: entry.time || "",
        text: String(entry.text ?? "").trim(),
        title: isAll ? String(entry.title ?? "").trim() : "",
        order: entry.order ?? 0
      }))
      .filter((entry) => entry.text)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    return { isAll, orderedItems }
  }, [dayListView, dayListEditText, activeWindowId, allowedDashboardGroupTitles])

  useEffect(() => {
    dayListEditGuardRef.current.open = Boolean(dayListModal)
    dayListEditGuardRef.current.mode = dayListMode
    dayListEditGuardRef.current.dirty = dayListDirtyRef.current
  }, [dayListModal, dayListMode, dayListEditText])

  const setReadBlockRef = useCallback((dateKey) => {
    return (el) => {
      const map = readBlockRefs.current
      if (!map) return
      if (el) map.set(dateKey, el)
      else map.delete(dateKey)
    }
  }, [])

  useEffect(() => {
    initialReadScrollPendingRef.current = true
  }, [session?.user?.id])

  useEffect(() => {
    if (!initialReadScrollPendingRef.current) return
    if (session?.user?.id && !remoteLoaded) return
    if (isEditingLeftMemo) return
    if (activeWindowId !== "all") return
    if (dayListModal) return

    const list = Array.isArray(dashboardBlocks) ? dashboardBlocks : []
    if (list.length === 0) return

    const todayTime = keyToTime(todayKey)
    let targetKey = list.find((b) => b?.dateKey === todayKey)?.dateKey ?? ""
    if (!targetKey) {
      targetKey =
        list.find((b) => b?.dateKey && keyToTime(b.dateKey) >= todayTime)?.dateKey ??
        list[list.length - 1]?.dateKey ??
        ""
    }
    if (!targetKey) return

    const target = readBlockRefs.current?.get(targetKey)
    if (!target) return

    let rafId = 0
    let attempts = 0
    const tryScroll = () => {
      const container = readScrollContainerRef.current
      const nextTarget = readBlockRefs.current?.get(targetKey)
      if (!nextTarget) return
      if (container) {
        const containerRect = container.getBoundingClientRect()
        const targetRect = nextTarget.getBoundingClientRect()
        const nextTop = targetRect.top - containerRect.top + container.scrollTop - READ_SCROLL_MARGIN_TOP
        const clampedTop = Math.max(0, nextTop)
        container.scrollTop = clampedTop
        attempts += 1
        if (attempts < 8 && Math.abs(container.scrollTop - clampedTop) > 1) {
          rafId = requestAnimationFrame(tryScroll)
          return
        }
      } else {
        nextTarget.scrollIntoView({ block: "start", behavior: "auto" })
      }
      initialReadScrollPendingRef.current = false
    }

    rafId = requestAnimationFrame(tryScroll)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [activeWindowId, dayListModal, dashboardBlocks, isEditingLeftMemo, todayKey, session?.user?.id, remoteLoaded])

  useEffect(() => {
    if (isEditingLeftMemo) return
    if (!lastEditedDateKey) return
    const target = readBlockRefs.current?.get(lastEditedDateKey)
    if (!target) return
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "start", behavior: "smooth" })
    })
  }, [isEditingLeftMemo, lastEditedDateKey, activeWindowId])

  useEffect(() => {
    if (!dayListModal) {
      setDayListEditText("")
      dayListDirtyRef.current = false
      dayListEditGuardRef.current.dirty = false
      return
    }
    const sourceText = activeWindowId === "all" ? textRef.current ?? text : tabEditText ?? ""
    const body = getDateBlockBodyText(sourceText, baseYear, dayListModal.key)
    setDayListEditText(body)
    dayListDirtyRef.current = false
    dayListEditGuardRef.current.dirty = false
    setDayListMode("edit")
  }, [dayListModal ? dayListModal.key : null, baseYear, activeWindowId])

  useEffect(() => {
    if (!dayListModal) return
    if (dayListMode === "edit") return
    const sourceText = activeWindowId === "all" ? textRef.current ?? text : tabEditText ?? ""
    const body = getDateBlockBodyText(sourceText, baseYear, dayListModal.key)
    if (body === dayListEditText) return
    dayListDirtyRef.current = false
    dayListEditGuardRef.current.dirty = false
    setDayListEditText(body)
  }, [text, tabEditText, baseYear, activeWindowId, dayListModal ? dayListModal.key : null, dayListMode])

  const handleDayListEditTextChange = useCallback((next) => {
    dayListDirtyRef.current = true
    dayListEditGuardRef.current.dirty = true
    setDayListEditText(next)
  }, [])

  useEffect(() => {
    // Keep mobile as source of truth when text-sync is disabled.
    if (!ENABLE_WEB_TEXT_PLAN_SYNC) return
    if (!session?.user?.id || !remoteLoaded) return
    if (isEditingLeftMemo) return
    if (dayListModal && dayListMode === "edit") return
    if (sortOrderSyncTimerRef.current) clearTimeout(sortOrderSyncTimerRef.current)
    const sourceText =
      activeWindowId === "all"
        ? textRef.current ?? text
        : getWindowMemoTextSync(baseYear, "all") ?? textRef.current ?? text
    sortOrderSyncTimerRef.current = setTimeout(() => {
      syncSortOrderFromText(sourceText, baseYear)
    }, 600)
    return () => {
      if (sortOrderSyncTimerRef.current) {
        clearTimeout(sortOrderSyncTimerRef.current)
        sortOrderSyncTimerRef.current = null
      }
    }
  }, [
    text,
    baseYear,
    session?.user?.id,
    remoteLoaded,
    isEditingLeftMemo,
    dayListModal ? dayListModal.key : null,
    dayListMode,
    activeWindowId
  ])

  useEffect(() => {
    if (!isMainMemoReadOnly) return
    if (!isEditingLeftMemo) return
    setIsEditingLeftMemo(false)
  }, [isMainMemoReadOnly, isEditingLeftMemo])

  function scrollReadDateIntoView(dateKey, behavior = "smooth") {
    if (!dateKey) return
    let attempts = 0

    const tryScroll = () => {
      const container = readScrollContainerRef.current
      const target = readBlockRefs.current?.get(dateKey)
      if (!container || !target) {
        attempts += 1
        if (attempts < 10) requestAnimationFrame(tryScroll)
        return
      }
      const containerRect = container.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const nextTop = targetRect.top - containerRect.top + container.scrollTop - READ_SCROLL_MARGIN_TOP
      container.scrollTo({ top: Math.max(0, nextTop), behavior })
    }

    requestAnimationFrame(tryScroll)
  }

  function setActiveDateKey(key) {
    if (!key) return
    lastActiveDateKeyRef.current = key
    lastCaretDateKeyRef.current = key
    setSelectedDateKey(key)
    setLastEditedDateKey(key)

    const { y, m } = keyToYMD(key)
    if (viewRef.current.year !== y || viewRef.current.month !== m) {
      setView({ year: y, month: m })
      viewRef.current = { year: y, month: m }
    }
  }

  function applyDayListEdit(nextBody) {
    if (!dayListModal) return
    if (canUseWebRowPlanEdit) {
      enqueueDayListSync(dayListModal.key, nextBody, activeWindowId)
    }
    if (
      readDateDraft &&
      readDateDraft.windowId === activeWindowId &&
      readDateDraft.year === baseYear &&
      readDateDraft.dateKey === dayListModal.key &&
      String(nextBody ?? "").trim()
    ) {
      setReadDateDraft(null)
    }
    if (isScheduleReadOnly) return
    const isAll = activeWindowId === "all"
    const current = isAll ? textRef.current ?? text : tabEditText ?? ""
    const nextText = updateDateBlockBody(current, baseYear, dayListModal.key, nextBody)
    if (nextText === current) return
    if (isAll) {
      updateEditorText(nextText)
      setWindowMemoTextSync(baseYear, "all", nextText)
      return
    }
    setTabEditText(nextText)
    setWindowMemoTextSync(baseYear, activeWindowId, nextText)
    applyTabEditToAllFromText(nextText)
  }

  function openReadDateCreatePicker(anchorEl = null) {
    void anchorEl
    openPlanCreateModal(String(lastActiveDateKeyRef.current || selectedDateKey || lastEditedDateKey || todayKey || "").trim() || todayKey)
  }

  function ensureDateBlockExists(sourceText, year, dateKey) {
    const current = sourceText ?? ""
    const parsedNow = parseBlocksAndItems(current, year)
    const existing = parsedNow.blocks.find((block) => block.dateKey === dateKey)
    if (existing) return { newText: current, inserted: false }

    const targetTime = keyToTime(dateKey)
    const sortedBlocks = [...parsedNow.blocks].sort(
      (a, b) => keyToTime(a.dateKey) - keyToTime(b.dateKey) || a.blockStartPos - b.blockStartPos
    )

    let insertPos = current.length
    for (const block of sortedBlocks) {
      if (keyToTime(block.dateKey) > targetTime) {
        insertPos = block.blockStartPos
        break
      }
    }

    const { y, m, d } = keyToYMD(dateKey)
    const headerLine = buildHeaderLine(y, m, d)
    const inserted = insertDateBlockAt(current, insertPos, headerLine)
    return { newText: inserted.newText, inserted: true }
  }

  function handleReadDateCreateChange(e) {
    const key = String(e.target.value ?? "").trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return
    const { y, m } = keyToYMD(key)
    if (!Number.isFinite(y) || !Number.isFinite(m)) return

    setView({ year: y, month: m })
    viewRef.current = { year: y, month: m }
    if (baseYearRef.current !== y) {
      baseYearRef.current = y
      setBaseYear(y)
    }

    setReadDateDraft(null)

    if (activeWindowId === "all") {
      const current = textRef.current ?? text
      const ensured = ensureDateBlockExists(current, y, key)
      if (ensured.inserted) {
        updateEditorText(ensured.newText)
        setWindowMemoTextSync(y, "all", ensured.newText)
        setReadDateDraft({ windowId: "all", year: y, dateKey: key })
      }
    } else {
      const current = tabEditText ?? ""
      const ensured = ensureDateBlockExists(current, y, key)
      if (ensured.inserted) {
        setTabEditText(ensured.newText)
        setWindowMemoTextSync(y, activeWindowId, ensured.newText)
        setReadDateDraft({ windowId: activeWindowId, year: y, dateKey: key })
      }
    }

    setActiveDateKey(key)
    scrollReadDateIntoView(key, "smooth")
    openPlanCreateModal(key)
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
      const caretForTa2 = normalizeCaretForTextarea(ta2, a.caretPos)
      ta2.setSelectionRange(caretForTa2, caretForTa2)
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
  }, [text, tabEditText, activeWindowId, baseYear])


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
      const caretForTa = normalizeCaretForTextarea(ta, a.caretPos)
      ta.setSelectionRange(caretForTa, caretForTa)
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
    const value = ta.value ?? ""
    const caret = ta.selectionStart ?? 0
    const key = getDateKeyAtCaret(value, caret)
    if (!key) return
    lastActiveDateKeyRef.current = key
    lastCaretDateKeyRef.current = key
    setSelectedDateKey(key)

    const { y, m } = keyToYMD(key)
    if (viewRef.current.year !== y || viewRef.current.month !== m) {
      setView({ year: y, month: m })
      viewRef.current = { year: y, month: m }
    }
  }

  function updateMentionGhost() {
    if (activeWindowId === "all" || !isEditingLeftMemo) {
      if (mentionGhostText) setMentionGhostText("")
      return
    }
    const ta = textareaRef.current
    if (!ta) return
    if (ta.selectionStart !== ta.selectionEnd) {
      if (mentionGhostText) setMentionGhostText("")
      return
    }
    if (document.activeElement !== ta) {
      if (mentionGhostText) setMentionGhostText("")
      return
    }
    const value = ta.value ?? ""
    const caret = ta.selectionStart ?? 0
    const lineStart = value.lastIndexOf("\n", caret - 1)
    const linePrefix = value.slice(lineStart + 1, caret)
    if (linePrefix.trim() !== "@" || !linePrefix.endsWith("@")) {
      if (mentionGhostText) setMentionGhostText("")
      return
    }
    const activeWindow = windows.find((w) => w.id === activeWindowId)
    if (!activeWindow) {
      if (mentionGhostText) setMentionGhostText("")
      return
    }
    const mirror = mirrorRef.current
    const marker = markerRef.current
    if (!mirror || !marker) return

    const pos = measureCharPosPx(ta, mirror, marker, value, caret)
    setMentionGhostPos({ top: pos.top - ta.scrollTop, left: pos.left })
    setMentionGhostText(`${activeWindow.title}(`)
  }

  function getTabMentionAnchor(value, caret) {
    if (caret <= 0) return null
    const lineStart = value.lastIndexOf("\n", caret - 1)
    const linePrefix = value.slice(lineStart + 1, caret)
    const trimmed = linePrefix.replace(/\s+$/, "")
    if (!trimmed.endsWith("@")) return null
    const atIndex = trimmed.lastIndexOf("@")
    if (atIndex === -1) return null
    const before = trimmed.slice(0, atIndex)
    if (before.length > 0) {
      const prev = before[before.length - 1]
      if (prev !== ";" && !/\s/.test(prev)) return null
    }
    return { lineStart, anchorPos: lineStart + 1 + atIndex }
  }

  function updateTabMentionMenu() {
    if (activeWindowId !== "all" || !isEditingLeftMemo) {
      if (tabMentionMenu.visible) setTabMentionMenu({ visible: false, top: 0, left: 0 })
      return
    }
    const ta = textareaRef.current
    if (!ta) return
    if (ta.selectionStart !== ta.selectionEnd) {
      if (tabMentionMenu.visible) setTabMentionMenu({ visible: false, top: 0, left: 0 })
      return
    }
    if (document.activeElement !== ta) {
      if (tabMentionMenu.visible) setTabMentionMenu({ visible: false, top: 0, left: 0 })
      return
    }
    const value = ta.value ?? ""
    const caret = ta.selectionStart ?? 0
    const anchor = getTabMentionAnchor(value, caret)
    if (!anchor) {
      if (tabMentionMenu.visible) setTabMentionMenu({ visible: false, top: 0, left: 0 })
      return
    }
    if (editableWindows.length === 0) {
      if (tabMentionMenu.visible) setTabMentionMenu({ visible: false, top: 0, left: 0 })
      return
    }
    const mirror = mirrorRef.current
    const marker = markerRef.current
    if (!mirror || !marker) return

    const pos = measureCharPosPx(ta, mirror, marker, value, caret)
    const lh = getLineHeightPx(ta)
    if (!tabMentionMenu.visible) {
      const firstId = editableWindows[0]?.id ?? null
      if (firstId !== tabMentionHoverId) setTabMentionHoverId(firstId)
    }
    setTabMentionMenu({
      visible: true,
      top: pos.top - ta.scrollTop + lh,
      left: pos.left
    })
  }

  function handleTabMentionPick(title) {
    const ta = textareaRef.current
    if (!ta) return
    const value = ta.value ?? ""
    const caret = ta.selectionStart ?? 0
    const anchor = getTabMentionAnchor(value, caret)
    if (!anchor) return

    const nextChar = value[caret] ?? ""
    const insert = `@${title}${nextChar === ";" ? "" : ";"}`
    const nextText = value.slice(0, anchor.anchorPos) + insert + value.slice(caret)
    const caretPos = anchor.anchorPos + insert.length

    updateEditorText(nextText)
    setTabMentionMenu({ visible: false, top: 0, left: 0 })
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(caretPos, caretPos)
      }
    })
  }

  function handleTabMentionKeyDown(e) {
    if (activeWindowId !== "all") return false
    if (!tabMentionMenu.visible) return false
    if (editableWindows.length === 0) return false

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      setTabMentionHoverId((prev) => {
        const currentIndex = editableWindows.findIndex((w) => w.id === prev)
        const baseIndex = currentIndex >= 0 ? currentIndex : 0
        const delta = e.key === "ArrowDown" ? 1 : -1
        const nextIndex = (baseIndex + delta + editableWindows.length) % editableWindows.length
        return editableWindows[nextIndex]?.id ?? null
      })
      return true
    }
    if (e.key === "Enter") {
      e.preventDefault()
      const activeId = tabMentionHoverId ?? editableWindows[0]?.id
      const target = editableWindows.find((w) => w.id === activeId) ?? editableWindows[0]
      if (target) handleTabMentionPick(target.title)
      return true
    }
    if (e.key === "Escape") {
      e.preventDefault()
      setTabMentionMenu({ visible: false, top: 0, left: 0 })
      return true
    }
    return false
  }

  useEffect(() => {
    if (!tabMentionMenu.visible) return

    function onDocPointerDown(e) {
      const menu = tabMentionRef.current
      const ta = textareaRef.current
      const t = e.target
      if (!(t instanceof Node)) return
      if ((menu && menu.contains(t)) || (ta && ta.contains(t))) return
      setTabMentionMenu({ visible: false, top: 0, left: 0 })
    }

    document.addEventListener("pointerdown", onDocPointerDown, true)
    return () => document.removeEventListener("pointerdown", onDocPointerDown, true)
  }, [tabMentionMenu.visible])

  function acceptMentionGhost(e) {
    if (e.key !== "Enter") return false
    if (activeWindowId === "all") return false
    if (!mentionGhostText) return false
    const ta = textareaRef.current
    if (!ta) return false

    e.preventDefault()
    const value = ta.value ?? ""
    const caret = ta.selectionStart ?? 0
    const nextText = value.slice(0, caret) + mentionGhostText + value.slice(caret)
    const nextCaret = caret + mentionGhostText.length
    setTabEditText(nextText)
    setMentionGhostText("")
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(nextCaret, nextCaret)
      }
    })
    return true
  }

  function handleBoxEnterKey(e, value, taRef, setValue) {
    if (e.key !== "Enter") return
    if (activeWindowId === "all") return
    const ta = taRef?.current
    if (!ta) return
    if (ta.selectionStart !== ta.selectionEnd) return

    const textValue = value ?? ""
    const caret = ta.selectionStart ?? 0
    const lineStart = textValue.lastIndexOf("\n", caret - 1) + 1
    const lineEndRaw = textValue.indexOf("\n", caret)
    const lineEnd = lineEndRaw === -1 ? textValue.length : lineEndRaw
    const line = textValue.slice(lineStart, lineEnd)
    const dateKey = getDateKeyFromLine(line, baseYear)
    if (!dateKey) return

    const targetWindow = windows.find((w) => w.id === activeWindowId)
    if (!targetWindow) return

    e.preventDefault()
    let workingText = textValue
    if (lineEndRaw === -1) {
      workingText = textValue.slice(0, lineEnd) + "\n" + textValue.slice(lineEnd)
    }
    const ensured = ensureTabGroupLineAtDate(workingText, dateKey, targetWindow.title, baseYear)
    const headerPos = ensured.headerPos ?? lineStart
    const caretPos = ensured.caretPos ?? lineEnd + 1
    if (ensured.newText !== workingText) {
      pendingJumpRef.current = { headerPos, caretPos, topOffsetLines: 1 }
      setValue(ensured.newText)
      return
    }
    if (workingText !== textValue) {
      pendingJumpRef.current = { headerPos, caretPos, topOffsetLines: 1 }
      setValue(workingText)
      return
    }
    scheduleJump(headerPos, caretPos, 1)
  }

  function onTextareaSelectOrKeyUp() {
    updateCalendarFromMemoCaret()
    updateMentionGhost()
    updateTabMentionMenu()
  }

  // ===== blur 정리 + 빈 블록이면 삭제 =====
  function onTextareaBlur() {
    if (tabMentionMouseDownRef.current) {
      tabMentionMouseDownRef.current = false
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (el) el.focus()
      })
      return
    }
    if (tabMentionMenu.visible) setTabMentionMenu({ visible: false, top: 0, left: 0 })

    const exitKey =
      editSessionRef.current.lastChangeKey ||
      lastCaretDateKeyRef.current ||
      editSessionRef.current.entryKey ||
      selectedDateKey ||
      lastActiveDateKeyRef.current
    if (exitKey) setLastEditedDateKey(exitKey)

    if (activeWindowId !== "all") {
      let nextTabText = tabEditText ?? ""
      let changed = false
      const stripped = stripEmptyGroupLines(nextTabText)
      if (stripped !== nextTabText) {
        nextTabText = stripped
        changed = true
      }
      const cleaned = removeAllEmptyBlocks(nextTabText, baseYear, { allowAnyYear: true })
      if (cleaned.changed) {
        nextTabText = cleaned.newText
        changed = true
      }
      if (changed) {
        setTabEditText(nextTabText)
        setWindowMemoTextSync(baseYear, activeWindowId, nextTabText)
        applyTabEditToAllFromText(nextTabText)
      } else {
        applyTabEditToAll()
      }
      setIsEditingLeftMemo(false)
      if (mentionGhostText) setMentionGhostText("")
      return
    }
    const ta = textareaRef.current
    if (!ta) return
    const current = ta.value ?? ""

    let normalized = stripEmptyGroupLines(current)
    const cleaned = removeAllEmptyBlocks(normalized, baseYear, { allowAnyYear: true })
    if (cleaned.changed) normalized = cleaned.newText
    normalized = normalizePrettyAndMerge(normalized, baseYear, { allowAnyYear: true })

    if (normalized !== current) {
      updateEditorText(normalized)
    }
    scheduleCloudSync(normalized, baseYear)
    if (!calendarInteractingRef.current) {
      setSelectedDateKey(null)
      lastActiveDateKeyRef.current = null
    }
    setIsEditingLeftMemo(false)
  }

  // ===== 달력 클릭 =====
  function handleDayClick(day) {
    const { year, month } = viewRef.current
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    setActiveDateKey(key)
    openPlanCreateModal(key)
  }

  function handleCalendarDateRangeCreate(startDateKey, endDateKey) {
    const start = String(startDateKey ?? "").trim()
    const end = String(endDateKey ?? startDateKey ?? "").trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return
    const normalizedStart = start <= end ? start : end
    const normalizedEnd = start <= end ? end : start
    setActiveDateKey(normalizedStart)
    openPlanCreateModal(normalizedStart, {
      endDateKey: normalizedEnd,
      repeat: "daily",
      repeatInterval: 1
    })
  }

  // ===== Today 버튼 동작 =====
  function goToday() {
    const now = new Date()
    setToday(now)
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    const d = now.getDate()
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    if (isMainMemoReadOnly) {
      setView({ year: y, month: m })
      viewRef.current = { year: y, month: m }
      setBaseYear(y)
      setActiveDateKey(key)
      scrollReadDateIntoView(key, "smooth")
      return
    }

    if (!isEditingLeftMemo) beginEditSession(key)
    setIsEditingLeftMemo(true)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) el.focus()
    })
    setActiveDateKey(key)

    if (activeWindowId !== "all") {
      const targetWindow = windows.find((w) => w.id === activeWindowId)
      if (!targetWindow) return

      const sameYear = baseYearRef.current === y
      if (!sameYear) {
        baseYearRef.current = y
        setBaseYear(y)
      }

      const baseTabText = sameYear
        ? tabEditText ?? ""
        : buildTabEditTextForTitleFromAllText(getWindowMemoTextSync(y, "all"), y, targetWindow.title)
      const currentText = baseTabText
      const blocksNow = parseBlocksAndItems(currentText, y).blocks
      const existing = blocksNow.find((b) => b.dateKey === key)

      if (existing) {
        const ensured = ensureTabGroupLineAtDate(currentText, key, targetWindow.title, y)
        if (ensured.newText !== currentText) {
          pendingJumpRef.current = {
            headerPos: ensured.headerPos ?? existing.headerStartPos,
            caretPos: ensured.caretPos ?? existing.bodyStartPos,
            topOffsetLines: 1
          }
          setTabEditText(ensured.newText)
        } else {
          scheduleJump(existing.headerStartPos, ensured.caretPos ?? existing.bodyStartPos, 1)
        }
      } else {
        const targetTime = keyToTime(key)
        const byDate = [...blocksNow].sort(
          (a, b) => keyToTime(a.dateKey) - keyToTime(b.dateKey) || a.blockStartPos - b.blockStartPos
        )

        let insertPos = currentText.length
        for (const b of byDate) {
          if (keyToTime(b.dateKey) > targetTime) {
            insertPos = b.blockStartPos
            break
          }
        }

        const headerLine = buildHeaderLine(y, m, d)
        const { newText: insertedText, headerStartPos, bodyStartPos } = insertDateBlockAt(
          currentText,
          insertPos,
          headerLine
        )
        pendingJumpRef.current = { headerPos: headerStartPos, caretPos: bodyStartPos, topOffsetLines: 1 }
        const ensured = ensureTabGroupLineAtDate(insertedText, key, targetWindow.title, y)
        pendingJumpRef.current.caretPos = ensured.caretPos ?? pendingJumpRef.current.caretPos
        setTabEditText(ensured.newText)
      }
      return
    }

    const switchingYear = baseYearRef.current !== y

    const yearText = switchingYear
      ? getEditorTextSync(y)
      : (textareaRef.current ? textareaRef.current.value : textRef.current) ?? ""
    let workingText = yearText

    const parsedNow = parseBlocksAndItems(workingText, y)
    const blocksNow = parsedNow.blocks
    const existing = blocksNow.find((b) => b.dateKey === key)

    if (existing) {
      const { newText, caretPos } = ensureBodyLineForBlock(workingText, existing)
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
      const newText = insertedText
      pendingJumpRef.current = { headerPos: headerStartPos, caretPos: bodyStartPos, topOffsetLines: 1 }
      workingText = newText
    }

    if (switchingYear) {
      setLeftMemoTextSync(y, workingText)
      suppressSaveRef.current = true
      baseYearRef.current = y
      setBaseYear(y)
      setText(workingText)
      textRef.current = workingText
      return
    }

    const currentSameYearText = (textareaRef.current ? textareaRef.current.value : textRef.current) ?? ""
    if (workingText !== currentSameYearText) {
      updateEditorText(workingText)
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
  const lastDay = daysInMonth(viewYear, viewMonth)
  const firstWeekday = dayOfWeek(viewYear, viewMonth, 1)
  const weeks = Math.ceil((firstWeekday + lastDay) / 7)

  // ===== 달력: 셀 높이 자동 =====
  useEffect(() => {
    const panel = calendarPanelRef.current
    const top = calendarTopRef.current
    if (!panel || !top) return

    const recalcCalendarCellHeight = () => {
      const panelH = panel.clientHeight
      const topH = top.offsetHeight
      const paddingAndGaps = 6 * 2 + 22
      const usable = Math.max(0, panelH - topH - paddingAndGaps)
      const h = usable > 0 ? Math.floor(usable / weeks) : 110
      const next = Math.max(86, h)
      setCalendarCellH((prev) => (prev === next ? prev : next))
    }

    recalcCalendarCellHeight()

    let ro = null
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(recalcCalendarCellHeight)
      ro.observe(panel)
      ro.observe(top)
    }
    window.addEventListener("resize", recalcCalendarCellHeight)

    return () => {
      if (ro) ro.disconnect()
      window.removeEventListener("resize", recalcCalendarCellHeight)
    }
  }, [weeks, outerCollapsed, layoutPreset])

  // ===== 리사이즈(달력/메모 스플릿) =====
  const draggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartRatioRef = useRef(0)

  function getOuterSplitBounds(containerW) {
    const safeW = Math.max(1, Number(containerW) || 1)
    const availableW = Math.max(0, safeW - OUTER_SPLIT_GAP_PX)
    const maxMemoPxForCalendar = Math.max(0, availableW - MIN_CALENDAR_PANEL_PX)
    const minMemoPx = Math.min(MIN_MEMO_PANEL_PX, maxMemoPxForCalendar)
    const maxMemoPx = Math.max(minMemoPx, maxMemoPxForCalendar)
    return {
      minRatio: minMemoPx / safeW,
      maxRatio: maxMemoPx / safeW
    }
  }

  function clampOuterSplitRatio(ratio, containerW) {
    const bounds = getOuterSplitBounds(containerW)
    return clamp(ratio, bounds.minRatio, bounds.maxRatio)
  }

  useEffect(() => {
    if (outerCollapsed !== "none") return
    function clampCurrentSplit() {
      const rect = layoutRef.current?.getBoundingClientRect?.()
      const width = rect?.width ?? 0
      if (!width) return
      setSplitRatio((prev) => clampOuterSplitRatio(prev, width))
    }
    clampCurrentSplit()
    window.addEventListener("resize", clampCurrentSplit)
    return () => window.removeEventListener("resize", clampCurrentSplit)
  }, [outerCollapsed, layoutPreset])

  function beginDrag(e) {
    if (outerCollapsed !== "none") return
    draggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartRatioRef.current = splitRatio
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch (err) { void err }
  }

  function onDragMove(e) {
    if (outerCollapsed !== "none") return
    // ? 메모 내부 드래그 중이면, 바깥 스플릿은 반응하지 않게
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

    const next = clampOuterSplitRatio(nextMemoPx / containerW, containerW)
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

  const ui = themes[theme] ?? themes.light
  const highlightTokens = useMemo(
    () => ({
      today: {
        ring: ui.todayRing,
        soft: ui.todaySoft,
        pillText: theme === "dark" ? "#818fc6" : ui.todayRing
      },
      selected: { ring: ui.accent, soft: ui.accentSoft },
      hover: { ring: ui.accent }
    }),
    [theme, ui]
  )

  const iconButton = {
    width: 28,
    height: 26,
    borderRadius: 6,
    border: `1px solid ${ui.border}`,
    background: ui.surface,
    color: ui.text,
    cursor: "pointer",
    fontWeight: 680,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: theme === "dark" ? "none" : "0 1px 0 rgba(15, 23, 42, 0.04)"
  }

  const arrowButton = {
    ...iconButton,
    border: "1px solid var(--arrow-border)",
    background: "var(--arrow-bg)",
    color: "var(--arrow-color)",
    boxShadow: "var(--arrow-shadow)",
    opacity: "var(--arrow-opacity)",
    transition: "opacity 140ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease"
  }

  const authInputStyle = {
    height: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: `1px solid ${ui.border}`,
    background: ui.surface2,
    color: ui.text,
    fontFamily: "inherit",
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: "0.01em"
  }

  // navArrowButton removed (reverted to original iconButton usage)

  const memoTopRightButton = {
    ...iconButton,
    width: 36,
    height: 34
  }

  const compactLayoutToggleButton = {
    ...memoTopRightButton,
    padding: 0,
    fontSize: 18,
    fontWeight: 680,
    flexShrink: 0
  }

  const controlInput = {
    height: 34,
    padding: "0 10px",
    borderRadius: 6,
    border: `1px solid ${ui.border}`,
    background: ui.surface,
    color: ui.text,
    fontFamily: "inherit",
    fontWeight: 680,
    outline: "none"
  }

  const settingsNumberInput = {
    ...controlInput,
    height: 22,
    padding: "0 6px",
    borderRadius: 6,
    textAlign: "center",
    fontWeight: 600,
    fontSize: 13
  }

  const panelFontFamily = "Pretendard Variable, Pretendard, 'Noto Sans KR', 'Apple SD Gothic Neo', system-ui, sans-serif"

  const pillButton = {
    height: 34,
    padding: "0 12px",
    borderRadius: 6,
    border: `1px solid ${ui.border}`,
    background: ui.surface,
    color: ui.text,
    fontFamily: "inherit",
    cursor: "pointer",
    fontWeight: 680,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    whiteSpace: "nowrap"
  }

  function PlannerLogoMark() {
    return (
      <div
        aria-label="Planner"
        title="Planner"
        style={{
          width: 34,
          height: 34,
          borderRadius: 6,
          border: `1px solid ${ui.border}`,
          background: theme === "dark" ? ui.surface : "linear-gradient(135deg, #ffffff 0%, #f6fbff 100%)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "0 0 auto",
          boxShadow: theme === "dark" ? "none" : "0 1px 0 rgba(15, 23, 42, 0.04)"
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M4 4.8 14.3 2.6 10.8 10.2 20 7.7 8.1 21.4 11.1 13.2 4 4.8Z"
            fill={ui.accent}
            opacity="0.96"
          />
          <path d="M7.7 7.2 14.3 2.6 10.8 10.2Z" fill="#7dd3fc" opacity="0.92" />
          <path d="M11.1 13.2 20 7.7 8.1 21.4Z" fill="#34d399" opacity="0.86" />
          <path d="M4 4.8 11.1 13.2 7.7 7.2Z" fill="#facc15" opacity="0.9" />
        </svg>
      </div>
    )
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
    padding: "8px 12px",
    paddingBottom: "50vh",
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
    const sourceText = activeWindowId === "all" ? textRef.current ?? text : tabEditText ?? ""
    const body = getDateBlockBodyText(sourceText, baseYear, key)
    setDayListEditText(body)
    dayListDirtyRef.current = false
    dayListEditGuardRef.current = { open: true, mode: "edit", dirty: false }
    setDayListModal({ key, items })
    setDayListMode("edit")
  }

  const dayListRecurringItems = useMemo(() => {
    if (!dayListModal?.key) return []
    return Array.isArray(recurringDisplayItemsByDate?.[dayListModal.key])
      ? recurringDisplayItemsByDate[dayListModal.key]
      : []
  }, [dayListModal?.key, recurringDisplayItemsByDate])
  const dayListTaskItems = useMemo(() => {
    if (!dayListModal?.key) return []
    return Array.isArray(combinedTaskItemsByDate?.[dayListModal.key]) ? combinedTaskItemsByDate[dayListModal.key] : []
  }, [combinedTaskItemsByDate, dayListModal?.key])

  function openRecurringCreate(dateKey, config = "schedule") {
    if (!dateKey) return
    const normalizedConfig =
      typeof config === "string"
        ? { kind: config }
        : {
            kind: config?.kind,
            rawLine: config?.rawLine,
            categoryTitle: config?.categoryTitle ?? config?.sourceTask?.title,
            sourceTask: config?.sourceTask ?? null,
            sourceLineIndex: Number.isInteger(config?.sourceLineIndex) ? config.sourceLineIndex : null
          }
    setRecurringModalState({
      mode: "create",
      dateKey,
      defaultCategoryTitle: String(normalizedConfig?.categoryTitle ?? activeRecurringCategoryTitle ?? "").trim(),
      defaultKind: normalizedConfig?.kind === "task" ? "task" : "schedule",
      defaultRawLine: String(normalizedConfig?.rawLine ?? "").trim(),
      sourceTask: normalizedConfig?.sourceTask ?? null,
      sourceLineIndex: normalizedConfig?.sourceLineIndex ?? null
    })
  }

  function openRecurringEdit(item) {
    if (!item) return
    setDayListModal(null)
    dayListDirtyRef.current = false
    dayListEditGuardRef.current = { open: false, mode: "read", dirty: false }
    setRecurringModalState({
      mode: "edit",
      dateKey: item.dateKey,
      item,
      defaultCategoryTitle: activeRecurringCategoryTitle || ""
    })
  }

  function closeRecurringModal() {
    setRecurringModalState(null)
  }

  function toggleTextTask(task) {
    if (!task?.dateKey || !Number.isInteger(task?.lineIndex)) return
    const currentText = activeWindowId === "all" ? textRef.current ?? text : tabEditText ?? ""
    const bodyText = getDateBlockBodyText(currentText, baseYear, task.dateKey)
    const nextBodyText = updateTaskLineStatusInBody(bodyText, task.lineIndex, !task.completed)
    if (nextBodyText === bodyText) return
    const nextText = updateDateBlockBody(currentText, baseYear, task.dateKey, nextBodyText)
    if (nextText === currentText) return

    if (activeWindowId === "all") {
      updateEditorText(nextText)
      setWindowMemoTextSync(baseYear, "all", nextText)
      return
    }

    setTabEditText(nextText)
    setWindowMemoTextSync(baseYear, activeWindowId, nextText)
    applyTabEditToAllFromText(nextText)
  }

  function findRemoteTaskPlanRow(task) {
    const userId = session?.user?.id ?? null
    if (!userId) return null

    const directRowId = String(task?.rowId ?? task?.row?.id ?? task?.planId ?? task?.ruleId ?? "").trim()
    if (directRowId) {
      const directRow = (remotePlans ?? []).find(
        (row) =>
          row &&
          String(row?.id ?? "").trim() === directRowId &&
          row.user_id === userId &&
          !row.deleted_at
      )
      if (directRow) return directRow
    }

    const dateKey = String(task?.dateKey ?? "").trim()
    const taskText = String(task?.text ?? "").trim()
    if (!dateKey || !taskText) return null

    const scopedTitle =
      activeWindowId === "all"
        ? ""
        : normalizeCategoryId(String(windows.find((w) => w.id === activeWindowId)?.title ?? "").trim())

    let expectedCategory = normalizeCategoryId(String(task?.title ?? "").trim())
    if (!expectedCategory) expectedCategory = scopedTitle || GENERAL_CATEGORY_ID

    const expectedTime = String(task?.time ?? "").trim()

    const candidates = (remotePlans ?? []).filter((row) => {
      if (!row || row.user_id !== userId || row.deleted_at) return false
      if (isRecurringPlanRow(row)) return false
      if (String(row?.date ?? "").trim() !== dateKey) return false

      const normalizedTime = normalizePlanTimeFields(row)
      if (String(normalizedTime.time ?? "").trim() !== expectedTime) return false

      let rowCategory = normalizeCategoryId(String(row?.category_id ?? "").trim())
      if (!rowCategory) rowCategory = GENERAL_CATEGORY_ID
      if (rowCategory !== expectedCategory) return false

      const parsedTask = stripTaskSuffix(String(row?.content ?? "").trim())
      if (String(parsedTask?.text ?? "").trim() !== taskText) return false
      return true
    })

    if (candidates.length === 0) return null

    candidates.sort((a, b) => {
      const sortA = Number(a?.sort_order ?? a?.sortOrder ?? Number.NaN)
      const sortB = Number(b?.sort_order ?? b?.sortOrder ?? Number.NaN)
      if (Number.isFinite(sortA) && Number.isFinite(sortB) && sortA !== sortB) return sortA - sortB

      const updatedA = Date.parse(String(a?.updated_at ?? a?.updatedAt ?? ""))
      const updatedB = Date.parse(String(b?.updated_at ?? b?.updatedAt ?? ""))
      if (Number.isFinite(updatedA) && Number.isFinite(updatedB) && updatedA !== updatedB) return updatedA - updatedB

      return String(a?.id ?? "").localeCompare(String(b?.id ?? ""), "en")
    })

    return candidates[0]
  }

  async function persistTextTaskToggle(task) {
    if (!canUseWebRowPlanEdit || !supabase || !session?.user?.id) return

    const userId = session.user.id
    const targetRow = findRemoteTaskPlanRow(task)
    if (!targetRow?.id) {
      console.warn("toggle task row not found", task)
      return
    }
    const rowId = String(targetRow.id ?? "").trim()

    const parsedTask = stripTaskSuffix(String(targetRow?.content ?? "").trim())
    const baseText = String(parsedTask?.text ?? task?.text ?? "").trim()
    if (!baseText) return

    const nextCompleted = !task?.completed
    const nextContent = buildPlanContentWithMeta(baseText, {
      completed: nextCompleted
    })
    const updatedAt = new Date().toISOString()
    suspendRemotePlansLoads()

    setRemotePlans((prev) =>
      (prev ?? []).map((row) =>
        String(row?.id ?? "").trim() === rowId
          ? { ...row, content: nextContent, updated_at: updatedAt, client_id: clientIdRef.current }
          : row
      )
    )

    const { error } = await supabase
      .from("plans")
      .update({ content: nextContent, updated_at: updatedAt, client_id: clientIdRef.current })
      .eq("id", rowId)
      .eq("user_id", userId)

    if (error) {
      console.error("toggle task", error)
      await loadRemotePlans(userId, { force: true })
    }
  }

  function setTextTaskCompleted(task, nextCompleted) {
    if (!task?.dateKey) return false
    const currentText = activeWindowId === "all" ? textRef.current ?? text : tabEditText ?? ""
    const bodyText = getDateBlockBodyText(currentText, baseYear, task.dateKey)
    let nextBodyText = ""
    if (Number.isInteger(task?.lineIndex)) {
      nextBodyText = updateTaskLineStatusInBody(bodyText, task.lineIndex, Boolean(nextCompleted))
    } else {
      const draft = getPlanModalDraftFromItem(task, task.dateKey)
      const fields = normalizePlanModalDraft({
        ...draft,
        isTask: true,
        completed: Boolean(nextCompleted)
      })
      const rawLine = buildPlanRawLineFromDraftFields(fields)
      nextBodyText = buildBodyWithPlanReplacement(bodyText, task, rawLine) ?? bodyText
    }
    if (nextBodyText === bodyText) return false
    const nextText = updateDateBlockBody(currentText, baseYear, task.dateKey, nextBodyText)
    if (nextText === currentText) return false
    if (activeWindowId === "all") {
      updateEditorText(nextText)
      setWindowMemoTextSync(baseYear, "all", nextText)
    } else {
      setTabEditText(nextText)
      setWindowMemoTextSync(baseYear, activeWindowId, nextText)
      applyTabEditToAllFromText(nextText)
    }
    return true
  }

  async function setCloudTaskCompleted(task, nextCompleted) {
    if (!canUseWebRowPlanEdit || !supabase || !session?.user?.id) return false
    const userId = session.user.id
    const targetRow = findRemoteTaskPlanRow(task)
    if (!targetRow?.id) return false
    const rowId = String(targetRow.id ?? "").trim()
    const parsedTask = stripTaskSuffix(String(targetRow?.content ?? "").trim())
    const baseText = String(parsedTask?.text ?? task?.text ?? "").trim()
    if (!baseText) return false
    const nextContent = buildPlanContentWithMeta(baseText, { completed: Boolean(nextCompleted) })
    const updatedAt = new Date().toISOString()
    suspendRemotePlansLoads()
    setRemotePlans((prev) =>
      (prev ?? []).map((row) =>
        String(row?.id ?? "").trim() === rowId
          ? { ...row, content: nextContent, updated_at: updatedAt, client_id: clientIdRef.current }
          : row
      )
    )
    const { error } = await supabase
      .from("plans")
      .update({ content: nextContent, updated_at: updatedAt, client_id: clientIdRef.current })
      .eq("id", rowId)
      .eq("user_id", userId)
    if (error) {
      console.error("set task completed", error)
      await loadRemotePlans(userId, { force: true })
      return false
    }
    return true
  }

  function setTaskCompletedFromModal({ sourceItem, completed }) {
    if (!sourceItem) return
    const nextCompleted = Boolean(completed)
    if (sourceItem?.sourceType === "recurring") return
    if (canUseWebRowPlanEdit && supabase && session?.user?.id) {
      void setCloudTaskCompleted(sourceItem, nextCompleted)
      return
    }
    setTextTaskCompleted(sourceItem, nextCompleted)
  }

  function buildRecurringPlanFieldsFromPayload(payload, fallbackCategoryTitle = "") {
    const rawLine = String(payload?.rawLine ?? "").trim()
    const taskAware = stripTaskSuffix(rawLine)
    const baseRaw = String(taskAware.text ?? "").trim()
    if (!baseRaw) return null

    const categoryTitle = String(payload?.categoryTitle ?? fallbackCategoryTitle ?? "").trim()
    let timeToken = ""
    let content = baseRaw

    const leadingTime = parseLeadingPlanTimeText(baseRaw)
    if (leadingTime) {
      timeToken = buildTimeSpanLabel(leadingTime.time, leadingTime.end_time)
      content = String(leadingTime.content ?? "").trim()
    }

    if (!content) return null
    const timeFields = normalizePlanTimeFields({ time: timeToken })
    let categoryId = normalizeCategoryId(categoryTitle)
    if (!categoryId) categoryId = GENERAL_CATEGORY_ID

    return {
      time: timeFields.time,
      end_time: timeFields.end_time,
      category_id: categoryId,
      content: buildPlanContentWithMeta(content, {
        completed: taskAware.completed
      })
    }
  }

  function buildSingleRecurringPlanPayload(userId, payload, dateKey, { seriesIdOverride = null, repeatTypeOverride = null, sortOrderOverride = null } = {}) {
    const planFields = buildRecurringPlanFieldsFromPayload(payload, payload?.categoryTitle ?? activeRecurringCategoryTitle ?? "")
    if (!planFields?.content) return null

    const repeatType = normalizeRepeatType(repeatTypeOverride ?? payload?.repeat)
    const repeatInterval = repeatType === "none" ? 1 : normalizeRepeatInterval(payload?.repeatInterval)
    const repeatDays = repeatType === "weekly" ? normalizeRepeatDays(payload?.repeatDays) : null
    const repeatUntil = repeatType === "none" ? null : String(payload?.untilDateKey ?? payload?.repeatUntil ?? dateKey ?? "").trim() || null
    const seriesId =
      repeatType === "none"
        ? null
        : String(seriesIdOverride ?? payload?.seriesId ?? "").trim() || null
    const alarmEnabled = Boolean(planFields.time) && Boolean(payload?.alarmEnabled)
    const alarmLeadMinutes = alarmEnabled ? normalizeAlarmLeadMinutes(payload?.alarmLeadMinutes ?? 0) : 0

    const row = {
      user_id: userId,
      date: String(dateKey ?? "").trim(),
      time: planFields.time,
      content: planFields.content,
      category_id: planFields.category_id,
      series_id: seriesId,
      repeat_type: repeatType,
      repeat_interval: repeatInterval,
      repeat_days: repeatDays,
      repeat_until: repeatUntil,
      client_id: clientIdRef.current,
      updated_at: new Date().toISOString()
    }
    if (endTimeSupportedRef.current) row.end_time = planFields.end_time || null
    if (alarmColumnsSupportedRef.current) {
      row.alarm_enabled = alarmEnabled
      row.alarm_lead_minutes = alarmLeadMinutes
    }
    if (sortOrderOverride != null) row.sort_order = sortOrderOverride
    return row
  }

  function buildRecurringPlanRows(
    userId,
    payload,
    {
      seriesIdOverride = null,
      startDateKeyOverride = null,
      repeatTypeOverride = null,
      excludedIds = null,
      initialSortOrderOverride = null
    } = {}
  ) {
    const repeatType = normalizeRepeatType(repeatTypeOverride ?? payload?.repeat)
    const startDateKey = String(startDateKeyOverride ?? payload?.startDateKey ?? recurringModalState?.dateKey ?? "").trim()
    if (!startDateKey) return []

    if (repeatType === "none") {
      const row = buildSingleRecurringPlanPayload(userId, payload, startDateKey, {
        seriesIdOverride: null,
        repeatTypeOverride: "none",
        sortOrderOverride: initialSortOrderOverride ?? getNextSortOrderForDate(startDateKey, remotePlans, excludedIds)
      })
      return row ? [row] : []
    }

    const rawUntilDateKey = String(payload?.untilDateKey ?? "").trim()
    const untilDateKey =
      rawUntilDateKey || addDaysToKey(startDateKey, getOpenEndedRepeatSpanDays(startDateKey))
    const repeatInterval = normalizeRepeatInterval(payload?.repeatInterval)
    const repeatDays = repeatType === "weekly" ? normalizeRepeatDays(payload?.repeatDays) : []
    const dateKeys = buildOccurrenceDateKeys(
      {
        startDateKey,
        untilDateKey,
        repeat: repeatType,
        repeatInterval,
        repeatDays
      },
      startDateKey,
      untilDateKey
    )
    const seriesId = String(seriesIdOverride ?? payload?.seriesId ?? genSeriesId()).trim() || genSeriesId()
    const sortSeeds = new Map()

    return dateKeys
      .map((dateKey) => {
        let sortOrderOverride = null
        if (sortOrderSupportedRef.current) {
          const existingSeed =
            dateKey === startDateKey && initialSortOrderOverride != null
              ? initialSortOrderOverride
              : sortSeeds.get(dateKey)
          if (existingSeed != null) {
            sortOrderOverride = existingSeed
            sortSeeds.set(dateKey, existingSeed + 1)
          } else {
            const seed = getNextSortOrderForDate(dateKey, remotePlans, excludedIds)
            if (seed != null) {
              sortOrderOverride = seed
              sortSeeds.set(dateKey, seed + 1)
            }
          }
        }
        return buildSingleRecurringPlanPayload(userId, payload, dateKey, {
          seriesIdOverride: seriesId,
          repeatTypeOverride: repeatType,
          sortOrderOverride
        })
      })
      .filter(Boolean)
  }

  function buildOpenEndedRecurringAppendRows(userId, planRows) {
    if (!repeatColumnsSupportedRef.current) return []
    const rows = Array.isArray(planRows) ? planRows.filter((row) => row && !row?.deleted_at) : []
    if (rows.length === 0) return []

    const horizonKey = getOpenEndedRepeatHorizonDateKey()
    const horizonMs = keyToTime(horizonKey)
    const groups = new Map()

    for (const row of rows) {
      const repeatMeta = normalizeRepeatMeta(row)
      const seriesId = String(repeatMeta.seriesId ?? "").trim()
      const dateKey = String(row?.date ?? "").trim()
      if (!seriesId || !dateKey) continue
      if (repeatMeta.repeatType === "none" || repeatMeta.repeatUntil) continue

      const current = groups.get(seriesId)
      if (!current) {
        groups.set(seriesId, {
          seriesId,
          repeatMeta,
          startDateKey: dateKey,
          latestDateKey: dateKey,
          sampleRow: row
        })
        continue
      }

      if (keyToTime(dateKey) < keyToTime(current.startDateKey)) {
        current.startDateKey = dateKey
        current.sampleRow = row
      }
      if (keyToTime(dateKey) > keyToTime(current.latestDateKey)) {
        current.latestDateKey = dateKey
      }
    }

    const nextRows = []
    const mergedRows = [...rows]

    for (const group of groups.values()) {
      const latestMs = keyToTime(group.latestDateKey)
      if (!Number.isFinite(latestMs) || latestMs >= horizonMs) continue

      const untilDateKey = addDaysToKey(group.startDateKey, getOpenEndedRepeatSpanDays(group.startDateKey))
      const desiredKeys = buildOccurrenceDateKeys(
        {
          startDateKey: group.startDateKey,
          untilDateKey,
          repeat: group.repeatMeta.repeatType,
          repeatInterval: group.repeatMeta.repeatInterval,
          repeatDays: group.repeatMeta.repeatDays ?? []
        },
        group.startDateKey,
        untilDateKey
      ).filter((dateKey) => keyToTime(dateKey) > latestMs && keyToTime(dateKey) <= horizonMs)

      for (const dateKey of desiredKeys) {
        const sortOrderOverride = sortOrderSupportedRef.current ? getNextSortOrderForDate(dateKey, mergedRows) : null
        const nextRow = buildSingleRecurringPlanPayload(userId, group.sampleRow, dateKey, {
          seriesIdOverride: group.seriesId,
          repeatTypeOverride: group.repeatMeta.repeatType,
          sortOrderOverride
        })
        if (!nextRow) continue
        nextRows.push(nextRow)
        mergedRows.push(nextRow)
      }
    }

    return nextRows
  }

  async function ensureOpenEndedRecurringCoverage(userId, planRows) {
    if (!supabase || !userId || openEndedRecurringSyncRef.current) return false
    const appendRows = buildOpenEndedRecurringAppendRows(userId, planRows)
    if (appendRows.length === 0) return false

    openEndedRecurringSyncRef.current = true
    try {
      suspendRemotePlansLoads()
      await insertRecurringPlanRows(appendRows)
      return true
    } catch (error) {
      console.error("ensure open-ended recurring coverage", error)
      return false
    } finally {
      openEndedRecurringSyncRef.current = false
    }
  }

  async function insertRecurringPlanRows(rows) {
    const list = Array.isArray(rows) ? rows : []
    if (list.length === 0) return
    const chunkSize = 200
    for (let i = 0; i < list.length; i += chunkSize) {
      let chunk = list.slice(i, i + chunkSize)
      chunk = endTimeSupportedRef.current ? chunk : stripEndTimeFromRows(chunk)
      chunk = alarmColumnsSupportedRef.current ? chunk : stripAlarmFromRows(chunk)
      chunk = sortOrderSupportedRef.current ? chunk : stripSortOrderFromRows(chunk)
      let { error } = await supabase.from("plans").insert(chunk)
      if (error && isRepeatColumnError(error)) {
        markRepeatFallbackNotice()
        throw error
      }
      if (error && isEndTimeColumnError(error)) {
        endTimeSupportedRef.current = false
        chunk = stripEndTimeFromRows(chunk)
        const retry = await supabase.from("plans").insert(sortOrderSupportedRef.current ? chunk : stripSortOrderFromRows(chunk))
        error = retry.error
      }
      if (error && isAlarmColumnError(error)) {
        alarmColumnsSupportedRef.current = false
        chunk = stripAlarmFromRows(chunk)
        const retry = await supabase.from("plans").insert(sortOrderSupportedRef.current ? chunk : stripSortOrderFromRows(chunk))
        error = retry.error
      }
      if (error && isSortOrderColumnError(error)) {
        sortOrderSupportedRef.current = false
        const retry = await supabase.from("plans").insert(stripSortOrderFromRows(chunk))
        error = retry.error
      }
      if (error) throw error
    }
  }

  async function updateRecurringPlanRowById(userId, rowId, payload) {
    let nextPayload = { ...(payload ?? {}) }
    if (!endTimeSupportedRef.current) nextPayload = stripEndTimeFromRows([nextPayload])[0]
    if (!alarmColumnsSupportedRef.current) nextPayload = stripAlarmFromRows([nextPayload])[0]
    if (!sortOrderSupportedRef.current) nextPayload = stripSortOrderFromRows([nextPayload])[0]

    let { error } = await supabase.from("plans").update(nextPayload).eq("id", rowId).eq("user_id", userId)
    if (error && isRepeatColumnError(error)) {
      markRepeatFallbackNotice()
      throw error
    }
    if (error && isEndTimeColumnError(error)) {
      endTimeSupportedRef.current = false
      const retry = await supabase
        .from("plans")
        .update(stripEndTimeFromRows([nextPayload])[0])
        .eq("id", rowId)
        .eq("user_id", userId)
      error = retry.error
    }
    if (error && isAlarmColumnError(error)) {
      alarmColumnsSupportedRef.current = false
      const retry = await supabase
        .from("plans")
        .update(stripAlarmFromRows([nextPayload])[0])
        .eq("id", rowId)
        .eq("user_id", userId)
      error = retry.error
    }
    if (error && isSortOrderColumnError(error)) {
      sortOrderSupportedRef.current = false
      const retry = await supabase
        .from("plans")
        .update(stripSortOrderFromRows([nextPayload])[0])
        .eq("id", rowId)
        .eq("user_id", userId)
      error = retry.error
    }
    if (error) throw error
  }

  async function softDeleteRecurringPlanIds(userId, ids) {
    const uniqueIds = [...new Set((ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))]
    if (uniqueIds.length === 0) return
    const deletedAt = new Date().toISOString()
    const { error } = await supabase
      .from("plans")
      .update({ deleted_at: deletedAt, updated_at: deletedAt, client_id: clientIdRef.current })
      .in("id", uniqueIds)
      .eq("user_id", userId)
    if (error) throw error
  }

  async function createCloudRecurringRule(payload) {
    if (!canUseWebRowPlanEdit || !supabase || !session?.user?.id) return
    const userId = session.user.id
    suspendRemotePlansLoads()
    try {
      const sourceTask = recurringModalState?.sourceTask ?? null
      const sourceLineIndex = recurringModalState?.sourceLineIndex ?? null
      flushPendingDayListSync()
      await dayListSyncQueueRef.current.catch(() => {})
      const sourceRow = sourceTask ? findRemoteTaskPlanRow(sourceTask) : null
      const sourceSortOrder = parsePlanOrderValue(sourceRow?.sort_order ?? sourceRow?.sortOrder ?? sourceRow?.order)
      const rows = buildRecurringPlanRows(userId, payload, {
        seriesIdOverride: genSeriesId(),
        initialSortOrderOverride: sourceSortOrder
      })
      if (rows.length === 0) return
      const nextCategoryTitles = new Set(
        rows
          .map((row) => normalizeCategoryId(String(row?.category_id ?? "").trim()))
          .filter((title) => title && !isGeneralCategoryId(title))
      )
      const sourceDateKey = String(sourceRow?.date ?? "").trim()
      const sourceRowIndex =
        sourceRow?.id && sourceDateKey
          ? rows.findIndex((row) => String(row?.date ?? "").trim() === sourceDateKey)
          : -1

      if (sourceRow?.id && sourceRowIndex >= 0) {
        const [sourceOccurrenceRow] = rows.splice(sourceRowIndex, 1)
        await updateRecurringPlanRowById(userId, sourceRow.id, {
          ...sourceOccurrenceRow,
          updated_at: new Date().toISOString(),
          client_id: clientIdRef.current
        })
        await insertRecurringPlanRows(rows)
      } else {
        await insertRecurringPlanRows(rows)
        if (sourceRow?.id) {
          const deletedAt = new Date().toISOString()
          await supabase
            .from("plans")
            .update({ deleted_at: deletedAt, updated_at: deletedAt, client_id: clientIdRef.current })
            .eq("user_id", userId)
            .eq("id", sourceRow.id)
        }
        removeSourceTaskFromTextTaskFlow(sourceTask, sourceLineIndex, recurringModalState?.dateKey)
        flushPendingDayListSync()
        await dayListSyncQueueRef.current.catch(() => {})
      }
      setDayListMode("edit")
      ensureWindowsForCategories(nextCategoryTitles)
      await loadRemotePlans(userId, { force: true })
    } catch (error) {
      console.error("create recurring rule", error)
      await loadRemotePlans(userId, { force: true })
    }
  }

  async function updateCloudRecurringRuleScoped(payload, scope) {
    if (!canUseWebRowPlanEdit || !supabase || !session?.user?.id) return
    setDayListMode("edit")
    const userId = session.user.id
    const target = recurringModalState?.item
    if (!target) return
    const rowId = String(target?.row?.id ?? target?.planId ?? target?.ruleId ?? "").trim()
    const anchorDateKey = String(target?.dateKey ?? recurringModalState?.dateKey ?? "").trim()
    const familyId = String(target?.seriesId ?? target?.familyId ?? target?.row?.series_id ?? "").trim()
    const familyStartDateKey = String(target?.familyStartDateKey ?? anchorDateKey).trim() || anchorDateKey
    if (!anchorDateKey) return

    suspendRemotePlansLoads()
    try {
      if (scope === "single" || !familyId) {
        if (!rowId) return
        const nextRow = buildSingleRecurringPlanPayload(userId, payload, anchorDateKey, {
          seriesIdOverride: null,
          repeatTypeOverride: "none"
        })
        if (!nextRow) return
        await updateRecurringPlanRowById(userId, rowId, nextRow)
        await loadRemotePlans(userId, { force: true })
        return
      }

      const familyRows = (remotePlans ?? []).filter((row) => {
        if (!row || row?.deleted_at) return false
        return String(row?.series_id ?? "").trim() === familyId
      })
      const deleteIds = familyRows
        .filter((row) => (scope === "future" ? String(row?.date ?? "").trim() >= anchorDateKey : true))
        .map((row) => row?.id)
        .filter(Boolean)

      await softDeleteRecurringPlanIds(userId, deleteIds)

      const excludedIds = new Set(deleteIds.map((id) => String(id)))
      const startDateKey = scope === "future" ? anchorDateKey : String(payload?.startDateKey ?? familyStartDateKey).trim() || familyStartDateKey
      const nextRows = buildRecurringPlanRows(userId, payload, {
        seriesIdOverride: genSeriesId(),
        startDateKeyOverride: startDateKey,
        excludedIds
      })
      await insertRecurringPlanRows(nextRows)
      ensureWindowsForCategories(
        new Set(nextRows.map((row) => normalizeCategoryId(String(row?.category_id ?? "").trim())).filter((title) => title && !isGeneralCategoryId(title)))
      )
      await loadRemotePlans(userId, { force: true })
    } catch (error) {
      console.error("update recurring rule", error)
      await loadRemotePlans(userId, { force: true })
    }
  }

  async function deleteCloudRecurringRuleScoped(scope) {
    if (!canUseWebRowPlanEdit || !supabase || !session?.user?.id) return
    setDayListMode("edit")
    const userId = session.user.id
    const target = recurringModalState?.item
    if (!target) return
    const rowId = String(target?.row?.id ?? target?.planId ?? target?.ruleId ?? "").trim()
    const anchorDateKey = String(target?.dateKey ?? recurringModalState?.dateKey ?? "").trim()
    const familyId = String(target?.seriesId ?? target?.familyId ?? target?.row?.series_id ?? "").trim()
    if (!anchorDateKey && !rowId) return

    suspendRemotePlansLoads()
    try {
      let deleteIds = []
      if (scope === "single" || !familyId) {
        deleteIds = rowId ? [rowId] : []
      } else {
        deleteIds = (remotePlans ?? [])
          .filter((row) => {
            if (!row || row?.deleted_at) return false
            if (String(row?.series_id ?? "").trim() !== familyId) return false
            if (scope === "future") return String(row?.date ?? "").trim() >= anchorDateKey
            return true
          })
          .map((row) => row?.id)
          .filter(Boolean)
      }
      await softDeleteRecurringPlanIds(userId, deleteIds)
      await loadRemotePlans(userId, { force: true })
    } catch (error) {
      console.error("delete recurring rule", error)
      await loadRemotePlans(userId, { force: true })
    }
  }

  async function toggleCloudRecurringTask(task) {
    if (!canUseWebRowPlanEdit || !supabase || !session?.user?.id) return
    const userId = session.user.id
    const rowId = String(task?.row?.id ?? task?.planId ?? "").trim()
    if (!rowId) return

    const currentContent = String(task?.row?.content ?? task?.rawLine ?? "").trim()
    const parsed = stripTaskSuffix(currentContent)
    const baseText = String(parsed.text ?? "").trim()
    if (!baseText || parsed.completed == null) return

    const nextContent = buildPlanContentWithMeta(baseText, {
      completed: parsed.completed !== true
    })
    const updatedAt = new Date().toISOString()

    setRemotePlans((prev) =>
      (prev ?? []).map((row) =>
        String(row?.id ?? "").trim() === rowId
          ? { ...row, content: nextContent, updated_at: updatedAt, client_id: clientIdRef.current }
          : row
      )
    )

    const { error } = await supabase
      .from("plans")
      .update({ content: nextContent, updated_at: updatedAt, client_id: clientIdRef.current })
      .eq("id", rowId)
      .eq("user_id", userId)

    if (error) {
      console.error("toggle recurring task", error)
      await loadRemotePlans(userId, { force: true })
    }
  }

  function toggleRecurringTask(task) {
    if (hasCloudSession) {
      toggleCloudRecurringTask(task)
      return
    }

    const ruleId = String(task?.ruleId ?? "").trim()
    const dateKey = String(task?.dateKey ?? "").trim()
    if (!ruleId || !dateKey) return

    const baseRule = (Array.isArray(recurringRules) ? recurringRules : []).find(
      (rule) => String(rule?.id ?? "").trim() === ruleId
    )
    if (!baseRule) return

    const parsed = parseRecurringRawLine(task?.rawLine, task?.title ?? "")
    const baseRaw = String(parsed.baseRaw ?? "").trim()
    if (!baseRaw) return

    const nextCompleted = !task?.completed
    const nextRawLine = `${baseRaw};${nextCompleted ? "O" : "X"}`
    const baseRuleRawLine = String(baseRule?.rawLine ?? "").trim()

    setRecurringOverrides((prev) => {
      const list = Array.isArray(prev) ? prev : []
      const filtered = list.filter(
        (item) =>
          !(
            String(item?.ruleId ?? "").trim() === ruleId &&
            String(item?.dateKey ?? "").trim() === dateKey
          )
      )

      if (nextRawLine === baseRuleRawLine) {
        return filtered
      }

      return [
        ...filtered,
        {
          id: genRecurringId("override"),
          familyId: String(task?.familyId ?? baseRule?.familyId ?? ruleId).trim(),
          ruleId,
          dateKey,
          mode: "replace",
          rawLine: nextRawLine,
          updatedAt: new Date().toISOString()
        }
      ]
    })
  }

  async function saveRecurringTaskInline(task, nextBaseRaw) {
    const baseRaw = String(nextBaseRaw ?? "").trim()
    if (!baseRaw) return

    const currentContent = String(task?.row?.content ?? task?.rawLine ?? "").trim()
    const parsedCurrent = stripTaskSuffix(currentContent)
    const nextContent = buildTaskMetaText(baseRaw, {
      completed: parsedCurrent.completed ?? Boolean(task?.completed)
    })
    if (!nextContent || nextContent === currentContent) return

    if (hasCloudSession && supabase && session?.user?.id) {
      const userId = session.user.id
      const rowId = String(task?.row?.id ?? task?.planId ?? "").trim()
      if (!rowId) return
      const updatedAt = new Date().toISOString()

      setRemotePlans((prev) =>
        (prev ?? []).map((row) =>
          String(row?.id ?? "").trim() === rowId
            ? { ...row, content: nextContent, updated_at: updatedAt, client_id: clientIdRef.current }
            : row
        )
      )

      const { error } = await supabase
        .from("plans")
        .update({ content: nextContent, updated_at: updatedAt, client_id: clientIdRef.current })
        .eq("id", rowId)
        .eq("user_id", userId)

      if (error) {
        console.error("save recurring task inline", error)
        await loadRemotePlans(userId, { force: true })
      }
      return
    }

    const ruleId = String(task?.ruleId ?? "").trim()
    const dateKey = String(task?.dateKey ?? "").trim()
    if (!ruleId || !dateKey) return
    const baseRule = (Array.isArray(recurringRules) ? recurringRules : []).find(
      (rule) => String(rule?.id ?? "").trim() === ruleId
    )
    if (!baseRule) return

    const baseRuleRawLine = String(baseRule?.rawLine ?? "").trim()
    setRecurringOverrides((prev) => {
      const list = Array.isArray(prev) ? prev : []
      const filtered = list.filter(
        (item) =>
          !(
            String(item?.ruleId ?? "").trim() === ruleId &&
            String(item?.dateKey ?? "").trim() === dateKey
          )
      )

      if (nextContent === baseRuleRawLine) {
        return filtered
      }

      return [
        ...filtered,
        {
          id: genRecurringId("override"),
          familyId: String(task?.familyId ?? baseRule?.familyId ?? ruleId).trim(),
          ruleId,
          dateKey,
          mode: "replace",
          rawLine: nextContent,
          updatedAt: new Date().toISOString()
        }
      ]
    })
  }

  function openTextTask(task) {
    openPlanEditModal(task, task?.dateKey ?? "")
  }

  function closeQuickCreateModal() {
    setQuickCreateModalState(null)
  }

  function getDefaultPlanCategoryTitle() {
    return activeRecurringCategoryTitle || ""
  }

  function openPlanCreateModal(dateKey = "", options = {}) {
    if (isScheduleReadOnly && !canUseWebRowPlanEdit) {
      setAuthMessage("웹에서 바로 추가하려면 편집 가능한 일정 모드여야 합니다.")
      return
    }

    const initialDateKey = String(dateKey || lastActiveDateKeyRef.current || todayKey || "").trim() || todayKey
    if (/^\d{4}-\d{2}-\d{2}$/.test(initialDateKey)) setActiveDateKey(initialDateKey)
    setQuickCreateModalState({
      editMode: "create",
      mode: "task",
      initialDateKey,
      initialEndDateKey: String(options?.endDateKey ?? initialDateKey).trim() || initialDateKey,
      initialTime: String(options?.time ?? "").trim(),
      initialRepeat: String(options?.repeat ?? "none").trim() || "none",
      initialRepeatInterval: options?.repeatInterval ?? 1,
      initialRepeatDays: normalizeRepeatDays(options?.repeatDays),
      initialRepeatOpenEnded: Boolean(options?.repeatOpenEnded ?? options?.openEndedRepeat ?? false),
      initialAlarmEnabled: options?.alarmEnabled ?? true,
      initialAlarmLeadMinutes: normalizeAlarmLeadMinutes(options?.alarmLeadMinutes ?? 0),
      defaultCategoryTitle: String(options?.categoryTitle ?? getDefaultPlanCategoryTitle()).trim(),
      initialContent: String(options?.content ?? "").trim(),
      initialIsTask: options?.isTask ?? true,
      initialCompleted: false,
      showCategory: true
    })
  }

  function getPlanModalDraftFromItem(item, dateKeyOverride = "") {
    const row = item?.row ?? null
    const rowTask = row ? stripTaskSuffix(String(row?.content ?? "").trim()) : null
    const itemTask = stripTaskSuffix(String(item?.rawLine ?? item?.baseRaw ?? item?.text ?? item?.display ?? "").trim())
    const rawContent = row
      ? String(rowTask?.text ?? "").trim()
      : String(item?.text ?? item?.display ?? itemTask?.text ?? "").trim()
    let categoryTitle = ""
    if (row) {
      const rowCategory = normalizeCategoryId(String(row?.category_id ?? "").trim())
      categoryTitle = isGeneralCategoryId(rowCategory) ? "" : rowCategory
    } else {
      categoryTitle = String(item?.sourceTitle ?? item?.title ?? getDefaultPlanCategoryTitle()).trim()
    }
    const normalizedTime = row ? normalizePlanTimeFields(row) : normalizePlanTimeFields({ time: item?.time ?? "" })
    const timeLabel = buildTimeSpanLabel(normalizedTime.time, normalizedTime.end_time)
    const completedValue = row ? rowTask?.completed : itemTask?.completed ?? item?.completed
    const repeatMeta = row ? normalizeRepeatMeta(row) : null
    const repeatOpenEnded = Boolean(repeatMeta && repeatMeta.repeatType !== "none" && !repeatMeta.repeatUntil)
    return {
      sourceItem: item,
      editMode: "edit",
      mode: "task",
      initialDateKey: String(row?.date ?? item?.dateKey ?? dateKeyOverride ?? todayKey ?? "").trim(),
      initialEndDateKey: repeatOpenEnded
        ? ""
        : String(row?.repeat_until ?? row?.repeatUntil ?? row?.date ?? item?.dateKey ?? dateKeyOverride ?? todayKey ?? "").trim(),
      initialTime: timeLabel,
      initialRepeat: repeatMeta ? repeatMeta.repeatType : "none",
      initialRepeatInterval: repeatMeta ? repeatMeta.repeatInterval : 1,
      initialRepeatDays: repeatMeta ? repeatMeta.repeatDays : [],
      initialRepeatOpenEnded: repeatOpenEnded,
      initialAlarmEnabled: row?.alarm_enabled == null ? true : Boolean(row?.alarm_enabled),
      initialAlarmLeadMinutes: normalizeAlarmLeadMinutes(row?.alarm_lead_minutes ?? row?.alarmLeadMinutes ?? 0),
      defaultCategoryTitle: categoryTitle,
      initialContent: rawContent,
      initialIsTask: row ? rowTask?.completed != null : Boolean(item?.isTask || itemTask?.completed != null),
      initialCompleted: Boolean(completedValue),
      showCategory: true
    }
  }

  function openPlanEditModal(item, dateKeyOverride = "") {
    if (!item) {
      openPlanCreateModal(dateKeyOverride)
      return
    }
    if (item?.sourceType === "recurring" || item?.repeatLabel || item?.seriesId || item?.familyId || item?.row?.series_id) {
      openRecurringEdit(item)
      return
    }
    if (isScheduleReadOnly && !canUseWebRowPlanEdit) {
      setAuthMessage("웹에서 바로 수정하려면 편집 가능한 일정 모드여야 합니다.")
      return
    }
    setDayListModal(null)
    setQuickCreateModalState(getPlanModalDraftFromItem(item, dateKeyOverride))
  }

  function appendRawLineToDateBlock(dateKey, rawLine) {
    const targetDateKey = String(dateKey ?? "").trim()
    const normalizedRawLine = String(rawLine ?? "").trim()
    if (!targetDateKey || !normalizedRawLine) return false

    const isAll = activeWindowId === "all"
    const currentText = isAll ? textRef.current ?? text : tabEditText ?? ""
    const currentBody = getDateBlockBodyText(currentText, baseYear, targetDateKey)
    const nextBody = [String(currentBody ?? "").trimEnd(), normalizedRawLine].filter(Boolean).join("\n").trimEnd()
    if (canUseWebRowPlanEdit) {
      enqueueDayListSync(targetDateKey, nextBody, activeWindowId)
    }
    const nextText = updateDateBlockBody(currentText, baseYear, targetDateKey, nextBody)
    if (isAll) {
      updateEditorText(nextText)
      setWindowMemoTextSync(baseYear, "all", nextText)
    } else {
      setTabEditText(nextText)
      setWindowMemoTextSync(baseYear, activeWindowId, nextText)
      applyTabEditToAllFromText(nextText)
    }
    setActiveDateKey(targetDateKey)
    return true
  }

  function normalizePlanModalDraft(draft) {
    const dateKey = String(draft?.startDateKey ?? draft?.dateKey ?? "").trim()
    const repeatOpenEnded = Boolean(draft?.repeatOpenEnded ?? draft?.openEndedRepeat ?? draft?.isOpenEndedRepeat)
    const rawUntilDateKey = String(draft?.untilDateKey ?? draft?.endDateKey ?? "").trim()
    const untilDateKey = repeatOpenEnded ? "" : rawUntilDateKey || dateKey
    const repeat = normalizeRepeatType(draft?.repeat)
    const repeatInterval = normalizeRepeatInterval(draft?.repeatInterval)
    const startTime = normalizeClockTime(draft?.startTime) || String(draft?.startTime ?? "").trim()
    const endTime = normalizeClockTime(draft?.endTime) || String(draft?.endTime ?? "").trim()
    let time = startTime ? buildTimeSpanLabel(startTime, endTime) : String(draft?.time ?? "").trim()
    let content = String(draft?.content ?? "").trim()
    const leadingTime = parseLeadingPlanTimeText(content)
    if (leadingTime) {
      content = leadingTime.content
      time = buildTimeSpanLabel(leadingTime.time, leadingTime.end_time)
    }
    const timeFields = normalizePlanTimeFields({ time })
    const categoryId = normalizeCategoryId(String(draft?.categoryTitle ?? "").trim()) || GENERAL_CATEGORY_ID
    const isTask = Boolean(draft?.isTask)
    const normalizedRepeatDays = normalizeRepeatDays(draft?.repeatDays)
    const repeatDays =
      repeat === "weekly"
        ? normalizedRepeatDays.length > 0
          ? normalizedRepeatDays
          : getDefaultWeeklyDaysForDate(dateKey)
        : []
    const alarmEnabled = Boolean(timeFields.time) && Boolean(draft?.alarmEnabled)
    const alarmLeadMinutes = alarmEnabled ? normalizeAlarmLeadMinutes(draft?.alarmLeadMinutes ?? 0) : 0
    return {
      dateKey,
      time: timeFields.time,
      end_time: timeFields.end_time,
      timeLabel: buildTimeSpanLabel(timeFields.time, timeFields.end_time),
      category_id: categoryId,
      content,
      isTask,
      completed: isTask ? Boolean(draft?.completed) : null,
      repeat,
      repeatInterval,
      repeatOpenEnded: repeat !== "none" && repeatOpenEnded,
      untilDateKey: repeat === "none" ? "" : repeatOpenEnded ? "" : untilDateKey || dateKey,
      repeatDays,
      alarmEnabled,
      alarmLeadMinutes,
      sourceItem: draft?.sourceItem ?? null,
      editMode: String(draft?.editMode ?? "").trim() === "edit" ? "edit" : "create"
    }
  }

  function buildPlanRawLineFromDraftFields(fields) {
    const parts = []
    if (fields.timeLabel) parts.push(fields.timeLabel)
    if (!isGeneralCategoryId(fields.category_id)) parts.push(`@${fields.category_id}`)
    parts.push(String(fields.content ?? "").trim())
    return buildTaskMetaText(parts.join(";"), {
      completed: fields.isTask ? Boolean(fields.completed) : null
    })
  }

  function buildRecurringPayloadFromPlanFields(fields) {
    return {
      startDateKey: fields.dateKey,
      untilDateKey: fields.repeatOpenEnded ? "" : fields.untilDateKey || fields.dateKey,
      repeat: fields.repeat,
      repeatInterval: fields.repeatInterval,
      repeatDays: fields.repeat === "weekly" ? fields.repeatDays : [],
      alarmEnabled: fields.alarmEnabled,
      alarmLeadMinutes: fields.alarmLeadMinutes,
      rawLine: buildPlanRawLineFromDraftFields(fields),
      categoryTitle: isGeneralCategoryId(fields.category_id) ? "" : fields.category_id
    }
  }

  function getComparablePlanParts(rowOrItem) {
    const row = rowOrItem?.row ? rowOrItem.row : rowOrItem
    const taskAware = stripTaskSuffix(String(row?.content ?? rowOrItem?.rawLine ?? rowOrItem?.baseRaw ?? rowOrItem?.text ?? rowOrItem?.display ?? "").trim())
    const normalizedTime = normalizePlanTimeFields(row?.content != null ? row : { time: rowOrItem?.time ?? "" })
    let category = normalizeCategoryId(String(row?.category_id ?? rowOrItem?.sourceTitle ?? rowOrItem?.title ?? "").trim())
    if (isGeneralCategoryId(category)) category = GENERAL_CATEGORY_ID
    return {
      date: String(row?.date ?? rowOrItem?.dateKey ?? "").trim(),
      time: String(normalizedTime.time ?? "").trim(),
      end_time: String(normalizedTime.end_time ?? "").trim(),
      category_id: category,
      content: String(taskAware.text ?? "").trim()
    }
  }

  function findMatchingRemotePlanRow(item) {
    const target = getComparablePlanParts(item)
    if (!target.date || !target.content) return null
    const targetOrder = parsePlanOrderValue(item?.sortOrder ?? item?.order)
    const rows = (remotePlans ?? []).filter((row) => {
      if (!row || row?.deleted_at || isRecurringPlanRow(row)) return false
      const current = getComparablePlanParts(row)
      if (current.date !== target.date) return false
      if (current.content !== target.content) return false
      if (current.category_id !== target.category_id) return false
      if (target.time && current.time !== target.time) return false
      if (target.end_time && current.end_time !== target.end_time) return false
      return true
    })
    if (rows.length <= 1 || targetOrder == null) return rows[0] ?? null
    return rows.find((row) => parsePlanOrderValue(row?.sort_order ?? row?.sortOrder ?? row?.order) === targetOrder) ?? rows[0] ?? null
  }

  function collectPlanEntriesFromBody(bodyText) {
    const entries = []
    const normalized = normalizeGroupLineNewlines(String(bodyText ?? ""))
    const lines = normalized.split("\n")
    let order = 0
    const pushEntry = ({ time = "", title = "", rawText = "" } = {}) => {
      const textValue = String(rawText ?? "").trim()
      if (!textValue) return
      entries.push({
        time: String(time ?? "").trim(),
        title: normalizeCategoryId(String(title ?? "").trim()),
        rawText: textValue,
        order
      })
      order += 1
    }

    for (const rawLine of lines) {
      const trimmed = String(rawLine ?? "").trim()
      if (!trimmed) continue
      const semicolon = parseDashboardSemicolonLine(trimmed, { allowEmptyText: true })
      if (semicolon) {
        if (String(semicolon.text ?? "").trim()) {
          pushEntry({ time: semicolon.time || "", title: semicolon.group || "", rawText: semicolon.text })
        }
        continue
      }
      const groupMatch = trimmed.match(groupLineRegex)
      if (groupMatch) {
        const title = normalizeCategoryId(String(groupMatch[1] ?? "").trim())
        const parts = String(groupMatch[2] ?? "")
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)
        for (const part of parts) {
          const parsed = parseLeadingTimeDashboardLine(part, { allowEmptyText: true })
          pushEntry({ time: parsed?.time || "", title: parsed?.group || title, rawText: parsed ? parsed.text : part })
        }
        continue
      }
      const leading = parseLeadingTimeDashboardLine(trimmed, { allowEmptyText: true })
      if (leading) {
        pushEntry({ time: leading.time || "", title: leading.group || "", rawText: leading.text })
        continue
      }
      pushEntry({ rawText: trimmed })
    }
    return entries
  }

  function buildBodyFromPlanEntries(entries) {
    return (entries ?? [])
      .map((entry) => {
        const rawText = String(entry?.rawText ?? "").trim()
        if (!rawText) return ""
        const title = normalizeCategoryId(String(entry?.title ?? "").trim())
        const time = String(entry?.time ?? "").trim()
        if (title) return time ? `${time};@${title};${rawText}` : `@${title};${rawText}`
        return time ? `${time};${rawText}` : rawText
      })
      .filter(Boolean)
      .join("\n")
      .trimEnd()
  }

  function planEntryMatchesItem(entry, item) {
    if (!entry || !item) return false
    const targetOrder = parsePlanOrderValue(item?.order ?? item?.lineIndex)
    if (targetOrder != null && entry.order === targetOrder) return true
    const entryText = String(stripTaskSuffix(entry.rawText)?.text ?? entry.rawText ?? "").trim()
    const targetText = String(item?.text ?? item?.display ?? "").trim()
    const entryTitle = normalizeCategoryId(String(entry.title ?? "").trim()) || GENERAL_CATEGORY_ID
    const targetTitle = normalizeCategoryId(String(item?.sourceTitle ?? item?.title ?? "").trim()) || GENERAL_CATEGORY_ID
    const entryTime = normalizePlanTimeFields({ time: entry.time })
    const targetTime = normalizePlanTimeFields({ time: item?.time ?? "" })
    return (
      entryText === targetText &&
      entryTitle === targetTitle &&
      (!targetTime.time || entryTime.time === targetTime.time) &&
      (!targetTime.end_time || entryTime.end_time === targetTime.end_time)
    )
  }

  function buildBodyWithPlanReplacement(bodyText, targetItem, replacementRawLine = null) {
    let changed = false
    const entries = collectPlanEntriesFromBody(bodyText)
    const nextEntries = []
    for (const entry of entries) {
      if (!changed && planEntryMatchesItem(entry, targetItem)) {
        changed = true
        if (replacementRawLine) nextEntries.push(...collectPlanEntriesFromBody(replacementRawLine))
        continue
      }
      nextEntries.push(entry)
    }
    if (!changed) return null
    return buildBodyFromPlanEntries(nextEntries)
  }

  async function insertPlanDraftToCloud(fields) {
    if (!supabase || !session?.user?.id) return false
    const userId = session.user.id
    const updatedAt = new Date().toISOString()
    const row = {
      user_id: userId,
      date: fields.dateKey,
      time: fields.time,
      content: buildPlanContentWithMeta(fields.content, {
        completed: fields.isTask ? Boolean(fields.completed) : null
      }),
      category_id: fields.category_id,
      client_id: clientIdRef.current,
      updated_at: updatedAt
    }
    if (endTimeSupportedRef.current) row.end_time = fields.end_time || null
    if (alarmColumnsSupportedRef.current) {
      row.alarm_enabled = Boolean(fields.time) && Boolean(fields.alarmEnabled)
      row.alarm_lead_minutes = fields.time && fields.alarmEnabled ? normalizeAlarmLeadMinutes(fields.alarmLeadMinutes) : 0
    }
    const sortPlan = sortOrderSupportedRef.current ? buildDefaultInsertSortPlan(fields.dateKey, remotePlans, row) : null
    if (sortOrderSupportedRef.current) row.sort_order = sortPlan?.sortOrder ?? getNextSortOrderForDate(fields.dateKey, remotePlans)

    suspendRemotePlansLoads()
    let { data, error } = await supabase.from("plans").insert(row).select()
    if (error && isEndTimeColumnError(error)) {
      endTimeSupportedRef.current = false
      const retryRow = { ...row }
      delete retryRow.end_time
      const retry = await supabase.from("plans").insert(retryRow).select()
      data = retry.data
      error = retry.error
    }
    if (error && isAlarmColumnError(error)) {
      alarmColumnsSupportedRef.current = false
      const retryRow = stripAlarmFromRows([endTimeSupportedRef.current ? row : stripEndTimeFromRows([row])[0]])[0]
      const retryPayload = sortOrderSupportedRef.current ? retryRow : stripSortOrderFromRows([retryRow])[0]
      const retry = await supabase.from("plans").insert(retryPayload).select()
      data = retry.data
      error = retry.error
    }
    if (error && isSortOrderColumnError(error)) {
      sortOrderSupportedRef.current = false
      const retryRow = endTimeSupportedRef.current ? { ...row } : stripEndTimeFromRows([row])[0]
      const alarmSafeRow = alarmColumnsSupportedRef.current ? retryRow : stripAlarmFromRows([retryRow])[0]
      delete alarmSafeRow.sort_order
      const retry = await supabase.from("plans").insert(alarmSafeRow).select()
      data = retry.data
      error = retry.error
    }
    if (error) {
      console.error("insert plan", error)
      setAuthMessage("항목 추가에 실패했어요.")
      return false
    }
    if (sortPlan?.updates?.length && sortOrderSupportedRef.current) {
      const baseMs = Date.now()
      const payloads = sortPlan.updates.map((item, idx) => ({
        id: item.id,
        user_id: userId,
        sort_order: item.order,
        updated_at: new Date(baseMs + idx).toISOString(),
        client_id: clientIdRef.current
      }))
      const { error: orderError } = await supabase.from("plans").upsert(payloads, { onConflict: "id" })
      if (orderError && isSortOrderColumnError(orderError)) {
        sortOrderSupportedRef.current = false
      } else if (orderError) {
        console.error("insert plan order", orderError)
      }
    }
    const orderMap = new Map((sortPlan?.updates ?? []).map((item) => [String(item.id), item.order]))
    setRemotePlans((prev) => [
      ...(prev ?? []).map((existing) => {
        const order = orderMap.get(String(existing?.id ?? ""))
        return order == null ? existing : { ...existing, sort_order: order }
      }),
      ...((data ?? []).length ? data : [row])
    ])
    return true
  }

  async function updatePlanDraftInCloud(fields) {
    if (!supabase || !session?.user?.id) return false
    const source = fields.sourceItem
    const targetRow = source?.rowId || source?.row?.id ? source?.row ?? { id: source?.rowId } : findMatchingRemotePlanRow(source)
    const rowId = String(targetRow?.id ?? "").trim()
    if (!rowId) return false
    const userId = session.user.id
    const updatedAt = new Date().toISOString()
    const payload = {
      date: fields.dateKey,
      time: fields.time,
      content: buildPlanContentWithMeta(fields.content, {
        completed: fields.isTask ? Boolean(fields.completed) : null
      }),
      category_id: fields.category_id,
      updated_at: updatedAt,
      client_id: clientIdRef.current
    }
    if (endTimeSupportedRef.current) payload.end_time = fields.end_time || null
    if (alarmColumnsSupportedRef.current) {
      payload.alarm_enabled = Boolean(fields.time) && Boolean(fields.alarmEnabled)
      payload.alarm_lead_minutes = fields.time && fields.alarmEnabled ? normalizeAlarmLeadMinutes(fields.alarmLeadMinutes) : 0
    }

    suspendRemotePlansLoads()
    setRemotePlans((prev) =>
      (prev ?? []).map((row) => (String(row?.id ?? "") === rowId ? { ...row, ...payload } : row))
    )

    let { error } = await supabase.from("plans").update(payload).eq("id", rowId).eq("user_id", userId)
    if (error && isEndTimeColumnError(error)) {
      endTimeSupportedRef.current = false
      const retryPayload = { ...payload }
      delete retryPayload.end_time
      const retry = await supabase.from("plans").update(retryPayload).eq("id", rowId).eq("user_id", userId)
      error = retry.error
    }
    if (error && isAlarmColumnError(error)) {
      alarmColumnsSupportedRef.current = false
      const retryPayload = stripAlarmFromRows([endTimeSupportedRef.current ? payload : stripEndTimeFromRows([payload])[0]])[0]
      const retry = await supabase.from("plans").update(retryPayload).eq("id", rowId).eq("user_id", userId)
      error = retry.error
    }
    if (error) {
      console.error("update plan", error)
      await loadRemotePlans(userId, { force: true })
      setAuthMessage("항목 수정에 실패했어요.")
      return false
    }
    return true
  }

  async function removeQuickSourcePlan(sourceItem) {
    if (!sourceItem) return true
    if (canUseWebRowPlanEdit && supabase && session?.user?.id) {
      const targetRow =
        sourceItem?.rowId || sourceItem?.row?.id
          ? sourceItem?.row ?? { id: sourceItem?.rowId }
          : findMatchingRemotePlanRow(sourceItem)
      const rowId = String(targetRow?.id ?? "").trim()
      if (!rowId) return true
      const userId = session.user.id
      const deletedAt = new Date().toISOString()
      suspendRemotePlansLoads()
      setRemotePlans((prev) => (prev ?? []).filter((row) => String(row?.id ?? "") !== rowId))
      const { error } = await supabase
        .from("plans")
        .update({ deleted_at: deletedAt, updated_at: deletedAt, client_id: clientIdRef.current })
        .eq("id", rowId)
        .eq("user_id", userId)
      if (error) {
        console.error("delete source plan", error)
        await loadRemotePlans(userId, { force: true })
        return false
      }
      return true
    }

    const sourceDateKey = String(sourceItem?.dateKey ?? "").trim()
    if (!sourceDateKey) return true
    const isAll = activeWindowId === "all"
    const current = isAll ? textRef.current ?? text : tabEditText ?? ""
    const sourceBody = getDateBlockBodyText(current, baseYear, sourceDateKey)
    const nextBody = buildBodyWithPlanReplacement(sourceBody, sourceItem, null)
    if (nextBody == null) return false
    const nextText = updateDateBlockBody(current, baseYear, sourceDateKey, nextBody)
    if (isAll) {
      updateEditorText(nextText)
      setWindowMemoTextSync(baseYear, "all", nextText)
    } else {
      setTabEditText(nextText)
      setWindowMemoTextSync(baseYear, activeWindowId, nextText)
      applyTabEditToAllFromText(nextText)
    }
    return true
  }

  async function saveQuickRecurringDraft(fields) {
    const payload = buildRecurringPayloadFromPlanFields(fields)
    if (!payload.rawLine) return false

    if (hasCloudSession && canUseWebRowPlanEdit && supabase && session?.user?.id) {
      const userId = session.user.id
      try {
        suspendRemotePlansLoads()
        const rows = buildRecurringPlanRows(userId, payload, { seriesIdOverride: genSeriesId() })
        if (rows.length === 0) return false
        await insertRecurringPlanRows(rows)
        if (fields.editMode === "edit" && fields.sourceItem) {
          const removed = await removeQuickSourcePlan(fields.sourceItem)
          if (!removed) return false
        }
        ensureWindowsForCategories(
          new Set(
            rows
              .map((row) => normalizeCategoryId(String(row?.category_id ?? "").trim()))
              .filter((title) => title && !isGeneralCategoryId(title))
          )
        )
        await loadRemotePlans(userId, { force: true })
        return true
      } catch (error) {
        console.error("quick recurring save", error)
        await loadRemotePlans(userId, { force: true })
        setAuthMessage("반복 일정 저장에 실패했어요.")
        return false
      }
    }

    const nextRule = buildRecurringRuleFromPayload(payload, fields.dateKey)
    setRecurringRules((prev) => [...(prev ?? []), nextRule])
    if (fields.editMode === "edit" && fields.sourceItem) {
      const removed = await removeQuickSourcePlan(fields.sourceItem)
      if (!removed) return false
    }
    setDayListMode("edit")
    return true
  }

  function savePlanDraftToText(fields) {
    const rawLine = buildPlanRawLineFromDraftFields(fields)
    if (fields.editMode !== "edit" || !fields.sourceItem) {
      return appendRawLineToDateBlock(fields.dateKey, rawLine)
    }

    const sourceDateKey = String(fields.sourceItem?.dateKey ?? fields.dateKey ?? "").trim()
    const isAll = activeWindowId === "all"
    const current = isAll ? textRef.current ?? text : tabEditText ?? ""
    const sourceBody = getDateBlockBodyText(current, baseYear, sourceDateKey)
    const removedBody = buildBodyWithPlanReplacement(sourceBody, fields.sourceItem, null)
    if (removedBody == null) return false

    let nextText = updateDateBlockBody(current, baseYear, sourceDateKey, removedBody)
    const targetBody = getDateBlockBodyText(nextText, baseYear, fields.dateKey)
    const nextTargetBody =
      sourceDateKey === fields.dateKey
        ? buildBodyWithPlanReplacement(sourceBody, fields.sourceItem, rawLine)
        : [String(targetBody ?? "").trimEnd(), rawLine].filter(Boolean).join("\n").trimEnd()
    nextText =
      sourceDateKey === fields.dateKey
        ? updateDateBlockBody(current, baseYear, sourceDateKey, nextTargetBody)
        : updateDateBlockBody(nextText, baseYear, fields.dateKey, nextTargetBody)

    if (canUseWebRowPlanEdit) {
      if (sourceDateKey !== fields.dateKey) enqueueDayListSync(sourceDateKey, removedBody, activeWindowId)
      enqueueDayListSync(fields.dateKey, nextTargetBody, activeWindowId)
    }
    if (isAll) {
      updateEditorText(nextText)
      setWindowMemoTextSync(baseYear, "all", nextText)
    } else {
      setTabEditText(nextText)
      setWindowMemoTextSync(baseYear, activeWindowId, nextText)
      applyTabEditToAllFromText(nextText)
    }
    return true
  }

  async function handleQuickCreate(draft) {
    const fields = normalizePlanModalDraft(draft)
    if (!fields.content) {
      setAuthMessage("내용을 입력해 주세요.")
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dateKey)) {
      setAuthMessage("날짜 형식은 YYYY-MM-DD 이어야 합니다.")
      return
    }
    if (!fields.dateKey.startsWith(`${baseYear}-`) && !canUseWebRowPlanEdit) {
      setAuthMessage(`웹 추가는 현재 보고 있는 연도(${baseYear}) 안에서 먼저 지원합니다.`)
      return
    }
    if (fields.repeat !== "none" && fields.untilDateKey && fields.untilDateKey < fields.dateKey) {
      setAuthMessage("마감일은 시작일보다 빠를 수 없습니다.")
      return
    }

    if (fields.repeat !== "none") {
      const ok = await saveQuickRecurringDraft(fields)
      if (!ok) return
      setAuthMessage(fields.editMode === "edit" ? "반복 일정으로 저장했어요." : "반복 일정을 추가했어요.")
      setActiveDateKey(fields.dateKey)
      closeQuickCreateModal()
      return
    }

    const usingCloudRows = canUseWebRowPlanEdit && supabase && session?.user?.id
    if (usingCloudRows) {
      const savePromise =
        fields.editMode === "edit"
          ? updatePlanDraftInCloud(fields)
          : insertPlanDraftToCloud(fields)
      setAuthMessage(fields.editMode === "edit" ? "항목을 저장했어요." : "항목을 추가했어요.")
      setActiveDateKey(fields.dateKey)
      closeQuickCreateModal()
      await savePromise
      return
    }

    const ok = savePlanDraftToText(fields)
    if (!ok) return

    setAuthMessage(fields.editMode === "edit" ? "항목을 저장했어요." : "항목을 추가했어요.")
    setActiveDateKey(fields.dateKey)
    closeQuickCreateModal()
  }

  async function handleQuickDelete({ sourceItem } = {}) {
    if (!sourceItem) return
    if (canUseWebRowPlanEdit && supabase && session?.user?.id) {
      const targetRow = sourceItem?.rowId || sourceItem?.row?.id ? sourceItem?.row ?? { id: sourceItem?.rowId } : findMatchingRemotePlanRow(sourceItem)
      const rowId = String(targetRow?.id ?? "").trim()
      if (!rowId) return
      const userId = session.user.id
      const deletedAt = new Date().toISOString()
      suspendRemotePlansLoads()
      setRemotePlans((prev) => (prev ?? []).filter((row) => String(row?.id ?? "") !== rowId))
      const { error } = await supabase
        .from("plans")
        .update({ deleted_at: deletedAt, updated_at: deletedAt, client_id: clientIdRef.current })
        .eq("id", rowId)
        .eq("user_id", userId)
      if (error) {
        console.error("delete plan", error)
        await loadRemotePlans(userId, { force: true })
        setAuthMessage("항목 삭제에 실패했어요.")
        return
      }
      setAuthMessage("항목을 삭제했어요.")
      closeQuickCreateModal()
      return
    }

    const sourceDateKey = String(sourceItem?.dateKey ?? "").trim()
    if (!sourceDateKey) return
    const isAll = activeWindowId === "all"
    const current = isAll ? textRef.current ?? text : tabEditText ?? ""
    const sourceBody = getDateBlockBodyText(current, baseYear, sourceDateKey)
    const nextBody = buildBodyWithPlanReplacement(sourceBody, sourceItem, null)
    if (nextBody == null) return
    const nextText = updateDateBlockBody(current, baseYear, sourceDateKey, nextBody)
    if (isAll) {
      updateEditorText(nextText)
      setWindowMemoTextSync(baseYear, "all", nextText)
    } else {
      setTabEditText(nextText)
      setWindowMemoTextSync(baseYear, activeWindowId, nextText)
      applyTabEditToAllFromText(nextText)
    }
    setAuthMessage("항목을 삭제했어요.")
    closeQuickCreateModal()
  }

  function toggleAnyTask(task) {
    if (task?.sourceType === "recurring") {
      toggleRecurringTask(task)
      return
    }
    if (canUseWebRowPlanEdit && supabase && session?.user?.id) {
      void persistTextTaskToggle(task)
      return
    }
    toggleTextTask(task)
  }

  function openAnyTask(task) {
    if (task?.sourceType === "recurring") {
      openRecurringEdit(task)
      return
    }
    openTextTask(task)
  }

  function buildRecurringRuleFromPayload(payload, fallbackDateKey, familyId = null) {
    const startDateKey = String(payload?.startDateKey ?? fallbackDateKey ?? "").trim()
    const untilDateKey = String(payload?.untilDateKey ?? "").trim()
    return {
      id: genRecurringId("rule"),
      familyId: familyId || genRecurringId("family"),
      startDateKey,
      untilDateKey,
      repeat: normalizeRepeatType(payload?.repeat),
      repeatInterval: normalizeRepeatInterval(payload?.repeatInterval),
      repeatDays:
        normalizeRepeatType(payload?.repeat) === "weekly"
          ? normalizeRepeatDays(payload?.repeatDays)
          : [],
      rawLine: String(payload?.rawLine ?? "").trim(),
      categoryTitle: String(payload?.categoryTitle ?? activeRecurringCategoryTitle ?? "").trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  function removeSourceTaskFromTextTaskFlow(sourceTask = null, sourceLineIndex = null, dateKeyOverride = "") {
    const dateKey = String(sourceTask?.dateKey ?? dateKeyOverride ?? recurringModalState?.dateKey ?? "").trim()
    const lineIndex = Number.isInteger(sourceTask?.lineIndex)
      ? sourceTask.lineIndex
      : Number.isInteger(sourceLineIndex)
        ? sourceLineIndex
        : null
    if (!dateKey || !Number.isInteger(lineIndex)) return

    const currentText = activeWindowId === "all" ? textRef.current ?? text : tabEditText ?? ""
    const bodyText = getDateBlockBodyText(currentText, baseYear, dateKey)
    const nextBodyText = removeTaskLineFromBody(bodyText, lineIndex)
    if (nextBodyText === bodyText) return

    if (canUseWebRowPlanEdit) {
      enqueueDayListSync(dateKey, nextBodyText, activeWindowId)
    }

    const nextText = updateDateBlockBody(currentText, baseYear, dateKey, nextBodyText)
    if (nextText === currentText) return

    if (activeWindowId === "all") {
      updateEditorText(nextText)
      setWindowMemoTextSync(baseYear, "all", nextText)
    } else {
      setTabEditText(nextText)
      setWindowMemoTextSync(baseYear, activeWindowId, nextText)
      applyTabEditToAllFromText(nextText)
    }

    if (dayListModal?.key === dateKey) {
      setDayListEditText(nextBodyText)
      setDayListMode("edit")
    }
  }

  function createRecurringRule(payload) {
    if (hasCloudSession) {
      createCloudRecurringRule(payload)
      return
    }
    const nextRule = buildRecurringRuleFromPayload(payload, recurringModalState?.dateKey)
    setRecurringRules((prev) => [...(prev ?? []), nextRule])
    removeSourceTaskFromTextTaskFlow(
      recurringModalState?.sourceTask ?? null,
      recurringModalState?.sourceLineIndex ?? null,
      recurringModalState?.dateKey
    )
    setDayListMode("edit")
  }

  function updateRecurringRuleScoped(payload, scope) {
    if (hasCloudSession) {
      updateCloudRecurringRuleScoped(payload, scope)
      return
    }
    setDayListMode("edit")
    const target = recurringModalState?.item
    if (!target) return
    const familyId = String(target.familyId ?? target.ruleId ?? "").trim()
    const anchorDateKey = String(target.dateKey ?? "").trim()
    if (!familyId || !anchorDateKey) return

    const familyRules = (recurringRules ?? [])
      .filter((rule) => String(rule?.familyId ?? rule?.id ?? "").trim() === familyId)
      .sort((a, b) => keyToTime(String(a?.startDateKey ?? "")) - keyToTime(String(b?.startDateKey ?? "")))
    if (familyRules.length === 0) return
    const familyStartDateKey = familyRules[0]?.startDateKey
    const normalizedPayload = buildRecurringRuleFromPayload(payload, anchorDateKey, familyId)
    const nowIso = new Date().toISOString()

    if (scope === "single") {
      const nextOverride = {
        id: genRecurringId("override"),
        familyId,
        ruleId: String(target.ruleId ?? "").trim(),
        dateKey: anchorDateKey,
        mode: "replace",
        rawLine: normalizedPayload.rawLine,
        updatedAt: nowIso
      }
      setRecurringOverrides((prev) => {
        const list = Array.isArray(prev) ? prev : []
        const filtered = list.filter(
          (item) =>
            !(
              String(item?.ruleId ?? "").trim() === nextOverride.ruleId &&
              String(item?.dateKey ?? "").trim() === anchorDateKey
            )
        )
        return [...filtered, nextOverride]
      })
      return
    }

    if (scope === "future") {
      const prevDateKey = getPreviousDateKey(anchorDateKey)
      setRecurringRules((prev) => {
        const list = Array.isArray(prev) ? prev : []
        const kept = []
        for (const rule of list) {
          const currentFamilyId = String(rule?.familyId ?? rule?.id ?? "").trim()
          if (currentFamilyId !== familyId) {
            kept.push(rule)
            continue
          }
          const ruleStart = String(rule?.startDateKey ?? "").trim()
          const ruleUntil = String(rule?.untilDateKey || ruleStart).trim()
          if (keyToTime(ruleUntil) < keyToTime(anchorDateKey)) {
            kept.push(rule)
            continue
          }
          if (keyToTime(ruleStart) < keyToTime(anchorDateKey) && keyToTime(prevDateKey) >= keyToTime(ruleStart)) {
            kept.push({ ...rule, untilDateKey: prevDateKey, updatedAt: nowIso })
          }
        }
        kept.push({
          ...normalizedPayload,
          id: genRecurringId("rule"),
          familyId,
          startDateKey: anchorDateKey,
          untilDateKey: normalizedPayload.untilDateKey,
          createdAt: nowIso,
          updatedAt: nowIso
        })
        return kept
      })
      setRecurringOverrides((prev) =>
        (Array.isArray(prev) ? prev : []).filter(
          (item) =>
            String(item?.familyId ?? "").trim() !== familyId || keyToTime(String(item?.dateKey ?? "")) < keyToTime(anchorDateKey)
        )
      )
      return
    }

    setRecurringRules((prev) => {
      const list = Array.isArray(prev) ? prev : []
      const kept = list.filter((rule) => String(rule?.familyId ?? rule?.id ?? "").trim() !== familyId)
      kept.push({
        ...normalizedPayload,
        id: genRecurringId("rule"),
        familyId,
        startDateKey: familyStartDateKey,
        untilDateKey: normalizedPayload.untilDateKey,
        createdAt: nowIso,
        updatedAt: nowIso
      })
      return kept
    })
    setRecurringOverrides((prev) =>
      (Array.isArray(prev) ? prev : []).filter((item) => String(item?.familyId ?? "").trim() !== familyId)
    )
  }

  function deleteRecurringRuleScoped(scope) {
    if (hasCloudSession) {
      deleteCloudRecurringRuleScoped(scope)
      return
    }
    setDayListMode("edit")
    const target = recurringModalState?.item
    if (!target) return
    const familyId = String(target.familyId ?? target.ruleId ?? "").trim()
    const anchorDateKey = String(target.dateKey ?? "").trim()
    if (!familyId || !anchorDateKey) return

    if (scope === "single") {
      const nextOverride = {
        id: genRecurringId("override"),
        familyId,
        ruleId: String(target.ruleId ?? "").trim(),
        dateKey: anchorDateKey,
        mode: "skip",
        rawLine: "",
        updatedAt: new Date().toISOString()
      }
      setRecurringOverrides((prev) => {
        const list = Array.isArray(prev) ? prev : []
        const filtered = list.filter(
          (item) =>
            !(
              String(item?.ruleId ?? "").trim() === nextOverride.ruleId &&
              String(item?.dateKey ?? "").trim() === anchorDateKey
            )
        )
        return [...filtered, nextOverride]
      })
      return
    }

    if (scope === "future") {
      const prevDateKey = getPreviousDateKey(anchorDateKey)
      setRecurringRules((prev) => {
        const list = Array.isArray(prev) ? prev : []
        const kept = []
        for (const rule of list) {
          const currentFamilyId = String(rule?.familyId ?? rule?.id ?? "").trim()
          if (currentFamilyId !== familyId) {
            kept.push(rule)
            continue
          }
          const ruleStart = String(rule?.startDateKey ?? "").trim()
          const ruleUntil = String(rule?.untilDateKey || ruleStart).trim()
          if (keyToTime(ruleUntil) < keyToTime(anchorDateKey)) {
            kept.push(rule)
            continue
          }
          if (keyToTime(ruleStart) < keyToTime(anchorDateKey) && keyToTime(prevDateKey) >= keyToTime(ruleStart)) {
            kept.push({ ...rule, untilDateKey: prevDateKey, updatedAt: new Date().toISOString() })
          }
        }
        return kept
      })
      setRecurringOverrides((prev) =>
        (Array.isArray(prev) ? prev : []).filter(
          (item) =>
            String(item?.familyId ?? "").trim() !== familyId || keyToTime(String(item?.dateKey ?? "")) < keyToTime(anchorDateKey)
        )
      )
      return
    }

    setRecurringRules((prev) =>
      (Array.isArray(prev) ? prev : []).filter((rule) => String(rule?.familyId ?? rule?.id ?? "").trim() !== familyId)
    )
    setRecurringOverrides((prev) =>
      (Array.isArray(prev) ? prev : []).filter((item) => String(item?.familyId ?? "").trim() !== familyId)
    )
  }

  function closeDayListModal() {
    flushPendingDayListSync()
    if (
      readDateDraft &&
      dayListModal &&
      readDateDraft.windowId === activeWindowId &&
      readDateDraft.year === baseYear &&
      readDateDraft.dateKey === dayListModal.key &&
      !String(dayListEditText ?? "").trim()
    ) {
      if (activeWindowId === "all") {
        const current = textRef.current ?? text
        const removeResult = removeEmptyBlockByDateKey(current, baseYear, dayListModal.key)
        if (removeResult.changed) {
          updateEditorText(removeResult.newText)
          setWindowMemoTextSync(baseYear, "all", removeResult.newText)
        }
      } else {
        const current = tabEditText ?? ""
        const removeResult = removeEmptyBlockByDateKey(current, baseYear, dayListModal.key)
        if (removeResult.changed) {
          setTabEditText(removeResult.newText)
          setWindowMemoTextSync(baseYear, activeWindowId, removeResult.newText)
        }
      }
    }
    setReadDateDraft(null)
    setDayListModal(null)
    dayListDirtyRef.current = false
    dayListEditGuardRef.current = { open: false, mode: "read", dirty: false }
    const userId = session?.user?.id
    if (userId && forceRemoteApplyRef.current) {
      loadRemotePlans(userId).catch((err) => {
        console.error("reload plans after day modal close", err)
      })
    }
  }

  function setMemoInnerMode(mode) {
    const next = mode === "left" ? "left" : "right"
    setMemoInnerCollapsed(next)
    setMemoCollapsedByWindow((map) => ({ ...map, [activeWindowId]: next }))
  }

  const memoTextareaStyle = {
    width: "100%",
    height: "100%",
    minHeight: 0,
    resize: "none",
    border: "none",
    borderRadius: 0,
    padding: "8px 12px",
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
    paddingBottom: "50vh",
    position: "relative",
    zIndex: 1
  }

  const settingsLabelTextStyle = {
    fontWeight: 500,
    color: ui.text2,
    fontSize: 15,
    letterSpacing: "0.01em",
    width: 82,
    textAlign: "left",
    paddingLeft: 2
  }

  const settingsRowStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%"
  }

  const isLeftCollapsed = memoInnerCollapsed === "left"
  const isRightCollapsed = memoInnerCollapsed === "right"
  const leftMemoFlex = isLeftCollapsed ? "0 0 0px" : "1 1 0"
  const rightMemoFlex = isRightCollapsed ? "0 0 0px" : "1 1 0"

  // ? "설정 창 밖 클릭" 처리: 패널/버튼 밖이면 닫기
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
  const showListPane = showMemoPanel && !isLeftCollapsed
  const showMemoMonthControls = showMemoPanel && !showCalendarPanel && !isLeftCollapsed
  const showMemoTopActions = showMemoPanel && !showCalendarPanel && !isLeftCollapsed
  const showLogoInMemoPanel = showMemoPanel && (!showCalendarPanel || layoutPreset === "memo-left")
  const showLogoInCalendarPanel = showCalendarPanel && (!showMemoPanel || layoutPreset === "calendar-left")
  const showSwapButtonInMemoPanel =
    showMemoPanel && (!showCalendarPanel || layoutPreset === "memo-left")
  const showSwapButtonInCalendarPanel =
    showCalendarPanel && (!showMemoPanel || layoutPreset === "calendar-left")
  const canScrollTabsLeft = tabScrollState.left
  const canScrollTabsRight = tabScrollState.right

  const memoPanel = (
    <div
      style={{
        flex: memoPanelFlex,
        minWidth: 0,
        minHeight: 0,
        height: "100%",
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flex: "1 1 auto",
              minWidth: 0
            }}
          >
            {showLogoInMemoPanel ? <PlannerLogoMark /> : null}
            {showMemoMonthControls ? (
              <MonthNavigator
                ymYear={ymYear}
                setYmYear={setYmYear}
                ymMonth={ymMonth}
                setYmMonth={setYmMonth}
                goPrevMonth={goPrevMonth}
                goNextMonth={goNextMonth}
                ui={ui}
                labelPrefix="리스트"
              />
            ) : null}
            {showMemoTopActions ? (
              <>
                <button
                  type="button"
                  onClick={goToday}
                  style={{
                    ...pillButton,
                    height: 32,
                    padding: "0 12px",
                    borderRadius: 6,
                    lineHeight: "normal"
                  }}
                  title="오늘로 이동"
                  aria-label="오늘로 이동"
                >
                  Today
                </button>
                <button
                  ref={readDateCreateButtonRef}
                  onClick={(e) => openReadDateCreatePicker(e.currentTarget)}
                  style={{
                    ...pillButton,
                    height: 32,
                    padding: "0 12px",
                    borderRadius: 6,
                    lineHeight: "normal",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                  title="일정 생성"
                  aria-label="일정 생성"
                >
                  🗓 Add
                </button>
                <input
                  ref={readDateCreateInputRef}
                  type="date"
                  required
                  onChange={handleReadDateCreateChange}
                  aria-label="일정 날짜 생성"
                  style={{
                    position: "fixed",
                    left: -9999,
                    top: -9999,
                    width: 1,
                    height: 1,
                    border: 0,
                    padding: 0,
                    margin: 0,
                    overflow: "hidden",
                    opacity: 0,
                    pointerEvents: "none"
                  }}
                />
              </>
            ) : null}
          </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            flexShrink: 0,
            marginLeft: "auto"
          }}
        >
          <div
            role="group"
            aria-label="리스트와 메모 보기 전환"
            style={{
              height: 34,
              borderRadius: 6,
              border: `1px solid ${ui.border}`,
              background: ui.surface,
              display: "inline-flex",
              alignItems: "stretch",
              overflow: "hidden",
              flexShrink: 0,
              boxShadow: theme === "dark" ? "none" : "0 1px 0 rgba(15, 23, 42, 0.04)"
            }}
          >
            {[
              { key: "right", icon: "☰", label: "리스트만 보기" },
              { key: "left", icon: "✎", label: "메모만 보기" }
            ].map((option, index) => {
              const active = memoInnerCollapsed === option.key
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setMemoInnerMode(option.key)}
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={active}
                  style={{
                    width: 34,
                    height: "100%",
                    boxSizing: "border-box",
                    border: 0,
                    borderLeft: index === 0 ? "none" : `1px solid ${ui.border}`,
                    background: active ? ui.accentSoft : "transparent",
                    color: active ? ui.accent : ui.text2,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: option.key === "right" ? 20 : 18,
                    fontWeight: 820,
                    lineHeight: 1,
                    outline: "none",
                    transform: "none"
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                      transform: option.key === "left" ? "translateY(-0.5px)" : "none"
                    }}
                  >
                    {option.icon}
                  </span>
                </button>
              )
            })}
          </div>
          <button
            ref={settingsBtnRef}
            onClick={() => setSettingsOpen((v) => !v)}
            title="설정"
            aria-label="설정"
            style={{
              ...memoTopRightButton,
              fontSize: 18,
              color: ui.text
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
              style={{ transform: "translateY(1px) scale(1.02)" }}
            >
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M11.983 2.25c-.267 0-.52.04-.76.115l-.6 1.95a.75.75 0 0 1-.428.48l-.9.39a.75.75 0 0 1-.636-.02l-1.823-1.07a9.029 9.029 0 0 0-1.354 1.354l1.07 1.823a.75.75 0 0 1 .02.636l-.39.9a.75.75 0 0 1-.48.428l-1.95.6a9.05 9.05 0 0 0 0 1.52l1.95.6a.75.75 0 0 1 .48.428l.39.9a.75.75 0 0 1-.02.636l-1.07 1.823a9.029 9.029 0 0 0 1.354 1.354l1.823-1.07a.75.75 0 0 1 .636-.02l.9.39a.75.75 0 0 1 .428.48l.6 1.95a9.05 9.05 0 0 0 1.52 0l.6-1.95a.75.75 0 0 1 .428-.48l.9-.39a.75.75 0 0 1 .636.02l1.823 1.07a9.029 9.029 0 0 0 1.354-1.354l-1.07-1.823a.75.75 0 0 1-.02-.636l.39-.9a.75.75 0 0 1 .48-.428l1.95-.6a9.05 9.05 0 0 0 0-1.52l-1.95-.6a.75.75 0 0 1-.48-.428l-.39-.9a.75.75 0 0 1 .02-.636l1.07-1.823a9.029 9.029 0 0 0-1.354-1.354l-1.823 1.07a.75.75 0 0 1-.636.02l-.9-.39a.75.75 0 0 1-.428-.48l-.6-1.95a9.05 9.05 0 0 0-.76-.115Zm.017 5.25a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {showSwapButtonInMemoPanel ? (
            <button
              onClick={() => setLayoutPreset((p) => (p === "memo-left" ? "calendar-left" : "memo-left"))}
              style={compactLayoutToggleButton}
              title="메모/달력 위치 변경"
              aria-label="메모/달력 위치 변경"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path
                  d="M4 6h10M11 3l3 3-3 3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M16 14H6M9 11l-3 3 3 3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
          {!session && (
            <>
              <button
                onClick={() => {
                  setAuthMessage("")
                  setLoginModalOpen(true)
                }}
                title="로그인"
                aria-label="로그인"
                style={{ ...memoTopRightButton, fontSize: 12, fontWeight: 760, minWidth: 74 }}
              >
                로그인
              </button>
              <span style={{ fontSize: 11, color: ui.text2 }}>오프라인 모드</span>
            </>
          )}
        </div>

        {settingsOpen && (
          <SettingsPanel
            settingsPanelRef={settingsPanelRef}
            ui={ui}
            panelFontFamily={panelFontFamily}
            settingsRowStyle={settingsRowStyle}
            settingsLabelTextStyle={settingsLabelTextStyle}
            settingsNumberInput={settingsNumberInput}
            theme={theme}
            setTheme={setTheme}
            FONT_MIN={FONT_MIN}
            FONT_MAX={FONT_MAX}
            CALENDAR_FONT_MIN={CALENDAR_FONT_MIN}
            CALENDAR_FONT_MAX={CALENDAR_FONT_MAX}
            tabFontInput={tabFontInput}
            setTabFontInput={setTabFontInput}
            tabFontPx={tabFontPx}
            setTabFontPx={setTabFontPx}
            memoFontInput={memoFontInput}
            setMemoFontInput={setMemoFontInput}
            memoFontPx={memoFontPx}
            setMemoFontPx={setMemoFontPx}
            memoTabFontInput={memoTabFontInput}
            setMemoTabFontInput={setMemoTabFontInput}
            memoTabFontPx={memoTabFontPx}
            setMemoTabFontPx={setMemoTabFontPx}
            memoBodyFontInput={memoBodyFontInput}
            setMemoBodyFontInput={setMemoBodyFontInput}
            memoBodyFontPx={memoBodyFontPx}
            setMemoBodyFontPx={setMemoBodyFontPx}
            calendarFontInput={calendarFontInput}
            setCalendarFontInput={setCalendarFontInput}
            calendarFontPx={calendarFontPx}
            setCalendarFontPx={setCalendarFontPx}
            showLogout={Boolean(session)}
            onSignOut={() => {
              setSettingsOpen(false)
              void handleSignOut()
            }}
            onDeleteAccount={session ? () => {
              setSettingsOpen(false)
              void handleDeleteAccount()
            } : null}
            deleteAccountLoading={deleteAccountLoading}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
      <WindowTabs
        windows={windows}
        activeWindowId={activeWindowId}
        setActiveWindowId={setActiveWindowId}
        editingWindowId={editingWindowId}
        setEditingWindowId={setEditingWindowId}
        titleInputRef={titleInputRef}
        commitWindowTitleChange={commitWindowTitleChange}
        tabFontPx={tabFontPx}
        setDeleteConfirm={setDeleteConfirm}
        draggingWindowIdRef={draggingWindowIdRef}
        reorderWindows={reorderWindows}
        addWindow={addWindow}
        scrollTabs={scrollTabs}
        tabsScrollRef={tabsScrollRef}
        canScrollTabsLeft={canScrollTabsLeft}
        canScrollTabsRight={canScrollTabsRight}
        ui={ui}
        arrowButton={arrowButton}
        iconButton={iconButton}
        WINDOW_COLORS={WINDOW_COLORS}
        setWindows={setWindows}
      />
      {/* ? 메모 2분할 + 내부 드래그 */}
      <div style={{ flex: "1 1 auto", minHeight: 0, padding: "6px 8px", marginTop: 0 }}>
        <div
          ref={memoInnerWrapRef}
          style={{
            position: "relative",
            display: "flex",
            gap: 0,
            flex: "1 1 auto",
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
              {isEditingLeftMemo ? (
                <MemoEditor
                  ui={ui}
                  memoOverlayStyle={memoOverlay}
                  memoTextareaStyle={memoTextareaStyle}
                  leftOverlayLines={leftOverlayLines}
                  leftOverlayInnerRef={leftOverlayInnerRef}
                  mentionGhostText={mentionGhostText}
                  mentionGhostPos={mentionGhostPos}
                  memoFontPx={memoFontPx}
                  textareaRef={textareaRef}
                  value={activeWindowId === "all" ? text : tabEditText}
                  onFocus={() => {
                    setIsEditingLeftMemo(true)
                    requestAnimationFrame(() => updateMentionGhost())
                  }}
                  onChange={(e) => {
                    handleLeftMemoChange(e)
                    updateMentionGhost()
                    updateTabMentionMenu()
                  }}
                  onBlur={onTextareaBlur}
                  onClick={onTextareaSelectOrKeyUp}
                  onKeyUp={onTextareaSelectOrKeyUp}
                  onKeyDown={(e) => {
                    if (handleTabMentionKeyDown(e)) return
                    if (acceptMentionGhost(e)) return
                    handleBoxEnterKey(
                      e,
                      activeWindowId === "all" ? text : tabEditText,
                      textareaRef,
                      activeWindowId === "all" ? updateEditorText : setTabEditText
                    )
                  }}
                  onSelect={onTextareaSelectOrKeyUp}
                  onWheel={onMemoWheel}
                  onScroll={(e) => {
                    syncOverlayScroll(e.currentTarget, leftOverlayInnerRef.current)
                    updateMentionGhost()
                    updateTabMentionMenu()
                  }}
                  placeholder={
                    activeWindowId === "all"
                      ? [
                          "[계획 메모장]",
                          "(+버튼을 눌러 새로운 메모장을 생성)",
                          "통합 탭에서는 모든 메모장들의 메모를 합쳐서 보여줍니다.",
                          "",
                          "1. 날짜를 달력에서 클릭하거나 1/25 처럼 직접 입력",
                          "2. 날짜 아래에 [시간;@메모장 제목;내용] 형식 맞춰 입력",
                          "(시간,@메모장 제목은 생략 가능)",
                          "",
                          "ex)",
                          "1/25",
                          "11:00;@대학;수강신청",
                          "12:00;@연애;선물 구매",
                          "",
                          "1/26",
                          "10:00;1교시",
                          "@금융;적금 계좌 개설"
                        ].join("\n")
                      : [
                          "메모장의 제목을 수정하여 원하는 카테고리를 생성하세요",
                          "",
                          "이 탭에 적는 내용은 '통합'에 자동으로 합쳐집니다.",
                          "(여기서는 @탭제목을 직접 쓸 필요 없습니다.)",
                          "",
                          "예)",
                          "1/4",
                          "10:00;회의",
                          "",
                          "1/5",
                          "11:00;회의",
                          "장보기"
                        ].join("\n")
                  }
                  showTabMentionMenu={tabMentionMenu.visible && activeWindowId === "all"}
                  tabMentionMenu={tabMentionMenu}
                  tabMentionRef={tabMentionRef}
                  editableWindows={editableWindows}
                  tabMentionHoverId={tabMentionHoverId}
                  setTabMentionHoverId={setTabMentionHoverId}
                  handleTabMentionPick={handleTabMentionPick}
                  tabMentionMouseDownRef={tabMentionMouseDownRef}
                />
              ) : (
                <div
                  ref={readScrollContainerRef}
                  onClick={enterEditMode}
                  style={{
                    width: "100%",
                    height: "100%",
                    border: `1px solid ${ui.border}`,
                    borderRadius: 12,
                    background: ui.surface,
                    padding: "12px 12px",
                    paddingBottom: "max(400px, 70vh)",
                    overflow: "auto",
                    fontSize: memoFontPx,
                    lineHeight: 1.25,
                    cursor: isMainMemoReadOnly ? "default" : "text"
                  }}
                >
                  <MemoReadView
                    blocks={activeWindowId === "all" ? visibleDashboardBlocks : visibleTabReadBlocks}
                    isAll={activeWindowId === "all"}
                    ui={ui}
                    highlightTokens={highlightTokens}
                    todayKey={todayKey}
                    collapsedForActive={collapsedForActive}
                    toggleDashboardCollapse={toggleDashboardCollapse}
                    keyToYMD={keyToYMD}
                    buildHeaderLine={buildHeaderLine}
                    activeWindowId={activeWindowId}
                    setReadBlockRef={setReadBlockRef}
                    handleReadBlockClick={handleReadBlockClick}
                    readScrollMarginTop={READ_SCROLL_MARGIN_TOP}
                    memoFontPx={memoFontPx}
                    windowColorByTitle={windowColorByTitle}
                    showCategoryBadges={activeWindowId === "all"}
                    recurringItemsByDate={recurringDisplayItemsByDate}
                    taskItemsByDate={combinedTaskItemsByDate}
                    onTaskToggle={toggleAnyTask}
                    onTaskOpen={openAnyTask}
                    onTaskMove={(item, dateKey, targetIndex) => {
                      void handlePlanMoveDate(item, dateKey, targetIndex)
                    }}
                    onRecurringOpen={openRecurringEdit}
                  />

                </div>
              )}
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
              <RightMemoEditor
                memoOverlayStyle={memoOverlay}
                memoTextareaStyle={memoTextareaStyle}
                rightOverlayLines={rightOverlayLines}
                rightOverlayInnerRef={rightOverlayInnerRef}
                rightTextareaRef={rightTextareaRef}
                rightMemoText={rightMemoText}
                setRightMemoText={setRightMemoText}
                activeWindowId={activeWindowId}
                syncCombinedRightText={syncCombinedRightText}
                ensureRightMemoSectionHeaders={ensureRightMemoSectionHeaders}
                allMemoGroups={allRightMemoGroups}
                integratedSelection={integratedRightMemoSelection}
                onIntegratedSelectionChange={updateIntegratedRightMemoSelection}
                onOpenMemoDoc={openRightMemoDocFromAll}
                onSaveMemoDoc={saveRightMemoDocFromAll}
                onSaveMemoState={saveRightMemoStateFromAll}
                preferredDocTarget={rightMemoJumpTarget}
                onPreferredDocHandled={() => setRightMemoJumpTarget(null)}
                onFocus={() => {
                  setSelectedDateKey(null)
                  lastActiveDateKeyRef.current = null
                }}
                onScroll={(e) => syncOverlayScroll(e.currentTarget, rightOverlayInnerRef.current)}
                ui={{
                  ...ui,
                  memoFontPx: memoBodyFontPx,
                  memoTabFontPx,
                  memoBodyFontPx,
                  memoLineHeight: memoTextareaStyle.lineHeight ?? 1.55
                }}
                placeholder={
                  activeWindowId === "all"
                    ? ""
                    : "이 메모장에 쓰고 싶은 글을 자유롭게 입력하세요."
                }
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
              display: "none"
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
    <CalendarPanel
      calendarPanelRef={calendarPanelRef}
      calendarTopRef={calendarTopRef}
      calendarBodyRef={calendarBodyRef}
      ymYear={ymYear}
      setYmYear={setYmYear}
      ymMonth={ymMonth}
      setYmMonth={setYmMonth}
      goPrevMonth={goPrevMonth}
      goNextMonth={goNextMonth}
      layoutPreset={layoutPreset}
      outerCollapsed={outerCollapsed}
      setLayoutPreset={setLayoutPreset}
      pillButton={pillButton}
      memoTopRightButton={memoTopRightButton}
      showSwapButton={showSwapButtonInCalendarPanel}
      brandLogo={showLogoInCalendarPanel ? <PlannerLogoMark /> : null}
      ui={ui}
      calendarCellH={calendarCellH}
      calendarFontPx={calendarFontPx}
      firstWeekday={firstWeekday}
      weeks={weeks}
      lastDay={lastDay}
      itemsByDate={itemsByDate}
      selectedDateKey={selectedDateKey}
      todayKey={todayKey}
      highlightTokens={highlightTokens}
      theme={theme}
      viewYear={viewYear}
      viewMonth={viewMonth}
      openDayList={openDayList}
      handleDayClick={handleDayClick}
      onItemClick={(item) => openPlanEditModal(item, item?.dateKey ?? "")}
      onDateAdd={(dateKey) => openPlanCreateModal(dateKey)}
      onDateRangeAdd={handleCalendarDateRangeCreate}
      onItemMove={(item, dateKey, targetIndex) => {
        void handlePlanMoveDate(item, dateKey, targetIndex)
      }}
      onTaskToggle={toggleAnyTask}
      calendarInteractingRef={calendarInteractingRef}
      goToday={goToday}
      onOpenAddPicker={openReadDateCreatePicker}
      settingsButtonRef={settingsBtnRef}
      onSettingsToggle={() => setSettingsOpen((v) => !v)}
      showSettingsButton={!showMemoPanel}
      showTopActions={showCalendarPanel}
      calendarViewMode={calendarViewMode}
      setCalendarViewMode={setCalendarViewMode}
      timeBlockDateKey={timeBlockDateKey}
      timeBlockItems={timeBlockItems}
      onTimeBlockPrevDay={() => shiftTimeBlockDate(-1)}
      onTimeBlockNextDay={() => shiftTimeBlockDate(1)}
      onTimeBlockToday={() => selectTimeBlockDate(todayKey)}
      onTimeBlockAdd={openTimeBlockDate}
      onTimeBlockOpen={(item) => openPlanEditModal(item, item?.dateKey ?? timeBlockDateKey)}
      onTimeBlockChange={(item, start, end) => {
        void handleTimeBlockChange(item, start, end)
      }}
    />
  )

  if (!isSupabaseConfigured) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: ui.bg,
          color: ui.text,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: panelFontFamily
        }}
      >
        <div
          style={{
            maxWidth: 520,
            width: "100%",
            borderRadius: 16,
            background: ui.surface,
            border: `1px solid ${ui.border}`,
            padding: "18px 20px",
            boxShadow: ui.shadow
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>Supabase 연결 필요</div>
          <div style={{ color: ui.text2, lineHeight: 1.5 }}>
            Vite 환경변수에 Supabase URL/Key가 설정되어 있지 않습니다. 루트에 `.env` 파일을 만들고
            `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
            (또는 `VITE_SUPABASE_ANON_KEY`)를 넣어주세요.
          </div>
        </div>
      </div>
    )
  }

  const dividerLeft =
    outerCollapsed === "left"
      ? `${OUTER_EDGE_PAD / 2}px`
        : outerCollapsed === "right"
          ? `calc(100% - ${OUTER_EDGE_PAD / 2}px)`
          : isSwapped
          ? `calc(${(1 - splitRatio) * 100}% - ${OUTER_SPLIT_GAP_PX / 2}px)`
          : `calc(${splitRatio * 100}% + ${OUTER_SPLIT_GAP_PX / 2}px)`
  const dayListTitle = dayListModal
    ? (() => {
        const { y, m, d } = keyToYMD(dayListModal.key)
        return buildHeaderLine(y, m, d)
      })()
    : ""
  const dayListIsToday = dayListModal?.key === todayKey
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
          gap: OUTER_SPLIT_GAP_PX,
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

        {settingsOpen && !showMemoPanel ? (
          <SettingsPanel
            settingsPanelRef={settingsPanelRef}
            ui={ui}
            panelFontFamily={panelFontFamily}
            settingsRowStyle={settingsRowStyle}
            settingsLabelTextStyle={settingsLabelTextStyle}
            settingsNumberInput={settingsNumberInput}
            theme={theme}
            setTheme={setTheme}
            FONT_MIN={FONT_MIN}
            FONT_MAX={FONT_MAX}
            CALENDAR_FONT_MIN={CALENDAR_FONT_MIN}
            CALENDAR_FONT_MAX={CALENDAR_FONT_MAX}
            tabFontInput={tabFontInput}
            setTabFontInput={setTabFontInput}
            tabFontPx={tabFontPx}
            setTabFontPx={setTabFontPx}
            memoFontInput={memoFontInput}
            setMemoFontInput={setMemoFontInput}
            memoFontPx={memoFontPx}
            setMemoFontPx={setMemoFontPx}
            memoTabFontInput={memoTabFontInput}
            setMemoTabFontInput={setMemoTabFontInput}
            memoTabFontPx={memoTabFontPx}
            setMemoTabFontPx={setMemoTabFontPx}
            memoBodyFontInput={memoBodyFontInput}
            setMemoBodyFontInput={setMemoBodyFontInput}
            memoBodyFontPx={memoBodyFontPx}
            setMemoBodyFontPx={setMemoBodyFontPx}
            calendarFontInput={calendarFontInput}
            setCalendarFontInput={setCalendarFontInput}
            calendarFontPx={calendarFontPx}
            setCalendarFontPx={setCalendarFontPx}
            showLogout={Boolean(session)}
            onSignOut={() => {
              setSettingsOpen(false)
              void handleSignOut()
            }}
            onDeleteAccount={session ? () => {
              setSettingsOpen(false)
              void handleDeleteAccount()
            } : null}
            deleteAccountLoading={deleteAccountLoading}
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}

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

      <QuickCreateModal
        open={Boolean(quickCreateModalState)}
        ui={ui}
        mode={quickCreateModalState?.mode ?? "task"}
        editMode={quickCreateModalState?.editMode ?? "create"}
        sourceItem={quickCreateModalState?.sourceItem ?? null}
        initialDateKey={quickCreateModalState?.initialDateKey ?? todayKey}
        initialEndDateKey={quickCreateModalState?.initialEndDateKey ?? quickCreateModalState?.initialDateKey ?? todayKey}
        initialTime={quickCreateModalState?.initialTime ?? ""}
        initialRepeat={quickCreateModalState?.initialRepeat ?? "none"}
        initialRepeatInterval={quickCreateModalState?.initialRepeatInterval ?? 1}
        initialRepeatDays={quickCreateModalState?.initialRepeatDays ?? []}
        initialRepeatOpenEnded={Boolean(quickCreateModalState?.initialRepeatOpenEnded)}
        initialAlarmEnabled={quickCreateModalState?.initialAlarmEnabled ?? true}
        initialAlarmLeadMinutes={quickCreateModalState?.initialAlarmLeadMinutes ?? 0}
        defaultCategoryTitle={quickCreateModalState?.defaultCategoryTitle ?? ""}
        initialContent={quickCreateModalState?.initialContent ?? ""}
        initialIsTask={quickCreateModalState?.initialIsTask ?? true}
        initialCompleted={Boolean(quickCreateModalState?.initialCompleted)}
        showCategory={Boolean(quickCreateModalState?.showCategory)}
        categoryOptions={planCategoryOptions}
        onClose={closeQuickCreateModal}
        onCreate={handleQuickCreate}
        onDelete={handleQuickDelete}
        onCompletedChange={setTaskCompletedFromModal}
      />

        <DayListModal
        open={Boolean(dayListModal)}
        onClose={closeDayListModal}
        readOnly={isScheduleReadOnly}
        ui={ui}
        highlightTokens={highlightTokens}
        dayListKey={dayListModal?.key ?? ""}
        dayListTitle={dayListTitle}
        isToday={dayListIsToday}
        dayListMode={dayListMode}
        setDayListMode={setDayListMode}
        dayListEditText={dayListEditText}
        setDayListEditText={handleDayListEditTextChange}
        applyDayListEdit={applyDayListEdit}
        dayListReadItems={dayListReadItems}
        memoFontPx={memoFontPx}
        editableWindows={editableWindows}
        windowColorByTitle={windowColorByTitle}
        scopedCategoryTitle={activeWindowId === "all" ? "" : activeRecurringCategoryTitle || ""}
        recurringItems={dayListRecurringItems}
        taskItems={dayListTaskItems}
        onTaskToggle={toggleAnyTask}
        onTaskOpen={openAnyTask}
        onRecurringCreate={(kind) => openRecurringCreate(dayListModal?.key, kind)}
        onRecurringSelect={openRecurringEdit}
        onRecurringInlineSave={saveRecurringTaskInline}
      />

      {recurringModalState ? (
        <RecurringRuleModal
          open
          ui={ui}
          editingOccurrence={recurringModalState.mode === "edit" ? recurringModalState.item ?? null : null}
          initialDateKey={recurringModalState.dateKey ?? ""}
          defaultCategoryTitle={recurringModalState.defaultCategoryTitle ?? ""}
          defaultKind={recurringModalState.defaultKind ?? "schedule"}
          defaultRawLine={recurringModalState.defaultRawLine ?? ""}
          editableWindows={editableWindows}
          onClose={closeRecurringModal}
          onCreate={createRecurringRule}
          onSave={updateRecurringRuleScoped}
          onDelete={deleteRecurringRuleScoped}
        />
      ) : null}

      <DeleteConfirmModal
        deleteConfirm={deleteConfirm}
        ui={ui}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={(id) => {
          removeWindow(id)
          setDeleteConfirm(null)
        }}
      />

      {!session && loginModalOpen && (
        <div className="login-modal-overlay" onClick={closeLoginModal}>
          <div
            className="login-modal-panel"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 18 }}>Planner</div>
              <button
                type="button"
                className="no-hover-outline login-modal-panel__close"
                onClick={closeLoginModal}
                aria-label="로그인 창 닫기"
              >
                ×
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleAuthSubmit()
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault()
                  closeLoginModal()
                }
              }}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <input
                value={authEmail}
                onChange={(e) => {
                  const next = e.target.value
                  setAuthEmail(next)
                  if (rememberCredentials && authMode === "signIn") persistCredentials(next)
                }}
                placeholder="아이디 또는 이메일"
                style={authInputStyle}
                className="login-modal-input"
                autoComplete="username"
              />
              <input
                type="password"
                value={authPassword}
                onChange={(e) => {
                  setAuthPassword(e.target.value)
                }}
                placeholder={authMode === "signIn" ? "비밀번호" : `비밀번호 (${AUTH_MIN_PASSWORD_LENGTH}자 이상)`}
                style={authInputStyle}
                className="login-modal-input"
                autoComplete={authMode === "signIn" ? "current-password" : "new-password"}
              />
              {authMode === "signUp" ? (
                <input
                  type="password"
                  value={authPasswordConfirm}
                  onChange={(e) => setAuthPasswordConfirm(e.target.value)}
                  placeholder="비밀번호 확인"
                  style={authInputStyle}
                  className="login-modal-input"
                  autoComplete="new-password"
                />
              ) : null}
              {authMode === "signUp" ? (
                <div
                  style={{
                    border: `1px solid ${ui.border}`,
                    background: ui.surface2,
                    borderRadius: 14,
                    padding: "12px 12px 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: ui.text }}>가입 전 확인</div>
                      <div style={{ marginTop: 4, fontSize: 12, color: ui.text2, lineHeight: 1.45 }}>
                        로그인과 일정 동기화를 위해 아이디/이메일과 비밀번호를 사용합니다.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSignupDetailsOpen((prev) => !prev)}
                      style={{
                        height: 30,
                        padding: "0 10px",
                        borderRadius: 10,
                        border: `1px solid ${ui.border}`,
                        background: ui.surface,
                        color: ui.text,
                        fontWeight: 800,
                        cursor: "pointer"
                      }}
                    >
                      {signupDetailsOpen ? "닫기" : "자세히"}
                    </button>
                  </div>
                  {signupDetailsOpen ? (
                    <div
                      style={{
                        fontSize: 12,
                        color: ui.text2,
                        lineHeight: 1.6,
                        padding: "10px 12px",
                        borderRadius: 12,
                        background: ui.surface
                      }}
                    >
                      수집 항목: 아이디 또는 이메일, 비밀번호
                      <br />
                      이용 목적: 로그인, 계정 식별, 일정/메모 동기화
                      <br />
                      보관 기간: 회원 탈퇴 시까지
                      <br />
                      거부 시 영향: 회원가입 및 동기화 기능을 사용할 수 없습니다.
                    </div>
                  ) : null}
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      color: ui.text,
                      cursor: "pointer"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={signupTermsAgreed}
                      onChange={(e) => setSignupTermsAgreed(e.target.checked)}
                      style={{ width: 14, height: 14 }}
                    />
                    <span>[필수] 이용약관 동의</span>
                  </label>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      color: ui.text,
                      cursor: "pointer"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={signupPrivacyAgreed}
                      onChange={(e) => setSignupPrivacyAgreed(e.target.checked)}
                      style={{ width: 14, height: 14 }}
                    />
                    <span>[필수] 개인정보 수집·이용 동의</span>
                  </label>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      color: ui.text2,
                      cursor: "pointer"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={signupUpdatesAgreed}
                      onChange={(e) => setSignupUpdatesAgreed(e.target.checked)}
                      style={{ width: 14, height: 14 }}
                    />
                    <span>[선택] 업데이트/알림 안내 수신</span>
                  </label>
                </div>
              ) : null}
              {authMode === "signIn" && (
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    color: ui.text2,
                    cursor: "pointer"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={rememberCredentials}
                    onChange={(e) => {
                      const next = e.target.checked
                      setRememberCredentials(next)
                      if (next) persistCredentials(authEmail)
                      else clearPersistedCredentials()
                    }}
                    style={{ width: 14, height: 14 }}
                  />
                  <span>아이디 기억</span>
                </label>
              )}
              <div
                className="login-mode-tabs"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: 1
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("signUp")
                    setSignupDetailsOpen(true)
                  }}
                  className="login-mode-tab"
                  style={{
                    border: "none",
                    background: "transparent",
                    color: authMode === "signUp" ? ui.text : ui.text2,
                    opacity: authMode === "signUp" ? 1 : 0.45,
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  가입
                </button>
                <div style={{ width: 1, height: 18, background: ui.border2, opacity: 0.7 }} />
                <button
                  type="button"
                  onClick={() => setAuthMode("signIn")}
                  className="login-mode-tab"
                  style={{
                    border: "none",
                    background: "transparent",
                    color: authMode === "signIn" ? ui.text : ui.text2,
                    opacity: authMode === "signIn" ? 1 : 0.45,
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  로그인
                </button>
              </div>
              {authMode === "signUp" ? (
                <div style={{ color: ui.text2, fontSize: 12, lineHeight: 1.45 }}>
                  비밀번호는 6자 이상으로 맞춰주세요. 로그인 유지 기능은 비밀번호 저장이 아니라 세션 유지로 동작합니다.
                </div>
              ) : null}
              <button
                type="submit"
                disabled={
                  authLoading ||
                  !String(authEmail ?? "").trim() ||
                  !authPassword ||
                  (authMode === "signUp" && !authPasswordConfirm)
                }
                className="login-modal-submit"
                style={{
                  height: 44,
                  borderRadius: 12,
                  border: "none",
                  background: ui.accent,
                  color: "#0b0f16",
                  fontWeight: 800,
                  cursor: "pointer"
                }}
              >
                {authLoading ? "..." : authMode === "signIn" ? "로그인" : "가입"}
              </button>
              {authMessage ? (
                <div style={{ color: ui.text2, fontSize: 13 }}>{authMessage}</div>
              ) : null}
            </form>
          </div>
        </div>
      )}

      <style>{`
        * { box-sizing: border-box; }
        textarea:focus, input:focus, select:focus {
          border-color: ${ui.accent};
          box-shadow: 0 0 0 3px ${theme === "dark" ? "rgba(96,165,250,0.18)" : "rgba(37, 99, 235, 0.15)"};
        }
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type=number] {
          -moz-appearance: textfield;
        }
        button {
          transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease, background 120ms ease,
            border-color 120ms ease, color 120ms ease;
        }
        button:hover:not(:disabled):not(.no-hover-outline) {
          transform: translateY(-1px);
          filter: brightness(0.98);
          outline: 2px solid ${ui.accent};
          outline-offset: -1px;
        }
        .no-hover-outline:hover:not(:disabled) {
          outline: none;
        }
        .memo-toggle-button {
          border-radius: 0;
        }
        .memo-toggle-button.is-left {
          border-radius: 6px 0 0 6px;
        }
        .memo-toggle-button.is-right {
          border-radius: 0 6px 6px 0;
        }
        .memo-toggle-button.is-left:hover:not(:disabled) {
          box-shadow: inset 0 0 0 2px ${ui.accent};
          background: ${ui.surface2};
        }
        .memo-toggle-button.is-right:hover:not(:disabled) {
          box-shadow: inset 0 0 0 2px ${ui.accent};
          background: ${ui.surface2};
        }
        .ym-spin-button {
          transition: color 120ms ease, opacity 120ms ease;
        }
        .ym-spin-button:hover:not(:disabled) {
          color: ${ui.text} !important;
          opacity: 1 !important;
          background: transparent;
        }
        .calendar-ym-control {
          transition: box-shadow 120ms ease, border-color 120ms ease;
        }
        .calendar-ym-control:hover {
          box-shadow: 0 0 0 1px ${ui.accent}, 0 0 0 3px ${ui.accentSoft};
        }
        .month-nav-center {
          transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
        }
        .month-nav-center:hover {
          border-color: ${ui.border2} !important;
          box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04), 0 0 0 2px ${theme === "dark" ? "rgba(148, 163, 184, 0.11)" : "rgba(148, 163, 184, 0.13)"} !important;
        }
        .month-nav-center:focus-within {
          border-color: ${ui.accent} !important;
          box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04), 0 0 0 2px ${ui.accentSoft} !important;
        }
        .month-nav-button:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: ${ui.border2} !important;
          background: ${theme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(15, 23, 42, 0.04)"} !important;
          color: ${ui.accent} !important;
          box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04), 0 0 0 2px ${ui.accentSoft} !important;
        }
        .month-nav-button:active:not(:disabled) {
          transform: translateY(0);
        }
        .month-nav-year-unit-text,
        .month-nav-year-arrows {
          transition: opacity 120ms ease, color 120ms ease;
        }
        .month-nav-year-segment:hover .month-nav-year-unit-text,
        .month-nav-year-segment:focus-within .month-nav-year-unit-text {
          opacity: 0;
        }
        .month-nav-year-segment:hover .month-nav-year-arrows,
        .month-nav-year-segment:focus-within .month-nav-year-arrows {
          opacity: 1 !important;
          pointer-events: auto !important;
        }
        .month-nav-year-arrow:hover {
          color: ${ui.accent} !important;
        }
        .month-nav-month-unit-text,
        .month-nav-month-arrow {
          transition: opacity 120ms ease, color 120ms ease;
        }
        .month-nav-month-segment:hover .month-nav-month-unit-text,
        .month-nav-month-segment:focus-within .month-nav-month-unit-text {
          opacity: 0;
        }
        .month-nav-month-segment:hover .month-nav-month-arrow,
        .month-nav-month-segment:focus-within .month-nav-month-arrow {
          opacity: 1 !important;
          color: ${ui.text2} !important;
        }
        .month-nav-field:focus,
        .month-nav-select:focus {
          border-color: transparent !important;
          box-shadow: none !important;
        }
        .month-nav-field:hover,
        .month-nav-field:focus {
          color: ${ui.accent} !important;
        }
        .month-nav-select,
        .month-nav-select:hover,
        .month-nav-select:focus {
          color: ${ui.text} !important;
        }
        .month-nav-select option {
          color: ${theme === "dark" ? "#e5e7eb" : "#0f172a"};
          background: ${theme === "dark" ? "#111827" : "#ffffff"};
        }
        .month-nav-field::selection {
          background: ${ui.accentSoft};
        }
        .memo-input {
          color: transparent;
          caret-color: ${ui.text};
        }
        .memo-input:focus {
          border-color: transparent !important;
          box-shadow: none !important;
        }
        .memo-input::placeholder {
          color: ${ui.text2};
        }
        .memo-overlay__line {
          white-space: pre-wrap;
          font-weight: 400;
        }
        .memo-overlay__line--header {
          font-weight: 520;
          text-shadow: 0 0 0 currentColor, 0.2px 0 0 currentColor, -0.2px 0 0 currentColor;
        }
        .memo-overlay__fn {
          font-weight: 600;
        }
        .tab-pill {
          transition: transform 120ms ease, box-shadow 120ms ease;
        }
        .tab-pill:not(.is-active):hover {
          transform: translateY(-0.5px);
          box-shadow: inset 0 0 0 2px ${ui.accentSoft};
        }
        .tab-pill.is-active:hover {
          transform: none;
          box-shadow: inset 0 0 0 2px ${ui.accentSoft};
        }
        .arrow-button {
          --arrow-opacity: 0.35;
          --arrow-border: transparent;
          --arrow-bg: transparent;
          --arrow-color: ${ui.text2};
          --arrow-shadow: none;
        }
        .arrow-button.is-active {
          --arrow-opacity: 0.95;
          --arrow-border: ${ui.accent};
          --arrow-bg: ${ui.surface2};
          --arrow-color: ${ui.text};
          --arrow-shadow: 0 0 0 2px ${ui.accentSoft};
        }
        .arrow-button:hover {
          --arrow-opacity: 0.85;
          --arrow-border: ${ui.border2};
          --arrow-bg: ${ui.surface2};
          --arrow-color: ${ui.text};
        }
        .arrow-button.is-active:hover {
          --arrow-opacity: 1;
          --arrow-border: ${ui.accent};
          --arrow-bg: ${ui.surface2};
          --arrow-color: ${ui.text};
          --arrow-shadow: 0 0 0 2px ${ui.accentSoft};
        }
        .arrow-button:focus-visible {
          --arrow-opacity: 0.9;
          --arrow-border: ${ui.accent};
          --arrow-bg: ${ui.surface2};
          --arrow-color: ${ui.text};
        }
        .arrow-button:disabled {
          --arrow-opacity: 0.2;
          --arrow-border: transparent;
          --arrow-bg: transparent;
          --arrow-color: ${ui.text2};
          --arrow-shadow: none;
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
          outline: none;
          background: ${theme === "dark" ? "rgba(96, 165, 250, 0.08)" : "linear-gradient(180deg, rgba(239, 246, 255, 0.78), rgba(255, 255, 255, 0.86))"} !important;
          box-shadow: inset 0 0 0 1px ${theme === "dark" ? "rgba(147, 197, 253, 0.30)" : "rgba(59, 130, 246, 0.18)"}, 0 8px 20px ${theme === "dark" ? "rgba(0, 0, 0, 0.14)" : "rgba(15, 23, 42, 0.05)"} !important;
        }
        .calendar-task-item {
          transition: background 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
        }
        .calendar-task-item:hover:not(:disabled) {
          background: ${theme === "dark" ? "rgba(255, 255, 255, 0.06)" : "rgba(59, 130, 246, 0.07)"} !important;
          box-shadow: inset 2px 0 0 ${theme === "dark" ? "rgba(147, 197, 253, 0.65)" : "rgba(37, 99, 235, 0.38)"};
          transform: none;
          filter: none;
        }
        .calendar-add-chip:hover:not(:disabled) {
          background: ${ui.surface2} !important;
          border-color: ${ui.border2} !important;
          box-shadow: 0 0 0 2px ${ui.accentSoft};
          transform: none;
          filter: none;
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
        .login-modal-overlay {
          position: fixed;
          inset: 0;
          background: radial-gradient(circle at top, rgba(37, 99, 235, 0.18), rgba(15, 23, 42, 0.65));
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          z-index: 130;
          backdrop-filter: blur(6px);
        }
        .login-modal-panel {
          width: min(420px, 100%);
          border-radius: 16px;
          background: ${ui.surface};
          border: 1px solid ${ui.border};
          box-shadow: ${ui.shadow};
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          position: relative;
          overflow: hidden;
        }
        .login-modal-panel::before {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, ${ui.surface2}, transparent 60%);
          opacity: 0.6;
          pointer-events: none;
        }
        .login-modal-panel > * {
          position: relative;
          z-index: 1;
        }
        .login-modal-panel__close {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          border: none;
          background: ${ui.surface2};
          color: ${ui.text2};
          font-size: 18px;
          line-height: 1;
        }
        .login-modal-panel__close:hover:not(:disabled) {
          background: ${ui.surface};
          color: ${ui.text};
        }
        .login-modal-input {
          transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
        }
        .login-modal-input:focus {
          background: ${ui.surface};
        }
        .login-mode-tabs {
          background: transparent;
          border: none;
          border-radius: 0;
          padding: 0;
        }
        .login-mode-tab {
          padding: 4px 10px;
          border-radius: 999px;
        }
        .login-modal-submit {
          box-shadow: 0 10px 24px rgba(37, 99, 235, 0.25);
        }
        .login-modal-submit:disabled {
          opacity: 0.7;
          cursor: default;
          box-shadow: none;
        }
        * { scrollbar-width: none; -ms-overflow-style: none; }
        ::-webkit-scrollbar { width: 0px; height: 0px; }
        button:active { transform: translateY(1px); }
      `}</style>
    </div>
  )
}

export default App

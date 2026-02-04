import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import CalendarPanel from "./components/CalendarPanel"
import DayListModal from "./components/DayListModal"
import DeleteConfirmModal from "./components/DeleteConfirmModal"
import FilterPanel from "./components/FilterPanel"
import MemoEditor from "./components/MemoEditor"
import MemoReadView from "./components/MemoReadView"
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
  parseTimePrefix,
  timeToMinutes,
  parseDashboardSemicolonLine,
  normalizeGroupLineNewlines,
  normalizeWindowTitle,
  makeUniqueWindowTitle,
  replaceGroupTitleInText,
  parseDashboardBlockContent,
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
        color: typeof w.color === "string" ? w.color : "#2563eb",
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
    localStorage.setItem(storageKey ?? WINDOWS_KEY, JSON.stringify(ws))
  } catch (err) { void err }
  }

  const WINDOW_COLORS = [
    "#c40000", // 153 red
    "#ff7a00", // 1201 orange
    "#ff4a00", // 255 fluorescent orange
    "#ffe94a", // 355 yellow
    "#ffd21a", // 356 deep yellow
    "#dff08a", // 452 pale yellow-green
    "#86e000", // 455 light green
    "#0b7a0b", // 457 green
    "#0a5a1f", // 460 deep green
    "#7fe8d2", // 463 jade
    "#98ddff", // 1501 sky
    "#cfe0ff", // 551 light sky
    "#14a7d8", // 553 deep sky
    "#1f33d6", // 558 blue
    "#1b0f7d", // 562 navy
    "#6b2e8f", // 654 purple
    "#e1c2ff", // 657 lavender
    "#ffd1e7" // 656 light pink
  ]

  // ===== Supabase (웹-앱 데이터 연동) =====
  const [session, setSession] = useState(null)
  const [authMode, setAuthMode] = useState("signIn") // "signIn" | "signUp"
  const [authEmail, setAuthEmail] = useState("")
  const [authPassword, setAuthPassword] = useState("")
  const [authLoading, setAuthLoading] = useState(false)
  const [authMessage, setAuthMessage] = useState("")
  const [loginModalOpen, setLoginModalOpen] = useState(false)
  const [rememberCredentials, setRememberCredentials] = useState(false)

  function persistCredentials(email, password) {
    if (typeof window === "undefined") return
    try {
      localStorage.setItem(REMEMBER_CREDENTIALS_KEY, JSON.stringify({ email, password }))
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
    if (!session) return
    setLoginModalOpen(false)
    setAuthMessage("")
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = localStorage.getItem(REMEMBER_CREDENTIALS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      const email = typeof parsed?.email === "string" ? parsed.email : ""
      const password = typeof parsed?.password === "string" ? parsed.password : ""
      if (email) setAuthEmail(email)
      if (password) setAuthPassword(password)
      if (email || password) setRememberCredentials(true)
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
    const used = new Set(ws.map((w) => w.color))
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

  function buildTextFromPlans(plans, year) {
    const yearPrefix = `${year}-`
    const byDate = new Map()
    for (const row of plans ?? []) {
      if (row?.deleted_at) continue
      const dateKey = String(row?.date ?? "")
      if (!dateKey.startsWith(yearPrefix)) continue
      const content = String(row?.content ?? "").trim()
      if (!content) continue
      const category = normalizeCategoryId(String(row?.category_id ?? "").trim())
      const isGeneral = isGeneralCategoryId(category)
      const time = String(row?.time ?? "").trim()
      const bucket = byDate.get(dateKey) ?? []
      bucket.push({ time, category: isGeneral ? "" : category, content, isGeneral })
      byDate.set(dateKey, bucket)
    }

    const sortedDates = [...byDate.keys()].sort((a, b) => keyToTime(a) - keyToTime(b))
    const blocks = sortedDates.map((dateKey) => {
      const { m, d } = keyToYMD(dateKey)
      const header = buildHeaderLine(year, m, d)
      const items = byDate.get(dateKey) ?? []
      items.sort((a, b) => {
        const ta = timeToMinutes(a.time)
        const tb = timeToMinutes(b.time)
        if (ta !== tb) return ta - tb
        const ca = a.category.localeCompare(b.category, "ko")
        if (ca !== 0) return ca
        const aNum = /^\d+$/.test(a.content) ? Number(a.content) : null
        const bNum = /^\d+$/.test(b.content) ? Number(b.content) : null
        if (aNum != null && bNum != null) return aNum - bNum
        return a.content.localeCompare(b.content, "ko")
      })
      const lines = items.map((item) => {
        if (item.isGeneral) return item.time ? `${item.time};${item.content}` : item.content
        return item.time ? `${item.time};@${item.category};${item.content}` : `@${item.category};${item.content}`
      })
      return lines.length > 0 ? `${header}\n${lines.join("\n")}` : header
    })
    return blocks.join("\n\n").trimEnd()
  }

  function extractPlansFromText(sourceText, year) {
    const out = []
    const parsed = parseBlocksAndItems(sourceText ?? "", year)
    for (const block of parsed.blocks) {
      const body = (sourceText ?? "").slice(block.bodyStartPos, block.blockEndPos)
      const parsedBlock = parseDashboardBlockContent(body)
      for (const line of parsedBlock.general ?? []) {
        const text = String(line ?? "").trim()
        if (!text) continue
        out.push({
          date: block.dateKey,
          time: null,
          category_id: GENERAL_CATEGORY_ID,
          content: text
        })
      }
      for (const item of parsedBlock.timed ?? []) {
        const text = String(item.text ?? "").trim()
        if (!text) continue
        out.push({
          date: block.dateKey,
          time: item.time ? String(item.time).trim() : null,
          category_id: GENERAL_CATEGORY_ID,
          content: text
        })
      }
      for (const group of parsedBlock.groups ?? []) {
        const title = normalizeCategoryId(String(group.title ?? "").trim())
        if (!title) continue
        for (const item of group.items ?? []) {
          const text = String(item.text ?? "").trim()
          if (!text) continue
          out.push({
            date: block.dateKey,
            time: item.time ? String(item.time).trim() : null,
            category_id: title,
            content: text
          })
        }
      }
    }
    return out
  }

  function buildPlanKey(row) {
    const date = String(row?.date ?? "").trim()
    const time = String(row?.time ?? "").trim()
    let category = normalizeCategoryId(String(row?.category_id ?? row?.categoryId ?? "").trim())
    if (!category) category = GENERAL_CATEGORY_ID
    const content = String(row?.content ?? row?.text ?? "").trim()
    return `${date}|${time}|${category}|${content}`
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      String(value ?? "")
    )
  }

  async function loadRemotePlans(userId) {
    if (!supabase) return
    const { data, error } = await supabase
      .from("plans")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
    if (error) {
      console.error("load plans", error)
      return
    }
    const updates = []
    const rows = (data ?? []).map((row) => {
      let normalized = normalizeCategoryId(row?.category_id)
      if (!normalized) normalized = GENERAL_CATEGORY_ID
      if (normalized && normalized !== row?.category_id) {
        updates.push({ id: row.id, category_id: normalized })
      }
      return { ...row, category_id: normalized }
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
      color: typeof row.color === "string" ? row.color : "#2563eb",
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
        color: typeof w.color === "string" ? w.color : "#2563eb",
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
      toInsert.push({
        ...row,
        user_id: userId,
        client_id: clientIdRef.current,
        updated_at: new Date().toISOString()
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
      const { data, error: insertError } = await supabase.from("plans").insert(toInsert).select()
      if (insertError) {
        console.error("insert plans", insertError)
        return
      }
      insertedRows = (data ?? []).map((row) => ({
        ...row,
        category_id: normalizeCategoryId(row?.category_id)
      }))
    }

    lastCloudSyncRef.current = { year, text: sourceText ?? "" }
    setRemotePlans((prev) => {
      const removedIds = new Set(toDelete.map((row) => row.id))
      const base = (prev ?? []).filter((row) => !removedIds.has(row?.id))
      return insertedRows.length > 0 ? [...base, ...insertedRows] : base
    })
  }

  function extractPlansFromDayBody(bodyText, dateKey, scopedWindowTitle = null) {
    const out = []
    const parsedBlock = parseDashboardBlockContent(bodyText ?? "")
    const scopedTitle = scopedWindowTitle ? normalizeCategoryId(scopedWindowTitle) : null

    if (scopedTitle) {
      for (const line of parsedBlock.general ?? []) {
        const text = String(line ?? "").trim()
        if (!text) continue
        out.push({ date: dateKey, time: null, category_id: scopedTitle, content: text })
      }
      for (const item of parsedBlock.timed ?? []) {
        const text = String(item?.text ?? "").trim()
        if (!text) continue
        out.push({
          date: dateKey,
          time: item?.time ? String(item.time).trim() : null,
          category_id: scopedTitle,
          content: text
        })
      }
      for (const group of parsedBlock.groups ?? []) {
        const groupTitle = normalizeCategoryId(String(group?.title ?? "").trim())
        if (!groupTitle || groupTitle !== scopedTitle) continue
        for (const item of group.items ?? []) {
          const text = String(item?.text ?? "").trim()
          if (!text) continue
          out.push({
            date: dateKey,
            time: item?.time ? String(item.time).trim() : null,
            category_id: scopedTitle,
            content: text
          })
        }
      }
      return out
    }

    for (const line of parsedBlock.general ?? []) {
      const text = String(line ?? "").trim()
      if (!text) continue
      out.push({ date: dateKey, time: null, category_id: GENERAL_CATEGORY_ID, content: text })
    }
    for (const item of parsedBlock.timed ?? []) {
      const text = String(item?.text ?? "").trim()
      if (!text) continue
      out.push({
        date: dateKey,
        time: item?.time ? String(item.time).trim() : null,
        category_id: GENERAL_CATEGORY_ID,
        content: text
      })
    }
    for (const group of parsedBlock.groups ?? []) {
      const title = normalizeCategoryId(String(group?.title ?? "").trim())
      if (!title) continue
      for (const item of group.items ?? []) {
        const text = String(item?.text ?? "").trim()
        if (!text) continue
        out.push({
          date: dateKey,
          time: item?.time ? String(item.time).trim() : null,
          category_id: title,
          content: text
        })
      }
    }
    return out
  }

  async function syncDayBodyToSupabase(dateKey, bodyText, windowId) {
    if (!canUseWebRowPlanEdit) return
    if (!supabase || !session?.user?.id) return
    const userId = session.user.id
    const scopedWindow =
      windowId && windowId !== "all" ? windows.find((w) => String(w?.id) === String(windowId)) : null
    if (windowId && windowId !== "all" && !scopedWindow) return
    const scopedTitle = scopedWindow ? normalizeCategoryId(scopedWindow.title) : null

    const desired = extractPlansFromDayBody(bodyText ?? "", dateKey, scopedTitle)
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

    const currentMap = new Map()
    const duplicateRows = []
    for (const row of currentRows ?? []) {
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
      toInsert.push({
        ...row,
        user_id: userId,
        client_id: clientIdRef.current,
        updated_at: new Date().toISOString()
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
      const { error: insertError } = await supabase.from("plans").insert(toInsert)
      if (insertError) {
        console.error("insert day plans", insertError)
        return
      }
    }

    const categoryTitles = new Set(
      desired
        .map((row) => normalizeCategoryId(String(row?.category_id ?? "").trim()))
        .filter((title) => title && !isGeneralCategoryId(title))
    )
    ensureWindowsForCategories(categoryTitles)
    await loadRemotePlans(userId)
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
    const nextId = session?.user?.id ?? null
    if (nextId && nextId !== lastSessionIdRef.current) {
      forceRemoteApplyRef.current = true
    }
    lastSessionIdRef.current = nextId
  }, [session?.user?.id])

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

  // ? 설정 패널(톱니) 토글
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const settingsPanelRef = useRef(null)

  // 달력 셀 높이 자동 계산용
  const [calendarCellH, setCalendarCellH] = useState(110)

  // ===== 테마/레이아웃 프리셋 =====
  const [theme, setTheme] = useState("light") // "light" | "dark"
  const [layoutPreset, setLayoutPreset] = useState("memo-left") // "memo-left" | "calendar-left"
  const isSwapped = layoutPreset === "calendar-left"

  // ===== ? 메모 패널 내부(좌/우 메모) 스플릿 =====
  const MEMO_INNER_KEY = "planner-memo-inner-split"
  const MIN_MEMO_LEFT_PX = 240
  const MIN_MEMO_RIGHT_PX = 240
  const DEFAULT_MEMO_INNER_SPLIT = 0.62
  const MEMO_DIVIDER_W = 10
  const MEMO_INNER_GAP = 10

  const [memoInnerSplit, setMemoInnerSplit] = useState(DEFAULT_MEMO_INNER_SPLIT)
  const [memoInnerCollapsed, setMemoInnerCollapsed] = useState("none") // "none" | "left" | "right"
  const [memoCollapsedByWindow, setMemoCollapsedByWindow] = useState(() => ({}))
  const [rightMemoText, setRightMemoText] = useState("") // ? 오른쪽 메모(기능 없음)
  const [tabEditText, setTabEditText] = useState("")
  const [dashboardSourceTick, setDashboardSourceTick] = useState(0)
  const [isEditingLeftMemo, setIsEditingLeftMemo] = useState(false)
  const [dashboardCollapsedByWindow, setDashboardCollapsedByWindow] = useState({})
  const [mentionGhostText, setMentionGhostText] = useState("")
  const [mentionGhostPos, setMentionGhostPos] = useState({ top: 0, left: 0 })
  const [tabMentionMenu, setTabMentionMenu] = useState({ visible: false, top: 0, left: 0 })
  const [tabMentionHoverId, setTabMentionHoverId] = useState(null)
  const tabMentionRef = useRef(null)
  const tabMentionMouseDownRef = useRef(false)
  // ? 창 목록/활성 탭
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
    if (!forceApply && isEditingLeftMemo) return
    const last = lastCloudSyncRef.current
    if (ENABLE_WEB_TEXT_PLAN_SYNC && !forceApply && last.year === baseYear && last.text !== textRef.current) return
    const nextText = buildTextFromPlans(remotePlans, baseYear)
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
    const max = Math.max(0, el.scrollWidth - el.clientWidth)
    const canScroll = max > 8
    const left = canScroll && el.scrollLeft > 2
    const right = canScroll && el.scrollLeft < max - 2
    setTabScrollState((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])

  function scrollTabs(dir) {
    const el = tabsScrollRef.current
    if (!el) return
    const amount = Math.max(80, Math.floor(el.clientWidth * 0.6))
    el.scrollBy({ left: dir * amount, behavior: "smooth" })
  }

  useEffect(() => {
    const el = tabsScrollRef.current
    if (!el) return
    const onScroll = () => updateTabScrollState()
    updateTabScrollState()
    el.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      el.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
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
    const next = memoCollapsedByWindow[activeWindowId] ?? "none"
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
        color: "#22c55e"
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
        if (typeof parsed.memoFontPx === "number") setMemoFontPx(clamp(parsed.memoFontPx, FONT_MIN, FONT_MAX))
        if (typeof parsed.tabFontPx === "number") setTabFontPx(clamp(parsed.tabFontPx, FONT_MIN, FONT_MAX))
      }
    } catch (err) { void err }

    try {
      const raw2 = localStorage.getItem(PREF_KEY)
      if (raw2) {
        const p = JSON.parse(raw2)
        if (p && (p.theme === "light" || p.theme === "dark")) setTheme(p.theme)
        if (p && (p.layoutPreset === "memo-left" || p.layoutPreset === "calendar-left")) setLayoutPreset(p.layoutPreset)
      }
    } catch (err) { void err }
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
    } catch (err) { void err }
  }, [splitRatio, memoFontPx, tabFontPx])

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
  const rightSaveSuppressResetRef = useRef(null)
  const editableWindows = useMemo(() => windows.filter((w) => w.id !== "all"), [windows])
  const windowTitlesOrder = useMemo(() => windows.filter((w) => w.id !== "all").map((w) => w.title), [windows])
  const windowTitleRank = useMemo(() => {
    return new Map(windowTitlesOrder.map((title, index) => [title, index]))
  }, [windowTitlesOrder])

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

  function sanitizeRightMemoBody(rawText, windowsForTitles) {
    const titleSet = new Set(
      (windowsForTitles ?? [])
        .map((w) => String(w?.title ?? "").trim())
        .filter(Boolean)
    )
    const lines = String(rawText ?? "").split("\n")
    const out = []
    for (const line of lines) {
      const match = line.match(/^\s*\[(.+)\]\s*$/)
      if (match && titleSet.has(String(match[1] ?? "").trim())) continue
      out.push(line)
    }
    return out.join("\n").trimEnd()
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
      localStorage.setItem(key, value)
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
      localStorage.setItem(key, value ?? "")
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
      localStorage.setItem(key, value)
    } catch (err) { void err }
  }

  function buildCombinedRightTextForYear(year) {
    const windowTexts = {}
    for (const w of editableWindows) {
      windowTexts[w.id] = sanitizeRightMemoBody(getRightWindowTextSync(year, w.id), editableWindows)
    }
    const commonText = sanitizeRightMemoBody(getRightWindowTextSync(year, "all"), editableWindows)
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

  async function handleAuthSubmit() {
    if (!supabase) return
    if (!authEmail || !authPassword) {
      setAuthMessage("이메일과 비밀번호를 모두 입력하세요.")
      return
    }
    setAuthLoading(true)
    setAuthMessage("")
    let error = null
    if (authMode === "signIn") {
      const result = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
      error = result.error
    } else {
      const result = await supabase.auth.signUp({ email: authEmail, password: authPassword })
      error = result.error
    }
    if (error) setAuthMessage(error.message)
    else {
      if (authMode === "signIn") {
        setAuthMessage("로그인 완료.")
      } else {
        setAuthMessage("가입 완료. 로그인해 주세요.")
        setAuthMode("signIn")
      }
    }
    setAuthLoading(false)
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
    await supabase.auth.signOut()
    setAuthMessage("")
  }

  function updateEditorText(nextText) {
    setText(nextText)
    textRef.current = nextText
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
      const normalizedBody = normalizeGroupLineNewlines(body)
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
            const parsed = parseTimePrefix(item)
            items.push({ text: parsed ? parsed.text : item, time: parsed ? parsed.time : "", order })
            order++
          }
          continue
        }

        const semicolon = parseDashboardSemicolonLine(trimmed)
        if (semicolon) {
          if (semicolon.group && title && semicolon.group !== title) continue
          items.push({ text: semicolon.text, time: semicolon.time, order })
          order++
          continue
        }
        const emptySemicolon = parseDashboardSemicolonLine(trimmed, { allowEmptyText: true })
        if (emptySemicolon && !emptySemicolon.text) continue

        const timeLine = parseTimePrefix(trimmed)
        if (timeLine) {
          items.push({ text: timeLine.text, time: timeLine.time, order })
          order++
          continue
        }

        items.push({ text: trimmed, time: "", order })
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
    if (!nextText.trim()) {
      await supabase
        .from("right_memos")
        .delete()
        .eq("user_id", userId)
        .eq("year", year)
        .eq("window_id", windowId)
      return
    }
    await supabase.from("right_memos").upsert(
      {
        user_id: userId,
        year,
        window_id: windowId,
        content: nextText
      },
      { onConflict: "user_id,year,window_id" }
    )
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
            const text = sanitizeRightMemoBody(String(windowTexts?.[w.id] ?? ""), editableWindows)
            normalizedWindowTexts[w.id] = text
            setRightWindowTextSync(baseYear, w.id, text)
          }
          const commonText = sanitizeRightMemoBody(getRightWindowTextSync(baseYear, "all"), editableWindows)
          setRightWindowTextSync(baseYear, "all", commonText)
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
        const normalized = sanitizeRightMemoBody(saved ?? "", editableWindows)
        setRightMemoText(normalized)
        if (normalized && supabase && session?.user?.id) {
          saveRightMemoToSupabase(session.user.id, baseYear, activeWindowId, normalized)
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
          const normalized = sanitizeRightMemoBody(remoteText, editableWindows)
          setRightMemoText(normalized)
          try {
            localStorage.setItem(rightMemoKey, normalized)
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
    try {
      localStorage.setItem(rightMemoKey, rightMemoText)
    } catch (err) { void err }

    const userId = session?.user?.id
    if (!supabase || !userId) return

    if (rightMemoSyncTimerRef.current) clearTimeout(rightMemoSyncTimerRef.current)

    const savedYear = baseYear
    const savedWindowId = activeWindowId
    const savedText = rightMemoText
    const savedWindows = editableWindows
    const savedFilters = integratedFilters

    const flush = () => {
      if (savedWindowId === "all") {
        const { commonLines, windowLinesById } = splitCombinedRightText(savedText, savedWindows)
        const normalizedCommon = sanitizeRightMemoBody(commonLines.join("\n").trimEnd(), savedWindows)
        setRightWindowTextSync(savedYear, "all", normalizedCommon)
        const visibleWindows = (savedWindows ?? []).filter((w) => !savedFilters || savedFilters[w.id] !== false)
        for (const w of visibleWindows) {
          const next = sanitizeRightMemoBody((windowLinesById.get(w.id) ?? []).join("\n").trimEnd(), savedWindows)
          setRightWindowTextSync(savedYear, w.id, next)
        }
        Promise.all(
          visibleWindows.map((w) => {
            const next = sanitizeRightMemoBody((windowLinesById.get(w.id) ?? []).join("\n").trimEnd(), savedWindows)
            return saveRightMemoToSupabase(userId, savedYear, w.id, next)
          })
        ).catch((err) => console.error("save all right memos", err))
        return
      }
      saveRightMemoToSupabase(userId, savedYear, savedWindowId, sanitizeRightMemoBody(savedText, savedWindows))
    }

    const t = setTimeout(flush, 800)
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
  const rightOverlayLines = useMemo(() => buildMemoOverlayLines(rightMemoText), [rightMemoText])

  useEffect(() => {
    syncOverlayScroll(textareaRef.current, leftOverlayInnerRef.current)
  }, [text, memoFontPx, memoInnerSplit])

  useEffect(() => {
    syncOverlayScroll(rightTextareaRef.current, rightOverlayInnerRef.current)
  }, [rightMemoText, memoFontPx, memoInnerSplit])

  useEffect(() => {
    updateMentionGhost()
  }, [activeWindowId, isEditingLeftMemo, tabEditText, windows])


  function getEditorTextSync(year) {
    return getLeftMemoTextSync(year)
  }

  // ===== 파싱 =====
  const parsed = useMemo(() => parseBlocksAndItems(text, baseYear), [text, baseYear])
  const blocks = parsed.blocks
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

  const dashboardByDate = useMemo(() => {
    const map = {}
    for (const block of dashboardBlocksSource) {
      const body = dashboardSourceText.slice(block.bodyStartPos, block.blockEndPos)
      const parsedBlock = parseDashboardBlockContent(body)
      const filteredGroups = allowedDashboardGroupTitles
        ? parsedBlock.groups.filter((group) => allowedDashboardGroupTitles.has(group.title))
        : parsedBlock.groups
      if (parsedBlock.general.length === 0 && filteredGroups.length === 0 && parsedBlock.timed.length === 0) continue
      map[block.dateKey] = { general: parsedBlock.general, groups: filteredGroups, timed: parsedBlock.timed }
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
        timed: parsedBlock.timed
      })
    }
    out.sort((a, b) => keyToTime(a.dateKey) - keyToTime(b.dateKey))
    return out
  }, [dashboardBlocksSource, dashboardByDate, windowTitleRank])

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
    out.sort((a, b) => keyToTime(a.dateKey) - keyToTime(b.dateKey))
    return out
  }, [activeWindowId, baseYear, tabEditText, windows])

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
    if (activeWindowId === "all") {
      const out = {}
      for (const block of dashboardBlocksSource) {
        const parsedBlock = dashboardByDate[block.dateKey]
        if (!parsedBlock) continue
        const bucket = []
        // general lines first (colorless)
        for (const line of parsedBlock.general) {
          if (!line) continue
          bucket.push({
            id: `${block.dateKey}-general-${bucket.length}`,
            time: "",
            text: line,
            color: "#999",
            sourceTitle: ""
          })
        }
        for (let idx = 0; idx < parsedBlock.timed.length; idx++) {
          const item = parsedBlock.timed[idx]
          const text = (item.text ?? "").trim()
          if (!text) continue
          bucket.push({
            id: `${block.dateKey}-timed-${idx}`,
            time: item.time || "",
            text,
            color: "#999",
            sourceTitle: ""
          })
        }
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
        for (const group of orderedGroups) {
          const window = windows.find((w) => w.title === group.title)
          const color = window?.color ?? "#aaa"
          for (let idx = 0; idx < group.items.length; idx++) {
            const item = group.items[idx]
            const text = (item.text ?? "").trim()
            if (!text) continue
            bucket.push({
              id: `${block.dateKey}-${group.title}-${idx}`,
              time: item.time || "",
              text,
              color,
              sourceTitle: group.title
            })
          }
        }
        if (bucket.length > 0) out[block.dateKey] = bucket
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
          return {
            id: `${key}-${targetWindow.id}-${idx}`,
            time: item.time || "",
            text,
            color: targetWindow.color,
            sourceTitle: targetWindow.title
          }
        })
        .filter(Boolean)
      out[key] = (out[key] ?? []).concat(bucket)
    }
    return out
  }, [activeWindowId, baseYear, dashboardBlocksSource, dashboardByDate, parsed.items, tabEditText, windowTitleRank, windows])

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
    if (isMainMemoReadOnly) {
      if (dateKey) {
        setActiveDateKey(dateKey)
        openDayList(dateKey, itemsByDate[dateKey] ?? [])
      }
      return
    }
    if (!dateKey) return
    beginEditSession(dateKey)
    setActiveDateKey(dateKey)
    setIsEditingLeftMemo(true)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) el.focus()
    })

    if (activeWindowId === "all") {
      const sourceText = textRef.current ?? text
      const parsedSource = parseBlocksAndItems(sourceText ?? "", baseYear)
      const block = parsedSource.blocks.find((b) => b.dateKey === dateKey)
      if (!block) return

      const ensured = ensureBodyLineForBlock(sourceText ?? "", block)
      if (ensured.newText !== (sourceText ?? "")) {
        pendingJumpRef.current = {
          headerPos: block.headerStartPos,
          caretPos: ensured.caretPos,
          topOffsetLines: 1
        }
        updateEditorText(ensured.newText)
      } else {
        scheduleJump(block.headerStartPos, ensured.caretPos, 1)
      }
      return
    }

    const targetWindow = windows.find((w) => w.id === activeWindowId)
    if (!targetWindow) return
    const sourceText = tabEditText ?? ""
    const ensured = ensureTabGroupLineAtDate(sourceText, dateKey, targetWindow.title, baseYear)
    const headerPos = ensured.headerPos ?? 0
    const caretPos = ensured.caretPos ?? 0
    if (ensured.newText !== sourceText) {
      pendingJumpRef.current = { headerPos, caretPos, topOffsetLines: 1 }
      setTabEditText(ensured.newText)
    } else {
      scheduleJump(headerPos, caretPos, 1)
    }
  }

  const READ_SCROLL_MARGIN_TOP = 16

  // ===== 선택된 날짜 =====
  const [selectedDateKey, setSelectedDateKey] = useState(null)
  const [lastEditedDateKey, setLastEditedDateKey] = useState(null)
  const [hoveredReadDateKey, setHoveredReadDateKey] = useState(null)
  const lastActiveDateKeyRef = useRef(null)
  const lastCaretDateKeyRef = useRef(null)
  const editSessionRef = useRef({ id: 0, entryKey: null, lastChangeKey: null })
  const calendarInteractingRef = useRef(false)
  const readDateCreateButtonRef = useRef(null)
  const readDateCreateInputRef = useRef(null)
  const [dayListModal, setDayListModal] = useState(null)
  const [dayListEditText, setDayListEditText] = useState("")
  const [dayListMode, setDayListMode] = useState("read")
  const dayListView = useMemo(() => {
    if (!dayListModal) return null
    return parseDashboardBlockContent(dayListEditText)
  }, [dayListModal, dayListEditText])
  const dayListReadItems = useMemo(() => {
    if (!dayListView) return null
    const isAll = activeWindowId === "all"
    if (isAll) {
      const filteredGroups = allowedDashboardGroupTitles
        ? dayListView.groups.filter((group) => allowedDashboardGroupTitles.has(group.title))
        : dayListView.groups
      const orderedGroups = filteredGroups
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
      const general = dayListView.general.filter((line) => String(line ?? "").trim())
      const noTimeGroupItems = []
      const timedItems = []
      for (const group of orderedGroups) {
        for (const item of group.items ?? []) {
          const text = (item.text ?? "").trim()
          if (!text) continue
          const entry = { time: item.time || "", text, title: group.title }
          if (entry.time) timedItems.push(entry)
          else noTimeGroupItems.push(entry)
        }
      }
      const timedNoGroup = (dayListView.timed ?? [])
        .map((item) => ({
          time: item.time || "",
          text: (item.text ?? "").trim(),
          title: ""
        }))
        .filter((item) => item.text)
      timedItems.push(...timedNoGroup)
      timedItems.sort((a, b) => {
        const ta = timeToMinutes(a.time)
        const tb = timeToMinutes(b.time)
        if (ta !== tb) return ta - tb
        return 0
      })
      return { isAll, general, noTimeGroupItems, timedItems }
    }
    const noTimeItems = dayListView.general.filter((line) => String(line ?? "").trim())
    const timedItems = (dayListView.timed ?? [])
      .map((item) => ({
        time: item.time || "",
        text: (item.text ?? "").trim()
      }))
      .filter((item) => item.text)
    timedItems.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time))
    return { isAll, noTimeItems, timedItems }
  }, [dayListView, activeWindowId, windowTitleRank, allowedDashboardGroupTitles])

  const setReadBlockRef = useCallback((dateKey) => {
    return (el) => {
      const map = readBlockRefs.current
      if (!map) return
      if (el) map.set(dateKey, el)
      else map.delete(dateKey)
    }
  }, [])

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
      return
    }
    const sourceText = activeWindowId === "all" ? textRef.current ?? text : tabEditText ?? ""
    const body = getDateBlockBodyText(sourceText, baseYear, dayListModal.key)
    setDayListEditText(body)
    setDayListMode("read")
  }, [dayListModal ? dayListModal.key : null, baseYear, activeWindowId])

  useEffect(() => {
    if (!isMainMemoReadOnly) return
    if (!isEditingLeftMemo) return
    setIsEditingLeftMemo(false)
  }, [isMainMemoReadOnly, isEditingLeftMemo])

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
      return
    }
    if (isScheduleReadOnly) return
    const isAll = activeWindowId === "all"
    const current = isAll ? textRef.current ?? text : tabEditText ?? ""
    const nextText = updateDateBlockBody(current, baseYear, dayListModal.key, nextBody)
    if (nextText === current) return
    if (isAll) {
      updateEditorText(nextText)
      return
    }
    setTabEditText(nextText)
    setWindowMemoTextSync(baseYear, activeWindowId, nextText)
    applyTabEditToAllFromText(nextText)
  }

  function openReadDateCreatePicker() {
    const input = readDateCreateInputRef.current
    if (!input) return
    const button = readDateCreateButtonRef.current
    if (button) {
      const rect = button.getBoundingClientRect()
      const pickerWidth = 296
      const gapY = 4
      const viewportPadding = 8
      let left = rect.right - pickerWidth + 90
      if (typeof window !== "undefined") {
        left = Math.max(viewportPadding, Math.min(left, window.innerWidth - pickerWidth - viewportPadding))
      }
      input.style.left = `${Math.round(left)}px`
      input.style.top = `${Math.round(rect.bottom + gapY)}px`
    }
    input.value = ""

    try {
      if (typeof input.showPicker === "function") {
        input.showPicker()
        return
      }
    } catch (err) {
      void err
    }
    input.focus()
    input.click()
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
    setActiveDateKey(key)
    openDayList(key, [])
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

    const insert = `@${title}`
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
    if (isMainMemoReadOnly) {
      setActiveDateKey(key)
      openDayList(key, itemsByDate[key] ?? [])
      return
    }
    if (!isEditingLeftMemo) {
      beginEditSession(key)
      setIsEditingLeftMemo(true)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (el) el.focus()
      })
    }
    setActiveDateKey(key)

    const isAll = activeWindowId === "all"
    const sourceText = isAll ? (textareaRef.current ? textareaRef.current.value : text) : tabEditText
    const sourceBlocks = isAll ? blocks : parseBlocksAndItems(sourceText ?? "", baseYear).blocks
    const existing = sourceBlocks.find((b) => b.dateKey === key)

    if (existing) {
      if (isAll) {
        const { newText, caretPos } = ensureBodyLineForBlock(sourceText ?? "", existing)
        if (newText !== (sourceText ?? "")) {
          pendingJumpRef.current = { headerPos: existing.headerStartPos, caretPos, topOffsetLines: 1 }
          updateEditorText(newText)
        } else {
          scheduleJump(existing.headerStartPos, caretPos, 1)
        }
      } else {
        const targetWindow = windows.find((w) => w.id === activeWindowId)
        if (!targetWindow) return
        const ensured = ensureTabGroupLineAtDate(sourceText ?? "", key, targetWindow.title, baseYear)
        if (ensured.newText !== (sourceText ?? "")) {
          pendingJumpRef.current = {
            headerPos: ensured.headerPos ?? existing.headerStartPos,
            caretPos: ensured.caretPos ?? existing.bodyStartPos,
            topOffsetLines: 1
          }
          setTabEditText(ensured.newText)
        } else {
          scheduleJump(existing.headerStartPos, ensured.caretPos ?? existing.bodyStartPos, 1)
        }
      }
      return
    }

    const targetTime = keyToTime(key)
    const byDate = [...sourceBlocks].sort(
      (a, b) => keyToTime(a.dateKey) - keyToTime(b.dateKey) || a.blockStartPos - b.blockStartPos
    )

    let insertPos = (sourceText ?? "").length
    for (const b of byDate) {
      if (keyToTime(b.dateKey) > targetTime) {
        insertPos = b.blockStartPos
        break
      }
    }

    const headerLine = buildHeaderLine(year, month, day)
    const { newText: insertedText, headerStartPos, bodyStartPos } = insertDateBlockAt(
      sourceText ?? "",
      insertPos,
      headerLine
    )
    pendingJumpRef.current = { headerPos: headerStartPos, caretPos: bodyStartPos, topOffsetLines: 1 }
    if (isAll) {
      updateEditorText(insertedText)
    } else {
      const targetWindow = windows.find((w) => w.id === activeWindowId)
      if (!targetWindow) return
      const ensured = ensureTabGroupLineAtDate(insertedText, key, targetWindow.title, baseYear)
      pendingJumpRef.current.caretPos = ensured.caretPos ?? pendingJumpRef.current.caretPos
      setTabEditText(ensured.newText)
    }
  }

  // ===== Today 버튼 동작 =====
  function goToday() {
    const y = today.getFullYear()
    const m = today.getMonth() + 1
    const d = today.getDate()
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    if (isMainMemoReadOnly) {
      setView({ year: y, month: m })
      viewRef.current = { year: y, month: m }
      setBaseYear(y)
      setActiveDateKey(key)
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

  const settingsNumberInput = {
    ...controlInput,
    height: 22,
    padding: "0 6px",
    borderRadius: 8,
    textAlign: "center",
    fontWeight: 600,
    fontSize: 13
  }

  const panelFontFamily = "Pretendard Variable, 'Inter', 'Apple SD Gothic Neo', system-ui, sans-serif"

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
    setDayListModal({ key, items })
    setDayListMode("read")
  }

  function closeDayListModal() {
    flushPendingDayListSync()
    setDayListModal(null)
  }

  function toggleLeftMemo() {
    setMemoInnerCollapsed((prev) => {
      const next = prev === "right" ? "none" : "right"
      setMemoCollapsedByWindow((map) => ({ ...map, [activeWindowId]: next }))
      return next
    })
  }

  function toggleRightMemo() {
    setMemoInnerCollapsed((prev) => {
      const next = prev === "left" ? "none" : "left"
      setMemoCollapsedByWindow((map) => ({ ...map, [activeWindowId]: next }))
      return next
    })
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
    width: 70,
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
  const leftButtonOpacity = isLeftCollapsed ? 0.4 : 1
  const rightButtonOpacity = isRightCollapsed ? 0.4 : 1
  const leftMemoFlex = isLeftCollapsed ? "0 0 0px" : isRightCollapsed ? "1 1 0" : `0 0 ${memoInnerSplit * 100}%`
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <button
              onClick={basePrevYear}
              className="arrow-button"
              style={arrowButton}
              title="이전 연도"
              aria-label="이전 연도"
            >
              ◀
            </button>
            <div style={{ fontWeight: 900 }}>{baseYear}</div>
            <button
              onClick={baseNextYear}
              className="arrow-button"
              style={arrowButton}
              title="다음 연도"
              aria-label="다음 연도"
            >
              ▶
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
                className="no-hover-outline memo-toggle-button is-left"
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
                  opacity: leftButtonOpacity
                }}
                title={isRightCollapsed ? "오른쪽 메모 펼치기" : "오른쪽 메모 접기"}
                aria-label={isRightCollapsed ? "오른쪽 메모 펼치기" : "오른쪽 메모 접기"}
              >
                L
              </button>
            <div style={{ width: 1, height: 32, background: ui.border2 }} />
              <button
                onClick={toggleRightMemo}
                className="no-hover-outline memo-toggle-button is-right"
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
                  opacity: rightButtonOpacity
                }}
                title={isLeftCollapsed ? "왼쪽 메모 펼치기" : "왼쪽 메모 접기"}
                aria-label={isLeftCollapsed ? "왼쪽 메모 펼치기" : "왼쪽 메모 접기"}
              >
                R
              </button>
            </div>
            {!isLeftCollapsed ? (
              <>
                <button
                  ref={readDateCreateButtonRef}
                  onClick={openReadDateCreatePicker}
                  style={{
                    ...pillButton,
                    height: 32,
                    padding: "0 12px",
                    borderRadius: 10,
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

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {activeWindowId === "all" && (
            <div style={{ position: "relative" }}>
              <button
                ref={filterBtnRef}
                onClick={() => setFilterOpen((v) => !v)}
              style={{
                ...memoTopRightButton,
                padding: 0,
                fontSize: 26,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center"
              }}
                title="통합 필터"
                aria-label="통합 필터"
              >
                <span style={{ display: "inline-block", transform: "translateY(-1.5px)" }}>≡</span>
              </button>
              {filterOpen && (
                <FilterPanel
                  filterPanelRef={filterPanelRef}
                  editableWindows={editableWindows}
                  integratedFilters={integratedFilters}
                  setIntegratedFilters={setIntegratedFilters}
                  ui={ui}
                  panelFontFamily={panelFontFamily}
                />
              )}
            </div>
          )}
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
          {!session && (
            <>
              <button
                onClick={() => {
                  setAuthMessage("")
                  setLoginModalOpen(true)
                }}
                title="로그인"
                aria-label="로그인"
                style={{ ...memoTopRightButton, fontSize: 12, fontWeight: 900, minWidth: 74 }}
              >
                로그인
              </button>
              <span style={{ fontSize: 11, color: ui.text2 }}>오프라인 모드</span>
            </>
          )}
          {layoutPreset === "memo-left" && (
            <button
              onClick={() => setLayoutPreset((p) => (p === "memo-left" ? "calendar-left" : "memo-left"))}
              style={{ ...memoTopRightButton, fontSize: 12, fontWeight: 900 }}
              title="메모/달력 위치 변경"
              aria-label="메모/달력 위치 변경"
            >
              ⇆
            </button>
          )}
          {outerCollapsed === "left" && (
            <button
              onClick={() => setLayoutPreset((p) => (p === "memo-left" ? "calendar-left" : "memo-left"))}
              style={{ ...memoTopRightButton, fontSize: 12, fontWeight: 900 }}
              title="메모/달력 위치 변경"
              aria-label="메모/달력 위치 변경"
            >
              ⇆
            </button>
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
            tabFontInput={tabFontInput}
            setTabFontInput={setTabFontInput}
            tabFontPx={tabFontPx}
            setTabFontPx={setTabFontPx}
            memoFontInput={memoFontInput}
            setMemoFontInput={setMemoFontInput}
            memoFontPx={memoFontPx}
            setMemoFontPx={setMemoFontPx}
            showLogout={Boolean(session)}
            onSignOut={() => {
              setSettingsOpen(false)
              void handleSignOut()
            }}
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
            gap: memoInnerCollapsed === "none" ? MEMO_INNER_GAP : 0,
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
                    blocks={activeWindowId === "all" ? dashboardBlocks : tabReadBlocks}
                    isAll={activeWindowId === "all"}
                    ui={ui}
                    highlightTokens={highlightTokens}
                    todayKey={todayKey}
                    hoveredReadDateKey={hoveredReadDateKey}
                    setHoveredReadDateKey={setHoveredReadDateKey}
                    collapsedForActive={collapsedForActive}
                    toggleDashboardCollapse={toggleDashboardCollapse}
                    timeToMinutes={timeToMinutes}
                    keyToYMD={keyToYMD}
                    buildHeaderLine={buildHeaderLine}
                    activeWindowId={activeWindowId}
                    setReadBlockRef={setReadBlockRef}
                    handleReadBlockClick={handleReadBlockClick}
                    readScrollMarginTop={READ_SCROLL_MARGIN_TOP}
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
                onFocus={() => {
                  setSelectedDateKey(null)
                  lastActiveDateKeyRef.current = null
                }}
                onScroll={(e) => syncOverlayScroll(e.currentTarget, rightOverlayInnerRef.current)}
                placeholder={
                  activeWindowId === "all"
                    ? [
                        "[자유 메모장]",
                        "통합 탭에서는 모든 메모장들의 메모를 합쳐서 보여줍니다.",
                        "",
                        "맨 위(섹션 제목 없이)는 공통 메모로 사용하세요.",
                        "",
                        "ex)",
                        "오늘도 화이팅",
                        "[대학]",
                        "권교수님 피드백 다시 한 번 생각하기",
                        "[연애]",
                        "100일 이벤트 준비하기"
                      ].join("\n")
                    : ["[자유 메모]", "", "해당 메모장에 쓰고 싶은 글을 자유롭게 입력하세요."].join("\n")
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
      controlInput={controlInput}
      arrowButton={arrowButton}
      ui={ui}
      calendarCellH={calendarCellH}
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
      calendarInteractingRef={calendarInteractingRef}
      goToday={goToday}
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
            `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 넣어주세요.
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

      <DayListModal
        open={Boolean(dayListModal)}
        onClose={closeDayListModal}
        readOnly={isScheduleReadOnly}
        ui={ui}
        dayListTitle={dayListTitle}
        dayListMode={dayListMode}
        setDayListMode={setDayListMode}
        dayListEditText={dayListEditText}
        setDayListEditText={setDayListEditText}
        applyDayListEdit={applyDayListEdit}
        dayListReadItems={dayListReadItems}
        memoFontPx={memoFontPx}
        editableWindows={editableWindows}
      />

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
            <input
              value={authEmail}
              onChange={(e) => {
                const next = e.target.value
                setAuthEmail(next)
                if (rememberCredentials && authMode === "signIn") persistCredentials(next, authPassword)
              }}
              placeholder="이메일"
              style={authInputStyle}
              className="login-modal-input"
              autoComplete="username"
            />
            <input
              type="password"
              value={authPassword}
              onChange={(e) => {
                const next = e.target.value
                setAuthPassword(next)
                if (rememberCredentials && authMode === "signIn") persistCredentials(authEmail, next)
              }}
              placeholder="비밀번호"
              style={authInputStyle}
              className="login-modal-input"
              autoComplete="current-password"
            />
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
                    if (next) persistCredentials(authEmail, authPassword)
                    else clearPersistedCredentials()
                  }}
                  style={{ width: 14, height: 14 }}
                />
                <span>아이디/비번 기억</span>
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
                onClick={() => setAuthMode("signUp")}
                className="login-mode-tab"
                style={{
                  border: "none",
                  background: "transparent",
                  color: authMode === "signUp" ? ui.text : ui.text2,
                  opacity: authMode === "signUp" ? 1 : 0.45,
                  fontWeight: 800,
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
                  fontWeight: 800,
                  cursor: "pointer"
                }}
              >
                로그인
              </button>
            </div>
            <button
              type="button"
              onClick={handleAuthSubmit}
              disabled={authLoading}
              className="login-modal-submit"
              style={{
                height: 44,
                borderRadius: 12,
                border: "none",
                background: ui.accent,
                color: "#0b0f16",
                fontWeight: 900,
                cursor: "pointer"
              }}
            >
              {authLoading ? "..." : authMode === "signIn" ? "로그인" : "가입"}
            </button>
            {authMessage ? (
              <div style={{ color: ui.text2, fontSize: 13 }}>{authMessage}</div>
            ) : null}
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
          border-radius: 10px 0 0 10px;
        }
        .memo-toggle-button.is-right {
          border-radius: 0 10px 10px 0;
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
          font-weight: 520;
          text-shadow: 0 0 0 currentColor, 0.2px 0 0 currentColor, -0.2px 0 0 currentColor;
        }
        .memo-overlay__fn {
          font-weight: 600;
        }
        .tab-pill {
          transition: transform 120ms ease, box-shadow 120ms ease;
        }
        .tab-pill:hover {
          transform: translateY(-0.5px);
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
          outline: 2px solid ${theme === "dark" ? "rgba(148, 197, 255, 0.7)" : "rgba(37, 99, 235, 0.35)"};
          outline-offset: -2px;
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


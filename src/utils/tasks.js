import {
  parseBlocksAndItems,
  parseDashboardSemicolonLine,
  parseLeadingTimeDashboardLine
} from "./plannerText"
import { buildTaskMetaText, decodeTaskLineBreaks, stripTaskSuffix } from "./taskMarkers"

export function formatTaskDisplay(baseRaw) {
  const normalized = String(baseRaw ?? "").trim()
  if (!normalized) return { time: "", title: "", text: "", display: "" }

  const semicolon = parseDashboardSemicolonLine(normalized, { allowEmptyText: true })
  if (semicolon) {
    const text = decodeTaskLineBreaks(String(semicolon.text ?? "").trim())
    const title = String(semicolon.group ?? "").trim()
    const time = String(semicolon.time ?? "").trim()
    const display = `${time ? `${time} ` : ""}${title ? `[${title}] ` : ""}${text}`.trim()
    return { time, title, text, display }
  }

  const timeLine = parseLeadingTimeDashboardLine(normalized)
  if (timeLine) {
    const time = String(timeLine.time ?? "").trim()
    const title = String(timeLine.group ?? "").trim()
    const text = decodeTaskLineBreaks(String(timeLine.text ?? "").trim())
    return {
      time,
      title,
      text,
      display: `${time ? `${time} ` : ""}${title ? `[${title}] ` : ""}${text}`.trim()
    }
  }

  const decoded = decodeTaskLineBreaks(normalized)
  return { time: "", title: "", text: decoded, display: decoded }
}

export function extractTasksFromPlannerText(sourceText, baseYear) {
  const text = String(sourceText ?? "")
  const parsed = parseBlocksAndItems(text, baseYear)
  const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : []
  const tasks = []

  for (const block of blocks) {
    const dateKey = String(block?.dateKey ?? "").trim()
    if (!dateKey) continue
    const body = text.slice(block.bodyStartPos ?? 0, block.blockEndPos ?? 0)
    const lines = String(body ?? "").replace(/\r\n/g, "\n").split("\n")
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const rawLine = String(lines[lineIndex] ?? "").trim()
      if (!rawLine) continue
      const parsedTask = stripTaskSuffix(rawLine)
      const baseText = String(parsedTask?.text ?? "").trim()
      if (!baseText) continue
      const formatted = formatTaskDisplay(baseText)
      tasks.push({
        id: `${dateKey}:${lineIndex}:${baseText}`,
        dateKey,
        lineIndex,
        rawLine,
        baseRaw: baseText,
        completed: parsedTask.completed === true,
        time: formatted.time,
        title: formatted.title,
        text: formatted.text,
        display: formatted.display
      })
    }
  }

  return tasks
}

export function updateTaskLineStatusInBody(bodyText, lineIndex, completed) {
  const lines = String(bodyText ?? "").replace(/\r\n/g, "\n").split("\n")
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return String(bodyText ?? "")
  const rawLine = String(lines[lineIndex] ?? "")
  const parsedTask = stripTaskSuffix(rawLine)
  const baseText = String(parsedTask?.text ?? "").trim()
  if (!baseText) return String(bodyText ?? "")
  lines[lineIndex] = buildTaskMetaText(baseText, {
    completed
  })
  return lines.join("\n")
}

export function removeTaskLineFromBody(bodyText, lineIndex) {
  const lines = String(bodyText ?? "").replace(/\r\n/g, "\n").split("\n")
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return String(bodyText ?? "")
  lines.splice(lineIndex, 1)
  return lines.join("\n")
}

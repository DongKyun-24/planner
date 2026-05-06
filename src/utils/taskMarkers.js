export function encodeTaskLineBreaks(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\\n")
}

export function decodeTaskLineBreaks(value) {
  return String(value ?? "").replace(/\\n/g, "\n")
}

function parseLineMetaSuffixes(rawLine) {
  let baseRaw = String(rawLine ?? "").trim()
  if (!baseRaw) {
    return { baseRaw: "", completed: null, marker: "" }
  }

  let completed = null
  let marker = ""
  while (baseRaw) {
    const taskMatch =
      completed == null ? baseRaw.match(/^(.*?);\s*([OX])\s*$/i) : null
    if (taskMatch) {
      const nextBaseRaw = String(taskMatch[1] ?? "").trim()
      if (!nextBaseRaw) break
      baseRaw = nextBaseRaw
      marker = String(taskMatch[2] ?? "").trim().toUpperCase()
      completed = marker === "O"
      continue
    }

    const legacyCountMetaMatch = baseRaw.match(/^(.*?);\s*(?:COUNT|ANN)\s*=\s*[^;]+\s*$/i)
    if (legacyCountMetaMatch) {
      const nextBaseRaw = String(legacyCountMetaMatch[1] ?? "").trim()
      if (!nextBaseRaw) break
      baseRaw = nextBaseRaw
      continue
    }

    const legacyDayMarkerMatch = baseRaw.match(/^(.*?);\s*D\s*$/i)
    if (legacyDayMarkerMatch) {
      const nextBaseRaw = String(legacyDayMarkerMatch[1] ?? "").trim()
      if (!nextBaseRaw) break
      baseRaw = nextBaseRaw
      continue
    }

    break
  }

  return {
    baseRaw,
    completed,
    marker
  }
}

export function parseTaskSuffix(rawLine) {
  const parsed = parseLineMetaSuffixes(rawLine)
  if (parsed.completed == null) return null
  return {
    baseRaw: parsed.baseRaw,
    completed: parsed.completed,
    marker: parsed.marker
  }
}

export function stripTaskSuffix(rawLine) {
  const parsed = parseLineMetaSuffixes(rawLine)
  return {
    text: parsed.baseRaw || String(rawLine ?? "").trim(),
    completed: parsed.completed
  }
}

export function buildTaskMetaText(baseRaw, { completed = null } = {}) {
  const text = encodeTaskLineBreaks(baseRaw).trim()
  if (!text) return ""
  let next = text
  if (completed != null) next += `;${completed ? "O" : "X"}`
  return next
}

export function removeTaskLinesFromBody(bodyText) {
  return String(bodyText ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !parseTaskSuffix(String(line ?? "").trim()))
    .join("\n")
}

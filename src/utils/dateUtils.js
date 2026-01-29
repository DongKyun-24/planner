export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

export function dayOfWeek(year, month, day) {
  return new Date(year, month - 1, day).getDay()
}

export function keyToYMD(key) {
  return {
    y: Number(key.slice(0, 4)),
    m: Number(key.slice(5, 7)),
    d: Number(key.slice(8, 10))
  }
}

export function keyToTime(key) {
  return new Date(key).getTime()
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

export function buildLineStartPositions(s) {
  const starts = [0]
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\n") starts.push(i + 1)
  }
  return starts
}

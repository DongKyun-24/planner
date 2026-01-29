import { THEME_ORDER } from "../styles/themes"

export default function ThemeToggle({ theme, ui, setTheme, compact = false }) {
  const baseBorder = ui.border2
  const dotColors = {
    light: "#ffffff",
    dark: "#0b1220",
    navy: "#152248",
    sage: "#d2f1dc",
    sunset: "#ffe3d0",
    berry: "#ffe4ff",
    mint: "#dafff8",
    stone: "#f7f8fb",
    charcoal: "#0f0f0f",
    ivory: "#fefefe",
    rose: "#ffe3ec",
    pistachio: "#e4f8e9",
    sky: "#e1edff",
    copper: "#f7d8b5",
    peach: "#ffe8d0",
    storm: "#1e2636",
    gold: "#fff5d4",
    lavender: "#f6edff"
  }

  const dotSize = compact ? 14 : 16
  const gap = compact ? 4 : 6
  const containerWidth = `calc(${dotSize * 5}px + ${gap * 4}px)`

  return (
    <div
      role="group"
      aria-label="테마 선택"
      style={{
        width: containerWidth,
        minHeight: dotSize + gap * 2,
        borderRadius: 999,
        display: "grid",
        gridTemplateColumns: `repeat(5, ${dotSize}px)`,
        gap,
        padding: compact ? "6px 4px" : "6px 5px",
        justifyContent: "center"
      }}
    >
      {THEME_ORDER.map((name) => {
        const isActive = theme === name
        return (
          <button
            key={name}
            type="button"
            onClick={() => setTheme(name)}
            title={`${name} 테마`}
            aria-label={`${name} 테마`}
            style={{
              width: dotSize,
              height: dotSize,
              borderRadius: 999,
              border: `1.5px solid ${isActive ? ui.accent : baseBorder}`,
              background: dotColors[name],
              boxShadow: isActive
                ? "0 0 0 2px rgba(59, 130, 246, 0.25)"
                : "inset 0 0 0 0.5px rgba(0,0,0,0.12)",
              cursor: "pointer",
              padding: 0
            }}
          />
        )
      })}
    </div>
  )
}

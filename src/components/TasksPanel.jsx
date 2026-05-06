import { useMemo } from "react"
import { getRepeatLabel } from "../utils/recurringRules"

const TASK_RING_BLUE = "#3b82f6"
const REGULAR_TASK_TEXT_OFFSET = 4

function formatDateLabel(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return raw
  return `${match[1]}.${match[2]}.${match[3]}`
}

export default function TasksPanel({
  open,
  ui,
  panelFontFamily,
  tasks = [],
  onToggleTask,
  onOpenTask,
  onClose
}) {
  const orderedTasks = useMemo(() => (Array.isArray(tasks) ? tasks : []), [tasks])

  if (!open) return null

  function renderTask(task) {
    const repeatLabel =
      task?.sourceType === "recurring" ? getRepeatLabel(task?.repeat, task?.repeatInterval) : ""

    return (
      <div
        key={task.id}
        onClick={() => onOpenTask?.(task)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onOpenTask?.(task)
          }
        }}
        role="button"
        tabIndex={0}
        style={{
          width: "100%",
          textAlign: "left",
          border: `1px solid ${ui.border}`,
          background: ui.surface,
          color: ui.text,
          borderRadius: 16,
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer"
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleTask?.(task)
          }}
          aria-label={task.completed ? "Task 미완료로 변경" : "Task 완료"}
          style={{
            width: 17,
            height: 17,
            borderRadius: 999,
            border: `1.25px solid ${task.completed ? ui.accent : TASK_RING_BLUE}`,
            background: task.completed ? ui.accent : ui.surface,
            color: task.completed ? "#fff" : "transparent",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            cursor: "pointer",
            fontWeight: 900,
            fontSize: 9,
            lineHeight: 1,
            padding: 0,
            alignSelf: "center"
          }}
        >
          {task.completed ? "✓" : ""}
        </button>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, justifyContent: "center" }}>
          <div style={{ fontSize: 15, lineHeight: 1.1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              {repeatLabel ? (
                <span
                  style={{
                    height: 18,
                    padding: "0 7px",
                    borderRadius: 999,
                    border: `1px solid ${ui.border}`,
                    background: ui.surface2,
                    color: ui.text2,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 800,
                    lineHeight: 1,
                    flexShrink: 0
                  }}
                >
                  {repeatLabel}
                </span>
              ) : null}
              <span
                style={{
                  minWidth: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: 18,
                  fontWeight: 800,
                  textDecoration: task.completed ? "line-through" : "none",
                  color: task.completed ? ui.text2 : ui.text,
                  lineHeight: 1.1,
                  marginLeft: repeatLabel ? 0 : REGULAR_TASK_TEXT_OFFSET
                }}
              >
                {task.display}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: ui.text2, fontSize: 12 }}>
            <span>{formatDateLabel(task.dateKey)}</span>
            {task.title ? <span>{`[${task.title}]`}</span> : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 76,
        right: 12,
        bottom: 12,
        width: "min(420px, calc(100vw - 24px))",
        borderRadius: 22,
        border: `1px solid ${ui.border}`,
        background: ui.surface,
        boxShadow: "0 22px 48px rgba(15, 23, 42, 0.22)",
        zIndex: 140,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontFamily: panelFontFamily,
        color: ui.text
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "16px 18px",
          borderBottom: `1px solid ${ui.border}`
        }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Tasks</div>
          <div style={{ fontSize: 12, color: ui.text2, marginTop: 4 }}>
            줄 끝에 `;X` 또는 `;O`가 붙은 항목이 여기 모입니다.
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            height: 36,
            padding: "0 14px",
            borderRadius: 12,
            border: `1px solid ${ui.border}`,
            background: ui.surface2,
            color: ui.text,
            fontFamily: "inherit",
            fontWeight: 800,
            cursor: "pointer"
          }}
        >
          Close
        </button>
      </div>

      <div style={{ padding: 16, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {orderedTasks.length ? (
          orderedTasks.map(renderTask)
        ) : (
          <div
            style={{
              borderRadius: 16,
              border: `1px dashed ${ui.border}`,
              background: ui.surface2,
              padding: "18px 16px",
              color: ui.text2,
              fontSize: 13,
              lineHeight: 1.6
            }}
          >
            아직 task가 없습니다. 날짜 내용에 `@탭;내용;X` 또는 `시간;@탭;내용;X`처럼 적어보세요.
          </div>
        )}
      </div>
    </div>
  )
}

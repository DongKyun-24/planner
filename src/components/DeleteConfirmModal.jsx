import { useEffect, useRef } from "react"

export default function DeleteConfirmModal({ deleteConfirm, ui, onCancel, onConfirm }) {
  const cancelButtonRef = useRef(null)
  const deleteButtonBg = "#ffffff"
  const deleteButtonBorder = "#d7b0b0"
  const deleteButtonText = "#a12b2b"

  useEffect(() => {
    if (!deleteConfirm) return undefined

    cancelButtonRef.current?.focus?.()

    const handleKeyDown = (event) => {
      if (event.key === "Escape" || event.key === "N" || event.key === "n") {
        event.preventDefault()
        onCancel?.()
        return
      }
      if (event.key === "Enter" || event.key === "Y" || event.key === "y") {
        event.preventDefault()
        onConfirm?.(deleteConfirm.id)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [deleteConfirm, onCancel, onConfirm])

  if (!deleteConfirm) return null

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 210
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="탭 삭제 확인"
        style={{
          width: "min(360px, 92vw)",
          background: ui.surface,
          color: ui.text,
          borderRadius: 12,
          border: `1px solid ${ui.border}`,
          boxShadow: ui.shadow,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 16 }}>탭을 삭제할까요?</div>
        <div style={{ color: ui.text2, fontWeight: 500, fontSize: 13, lineHeight: 1.5 }}>
          [{deleteConfirm.title}] 탭을 삭제하면 되돌릴 수 없습니다.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            style={{
              height: 34,
              padding: "0 16px",
              borderRadius: 10,
              border: `1px solid ${ui.border}`,
              background: ui.surface2,
              color: ui.text,
              cursor: "pointer",
              fontWeight: 700
            }}
          >
            아니오
          </button>
          <button
            type="button"
            onClick={() => onConfirm(deleteConfirm.id)}
            style={{
              height: 34,
              padding: "0 16px",
              borderRadius: 10,
              border: `1px solid ${deleteButtonBorder}`,
              background: deleteButtonBg,
              color: deleteButtonText,
              cursor: "pointer",
              fontWeight: 800,
              boxShadow: "none"
            }}
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  )
}

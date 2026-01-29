export default function DeleteConfirmModal({ deleteConfirm, ui, onCancel, onConfirm }) {
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
        <div style={{ fontWeight: 900, fontSize: 16 }}>탭을 삭제할까요?</div>
        <div style={{ color: ui.text2, fontWeight: 600, fontSize: 13 }}>
          [{deleteConfirm.title}] 탭을 삭제하면 복구할 수 없습니다.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              height: 32,
              padding: "0 16px",
              borderRadius: 10,
              border: `1px solid ${ui.border}`,
              background: ui.surface2,
              color: ui.text,
              cursor: "pointer",
              fontWeight: 800
            }}
          >
            N
          </button>
          <button
            type="button"
            onClick={() => onConfirm(deleteConfirm.id)}
            style={{
              height: 32,
              padding: "0 16px",
              borderRadius: 10,
              border: `1px solid ${ui.border}`,
              background: ui.accent,
              color: "#fff",
              cursor: "pointer",
              fontWeight: 800
            }}
          >
            Y
          </button>
        </div>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_RIGHT_MEMO_DOC_TITLE,
  createRightMemoDoc,
  getNextRightMemoDocTitle,
  getRightMemoDocDisplayTitle,
  normalizeRightMemoDocState,
  serializeRightMemoDocState
} from "../utils/rightMemoDocs";

const FALLBACK_MEMO_UI = {
  memoFontPx: 18,
  memoTabFontPx: 18,
  memoBodyFontPx: 18,
  memoLineHeight: 1.6,
  palette: {
    line: "#dbe3ef",
    panel: "#ffffff",
    subtleText: "#6b7280",
    text: "#0f172a",
    chromeBg: "#f8fafc",
    brand: "#2563eb",
    brandSoft: "rgba(37, 99, 235, 0.10)"
  }
};

function buildPaletteFromFlatUi(ui) {
  return {
    line: ui?.border,
    panel: ui?.surface,
    subtleText: ui?.text2,
    text: ui?.text,
    chromeBg: ui?.surface2,
    brand: ui?.accent,
    brandSoft: ui?.accentSoft
  };
}

function mergeUi(ui) {
  const paletteFromFlatUi = buildPaletteFromFlatUi(ui);
  const fallbackFontPx = Number(ui?.memoFontPx) || FALLBACK_MEMO_UI.memoFontPx;
  const memoTabFontPx = Number(ui?.memoTabFontPx) || fallbackFontPx;
  const memoBodyFontPx = Number(ui?.memoBodyFontPx) || fallbackFontPx;
  return {
    ...FALLBACK_MEMO_UI,
    ...ui,
    memoFontPx: memoBodyFontPx,
    memoTabFontPx,
    memoBodyFontPx,
    palette: {
      ...FALLBACK_MEMO_UI.palette,
      ...paletteFromFlatUi,
      ...(ui?.palette || {})
    }
  };
}

function buildSafeDocs(rawDocs) {
  const docs = Array.isArray(rawDocs) ? rawDocs : [];
  if (!docs.length) {
    return [createRightMemoDoc({ title: DEFAULT_RIGHT_MEMO_DOC_TITLE, content: "" })];
  }
  return docs.map((doc, index) => ({
    id: typeof doc?.id === "string" && doc.id.trim() ? doc.id : createRightMemoDoc().id,
    title: getRightMemoDocDisplayTitle(doc?.title, index),
    content: String(doc?.content ?? "")
  }));
}

function Arrow({ left = false, size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {left ? (
        <path
          d="M12.5 4.5L7 10l5.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M7.5 4.5L13 10l-5.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function PlainButton({
  children,
  onClick,
  onMouseDown,
  onPointerDown,
  disabled = false,
  style,
  ariaLabel,
  title
}) {
  return (
    <button
      type="button"
      className="no-hover-outline"
      onPointerDown={onPointerDown}
      onMouseDown={(e) => {
        onMouseDown?.(e);
        e.preventDefault();
      }}
      onFocus={(e) => e.currentTarget.blur()}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      style={style}
    >
      {children}
    </button>
  );
}

function getToolbarButtonStyle(ui, disabled = false) {
  return {
    width: 30,
    height: 30,
    borderRadius: 6,
    padding: 0,
    border: disabled ? "1px solid transparent" : `1px solid ${ui.palette.line}`,
    background: disabled ? "transparent" : ui.palette.panel,
    color: disabled ? ui.palette.subtleText : ui.palette.text,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.2 : 1,
    outline: "none",
    boxShadow: "none",
    marginBottom: 0,
    transition: "opacity 140ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease",
    userSelect: "none",
    flexShrink: 0
  };
}

function getTabStyle(ui, isActive, hasDeleteButton = false) {
  const edgeLine = `inset 1px 0 0 ${ui.palette.line}, inset -1px 0 0 ${ui.palette.line}, inset 0 1px 0 ${ui.palette.line}`;
  return {
    position: "relative",
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    height: 36,
    padding: hasDeleteButton ? "0 10px 0 18px" : "0 18px",
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderLeft: `1px solid ${ui.palette.line}`,
    borderRight: `1px solid ${ui.palette.line}`,
    borderTop: `1px solid ${ui.palette.line}`,
    borderBottom: isActive ? `1px solid ${ui.palette.panel}` : `1px solid ${ui.palette.line}`,
    background: isActive ? ui.palette.panel : ui.palette.chromeBg,
    backgroundClip: "padding-box",
    color: ui.palette.text,
    fontSize: ui.memoTabFontPx,
    lineHeight: ui.memoLineHeight,
    fontWeight: isActive ? 560 : 460,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    outline: "none",
    boxShadow: isActive ? edgeLine : "none",
    marginBottom: isActive ? -1 : 0,
    zIndex: isActive ? 2 : 1,
    flexShrink: 0
  };
}

function getSelectorButtonStyle(ui) {
  return {
    minWidth: 0,
    height: 40,
    padding: "0 4px 0 0",
    border: "none",
    borderRadius: 0,
    background: "transparent",
    color: ui.palette.text,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 12,
    cursor: "pointer",
    outline: "none",
    boxShadow: "none",
    userSelect: "none",
    fontSize: ui.memoTabFontPx,
    lineHeight: ui.memoLineHeight,
    fontWeight: 520
  };
}

function getTextareaStyle(baseStyle, ui) {
  return {
    ...baseStyle,
    width: "100%",
    minHeight: 0,
    height: "100%",
    border: "none",
    outline: "none",
    resize: "none",
    padding: 0,
    margin: 0,
    background: "transparent",
    fontSize: ui.memoBodyFontPx,
    lineHeight: ui.memoLineHeight,
    color: ui.palette.text,
    fontWeight: 500
  };
}

function canDeleteMemoDoc(index) {
  return index > 0;
}

function TabsChrome({
  ui,
  docs,
  activeDocId,
  renameDocId,
  renameDraft,
  setRenameDraft,
  renameInputRef,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onSelectDoc,
  onDeleteDoc,
  onAddDoc
}) {
  const viewportRef = useRef(null);
  const innerRef = useRef(null);
  const tabRefs = useRef(new Map());
  const [scrollState, setScrollState] = useState({ left: 0, max: 0, viewportWidth: 0 });
  const [hoveredDocId, setHoveredDocId] = useState(null);

  const updateScrollState = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const viewportWidth = viewport.clientWidth || 0;
    const max = Math.max(0, (viewport.scrollWidth || 0) - viewportWidth);
    setScrollState((prev) => {
      const next = {
        left: viewport.scrollLeft || 0,
        max,
        viewportWidth
      };
      if (
        Math.abs(prev.left - next.left) < 1 &&
        Math.abs(prev.max - next.max) < 1 &&
        Math.abs(prev.viewportWidth - next.viewportWidth) < 1
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const rafId = requestAnimationFrame(updateScrollState);
    const viewport = viewportRef.current;
    if (!viewport) {
      return () => cancelAnimationFrame(rafId);
    }

    const handleScroll = () => updateScrollState();
    const handleResize = () => updateScrollState();
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    let viewportObserver = null;
    let innerObserver = null;
    if (typeof ResizeObserver !== "undefined") {
      viewportObserver = new ResizeObserver(() => updateScrollState());
      viewportObserver.observe(viewport);
      if (innerRef.current) {
        innerObserver = new ResizeObserver(() => updateScrollState());
        innerObserver.observe(innerRef.current);
      }
    }

    return () => {
      cancelAnimationFrame(rafId);
      viewport.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      if (viewportObserver) viewportObserver.disconnect();
      if (innerObserver) innerObserver.disconnect();
    };
  }, [docs, renameDocId, renameDraft, updateScrollState]);

  useLayoutEffect(() => {
    const activeNode = tabRefs.current.get(activeDocId);
    const viewport = viewportRef.current;
    if (!activeNode || !viewport) return;
    const activeIndex = docs.findIndex((doc) => doc.id === activeDocId);
    const shouldSnapToEnd = activeIndex >= 0 && activeIndex === docs.length - 1;
    const rafId = requestAnimationFrame(() => {
      if (shouldSnapToEnd) {
        viewport.scrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      } else {
        activeNode.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      updateScrollState();
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeDocId, docs, renameDocId, renameDraft, updateScrollState]);

  const canMoveLeft = scrollState.left > 1;
  const canMoveRight = scrollState.left < scrollState.max - 1;
  const shiftAmount = Math.max(120, Math.floor(scrollState.viewportWidth * 0.75));

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-end",
        gap: 10,
        padding: "2px 10px 0 10px",
        minHeight: 38
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 1,
          background: ui.palette.line,
          zIndex: 0
        }}
      />

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          alignSelf: "stretch",
          flexShrink: 0
        }}
      >
      <PlainButton
        onClick={() => viewportRef.current?.scrollBy({ left: -shiftAmount, behavior: "smooth" })}
        disabled={!canMoveLeft}
        style={getToolbarButtonStyle(ui, !canMoveLeft)}
        ariaLabel="?쇱そ 硫붾え 蹂닿린"
      >
        <Arrow left size={Math.max(ui.memoTabFontPx, 12)} />
      </PlainButton>
      </div>

      <div
        ref={viewportRef}
        style={{
          boxSizing: "border-box",
          minWidth: 0,
          flex: 1,
          overflowX: "auto",
          overflowY: "hidden",
          paddingTop: 2,
          paddingBottom: 0,
          minHeight: 38,
          scrollbarWidth: "none",
          msOverflowStyle: "none"
        }}
      >
        <div
          ref={innerRef}
          style={{
            display: "inline-flex",
            alignItems: "flex-end",
            gap: 2,
            width: "max-content",
            minHeight: 36,
            paddingRight: 2
          }}
        >
          {docs.map((doc, index) => {
            const title = getRightMemoDocDisplayTitle(doc.title, index);
            const active = doc.id === activeDocId;
            const renaming = renameDocId === doc.id;
            const hasDeleteButton = docs.length > 1 && canDeleteMemoDoc(index);
            const showDeleteButton = hasDeleteButton && hoveredDocId === doc.id;

            return (
              <div
                key={doc.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(doc.id, node);
                  else tabRefs.current.delete(doc.id);
                }}
                onMouseEnter={() => setHoveredDocId(doc.id)}
                onMouseLeave={() => {
                  setHoveredDocId((prev) => (prev === doc.id ? null : prev));
                }}
                onMouseDown={(e) => {
                  if (e.target instanceof Element && e.target.closest("button, input")) return;
                  e.preventDefault();
                }}
                onClick={(e) => {
                  if (e.target instanceof Element && e.target.closest("button, input")) return;
                  if (!renaming) onSelectDoc(doc.id);
                }}
                onDoubleClick={() => onRenameStart(doc.id, title)}
                style={getTabStyle(ui, active, hasDeleteButton)}
              >
                {renaming ? (
                  <input
                    ref={renameInputRef}
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => onRenameCommit(doc.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        onRenameCommit(doc.id);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        onRenameCancel();
                      }
                    }}
                    style={{
                      minWidth: 0,
                      width: Math.max(56, renameDraft.length * Math.max(ui.memoTabFontPx * 0.9, 8)),
                      border: "none",
                      outline: "none",
                      boxShadow: "none",
                      background: "transparent",
                      fontSize: ui.memoTabFontPx,
                      lineHeight: ui.memoLineHeight,
                      color: ui.palette.text,
                      fontWeight: active ? 700 : 600,
                      padding: 0,
                      margin: 0,
                      appearance: "none",
                      WebkitAppearance: "none",
                      MozAppearance: "none"
                    }}
                  />
                ) : (
                  <span style={{ position: "relative", zIndex: 3 }}>{title}</span>
                )}

                {hasDeleteButton ? (
                  <PlainButton
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDeleteDoc(doc.id);
                    }}
                    style={{
                      position: "relative",
                      zIndex: 3,
                      marginLeft: 2,
                      border: "none",
                      background: "transparent",
                      color: ui.palette.subtleText,
                      fontSize: ui.memoTabFontPx,
                      lineHeight: 1,
                      padding: 0,
                      cursor: showDeleteButton ? "pointer" : "default",
                      outline: "none",
                      boxShadow: "none",
                      opacity: showDeleteButton ? 1 : 0,
                      pointerEvents: showDeleteButton ? "auto" : "none",
                      transition: "opacity 120ms ease"
                    }}
                    ariaLabel={`${title} 삭제`}
                  >
                    ×
                  </PlainButton>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          alignSelf: "stretch",
          gap: 8,
          flexShrink: 0
        }}
      >
      <PlainButton
        onClick={() => viewportRef.current?.scrollBy({ left: shiftAmount, behavior: "smooth" })}
        disabled={!canMoveRight}
        style={getToolbarButtonStyle(ui, !canMoveRight)}
        ariaLabel="?ㅻⅨ履?硫붾え 蹂닿린"
      >
        <Arrow size={Math.max(ui.memoTabFontPx, 12)} />
      </PlainButton>

      <PlainButton
        onClick={onAddDoc}
        style={getToolbarButtonStyle(ui)}
        ariaLabel="??硫붾え 異붽?"
      >
        <span style={{ fontSize: Math.max(ui.memoTabFontPx, 12), lineHeight: 1 }}>+</span>
      </PlainButton>
      </div>
    </div>
  );
}

function IntegratedMemoEditor({
  ui,
  groups,
  integratedSelection,
  onIntegratedSelectionChange,
  preferredDocTarget,
  onPreferredDocHandled,
  onSaveMemoState,
  memoTextareaStyle,
  rightTextareaRef,
  onFocus,
  onScroll,
  placeholder
}) {
  const normalizedGroups = useMemo(
    () =>
      (groups || []).map((group) => ({
        ...group,
        docs: buildSafeDocs(group?.docs),
        activeDocId: typeof group?.activeDocId === "string" ? group.activeDocId : null
      })),
    [groups]
  );
  const [groupsWithDocs, setGroupsWithDocs] = useState(normalizedGroups);

  const [renameDocId, setRenameDocId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const renameInputRef = useRef(null);
  const groupMenuRef = useRef(null);
  const selectedWindowId =
    typeof integratedSelection?.selectedWindowId === "string" ? integratedSelection.selectedWindowId : null;
  const selectedDocIds =
    integratedSelection?.selectedDocIds && typeof integratedSelection.selectedDocIds === "object"
      ? integratedSelection.selectedDocIds
      : {};

  useEffect(() => {
    setGroupsWithDocs(normalizedGroups);
  }, [normalizedGroups]);

  const resolvedWindowId = useMemo(() => {
    if (groupsWithDocs.some((group) => group.windowId === selectedWindowId)) {
      return selectedWindowId;
    }
    return groupsWithDocs[0]?.windowId || null;
  }, [groupsWithDocs, selectedWindowId]);

  useEffect(() => {
    if (!preferredDocTarget) return;
    const rafId = requestAnimationFrame(() => {
      onIntegratedSelectionChange?.((prev) => ({
        selectedWindowId: preferredDocTarget.windowId,
        selectedDocIds: {
          ...(prev?.selectedDocIds || {}),
          [preferredDocTarget.windowId]: preferredDocTarget.docId
        }
      }));
      onPreferredDocHandled?.();
    });
    return () => cancelAnimationFrame(rafId);
  }, [onIntegratedSelectionChange, onPreferredDocHandled, preferredDocTarget]);

  useEffect(() => {
    if (!groupMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      const menu = groupMenuRef.current;
      if (menu && menu.contains(event.target)) return;
      setGroupMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [groupMenuOpen]);

  const currentGroup = useMemo(
    () => groupsWithDocs.find((group) => group.windowId === resolvedWindowId) || groupsWithDocs[0] || null,
    [groupsWithDocs, resolvedWindowId]
  );
  const currentDocs = useMemo(() => currentGroup?.docs || [], [currentGroup]);
  const desiredDocId = currentGroup
    ? selectedDocIds[currentGroup.windowId] || currentGroup.activeDocId || null
    : null;
  const activeIndex = Math.max(
    0,
    currentDocs.findIndex((doc) => doc.id === desiredDocId)
  );
  const activeDoc = currentDocs[activeIndex] || currentDocs[0] || createRightMemoDoc();

  const commitDocs = useCallback(
    (windowId, nextDocs, nextActiveIndex) => {
      const safeDocs = buildSafeDocs(nextDocs);
      const safeActiveIndex = Math.max(0, Math.min(nextActiveIndex ?? 0, safeDocs.length - 1));
      const activeDocId = safeDocs[safeActiveIndex]?.id ?? safeDocs[0]?.id ?? null;
      setGroupsWithDocs((prev) =>
        prev.map((group) =>
          group.windowId === windowId
            ? {
                ...group,
                docs: safeDocs,
                activeDocId
              }
            : group
        )
      );
      onIntegratedSelectionChange?.((prev) => ({
        selectedWindowId: prev?.selectedWindowId ?? windowId,
        selectedDocIds: {
          ...(prev?.selectedDocIds || {}),
          [windowId]: activeDocId
        }
      }));
      onSaveMemoState?.(windowId, {
        docs: safeDocs,
        activeDocId
      });
    },
    [onIntegratedSelectionChange, onSaveMemoState]
  );

  const finishRename = useCallback(
    (docId) => {
      if (!docId || !currentGroup) return;
      const nextTitle = (renameDraft || "").trim() || DEFAULT_RIGHT_MEMO_DOC_TITLE;
      const nextDocs = currentDocs.map((doc) =>
        doc.id === docId ? { ...doc, title: nextTitle } : doc
      );
      commitDocs(currentGroup.windowId, nextDocs, activeIndex);
      setRenameDocId(null);
      setRenameDraft("");
    },
    [activeIndex, commitDocs, currentDocs, currentGroup, renameDraft]
  );

  const effectiveRenameDocId =
    renameDocId && currentDocs.some((doc) => doc.id === renameDocId) ? renameDocId : null;

  useEffect(() => {
    if (!effectiveRenameDocId) return undefined;
    const handlePointerDown = (event) => {
      const input = renameInputRef.current;
      if (input && input.contains(event.target)) return;
      finishRename(effectiveRenameDocId);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [effectiveRenameDocId, finishRename]);

  const selectorButton = (
    <PlainButton
      onClick={() => setGroupMenuOpen((prev) => !prev)}
      style={getSelectorButtonStyle(ui)}
      ariaLabel="메모 탭 선택"
    >
      <span
        aria-hidden="true"
        style={{
          width: 12,
          height: 12,
          borderRadius: 999,
          background: currentGroup?.color || ui.palette.brand,
          flexShrink: 0
        }}
      />
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {currentGroup?.title || "메모"}
      </span>
      <span
        aria-hidden="true"
        style={{
          fontSize: Math.max(ui.memoTabFontPx, 12),
          lineHeight: 1,
          color: ui.palette.subtleText,
          transform: groupMenuOpen ? "rotate(180deg)" : "none",
          transition: "transform 140ms ease"
        }}
      >
        ▾
      </span>
    </PlainButton>
  );

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        fontSize: ui.memoTabFontPx,
        lineHeight: ui.memoLineHeight
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          minHeight: 40,
          padding: "3px 16px 0 16px"
        }}
      >
        <div style={{ position: "relative" }} ref={groupMenuRef}>
          {selectorButton}
          {groupMenuOpen ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                left: 0,
                zIndex: 30,
                minWidth: 220,
                maxHeight: 280,
                overflowY: "auto",
                borderRadius: 14,
                border: `1px solid ${ui.palette.line}`,
                background: ui.palette.panel,
                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.14)",
                padding: 8
              }}
            >
              {groupsWithDocs.map((group) => {
                const active = group.windowId === currentGroup?.windowId;
                return (
                  <PlainButton
                    key={group.windowId}
                    onClick={() => {
                      onIntegratedSelectionChange?.((prev) => ({
                        selectedWindowId: group.windowId,
                        selectedDocIds: prev?.selectedDocIds || {}
                      }));
                      setGroupMenuOpen(false);
                    }}
                    style={{
                      width: "100%",
                      height: 40,
                      padding: "0 12px",
                      borderRadius: 6,
                      border: "none",
                      background: active ? ui.palette.brandSoft : "transparent",
                      color: ui.palette.text,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      cursor: "pointer",
                      outline: "none",
                      boxShadow: "none",
                      fontSize: ui.memoTabFontPx,
                      lineHeight: ui.memoLineHeight,
                      fontWeight: active ? 700 : 600
                    }}
                    ariaLabel={`${group.title} 메모`}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: group.color || ui.palette.brand,
                          flexShrink: 0
                        }}
                      />
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {group.title}
                      </span>
                    </span>
                    {active ? <span style={{ color: ui.palette.brand, fontWeight: 800 }}>✓</span> : null}
                  </PlainButton>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {currentGroup ? (
        <>
          <TabsChrome
            ui={ui}
            docs={currentDocs}
            activeDocId={activeDoc.id}
            renameDocId={effectiveRenameDocId}
            renameDraft={renameDraft}
            setRenameDraft={setRenameDraft}
            renameInputRef={renameInputRef}
            onRenameStart={(docId, currentTitle) => {
              setRenameDocId(docId);
              setRenameDraft(currentTitle);
            }}
            onRenameCommit={finishRename}
            onRenameCancel={() => {
              setRenameDocId(null);
              setRenameDraft("");
            }}
            onSelectDoc={(docId) =>
              commitDocs(
                currentGroup.windowId,
                currentDocs,
                currentDocs.findIndex((doc) => doc.id === docId)
              )
            }
            onDeleteDoc={(docId) => {
              const docIndex = currentDocs.findIndex((doc) => doc.id === docId);
              if (docIndex < 0 || !canDeleteMemoDoc(docIndex)) return;
              const nextDocs = currentDocs.filter((doc) => doc.id !== docId);
              const nextActiveIndex = docIndex < activeIndex ? activeIndex - 1 : activeIndex;
              commitDocs(currentGroup.windowId, nextDocs, nextActiveIndex);
            }}
            onAddDoc={() => {
              const nextDoc = createRightMemoDoc({ title: getNextRightMemoDocTitle(currentDocs), content: "" });
              const nextDocs = [...currentDocs, nextDoc];
              commitDocs(currentGroup.windowId, nextDocs, nextDocs.length - 1);
            }}
          />

          <div style={{ flex: 1, minHeight: 0, padding: "18px 18px 20px 18px" }}>
            <textarea
              className="memo-input"
              ref={rightTextareaRef}
              value={activeDoc.content || ""}
              onChange={(e) => {
                const nextDocs = currentDocs.map((doc, index) =>
                  index === activeIndex ? { ...doc, content: e.target.value } : doc
                );
                commitDocs(currentGroup.windowId, nextDocs, activeIndex);
              }}
              onFocus={onFocus}
              onScroll={onScroll}
              placeholder={placeholder ?? "이 메모장에 쓰고 싶은 내용을 자유롭게 적어보세요."}
              spellCheck={false}
              style={getTextareaStyle(memoTextareaStyle, ui)}
            />
          </div>
        </>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            color: ui.palette.subtleText,
            fontSize: Math.max(14, ui.memoBodyFontPx - 1),
            lineHeight: 1.55,
            fontWeight: 500,
            padding: "18px 18px 0 18px",
            textAlign: "left"
          }}
        >
          <div style={{ maxWidth: 320 }}>
            + 버튼을 눌러 나만의 카테고리를 만들고 메모장을 활성화해보세요.
          </div>
        </div>
      )}
    </div>
  );
}

export default function RightMemoEditor({
  memoTextareaStyle,
  rightTextareaRef,
  rightMemoText,
  setRightMemoText,
  activeWindowId,
  allMemoGroups = [],
  integratedSelection,
  onIntegratedSelectionChange,
  onSaveMemoState,
  preferredDocTarget,
  onPreferredDocHandled,
  onFocus,
  onScroll,
  placeholder,
  ui
}) {
  const safeUi = useMemo(() => mergeUi(ui), [ui]);
  const isIntegrated = activeWindowId === "all";

  const docsState = useMemo(
    () => (isIntegrated ? null : normalizeRightMemoDocState(rightMemoText)),
    [isIntegrated, rightMemoText]
  );
  const docs = useMemo(() => (docsState ? buildSafeDocs(docsState.docs) : []), [docsState]);
  const activeDocId =
    typeof docsState?.activeDocId === "string" && docs.some((doc) => doc.id === docsState.activeDocId)
      ? docsState.activeDocId
      : docs[0]?.id || null;
  const activeIndex = Math.max(
    0,
    docs.findIndex((doc) => doc.id === activeDocId)
  );
  const activeDoc = docs[activeIndex] || docs[0] || createRightMemoDoc();
  const [renameDocId, setRenameDocId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef(null);

  const commitDocs = useCallback(
    (nextDocs, nextActiveIndex, options = {}) => {
      const safeDocs = buildSafeDocs(nextDocs);
      const safeActiveIndex = Math.max(0, Math.min(nextActiveIndex ?? 0, safeDocs.length - 1));
      const activeDocId = safeDocs[safeActiveIndex]?.id ?? safeDocs[0]?.id ?? null;
      const nextRaw = serializeRightMemoDocState({
        docs: safeDocs,
        activeDocId
      });
      setRightMemoText(nextRaw);
      if (options.persistImmediately) {
        onSaveMemoState?.(activeWindowId, {
          docs: safeDocs,
          activeDocId
        });
      }
    },
    [activeWindowId, onSaveMemoState, setRightMemoText]
  );

  useEffect(() => {
    if (isIntegrated || !preferredDocTarget || preferredDocTarget.windowId !== activeWindowId) return;
    const nextIndex = docs.findIndex((doc) => doc.id === preferredDocTarget.docId);
    if (nextIndex >= 0 && docs[nextIndex]?.id !== activeDoc.id) {
      commitDocs(docs, nextIndex);
    }
    onPreferredDocHandled?.();
  }, [
    activeDoc.id,
    activeWindowId,
    commitDocs,
    docs,
    isIntegrated,
    onPreferredDocHandled,
    preferredDocTarget
  ]);

  const finishRename = useCallback(
    (docId) => {
      if (!docId) return;
      const nextTitle = (renameDraft || "").trim() || DEFAULT_RIGHT_MEMO_DOC_TITLE;
      const nextDocs = docs.map((doc) =>
        doc.id === docId ? { ...doc, title: nextTitle } : doc
      );
      commitDocs(nextDocs, activeIndex, { persistImmediately: true });
      setRenameDocId(null);
      setRenameDraft("");
    },
    [activeIndex, commitDocs, docs, renameDraft]
  );

  const effectiveRenameDocId =
    renameDocId && docs.some((doc) => doc.id === renameDocId) ? renameDocId : null;

  useEffect(() => {
    if (!effectiveRenameDocId) return undefined;
    const handlePointerDown = (event) => {
      const input = renameInputRef.current;
      if (input && input.contains(event.target)) return;
      finishRename(effectiveRenameDocId);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [effectiveRenameDocId, finishRename]);

  if (isIntegrated) {
    return (
      <IntegratedMemoEditor
        ui={safeUi}
        groups={allMemoGroups}
        integratedSelection={integratedSelection}
        onIntegratedSelectionChange={onIntegratedSelectionChange}
        preferredDocTarget={preferredDocTarget}
        onPreferredDocHandled={onPreferredDocHandled}
        onSaveMemoState={onSaveMemoState}
        memoTextareaStyle={memoTextareaStyle}
        rightTextareaRef={rightTextareaRef}
        onFocus={onFocus}
        onScroll={onScroll}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        fontSize: safeUi.memoBodyFontPx,
        lineHeight: safeUi.memoLineHeight
      }}
    >
      <TabsChrome
        ui={safeUi}
        docs={docs}
        activeDocId={activeDoc.id}
        renameDocId={effectiveRenameDocId}
        renameDraft={renameDraft}
        setRenameDraft={setRenameDraft}
        renameInputRef={renameInputRef}
        onRenameStart={(docId, currentTitle) => {
          setRenameDocId(docId);
          setRenameDraft(currentTitle);
        }}
        onRenameCommit={finishRename}
        onRenameCancel={() => {
          setRenameDocId(null);
          setRenameDraft("");
        }}
        onSelectDoc={(docId) => {
          const nextIndex = docs.findIndex((doc) => doc.id === docId);
          if (nextIndex >= 0) commitDocs(docs, nextIndex, { persistImmediately: true });
        }}
        onDeleteDoc={(docId) => {
          const docIndex = docs.findIndex((doc) => doc.id === docId);
          if (docIndex < 0 || !canDeleteMemoDoc(docIndex)) return;
          const nextDocs = docs.filter((doc) => doc.id !== docId);
          const nextActiveIndex = docIndex < activeIndex ? activeIndex - 1 : activeIndex;
          commitDocs(nextDocs, nextActiveIndex, { persistImmediately: true });
        }}
        onAddDoc={() => {
          const nextDoc = createRightMemoDoc({ title: getNextRightMemoDocTitle(docs), content: "" });
          const nextDocs = [...docs, nextDoc];
          commitDocs(nextDocs, nextDocs.length - 1, { persistImmediately: true });
        }}
      />

      <div style={{ flex: 1, minHeight: 0, padding: "18px 18px 20px 18px" }}>
        <textarea
          className="memo-input"
          ref={rightTextareaRef}
          value={activeDoc.content || ""}
          onChange={(e) => {
            const nextDocs = docs.map((doc, index) =>
              index === activeIndex ? { ...doc, content: e.target.value } : doc
            );
            commitDocs(nextDocs, activeIndex);
          }}
          onFocus={onFocus}
          onScroll={onScroll}
          placeholder={placeholder ?? "이 메모장에 쓰고 싶은 내용을 자유롭게 적어보세요."}
          spellCheck={false}
          style={getTextareaStyle(memoTextareaStyle, safeUi)}
        />
      </div>
    </div>
  );
}

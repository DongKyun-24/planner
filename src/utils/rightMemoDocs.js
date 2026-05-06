export const DEFAULT_RIGHT_MEMO_DOC_TITLE = "기본 메모";
const UNTITLED_RIGHT_MEMO_DOC_TITLE = "새 메모";

function genRightMemoDocId() {
  try {
    if (globalThis.crypto?.randomUUID) {
      return `rmd-${globalThis.crypto.randomUUID()}`;
    }
  } catch (err) {
    void err;
  }
  return `rmd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildUntitledRightMemoDocTitle(sequence = 1) {
  const nextSequence = Number(sequence);
  if (!Number.isFinite(nextSequence) || nextSequence <= 1) return UNTITLED_RIGHT_MEMO_DOC_TITLE;
  return `${UNTITLED_RIGHT_MEMO_DOC_TITLE} ${Math.floor(nextSequence)}`;
}

function parseUntitledRightMemoDocSequence(title) {
  const trimmed = String(title ?? "").trim();
  if (!trimmed) return null;
  if (trimmed === UNTITLED_RIGHT_MEMO_DOC_TITLE) return 1;
  let match = trimmed.match(/^새 메모\s+(\d+)$/);
  if (match) {
    const sequence = Number(match[1] ?? NaN);
    return Number.isFinite(sequence) && sequence >= 2 ? sequence : 1;
  }
  match = trimmed.match(/^메모\s+(\d+)$/);
  if (match) {
    const sequence = Number(match[1] ?? NaN);
    return Number.isFinite(sequence) && sequence >= 2 ? sequence : 2;
  }
  return null;
}

function getFallbackTitle(index = 0) {
  return index === 0 ? DEFAULT_RIGHT_MEMO_DOC_TITLE : buildUntitledRightMemoDocTitle(index);
}

function normalizeTitle(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function getRightMemoDocDisplayTitle(title, index = 0) {
  const next = String(title ?? "").trim();
  return next || getFallbackTitle(index);
}

function normalizeDoc(doc, index = 0) {
  return {
    id: typeof doc?.id === "string" && doc.id.trim() ? doc.id : genRightMemoDocId(),
    title: normalizeTitle(doc?.title, getFallbackTitle(index)),
    content: String(doc?.content ?? "")
  };
}

function parseLegacyCombinedText(rawContent) {
  const raw = String(rawContent ?? "");
  const lines = raw.split("\n");
  const docs = [];
  const leadingLines = [];
  let currentTitle = null;
  let currentLines = [];

  const pushCurrent = () => {
    if (!currentTitle) return;
    docs.push({
      id: genRightMemoDocId(),
      title: currentTitle,
      content: currentLines.join("\n").trimEnd()
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const match =
      trimmed.match(/^《\s*(.+?)\s*》$/) ||
      trimmed.match(/^〈\s*(.+?)\s*〉$/) ||
      trimmed.match(/^<\s*(.+?)\s*>$/);

    if (match) {
      pushCurrent();
      currentTitle = String(match[1] ?? "").trim() || UNTITLED_RIGHT_MEMO_DOC_TITLE;
      currentLines = [];
      continue;
    }

    if (currentTitle) {
      currentLines.push(line);
    } else {
      leadingLines.push(line);
    }
  }

  pushCurrent();

  const leadingContent = leadingLines.join("\n").trim();
  if (leadingContent) {
    docs.unshift({
      id: genRightMemoDocId(),
      title: DEFAULT_RIGHT_MEMO_DOC_TITLE,
      content: leadingLines.join("\n").trimEnd()
    });
  }

  return docs.length ? docs : null;
}

export function normalizeRightMemoDocState(rawContent) {
  const raw = String(rawContent ?? "");

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.docs)) {
      const docs = parsed.docs.map((doc, index) => normalizeDoc(doc, index));
      const safeDocs = docs.length > 0 ? docs : [normalizeDoc({}, 0)];
      const activeDocId =
        typeof parsed.activeDocId === "string" &&
        safeDocs.some((doc) => doc.id === parsed.activeDocId)
          ? parsed.activeDocId
          : safeDocs[0].id;

      return {
        docs: safeDocs,
        activeDocId
      };
    }
  } catch (err) {
    void err;
  }

  const legacyDocs = parseLegacyCombinedText(raw);
  if (legacyDocs) {
    const normalizedDocs = legacyDocs.map((doc, index) => normalizeDoc(doc, index));
    return {
      docs: normalizedDocs,
      activeDocId: normalizedDocs[0]?.id ?? null
    };
  }

  return {
    docs: [normalizeDoc({ title: DEFAULT_RIGHT_MEMO_DOC_TITLE, content: raw }, 0)],
    activeDocId: null
  };
}

export function serializeRightMemoDocState(state) {
  const docs =
    Array.isArray(state?.docs) && state.docs.length > 0
      ? state.docs.map((doc, index) => normalizeDoc(doc, index))
      : [normalizeDoc({}, 0)];

  const activeDocId =
    typeof state?.activeDocId === "string" && docs.some((doc) => doc.id === state.activeDocId)
      ? state.activeDocId
      : docs[0].id;

  return JSON.stringify({
    version: 1,
    activeDocId,
    docs: docs.map((doc) => ({
      id: doc.id,
      title: normalizeTitle(doc.title),
      content: String(doc.content ?? "")
    }))
  });
}

export function createRightMemoDoc(input = {}) {
  if (typeof input === "string") {
    return {
      id: genRightMemoDocId(),
      title: normalizeTitle(input, UNTITLED_RIGHT_MEMO_DOC_TITLE),
      content: ""
    };
  }

  return {
    id: genRightMemoDocId(),
    title: normalizeTitle(input?.title, UNTITLED_RIGHT_MEMO_DOC_TITLE),
    content: String(input?.content ?? "")
  };
}

export function getNextRightMemoDocTitle(docs) {
  const used = new Set(
    (Array.isArray(docs) ? docs : [])
      .map((doc, index) => parseUntitledRightMemoDocSequence(getRightMemoDocDisplayTitle(doc?.title, index)))
      .filter((value) => value != null)
  );
  if (!used.has(1)) return buildUntitledRightMemoDocTitle(1);
  let n = 2;
  while (used.has(n)) n += 1;
  return buildUntitledRightMemoDocTitle(n);
}

export function hasPersistableRightMemoState(rawContent) {
  const state = normalizeRightMemoDocState(rawContent);
  const docs = Array.isArray(state?.docs) && state.docs.length > 0
    ? state.docs.map((doc, index) => normalizeDoc(doc, index))
    : [normalizeDoc({}, 0)];

  if (docs.length > 1) return true;

  const firstDoc = docs[0];
  if (!firstDoc) return false;
  if (String(firstDoc.content ?? "").trim()) return true;

  const title = String(firstDoc.title ?? "").trim();
  return title !== "" && title !== getFallbackTitle(0);
}

export function buildRightMemoCombinedText(rawContent) {
  const state = normalizeRightMemoDocState(rawContent);
  const docsWithContent = state.docs.filter((doc) => String(doc.content ?? "").trim() !== "");

  if (docsWithContent.length === 0) return "";

  if (
    docsWithContent.length === 1 &&
    getRightMemoDocDisplayTitle(docsWithContent[0].title, 0) === DEFAULT_RIGHT_MEMO_DOC_TITLE
  ) {
    return String(docsWithContent[0].content ?? "").trimEnd();
  }

  const lines = [];
  for (const [index, doc] of docsWithContent.entries()) {
    if (index > 0) lines.push("");
    lines.push(`《${getRightMemoDocDisplayTitle(doc.title, index)}》`);
    lines.push(...String(doc.content ?? "").split("\n"));
  }
  return lines.join("\n").trimEnd();
}

import katex from "katex";
import { useMemo } from "react";
import type { BoardItem } from "../../core/types";

// The tutor's board. Math lines are KaTeX; a highlighted term inside a math
// line is wrapped in \htmlClass{hl}{…}. If that breaks the LaTeX (the term
// spanned a brace, say) the whole line is highlighted instead.

const KATEX_OPTS = {
  throwOnError: true,
  strict: false,
  // Only our own highlight class: LLM-written LaTeX must not be able to borrow other app classes.
  trust: (ctx: { command: string; class?: string }) => ctx.command === "\\htmlClass" && ctx.class === "hl",
} as const;

function renderMath(content: string, term?: string): { html: string; lineHighlight: boolean } {
  if (term) {
    const i = content.indexOf(term);
    if (i >= 0) {
      const wrapped = `${content.slice(0, i)}\\htmlClass{hl}{${term}}${content.slice(i + term.length)}`;
      try {
        return { html: katex.renderToString(wrapped, KATEX_OPTS), lineHighlight: false };
      } catch {
        // fall through to whole-line highlight
      }
    }
  }
  try {
    return { html: katex.renderToString(content, KATEX_OPTS), lineHighlight: !!term };
  } catch {
    return { html: escapeHtml(content), lineHighlight: !!term };
  }
}

function renderText(content: string, term?: string) {
  if (!term) return <>{content}</>;
  const i = content.indexOf(term);
  if (i < 0) return <>{content}</>;
  return (
    <>
      {content.slice(0, i)}
      <mark className="hl">{term}</mark>
      {content.slice(i + term.length)}
    </>
  );
}

function Line({ item }: { item: BoardItem }) {
  const term = item.highlight?.term;
  const highlighted = !!item.highlight;
  const math = useMemo(() => (item.kind === "math" ? renderMath(item.content, term) : null), [item.kind, item.content, term]);
  const lineHl = highlighted && (item.kind === "math" ? math!.lineHighlight || !term : !term || !item.content.includes(term));
  const cls = ["board-line", `board-${item.kind}`, item.id === "title" ? "board-title" : "", item.id.startsWith("q_") ? "board-question" : "", item.id.startsWith("why_") ? "board-why" : "", item.id === "why_title" ? "board-why-title" : "", lineHl ? "line-hl" : ""]
    .filter(Boolean)
    .join(" ");

  return math ? (
    <div className={cls} dangerouslySetInnerHTML={{ __html: math.html }} />
  ) : (
    <div className={cls}>{renderText(item.content, term)}</div>
  );
}

export function Whiteboard({ items }: { items: BoardItem[] }) {
  return (
    <section className="board" aria-label="Whiteboard" aria-live="polite">
      {items.length === 0 ? <div className="board-empty">The tutor will write here.</div> : items.map((it) => <Line key={it.id + it.content} item={it} />)}
    </section>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

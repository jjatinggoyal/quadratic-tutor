import type { BoardItem, BoardOp } from "./types";

export const MAX_BOARD_ITEMS = 10;
export const QUESTION_IDS = { text: "q_text", math: "q_math" } as const;

const isQuestion = (i: BoardItem) => i.id === QUESTION_IDS.text || i.id === QUESTION_IDS.math;
const isPinned = (i: BoardItem) => isQuestion(i) || i.id === "title";

/**
 * Apply ops to a board. Highlights last one turn: they are cleared before the
 * new ops are applied, so the highlight always matches what the tutor is
 * saying right now. Invalid ops are dropped and reported, never thrown.
 */
export function applyBoardOps(board: BoardItem[], ops: BoardOp[]): { board: BoardItem[]; applied: BoardOp[]; dropped: string[] } {
  let items = board.map(({ highlight: _h, ...rest }) => rest as BoardItem);
  const applied: BoardOp[] = [];
  const dropped: string[] = [];

  for (const op of ops) {
    if (op.op === "clear") {
      items = [];
      applied.push(op);
    } else if (op.op === "remove") {
      items = items.filter((i) => i.id !== op.id);
      applied.push(op);
    } else if (op.op === "write") {
      const idx = items.findIndex((i) => i.id === op.id);
      const item: BoardItem = { id: op.id, kind: op.kind, content: op.content };
      if (idx >= 0) items[idx] = item;
      else items.push(item);
      applied.push(op);
    } else {
      const item = items.find((i) => i.id === op.id);
      if (!item) {
        dropped.push(`highlight: unknown id "${op.id}"`);
        continue;
      }
      const term = op.term && item.content.includes(op.term) ? op.term : undefined;
      if (op.term && !term) dropped.push(`highlight: term "${op.term}" not in "${op.id}", highlighting whole line`);
      item.highlight = { term };
      applied.push({ op: "highlight", id: op.id, ...(term ? { term } : {}) });
    }
  }

  // The pending question always sits at the bottom of the board.
  items = [...items.filter((i) => !isQuestion(i)), ...items.filter(isQuestion)];

  // Keep the board readable: drop the oldest unpinned lines beyond the cap.
  while (items.length > MAX_BOARD_ITEMS) {
    const oldest = items.findIndex((i) => !isPinned(i));
    if (oldest < 0) break;
    items.splice(oldest, 1);
  }
  return { board: items, applied, dropped };
}

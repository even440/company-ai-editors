/**
 * 目录要用的标题，和「设成标题」时按行拆开（不依赖页面，tools/check-doc.mjs 在 Node 里测）。
 *
 * 标题里的软换行（用户 2026-11-25 截图：「1、收银台优惠」「2、门店要货」「3、员工交通补贴」都设成了标题 1，左边目录只有两条，第一条是「1、收银台优惠2、门店要货」）：
 * 前两行在同一段里，中间是软换行（Shift+Enter，或者粘贴进来的 <br>），设标题时整段变成了一个标题。正文里看着是两个标题，目录只认一个，文字还连在一起。
 * - 以后设标题（工具栏的段落样式）时先按软换行拆成几段，每行各是一个标题（setHeadingLines）；空行、只有空格的行不单独成标题。
 * - 已经是这样的标题，目录里按行列出来（tocOf），点第二行跳到第二行。链接弹窗里还是一个标题一项（lines = false，行之间用空格隔开），链的是整个标题
 */
import type { Node as PmNode, NodeType } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

/** pos 是标题这一块的位置；at 是跳过去、算当前一节时看的位置：第一行就是 pos，后面的行是那一行开头的字 */
export interface TocItem { pos: number; at: number; level: number; text: string; key: string }

const isBreak = (n: PmNode) => n.type.name === 'hardBreak';
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 标题按软换行分成的行：有字的行，第一行的位置是标题本身；一行字都没有时是一个空行 */
function linesOf(node: PmNode, pos: number): { text: string; at: number }[] {
  const raw: { text: string; at: number }[] = [];
  let text = '', at = pos;
  node.forEach((c, off) => {
    if (isBreak(c)) { raw.push({ text, at }); text = ''; at = pos + 1 + off + c.nodeSize; } else text += c.textContent;
  });
  raw.push({ text, at });
  const lines = raw.map((l) => ({ text: tidy(l.text), at: l.at })).filter((l) => l.text);
  return lines.length ? [{ text: lines[0].text, at: pos }, ...lines.slice(1)] : [{ text: '', at: pos }];
}

/**
 * 正文的目录：顶层的一到六级标题。key 由级别、文字和同名的第几个组成，编辑时收起状态不乱。
 * lines：标题里有软换行时每行一项（目录）；false 时一个标题一项，行之间用空格隔开（链接弹窗）
 */
export function tocOf(doc: PmNode, lines = true): TocItem[] {
  const out: TocItem[] = [], seen = new Map<string, number>();
  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return;
    const level = Math.min(6, Math.max(1, Number(node.attrs.level) || 1));
    const parts = lines ? linesOf(node, offset) : [{ text: linesOf(node, offset).map((l) => l.text).join(' '), at: offset }];
    for (const { text, at } of parts) {
      const base = `${level}:${text}`, n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      out.push({ pos: offset, at, level, text, key: `${base}#${n}` });
    }
  });
  return out;
}

/** 一段里的软换行从后往前拿掉：两边都有字的在那里拆成两段（后一段不带书签），一边没字的直接删掉（不留空标题） */
function splitBreaks(tr: Transaction, pos: number): void {
  const marks: number[] = [];
  tr.doc.nodeAt(pos)?.forEach((c, off) => { if (isBreak(c)) marks.push(pos + 1 + off); });
  for (let i = marks.length - 1; i >= 0; i--) {
    const node = tr.doc.nodeAt(pos)!, p = marks[i], idx = tr.doc.resolve(p).index();
    // 后面的软换行已经处理过了，这一个后面直到段尾都是同一行
    let before = '', after = '';
    for (let j = idx - 1; j >= 0 && !isBreak(node.child(j)); j--) before += node.child(j).textContent;
    for (let j = idx + 1; j < node.childCount; j++) after += node.child(j).textContent;
    tr.delete(p, p + 1);
    if (before.trim() && after.trim()) tr.split(p, 1, [{ type: node.type, attrs: { ...node.attrs, anchor: null } }]);
  }
}

/**
 * 把选区里的段落、标题设成 level 级标题，有软换行的先按行拆开，每行一个标题（对齐、行距这些留着，书签只留在第一行）。
 * 选区里有不能直接换成标题的块（列表项的第一段：Tiptap 的 setHeading 会先把它挪出列表）时什么也不做、返回 false，调用方照旧用 setHeading
 */
export function setHeadingLines(tr: Transaction, heading: NodeType, level: number): boolean {
  const found = new Map<number, number>();
  for (const r of tr.selection.ranges) {
    tr.doc.nodesBetween(r.$from.pos, r.$to.pos, (node, pos) => {
      if (!node.isTextblock) return true;
      found.set(pos, pos + node.nodeSize);
      return false;
    });
  }
  const blocks = [...found].sort((a, b) => a[0] - b[0]);
  if (!blocks.length) return false;
  for (const [pos] of blocks) {
    const $p = tr.doc.resolve(pos);
    if (!$p.parent.canReplaceWith($p.index(), $p.index() + 1, heading)) return false;
  }
  const start = tr.steps.length;
  for (let i = blocks.length - 1; i >= 0; i--) splitBreaks(tr, blocks[i][0]);
  const map = tr.mapping.slice(start);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const [from, to] = blocks[i];
    tr.setBlockType(map.map(from, 1), map.map(to, -1), heading, (node) => ({ ...node.attrs, level }));
  }
  return true;
}

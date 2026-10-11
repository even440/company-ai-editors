/** 文档结构（Tiptap JSON）的公共处理：拼结构、取纯文本。和平台 src/features/docs/content.ts 里的同名函数一致 */

export interface DocNode { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; marks?: { type: string; attrs?: Record<string, unknown> }[]; text?: string }

/* ---------- 拼结构 ---------- */

export const text = (t: string): DocNode => ({ type: 'text', text: t });
export const p = (t = ''): DocNode => (t ? { type: 'paragraph', content: [text(t)] } : { type: 'paragraph' });
export const h = (t: string, level = 2): DocNode => ({ type: 'heading', attrs: { level }, ...(t ? { content: [text(t)] } : {}) });
export const ul = (items: string[]): DocNode => ({ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [p(t)] })) });
export const doc = (...blocks: DocNode[]): DocNode => ({ type: 'doc', content: blocks.length ? blocks : [p()] });

/** 宿主给的 content 是不是一份文档；空内容（{}）和别的东西都按空白文档处理 */
export const isDoc = (v: unknown): v is DocNode => !!v && typeof v === 'object' && (v as DocNode).type === 'doc' && Array.isArray((v as DocNode).content);
export const contentOf = (v: unknown): DocNode => (isDoc(v) && v.content!.length ? v : doc());

/* ---------- 纯文本 ---------- */

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);
const inline = (n: DocNode): string => (n.type === 'text' ? n.text ?? '' : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(inline).join(''));

/** 每个段落、标题、列表项一行；表格一行一行，单元格之间用竖线隔开。用于搜索和交给 AI */
export function plainOf(node: DocNode): string {
  const lines: string[] = [];
  const walk = (n: DocNode) => {
    if (n.type === 'tableRow') { lines.push((n.content ?? []).map((c) => plainOf(c).replace(/\n+/g, ' ')).join(' | ')); return; }
    if (TEXT_BLOCKS.has(n.type)) { const t = inline(n).trim(); if (t) lines.push(t); return; }
    for (const c of n.content ?? []) walk(c);
  };
  walk(node);
  return lines.join('\n');
}

/** 把一段文字按行拆成段落节点（宿主 insert 消息、导入 txt 时用），和平台里一致 */
export const paragraphsOf = (t: string): DocNode[] => t.split(/\r?\n+/).map((x) => x.trim()).filter(Boolean).map((x) => p(x));

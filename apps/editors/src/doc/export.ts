/**
 * 导出：把 Tiptap JSON 转成 Word（docx 库）和 Markdown。PDF 走浏览器打印，不在这里。
 * 只处理本格式里会出现的节点：标题、段落、列表、引用、代码块、分隔线、表格、图片，以及加粗、斜体、删除线、代码和链接。
 * 书签（块的 anchor 属性，见 anchors.ts）写成 Word 的书签，# 开头的链接写成文档内链接，导出的 Word 里目录、交叉引用照样能点；
 * Markdown 里书签写成 <a id> 放在那一行前面。
 */
import { AlignmentType, Bookmark, BorderStyle, Document, ExternalHyperlink, HeadingLevel, InternalHyperlink, ImageRun, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, type IParagraphOptions, type ParagraphChild } from 'docx';
import { anchorNames, anchorOfHref, slugOf, validAnchor } from './anchors';
import type { DocNode } from './content';

type Marks = { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; link?: string };
const textOf = (n: DocNode): string => (n.type === 'text' ? n.text ?? '' : (n.content ?? []).map(textOf).join(''));
/** 正文第一块就是和标题一样的一级标题（从 Word 导入的常见情况）：导出时不再重复加标题 */
const startsWithTitle = (json: DocNode, title: string) => { const first = json.content?.[0]; return !!first && first.type === 'heading' && Number(first.attrs?.level ?? 2) === 1 && textOf(first).trim() === title.trim(); };
const marksOf = (n: DocNode): Marks => {
  const m: Marks = {};
  for (const k of n.marks ?? []) {
    if (k.type === 'bold') m.bold = true; else if (k.type === 'italic') m.italic = true; else if (k.type === 'strike') m.strike = true; else if (k.type === 'code') m.code = true;
    else if (k.type === 'link' && typeof k.attrs?.href === 'string') m.link = k.attrs.href;
  }
  return m;
};
const kids = (n: DocNode) => n.content ?? [];

/* ---------- 书签 ---------- */

const ANCHORED = new Set(['heading', 'paragraph', 'listItem']);

/**
 * 每个块要写的书签：块自己的 anchor，加上只按标题对上的链接（# 后面是标题的 GitHub 写法或原文，和 anchors.ts 的 findAnchor 一样）。
 * 用块对象当键，导出时按块查
 */
function anchorPlan(json: DocNode): Map<DocNode, string[]> {
  const plan = new Map<DocNode, string[]>(), own = new Set<string>(), headings: DocNode[] = [], links = new Set<string>();
  const walk = (n: DocNode) => {
    if (ANCHORED.has(n.type)) { const names = anchorNames(n.attrs?.anchor); if (names.length) { plan.set(n, [...names]); names.forEach((x) => own.add(x)); } }
    if (n.type === 'heading') headings.push(n);
    for (const m of n.marks ?? []) if (m.type === 'link') { const a = anchorOfHref(typeof m.attrs?.href === 'string' ? m.attrs.href : null); if (a) links.add(a); }
    (n.content ?? []).forEach(walk);
  };
  walk(json);
  for (const name of links) {
    if (own.has(name) || !validAnchor(name)) continue;
    const h = headings.find((x) => { const t = textOf(x).trim(); return !!t && (t === name || slugOf(t) === name.toLowerCase()); });
    if (h) plan.set(h, [...(plan.get(h) ?? []), name]);
  }
  return plan;
}

/**
 * Word 的书签名有规矩：字母（含汉字）或下划线开头，只有字母、数字、下划线，最长 40 个字；不合规的换一下，同一次导出里链接和书签换成同一个名字。
 * _top 这种 Word 自带的照旧
 */
function wordNames() {
  const map = new Map<string, string>(), used = new Set<string>();
  return (name: string): string => {
    let v = map.get(name);
    if (v) return v;
    let base = name.replace(/[^\p{L}\p{N}_]/gu, '_');
    if (!/^[\p{L}_]/u.test(base)) base = 'B_' + base;
    base = base.slice(0, 40);
    v = base;
    for (let i = 2; used.has(v); i++) v = base.slice(0, 40 - String(i).length - 1) + '_' + i;
    map.set(name, v); used.add(v);
    return v;
  };
}

interface WordCtx { plan: Map<DocNode, string[]>; name: (n: string) => string }
/** 一个块的内容外面包上它的书签（第一个包住整段文字，其余的是空书签） */
function withBookmarks(n: DocNode, children: ParagraphChild[], w: WordCtx, extra: string[] = []): ParagraphChild[] {
  const names = [...new Set([...extra, ...(w.plan.get(n) ?? [])])];
  if (!names.length) return children;
  const [first, ...rest] = names.map(w.name);
  return [...rest.map((id) => new Bookmark({ id, children: [] })), new Bookmark({ id: first, children })];
}

/* ---------- Word ---------- */

const HEADING = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
/** 图片在正文里最多这么宽（像素，docx 按 96dpi 算） */
const MAX_IMG = 600;

function runs(n: DocNode, w: WordCtx, extra: Marks = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const c of kids(n)) {
    if (c.type === 'hardBreak') { out.push(new TextRun({ break: 1 })); continue; }
    if (c.type !== 'text') { out.push(...runs(c, w, extra)); continue; }
    const m = { ...extra, ...marksOf(c) };
    const run = new TextRun({ text: c.text ?? '', bold: m.bold, italics: m.italic, strike: m.strike, font: m.code ? 'Consolas' : undefined, style: m.link ? 'Hyperlink' : undefined });
    const anchor = anchorOfHref(m.link);
    out.push(anchor !== null ? new InternalHyperlink({ anchor: anchor ? w.name(anchor) : '_top', children: [run] }) : m.link ? new ExternalHyperlink({ link: m.link, children: [run] }) : run);
  }
  return out;
}

/** 取图片字节和尺寸；拿不到（跨域、已删除）就返回空，导出时放一行说明代替 */
async function fetchImage(src: string): Promise<{ data: ArrayBuffer; type: 'png' | 'jpg' | 'gif' | 'bmp'; width: number; height: number } | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mime = blob.type.toLowerCase();
    const type = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('gif') ? 'gif' : mime.includes('bmp') ? 'bmp' : mime.includes('png') ? 'png' : null;
    if (!type) return null;
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_IMG / bmp.width);
    const size = { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) };
    bmp.close();
    return { data: await blob.arrayBuffer(), type, ...size };
  } catch { return null; }
}

type Block = Paragraph | Table;

async function blocks(n: DocNode, w: WordCtx, ctx: { list?: 'bullet' | 'number'; level: number; quote?: boolean; carry?: string[] }): Promise<Block[]> {
  const out: Block[] = [];
  const listOpts = (): Partial<IParagraphOptions> => (ctx.list === 'bullet' ? { bullet: { level: ctx.level } } : ctx.list === 'number' ? { numbering: { reference: 'num', level: ctx.level } } : {});
  const quoteOpts = (): Partial<IParagraphOptions> => (ctx.quote ? { indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'C9CFD9', space: 8 } } } : {});
  for (const c of kids(n)) {
    // 列表项的书签放在它的第一段上
    const carry = ctx.carry; if (carry) ctx = { ...ctx, carry: undefined };
    switch (c.type) {
      case 'heading': { const lv = Math.min(6, Math.max(1, Number(c.attrs?.level ?? 2))); out.push(new Paragraph({ heading: HEADING[lv - 1], children: withBookmarks(c, runs(c, w), w, carry) })); break; }
      case 'paragraph': out.push(new Paragraph({ children: withBookmarks(c, runs(c, w, ctx.quote ? { italic: true } : {}), w, carry), ...listOpts(), ...quoteOpts() })); break;
      case 'bulletList': case 'orderedList':
        for (const li of kids(c)) out.push(...await blocks(li, w, { list: c.type === 'bulletList' ? 'bullet' : 'number', level: Math.min(ctx.list ? ctx.level + 1 : 0, 8), carry: w.plan.get(li) }));
        break;
      case 'listItem': out.push(...await blocks(c, w, { ...ctx, carry: w.plan.get(c) })); break;
      case 'blockquote': out.push(...await blocks(c, w, { ...ctx, quote: true })); break;
      case 'codeBlock':
        for (const line of (kids(c).map((t) => t.text ?? '').join('')).split('\n')) out.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', size: 20 })], shading: { fill: 'F4F6FA' } }));
        break;
      case 'horizontalRule': out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C9CFD9' } }, spacing: { after: 120 } })); break;
      case 'image': {
        const img = typeof c.attrs?.src === 'string' ? await fetchImage(c.attrs.src) : null;
        out.push(img ? new Paragraph({ children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: img.width, height: img.height } })] }) : new Paragraph({ children: [new TextRun({ text: `[图片${c.attrs?.alt ? '：' + String(c.attrs.alt) : ''}]`, color: '6F7B8F' })] }));
        break;
      }
      case 'table': {
        const rows: TableRow[] = [];
        for (const r of kids(c)) {
          const cells: TableCell[] = [];
          for (const cell of kids(r)) {
            const inner = await blocks(cell, w, { level: 0 });
            cells.push(new TableCell({ children: inner.length ? inner : [new Paragraph('')], columnSpan: Number(cell.attrs?.colspan) > 1 ? Number(cell.attrs?.colspan) : undefined, shading: cell.type === 'tableHeader' ? { fill: 'F0F3F8' } : undefined }));
          }
          rows.push(new TableRow({ children: cells, tableHeader: kids(r).every((x) => x.type === 'tableHeader') }));
        }
        if (rows.length) out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        break;
      }
      default: if (c.content) out.push(...await blocks(c, w, ctx));
    }
  }
  return out;
}

/** 整篇文档转成 Word 文件。标题放在最上面（宿主负责标题，但导出的文件要带上） */
export async function toDocx(json: DocNode, title: string): Promise<Blob> {
  const body = await blocks(json, { plan: anchorPlan(json), name: wordNames() }, { level: 0 });
  const doc = new Document({
    title,
    creator: 'Company AI',
    numbering: { config: [{ reference: 'num', levels: [0, 1, 2, 3].map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })) }] },
    styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 } } } },
    sections: [{ children: [...(startsWithTitle(json, title) ? [] : [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] })]), ...body] }],
  });
  return Packer.toBlob(doc);
}

/* ---------- Markdown ---------- */

const esc = (t: string) => t.replace(/([*_`[\]\\])/g, '\\$1');
function inlineMd(n: DocNode): string {
  let s = '';
  for (const c of kids(n)) {
    if (c.type === 'hardBreak') { s += '  \n'; continue; }
    if (c.type !== 'text') { s += inlineMd(c); continue; }
    const m = marksOf(c);
    let t = m.code ? '`' + (c.text ?? '') + '`' : esc(c.text ?? '');
    if (m.bold) t = `**${t}**`;
    if (m.italic) t = `*${t}*`;
    if (m.strike) t = `~~${t}~~`;
    if (m.link) t = `[${t}](${m.link})`;
    s += t;
  }
  return s;
}
const cellMd = (cell: DocNode) => kids(cell).map((b) => inlineMd(b)).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** 块的书签在 Markdown 里写成 <a id>，放在这一行前面（多数 Markdown 显示器认它，[x](#书签) 还能跳） */
const anchorMd = (n: DocNode) => anchorNames(n.attrs?.anchor).map((a) => `<a id="${a.replace(/&/g, '&amp;')}"></a>`).join('');

function blockMd(n: DocNode, indent = ''): string[] {
  const out: string[] = [];
  for (const c of kids(n)) {
    switch (c.type) {
      case 'heading': out.push(indent + '#'.repeat(Math.min(6, Math.max(1, Number(c.attrs?.level ?? 2)))) + ' ' + anchorMd(c) + inlineMd(c), ''); break;
      case 'paragraph': out.push(indent + anchorMd(c) + inlineMd(c), ''); break;
      case 'bulletList': case 'orderedList': {
        const start = Number(c.attrs?.start ?? 1);
        kids(c).forEach((li, i) => {
          const marker = c.type === 'bulletList' ? '- ' : `${start + i}. `, pad = ' '.repeat(marker.length);
          const lines = blockMd(li, '');
          while (lines.length && lines[lines.length - 1] === '') lines.pop();
          lines.forEach((l, j) => out.push(indent + (j === 0 ? marker + anchorMd(li) : l ? pad : '') + l));
        });
        out.push('');
        break;
      }
      case 'blockquote': { const lines = blockMd(c); while (lines.length && lines[lines.length - 1] === '') lines.pop(); out.push(...lines.map((l) => indent + '> ' + l), ''); break; }
      case 'codeBlock': out.push(indent + '```' + (typeof c.attrs?.language === 'string' ? c.attrs.language : ''), ...kids(c).map((t) => t.text ?? '').join('').split('\n').map((l) => indent + l), indent + '```', ''); break;
      case 'horizontalRule': out.push(indent + '---', ''); break;
      case 'image': out.push(indent + `![${String(c.attrs?.alt ?? '')}](${String(c.attrs?.src ?? '')})`, ''); break;
      case 'table': {
        const rows = kids(c).map((r) => kids(r).map(cellMd));
        if (!rows.length) break;
        const cols = Math.max(...rows.map((r) => r.length));
        const line = (r: string[]) => indent + '| ' + Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ') + ' |';
        const header = kids(c)[0]?.content?.every((x) => x.type === 'tableHeader');
        const [first, ...rest] = rows;
        // Markdown 表格必须有表头行：第一行不是表头时补一行空表头
        out.push(line(header ? first : Array(cols).fill('')), indent + '|' + ' --- |'.repeat(cols), ...(header ? rest : rows).map(line), '');
        break;
      }
      default: if (c.content) out.push(...blockMd(c, indent));
    }
  }
  return out;
}

export function toMarkdown(json: DocNode, title?: string): string {
  const lines = blockMd(json);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return (title && !startsWithTitle(json, title) ? `# ${title}\n\n` : '') + lines.join('\n') + '\n';
}

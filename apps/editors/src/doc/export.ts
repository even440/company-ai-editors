/**
 * 导出：把 Tiptap JSON 转成 Word（docx 库）和 Markdown。PDF 走浏览器打印，不在这里。
 * 只处理本格式里会出现的节点：标题、段落、列表、引用、代码块、分隔线、表格、图片，以及加粗、斜体、删除线、代码和链接。
 * 书签（块的 anchor 属性，见 anchors.ts）写成 Word 的书签，# 开头的链接写成文档内链接，导出的 Word 里目录、交叉引用照样能点；
 * Markdown 里书签写成 <a id> 放在那一行前面。
 * 格式（2026-10-27）：对齐、字体、字号、文字颜色、底纹、列表和编号的样式、拖过的列宽都带到 Word 里；Markdown 表示不了，照旧只有文字。
 */
import { AlignmentType, Bookmark, BorderStyle, Document, ExternalHyperlink, HeadingLevel, InternalHyperlink, ImageRun, LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType, type ILevelsOptions, type IParagraphOptions, type ParagraphChild } from 'docx';
import { anchorNames, anchorOfHref, slugOf, validAnchor } from './anchors';
import type { DocNode } from './content';
import { hexOf, ptOf, wordFont } from './textstyle';

type Marks = { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; link?: string; color?: string; bg?: string; font?: string; size?: number };
const textOf = (n: DocNode): string => (n.type === 'text' ? n.text ?? '' : (n.content ?? []).map(textOf).join(''));
/** 正文第一块就是和标题一样的一级标题（从 Word 导入的常见情况）：导出时不再重复加标题 */
const startsWithTitle = (json: DocNode, title: string) => { const first = json.content?.[0]; return !!first && first.type === 'heading' && Number(first.attrs?.level ?? 2) === 1 && textOf(first).trim() === title.trim(); };
const marksOf = (n: DocNode): Marks => {
  const m: Marks = {};
  for (const k of n.marks ?? []) {
    if (k.type === 'bold') m.bold = true; else if (k.type === 'italic') m.italic = true; else if (k.type === 'strike') m.strike = true; else if (k.type === 'code') m.code = true;
    else if (k.type === 'link' && typeof k.attrs?.href === 'string') m.link = k.attrs.href;
    else if (k.type === 'textStyle') {
      // 颜色是 #RRGGBB，字号换成半磅（Word 的单位）
      const a = k.attrs ?? {}, color = hexOf(a.color), bg = hexOf(a.backgroundColor), pt = ptOf(a.fontSize);
      if (color) m.color = color.slice(1);
      if (bg) m.bg = bg.slice(1);
      if (typeof a.fontFamily === 'string' && a.fontFamily.trim()) m.font = wordFont(a.fontFamily);
      if (pt) m.size = Math.round(pt * 2);
    }
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

interface WordCtx { plan: Map<DocNode, string[]>; name: (n: string) => string; lists: ListPlan }
/** 一个块的内容外面包上它的书签（第一个包住整段文字，其余的是空书签） */
function withBookmarks(n: DocNode, children: ParagraphChild[], w: WordCtx, extra: string[] = []): ParagraphChild[] {
  const names = [...new Set([...extra, ...(w.plan.get(n) ?? [])])];
  if (!names.length) return children;
  const [first, ...rest] = names.map(w.name);
  return [...rest.map((id) => new Bookmark({ id, children: [] })), new Bookmark({ id: first, children })];
}

/* ---------- Word ---------- */

const HEADING = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
/** 段落、标题的对齐（textstyle.ts 的 ALIGNS）；左对齐是默认，不写 */
const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
const alignOf = (n: DocNode): Partial<IParagraphOptions> => { const a = ALIGN[String(n.attrs?.textAlign ?? '')]; return a ? { alignment: a } : {}; };

/* ---------- 列表和编号 ---------- */

/** 项目符号：没设样式时按层轮换（和网页上一样），设了样式时每层都是那一种 */
const BULLET_TEXT: Record<string, string[]> = { '': ['●', '○', '■'], disc: ['●'], circle: ['○'], square: ['■'] };
/** 编号样式（liststyle.ts 的 ORDERED_STYLES）在 Word 里的格式和后面跟的符号 */
const NUMBER_FORMAT: Record<string, [(typeof LevelFormat)[keyof typeof LevelFormat], string]> = {
  '': [LevelFormat.DECIMAL, '.'], decimal: [LevelFormat.DECIMAL, '.'], 'lower-alpha': [LevelFormat.LOWER_LETTER, '.'], 'upper-alpha': [LevelFormat.UPPER_LETTER, '.'],
  'lower-roman': [LevelFormat.LOWER_ROMAN, '.'], 'upper-roman': [LevelFormat.UPPER_ROMAN, '.'], 'cjk-ideographic': [LevelFormat.CHINESE_COUNTING, '、'],
};

/**
 * 每种（样式、起始号）一份 Word 的编号定义；编号列表每个一个实例，各自从头编（以前所有编号列表接着编号）。
 * 列表的段落用它所在的层级（嵌套几层），所以定义里九层都是同一种样式、同一个起始号
 */
class ListPlan {
  private defs = new Map<string, ILevelsOptions[]>();
  private next = 0;
  /** 一个列表节点用哪份定义、哪个实例 */
  of(n: DocNode): { reference: string; instance: number } {
    const ordered = n.type === 'orderedList', style = typeof n.attrs?.listStyle === 'string' ? n.attrs.listStyle : '';
    const start = ordered ? Math.min(99999, Math.max(0, Math.round(Number(n.attrs?.start ?? 1)) || 0)) : 0;
    const reference = ordered ? `ol-${NUMBER_FORMAT[style] ? style || 'decimal' : 'decimal'}-${start}` : `ul-${BULLET_TEXT[style] ? style || 'auto' : 'auto'}`;
    if (!this.defs.has(reference)) this.defs.set(reference, Array.from({ length: 9 }, (_, level): ILevelsOptions => {
      const indent = { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } };
      if (!ordered) { const t = BULLET_TEXT[style] ?? BULLET_TEXT['']; return { level, format: LevelFormat.BULLET, text: t[level % t.length], alignment: AlignmentType.START, style: indent }; }
      const [format, suffix] = NUMBER_FORMAT[style] ?? NUMBER_FORMAT[''];
      return { level, format, text: `%${level + 1}${suffix}`, start, alignment: AlignmentType.START, style: indent };
    }));
    // 项目符号不用分实例
    return { reference, instance: ordered ? ++this.next : 0 };
  }
  config() { return [...this.defs].map(([reference, levels]) => ({ reference, levels })); }
}

/* ---------- 表格的列宽 ---------- */

/** 网页上的 1 像素在 Word 里是 15 缇（96 dpi）；A4 去掉页边距后正文大约 9000 缇宽，宽了按比例缩 */
const TWIPS_PER_PX = 15, PAGE_WIDTH = 9000;
const pxOf = (cell: DocNode): number[] | null => { const w = cell.attrs?.colwidth; return Array.isArray(w) && w.length && w.every((x) => typeof x === 'number' && x > 0) ? w as number[] : null; };
/** 表格每一列的宽（缇）：按第一行各格的 colwidth；有一列没拖过就返回空，整个表格按页宽平分 */
function gridOf(table: DocNode): { cols: number[]; scale: number } | null {
  const cols: number[] = [];
  for (const cell of kids(kids(table)[0] ?? { type: 'tableRow' })) { const w = pxOf(cell); if (!w) return null; cols.push(...w.map((x) => x * TWIPS_PER_PX)); }
  if (!cols.length) return null;
  const scale = Math.min(1, PAGE_WIDTH / cols.reduce((a, b) => a + b, 0));
  return { cols: cols.map((x) => Math.round(x * scale)), scale };
}
/** 图片在正文里最多这么宽（像素，docx 按 96dpi 算） */
const MAX_IMG = 600;

function runs(n: DocNode, w: WordCtx, extra: Marks = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const c of kids(n)) {
    if (c.type === 'hardBreak') { out.push(new TextRun({ break: 1 })); continue; }
    if (c.type !== 'text') { out.push(...runs(c, w, extra)); continue; }
    const m = { ...extra, ...marksOf(c) };
    const run = new TextRun({
      text: c.text ?? '', bold: m.bold, italics: m.italic, strike: m.strike, font: m.code ? 'Consolas' : m.font, style: m.link ? 'Hyperlink' : undefined,
      color: m.color, size: m.size, shading: m.bg ? { type: ShadingType.CLEAR, fill: m.bg, color: 'auto' } : undefined,
    });
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

async function blocks(n: DocNode, w: WordCtx, ctx: { list?: { reference: string; instance: number }; level: number; quote?: boolean; carry?: string[] }): Promise<Block[]> {
  const out: Block[] = [];
  const listOpts = (): Partial<IParagraphOptions> => (ctx.list ? { numbering: { ...ctx.list, level: ctx.level } } : {});
  const quoteOpts = (): Partial<IParagraphOptions> => (ctx.quote ? { indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'C9CFD9', space: 8 } } } : {});
  for (const c of kids(n)) {
    // 列表项的书签放在它的第一段上
    const carry = ctx.carry; if (carry) ctx = { ...ctx, carry: undefined };
    switch (c.type) {
      case 'heading': { const lv = Math.min(6, Math.max(1, Number(c.attrs?.level ?? 2))); out.push(new Paragraph({ heading: HEADING[lv - 1], children: withBookmarks(c, runs(c, w), w, carry), ...alignOf(c) })); break; }
      case 'paragraph': out.push(new Paragraph({ children: withBookmarks(c, runs(c, w, ctx.quote ? { italic: true } : {}), w, carry), ...listOpts(), ...quoteOpts(), ...alignOf(c) })); break;
      case 'bulletList': case 'orderedList': {
        const list = w.lists.of(c), level = Math.min(ctx.list ? ctx.level + 1 : 0, 8);
        for (const li of kids(c)) out.push(...await blocks(li, w, { list, level, carry: w.plan.get(li) }));
        break;
      }
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
        // 拖过列宽的表格按那个宽度（固定列宽），没拖过的铺满页宽
        const grid = gridOf(c), rows: TableRow[] = [];
        for (const r of kids(c)) {
          const cells: TableCell[] = [];
          for (const cell of kids(r)) {
            const inner = await blocks(cell, w, { level: 0 }), px = grid ? pxOf(cell) : null;
            cells.push(new TableCell({
              children: inner.length ? inner : [new Paragraph('')],
              columnSpan: Number(cell.attrs?.colspan) > 1 ? Number(cell.attrs?.colspan) : undefined, rowSpan: Number(cell.attrs?.rowspan) > 1 ? Number(cell.attrs?.rowspan) : undefined,
              shading: cell.type === 'tableHeader' ? { fill: 'F0F3F8' } : undefined,
              width: grid && px ? { size: Math.round(px.reduce((a, b) => a + b, 0) * TWIPS_PER_PX * grid.scale), type: WidthType.DXA } : undefined,
            }));
          }
          rows.push(new TableRow({ children: cells, tableHeader: kids(r).every((x) => x.type === 'tableHeader') }));
        }
        if (rows.length) out.push(new Table(grid
          ? { rows, columnWidths: grid.cols, width: { size: grid.cols.reduce((a, b) => a + b, 0), type: WidthType.DXA }, layout: TableLayoutType.FIXED }
          : { rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        break;
      }
      default: if (c.content) out.push(...await blocks(c, w, ctx));
    }
  }
  return out;
}

/** 整篇文档转成 Word 文件。标题放在最上面（宿主负责标题，但导出的文件要带上） */
export async function toDocx(json: DocNode, title: string): Promise<Blob> {
  const lists = new ListPlan();
  const body = await blocks(json, { plan: anchorPlan(json), name: wordNames(), lists }, { level: 0 });
  const doc = new Document({
    title,
    creator: 'Company AI',
    numbering: { config: lists.config() },
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

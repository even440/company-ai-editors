/**
 * 导入：把源文件转成 HTML，再由 Tiptap 的 setContent 解析成文档结构。
 * docx 用 mammoth，Markdown 用 marked，txt 按行成段落，html 直接用。
 */
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { marked } from 'marked';
import type { EditorClient, EditorFile } from '@cai/bridge';
import { anchorNames, anchorOfHref, slugOf, validAnchor } from './anchors';
import { imageSize, placeImages, type ImageProgress, type PendingImage } from './images';

const escapeHtml = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
export const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();

/** 去掉 HTML 里会执行的东西：脚本、内嵌框架和 on* 事件。Tiptap 解析时本来也不认识它们，这里多一层保险 */
export function sanitizeHtml(html: string): string {
  const d = new DOMParser().parseFromString(html, 'text/html');
  d.querySelectorAll('script, iframe, object, embed, style, link, meta').forEach((el) => el.remove());
  for (const el of d.body.querySelectorAll('*')) for (const a of [...el.attributes]) { if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name); }
  return d.body.innerHTML;
}

/** 纯文本：空行分段，单个换行也算一段（和宿主 insert 消息一致） */
export const textToHtml = (t: string) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${escapeHtml(l)}</p>`).join('') || '<p></p>';

export const markdownToHtml = (md: string) => sanitizeHtml(marked.parse(md, { async: false, gfm: true, breaks: false }));

/**
 * Word 的「交叉引用」（引用 → 交叉引用，比如「见 2.1 节」）是 REF / NOTEREF 域，mammoth 只认 HYPERLINK 域，转换后只剩文字、点不了。
 * 先在 document.xml 里把它们改写成指向同一个书签的文档内链接（HYPERLINK \l "书签"），转换出来就是 #书签 的链接（书签见 liftAnchors）。
 * 域代码可能拆在好几个 w:instrText 里、域里还能套域，按 fldChar 的 begin / separate / end 配对；PAGEREF（页码）不动
 */
export function crossRefsToLinks(xml: string): string {
  const re = /<w:fldChar\b[^>]*w:fldCharType="(begin|separate|end)"[^>]*>|(<w:instrText\b[^>]*>)([^<]*)<\/w:instrText>/g;
  const stack: { instr: { start: number; end: number; text: string }[]; open: boolean }[] = [];
  const edits: { start: number; end: number; text: string }[] = [];
  const unxml = (s: string) => s.replace(/&(lt|gt|quot|apos|amp);/g, (_m, e: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e] ?? '');
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const top = stack[stack.length - 1];
    if (m[1] === 'begin') stack.push({ instr: [], open: true });
    else if (m[1]) {
      if (top?.open) {
        top.open = false;
        const ref = /^\s*(?:REF|NOTEREF)\s+([^\s\\"]+)/.exec(unxml(top.instr.map((x) => x.text).join('')));
        if (ref && validAnchor(ref[1])) top.instr.forEach((x, i) => edits.push({ ...x, text: i ? '' : ` HYPERLINK \\l "${ref[1].replace(/&/g, '&amp;')}" ` }));
      }
      if (m[1] === 'end') stack.pop();
    } else if (top?.open) {
      const start = m.index + m[2].length;
      top.instr.push({ start, end: start + m[3].length, text: m[3] });
    }
  }
  for (const e of edits.sort((a, b) => b.start - a.start)) xml = xml.slice(0, e.start) + e.text + xml.slice(e.end);
  return xml;
}

/** 把 docx 里的交叉引用改写成文档内链接（crossRefsToLinks）；没有交叉引用、读不了的原样返回 */
async function withCrossRefLinks(data: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const zip = await JSZip.loadAsync(data);
    const f = zip.file('word/document.xml');
    if (!f) return data;
    const xml = await f.async('string'), out = crossRefsToLinks(xml);
    if (out === xml) return data;
    zip.file('word/document.xml', out);
    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch { return data; }
}

/** 转换时图片的占位地址，转完换成真的（images.ts） */
const PH = 'cai-img:';

/**
 * Word：里面的图片交给宿主保存成附件（得到带令牌的地址），传不上去时退成 data: 地址内嵌；交叉引用先改写成文档内链接（crossRefsToLinks）。
 * 图片先收下、给占位地址，转完再一起传（一样的只传一次、同时传几张，onProgress 报进度），并带上像素宽高（images.ts）。
 * mammoth 的样式映射保持默认：Heading 1-6 → h1-h6，列表、表格、加粗、斜体、链接都能对上。
 */
export async function docxToHtml(data: ArrayBuffer, client?: EditorClient, onProgress?: ImageProgress): Promise<string> {
  data = await withCrossRefLinks(data);
  const images: PendingImage[] = [];
  const convertImage = mammoth.images.imgElement(async (image) => {
    const raw: ArrayBuffer | Uint8Array = await image.readAsArrayBuffer(), bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw), size = imageSize(bytes);
    images.push({ bytes, type: image.contentType || 'image/png' });
    return { src: `${PH}${images.length - 1}`, ...(size ? { width: String(size.w), height: String(size.h) } : {}) };
  });
  const r = await mammoth.convertToHtml({ arrayBuffer: data }, { convertImage });
  const srcs = await placeImages(images, client, onProgress);
  return sanitizeHtml(r.value.replace(/cai-img:(\d+)/g, (_, i: string) => srcs[Number(i)] ?? ''));
}

/** 能挂书签的块（标题一到六级，2026-10-27 起编辑器认六级；原来 4–6 级在这里换成段落） */
const TARGETS = 'h1,h2,h3,h4,h5,h6,p,li';
/** 一个块最多记几个书签（和 anchors.ts、平台 content.ts 一致） */
const MAX_PER_BLOCK = 16;

/**
 * 书签挪到所在的块上（data-anchor，见 anchors.ts）。编辑器的结构里没有空的 <a>，不挪就丢了，目录、交叉引用、脚注点了没处去：
 * Word 的书签 mammoth 转成空的 <a id>；脚注是 <li id> 和带 id 的引用链接；HTML 里还有 <a name> 和块元素的 id。
 * Word 自己用的隐藏书签（_Toc、_Ref、_Hlk 这类下划线开头的）只留有链接指向的；有链接指向、还没有锚点的标题按 GitHub 的写法补上
 * （Markdown 里的 [x](#标题文字)）。
 */
export function liftAnchors(html: string): string {
  const d = new DOMParser().parseFromString(html, 'text/html'), body = d.body;
  const linked = new Map<string, string>();
  for (const a of body.querySelectorAll('a[href^="#"]')) { const n = anchorOfHref(a.getAttribute('href')); if (n) linked.set(n.toLowerCase(), n); }
  const add = (el: Element, name: string | null) => {
    if (!name || !validAnchor(name) || (name.startsWith('_') && !linked.has(name.toLowerCase()))) return;
    const cur = anchorNames(el.getAttribute('data-anchor'));
    if (!cur.includes(name) && cur.length < MAX_PER_BLOCK) el.setAttribute('data-anchor', [...cur, name].join(' '));
  };
  /** 书签落在哪个块：在块里就是那个块；表格单元格、引用里直接写的文字先包成段落；块外面的挂到后面最近的块上（没有就最后一块） */
  const targetOf = (el: Element): Element | null => {
    const own = el.closest(TARGETS);
    if (own) return own;
    const box = el.closest('td,th,blockquote');
    if (box) {
      const inner = box.querySelector(TARGETS);
      if (inner) return inner;
      const p = d.createElement('p'); p.append(...box.childNodes); box.append(p); return p;
    }
    const all = [...body.querySelectorAll(TARGETS)];
    return all.find((b) => !!(el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? all.at(-1) ?? null;
  };
  // 书签：没有 href 的 <a id> / <a name>。拿掉这个空壳，里面有字的留着
  for (const a of [...body.querySelectorAll('a[id]:not([href]), a[name]:not([href])')]) {
    const block = targetOf(a);
    if (block) { add(block, a.getAttribute('id')); add(block, a.getAttribute('name')); }
    a.replaceWith(...a.childNodes);
  }
  // 别的元素上的 id（脚注、HTML 的 <h2 id>、<section id>…）：块本身就挂上，容器挂到里面第一个块
  for (const el of [...body.querySelectorAll('[id]')]) {
    const block = el.matches(TARGETS) ? el : (el.querySelector(TARGETS) ?? targetOf(el));
    if (block) add(block, el.getAttribute('id'));
    el.removeAttribute('id');
  }
  // 有链接指向、还没有锚点的标题：GitHub 的写法（重名的依次加 -1、-2）
  if (linked.size) {
    const seen = new Map<string, number>();
    for (const h of body.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      const base = slugOf(h.textContent ?? '');
      if (!base) continue;
      const n = seen.get(base) ?? 0; seen.set(base, n + 1);
      const name = linked.get(n ? `${base}-${n}` : base);
      if (name) add(h, name);
    }
  }
  return body.innerHTML;
}

/** 按扩展名把源文件转成 HTML；不认识的扩展名按纯文本处理 */
export async function importToHtml(file: EditorFile, data: ArrayBuffer, client?: EditorClient, onProgress?: ImageProgress): Promise<string> {
  const ext = extOf(file.name);
  if (ext === 'docx') return liftAnchors(await docxToHtml(data, client, onProgress));
  const text = new TextDecoder('utf-8').decode(data);
  if (ext === 'md' || ext === 'markdown') return liftAnchors(markdownToHtml(text));
  if (ext === 'html' || ext === 'htm') return liftAnchors(sanitizeHtml(text));
  return textToHtml(text);
}

/** 导入后的标题：宿主一般已经按文件名起好了，这里只把扩展名去掉 */
export const titleOf = (title: string, fileName: string) => title.replace(new RegExp(`\\.${extOf(fileName)}$`, 'i'), '').trim() || title;

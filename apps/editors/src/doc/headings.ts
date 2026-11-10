/**
 * 导入 Word 时认出标题（用户 2026-11-10：一份从别的系统导出的操作手册，WPS 左边的目录是全的，导入以后一个标题都没有）。
 * mammoth 只按样式的名字认标题（样式叫 heading 1～6 才是 h1～h6）。外面来的文件常常不是这样：
 * - 段落自己写着大纲级别（w:outlineLvl），引用的样式在 styles.xml 里根本没有定义（那份手册就是：Apache POI 生成的，styles.xml 是空的）；
 * - 标题用的是自己起名的样式（「章标题」「一级标题」），大纲级别写在样式上，或者是「基于」标题样式建的。
 * Word、WPS 的导航窗格看的是大纲级别，不看样式叫什么。这里照它们的算法先把 document.xml 改一遍：
 * 大纲级别是 1～9 级的段落，样式换成这里补进 styles.xml 的 CaiHeading1～6（名字是 heading 1～6），mammoth 就认了。七到九级按六级（编辑器的标题到六级）。
 * 只改字符串、不用 DOM，自测脚本（tools/check-doc.mjs）在 Node 里也能跑
 */
import JSZip from 'jszip';

/** 编辑器的标题到六级 */
const MAX_LEVEL = 6;
/** 补进 styles.xml 的样式的编号前缀 */
const SYN = 'CaiHeading';

/** 标签上某个属性的值（单引号、双引号都认） */
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

interface StyleInfo { name: string; basedOn: string | null; outline: number | null }

/** styles.xml 里的段落样式：名字、基于哪个样式、自己写的大纲级别 */
function readStyles(xml: string): Map<string, StyleInfo> {
  const out = new Map<string, StyleInfo>();
  for (const m of xml.matchAll(/<w:style\b([^>]*?)(?:\/>|>([\s\S]*?)<\/w:style>)/g)) {
    const head = ' ' + m[1], body = m[2] ?? '', id = attr(head, 'w:styleId');
    if (!id || out.has(id) || (attr(head, 'w:type') ?? 'paragraph') !== 'paragraph') continue;
    const tag = (name: string) => new RegExp(`<w:${name}\\b[^>]*>`).exec(body)?.[0] ?? '';
    const lvl = attr(tag('outlineLvl'), 'w:val');
    out.set(id, { name: attr(tag('name'), 'w:val') ?? '', basedOn: attr(tag('basedOn'), 'w:val'), outline: lvl !== null && /^\d+$/.test(lvl) ? Number(lvl) : null });
  }
  return out;
}

/** 样式名本身就写着是几级标题的（有的生成工具不写大纲级别，只起这个名字；各语言的 Word 存的一般是英文名，本地化的名字也认一下） */
const NAMED = /^(?:heading|标题|標題|t[ií]tulo|titre|überschrift|見出し|제목)\s*([1-9])$/i;
/** mammoth 自己就认的名字 */
const NATIVE = /^heading ([1-6])$/i;

/** 大纲级别的值（0～8 是一到九级，9 是正文）换成标题级别；不是标题返回 null */
const levelOfOutline = (v: number): number | null => (v >= 0 && v <= 8 ? v + 1 : null);

/**
 * 把按大纲级别算是标题、mammoth 却认不出来的段落改成它认的样式。
 * 返回改过的 document.xml 和 styles.xml；一处都不用改时返回 null。stylesXml 是 null 表示文件里没有 styles.xml
 */
export function outlineHeadings(documentXml: string, stylesXml: string | null): { document: string; styles: string; count: number } | null {
  const styles = readStyles(stylesXml ?? '');
  const memo = new Map<string, number | null>();
  /** 样式算几级标题：自己写了大纲级别的按它（写 9 就是正文，「目录标题」这类样式是这样），没写的看名字，再没有就顺着「基于」往上找 */
  const styleLevel = (id: string | null, seen = new Set<string>()): number | null => {
    if (!id) return null;
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    const s = styles.get(id);
    let level: number | null = null;
    if (s && !seen.has(id)) {
      seen.add(id);
      if (s.outline !== null) level = levelOfOutline(s.outline);
      else { const named = NAMED.exec(s.name.trim()); level = named ? Number(named[1]) : styleLevel(s.basedOn, seen); }
    }
    memo.set(id, level);
    return level;
  };
  /** mammoth 按这个样式会给出几级标题 */
  const nativeLevel = (id: string | null): number | null => { const m = id ? NATIVE.exec(styles.get(id)?.name.trim() ?? '') : null; return m ? Number(m[1]) : null; };

  const edits: { start: number; end: number; text: string }[] = [], used = new Set<number>();
  // 段落属性紧跟在 <w:p> 后面。修订记录（w:pPrChange）里还会再套一层 w:pPr，按层数找到自己的结束标签
  const close = /<w:pPr>|<\/w:pPr>/g;
  for (const m of documentXml.matchAll(/<w:p(?:\s[^>]*)?>\s*<w:pPr>/g)) {
    const start = m.index + m[0].length;
    let end = -1, depth = 1;
    close.lastIndex = start;
    for (let c = close.exec(documentXml); c; c = close.exec(documentXml)) {
      depth += c[0] === '<w:pPr>' ? 1 : -1;
      if (!depth) { end = c.index; break; }
    }
    if (end < 0) continue;
    // 修订前的旧属性不看（w:pPrChange 总在最后）
    const inner = documentXml.slice(start, end), cut = inner.indexOf('<w:pPrChange'), own = cut < 0 ? inner : inner.slice(0, cut);
    const styleTag = /<w:pStyle\b[^>]*\/>/.exec(own), styleId = styleTag ? attr(styleTag[0], 'w:val') : null;
    const direct = attr(/<w:outlineLvl\b[^>]*\/>/.exec(own)?.[0] ?? '', 'w:val');
    // 段落自己写的大纲级别优先（写 9 是特意设成正文），没写的看样式
    const raw = direct !== null && /^\d+$/.test(direct) ? levelOfOutline(Number(direct)) : styleLevel(styleId);
    if (raw === null) continue;
    const level = Math.min(MAX_LEVEL, raw);
    if (nativeLevel(styleId) === level) continue;
    used.add(level);
    const tag = `<w:pStyle w:val="${SYN}${level}"/>`;
    edits.push(styleTag ? { start: start + styleTag.index, end: start + styleTag.index + styleTag[0].length, text: tag } : { start, end: start, text: tag });
  }
  if (!edits.length) return null;

  // 从前往后拼（几十兆的 document.xml 不能一处处切）
  const parts: string[] = [];
  let at = 0;
  for (const e of edits) { parts.push(documentXml.slice(at, e.start), e.text); at = e.end; }
  parts.push(documentXml.slice(at));

  const defs = [...used].sort().map((n) => `<w:style w:type="paragraph" w:styleId="${SYN}${n}"><w:name w:val="heading ${n}"/></w:style>`).join('');
  const src = stylesXml ?? '';
  const styled = /<\/w:styles>\s*$/.test(src) ? src.replace(/<\/w:styles>\s*$/, `${defs}</w:styles>`)
    // 空的样式表常写成一个自己闭合的 <w:styles …/>
    : /<w:styles\b[^>]*\/>\s*$/.test(src) ? src.replace(/<w:styles\b([^>]*)\/>\s*$/, (_all, a: string) => `<w:styles${a}>${defs}</w:styles>`)
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${defs}</w:styles>`;
  return { document: parts.join(''), styles: styled, count: edits.length };
}

/** 压缩包里某个关系文件中指定类型的目标（.rels 里 Type 以 /<type> 结尾的那一条） */
async function relTarget(zip: JSZip, rels: string, type: string): Promise<string | null> {
  const xml = await zip.file(rels)?.async('string');
  for (const m of xml?.matchAll(/<Relationship\b[^>]*>/g) ?? []) {
    if (!new RegExp(`\\sType\\s*=\\s*["'][^"']*/${type}["']`).test(m[0])) continue;
    const t = /\sTarget\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[0]);
    if (t) return t[1] ?? t[2] ?? null;
  }
  return null;
}
/** 相对路径接到目录后面（/ 开头的从压缩包的根算），去掉 . 和 .. */
function joinPath(dir: string, target: string): string {
  const out: string[] = [];
  for (const seg of (target.startsWith('/') ? target : `${dir}/${target}`).split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); }
  return out.join('/');
}

/**
 * 转换之前先改一遍 docx（只解一次压缩包）：fix 是调用方对正文另外要做的改写（import.ts 把交叉引用改成文档内链接），再按大纲级别认标题（outlineHeadings）。
 * 正文和样式表的位置照 mammoth 的找法：按关系文件找，找不到用 word/document.xml、word/styles.xml。都不用改、读不了的原样返回
 */
export async function prepareDocx(data: ArrayBuffer, fix: (documentXml: string) => string = (x) => x): Promise<ArrayBuffer> {
  try {
    const zip = await JSZip.loadAsync(data);
    const mainRel = await relTarget(zip, '_rels/.rels', 'officeDocument');
    const main = [mainRel ? joinPath('', mainRel) : '', 'word/document.xml'].find((p) => p && zip.file(p));
    if (!main) return data;
    const cut = main.lastIndexOf('/'), dir = main.slice(0, Math.max(0, cut)), base = main.slice(cut + 1);
    const stylesRel = await relTarget(zip, `${dir ? dir + '/' : ''}_rels/${base}.rels`, 'styles'), styled = stylesRel ? joinPath(dir, stylesRel) : '';
    const stylesPath = styled && zip.file(styled) ? styled : 'word/styles.xml';
    const xml = await zip.file(main)!.async('string'), linked = fix(xml);
    const heads = outlineHeadings(linked, (await zip.file(stylesPath)?.async('string')) ?? null);
    if (!heads && linked === xml) return data;
    zip.file(main, heads?.document ?? linked);
    if (heads) zip.file(stylesPath, heads.styles);
    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch { return data; }
}

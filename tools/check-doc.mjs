/**
 * 文档的自测。一是导入时认标题（apps/editors/src/doc/headings.ts 的 outlineHeadings、prepareDocx）：
 * Word 的标题不一定用叫 heading 1～6 的样式——段落自己写大纲级别、样式起了别的名字、样式是「基于」标题样式建的，都要认成标题。
 * 二是粘贴带图的内容时，从同一次复制的 RTF、从 data: 地址里取出图片本身（images.ts 的 rtfImages、dataImage）。
 * 三是标题里的软换行（toc.ts，2026-11-25）：目录按行列出来，设标题时按行拆开；还有行距（lineheight.ts）认哪些值。
 * 这个仓库没有测试框架，直接用 Node 跑 TypeScript 源码（要 Node 22.15 以上）：
 *   node --experimental-strip-types tools/check-doc.mjs
 * 全部通过时最后一行是「全部通过（N 组）」，有不过的会列出来、退出码是 1。里面的文字都是编的。
 */
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';

// 源码里的相对引用不写扩展名（给 Vite 用的），这里补上 .ts
registerHooks({ resolve(spec, ctx, next) { try { return next(spec, ctx); } catch (e) { if (spec.startsWith('.')) return next(spec + '.ts', ctx); throw e; } } });
const require = createRequire(new URL('../apps/editors/package.json', import.meta.url));
const JSZip = require('jszip'), mammoth = require('mammoth');
const ED = new URL('../apps/editors/src/doc/', import.meta.url).href;
const { outlineHeadings, prepareDocx } = await import(ED + 'headings.ts');

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗', name, '\n ', e.message); process.exitCode = 1; } };
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (text, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const body = (...ps) => `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${ps.join('')}</w:body></w:document>`;
const styles = (...ss) => `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}>${ss.join('')}</w:styles>`;
const style = (id, name, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${extra}</w:style>`;
/** 改过以后各段落的样式编号，按顺序；没有样式的是 null */
const stylesOf = (xml) => [...xml.matchAll(/<w:p>(?:<w:pPr>(.*?)<\/w:pPr>)?<w:r>/g)].map((m) => /^<w:pStyle w:val="([^"]*)"\/>/.exec(m[1] ?? '')?.[1] ?? null);

await t('段落自己写着大纲级别、样式没有定义（别的系统导出的文件）', () => {
  const doc = body(para('操作手册'), para('前言', '<w:pStyle w:val="1"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/>'), para('一、总则', '<w:pStyle w:val="2"/><w:outlineLvl w:val="1"/>'), para('正文'), para('没有样式的标题', '<w:spacing w:before="120"/><w:outlineLvl w:val="2"/>'));
  const r = outlineHeadings(doc, `<?xml version="1.0" encoding="UTF-8"?>\n<w:styles ${W}/>`);
  assert.equal(r.count, 3);
  assert.deepEqual(stylesOf(r.document), [null, 'CaiHeading1', 'CaiHeading2', null, 'CaiHeading3']);
  // 别的段落属性原样留着；空的样式表补上三个样式
  assert.ok(r.document.includes('<w:pStyle w:val="CaiHeading1"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/>'));
  assert.ok(r.document.includes('<w:pStyle w:val="CaiHeading3"/><w:spacing w:before="120"/>'));
  assert.equal(r.styles.match(/<w:style /g).length, 3);
  assert.ok(r.styles.includes('<w:style w:type="paragraph" w:styleId="CaiHeading2"><w:name w:val="heading 2"/></w:style>') && r.styles.endsWith('</w:style></w:styles>'));
});

await t('自己起名的样式：大纲级别写在样式上、基于标题样式、名字是本地化的', () => {
  const st = styles(
    style('Heading1', 'heading 1', '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>'), style('Normal', 'Normal'),
    style('a1', '章标题', '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr>'),
    style('a2', '节标题', '<w:basedOn w:val="Heading1"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr>'),
    style('a3', '大标题', '<w:basedOn w:val="Heading1"/>'),
    style('a4', '标题 3'),
    style('TOCHeading', 'TOC Heading', '<w:basedOn w:val="Heading1"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr>'),
    `<w:style w:type="character" w:styleId="c1"><w:name w:val="heading 1"/></w:style>`,
  );
  const doc = body(para('第一章', '<w:pStyle w:val="a1"/>'), para('第一节', '<w:pStyle w:val="a2"/>'), para('另一章', '<w:pStyle w:val="a3"/>'), para('小节', '<w:pStyle w:val="a4"/>'), para('目录', '<w:pStyle w:val="TOCHeading"/>'), para('正文', '<w:pStyle w:val="Normal"/>'), para('本来就认的', '<w:pStyle w:val="Heading1"/>'));
  const r = outlineHeadings(doc, st);
  assert.deepEqual(stylesOf(r.document), ['CaiHeading1', 'CaiHeading2', 'CaiHeading1', 'CaiHeading3', 'TOCHeading', 'Normal', 'Heading1']);
  assert.equal(r.count, 4);
  // 原来的样式都还在，新的接在后面
  assert.ok(r.styles.includes('w:styleId="a1"') && r.styles.endsWith('<w:name w:val="heading 3"/></w:style></w:styles>'));
});

await t('段落写的大纲级别比样式优先；9 是正文；七到九级按六级', () => {
  const st = styles(style('Heading2', 'heading 2', '<w:pPr><w:outlineLvl w:val="1"/></w:pPr>'), style('x', '强调段', '<w:pPr><w:outlineLvl w:val="2"/></w:pPr>'));
  const doc = body(para('升成一级', '<w:pStyle w:val="Heading2"/><w:outlineLvl w:val="0"/>'), para('设成正文', '<w:pStyle w:val="x"/><w:outlineLvl w:val="9"/>'), para('八级', '<w:outlineLvl w:val="7"/>'), para('九级', '<w:outlineLvl w:val="8"/>'));
  const r = outlineHeadings(doc, st);
  assert.deepEqual(stylesOf(r.document), ['CaiHeading1', 'x', 'CaiHeading6', 'CaiHeading6']);
});

await t('修订记录里的旧属性不看；本来就对的文件不改', () => {
  const old = '<w:pPrChange w:id="1" w:author="a"><w:pPr><w:pStyle w:val="old"/><w:outlineLvl w:val="0"/></w:pPr></w:pPrChange>';
  assert.equal(outlineHeadings(body(para('改成了正文', `<w:jc w:val="left"/>${old}`)), null), null);
  const r = outlineHeadings(body(para('现在是二级', `<w:outlineLvl w:val="1"/>${old}`), para('后面的段落', '<w:outlineLvl w:val="0"/>')), null);
  assert.deepEqual([...r.document.matchAll(/CaiHeading(\d)/g)].map((m) => m[1]), ['2', '1']);
  assert.ok(r.document.includes(`<w:pStyle w:val="CaiHeading2"/><w:outlineLvl w:val="1"/>${old}</w:pPr>`));
  // 没有 styles.xml 的文件：新建一份
  assert.ok(r.styles.startsWith('<?xml') && r.styles.includes(`<w:styles ${W}>`));
  const st = styles(style('Heading1', 'heading 1', '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>'), style('Heading3', 'Heading 3'));
  assert.equal(outlineHeadings(body(para('一', '<w:pStyle w:val="Heading1"/>'), para('三', '<w:pStyle w:val="Heading3"/><w:outlineLvl w:val="2"/>'), para('正文')), st), null);
});

/** 拼一个最小的 docx；rels 为假时不带关系文件（靠默认位置找） */
async function docx(documentXml, stylesXml, { main = 'word/document.xml', stylesAt = 'word/styles.xml', rels = true } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>');
  if (rels) {
    zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`);
    const dir = main.split('/').slice(0, -1).join('/'), name = main.split('/').pop();
    if (stylesXml !== null) zip.file(`${dir}/_rels/${name}.rels`, `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="${stylesAt.slice(dir.length + 1)}"/></Relationships>`);
  }
  zip.file(main, documentXml);
  if (stylesXml !== null) zip.file(stylesAt, stylesXml);
  const b = await zip.generateAsync({ type: 'nodebuffer' });
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
const html = async (ab) => (await mammoth.convertToHtml({ buffer: Buffer.from(ab) })).value;
const DOC = body(para('前言', '<w:pStyle w:val="1"/><w:outlineLvl w:val="0"/>'), para('一、范围', '<w:pStyle w:val="2"/><w:outlineLvl w:val="1"/>'), para('这是正文。'), para('第一章', '<w:pStyle w:val="a1"/>'));
const ST = styles(style('a1', '章标题', '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>'));

await t('整个走一遍：改之前 mammoth 一个标题都认不出，改之后是 h1 / h2', async () => {
  const raw = await docx(DOC, ST);
  assert.equal((await html(raw)).includes('<h'), false);
  assert.equal(await html(await prepareDocx(raw)), '<h1>前言</h1><h2>一、范围</h2><p>这是正文。</p><h1>第一章</h1>');
});

await t('正文和样式表不在默认位置（按关系文件找）、没有关系文件、没有样式表', async () => {
  assert.equal(await html(await prepareDocx(await docx(DOC, ST, { main: 'doc/main.xml', stylesAt: 'doc/look/styles2.xml' }))), '<h1>前言</h1><h2>一、范围</h2><p>这是正文。</p><h1>第一章</h1>');
  assert.equal(await html(await prepareDocx(await docx(DOC, ST, { rels: false }))), '<h1>前言</h1><h2>一、范围</h2><p>这是正文。</p><h1>第一章</h1>');
  assert.equal(await html(await prepareDocx(await docx(DOC, null))), '<h1>前言</h1><h2>一、范围</h2><p>这是正文。</p><p>第一章</p>');
});

await t('不用改的文件原样返回（不重新打包）；不是 docx 的也原样返回', async () => {
  const plain = await docx(body(para('只有正文'), para('第二段')), styles(style('Normal', 'Normal')));
  assert.equal(await prepareDocx(plain), plain);
  const junk = new TextEncoder().encode('这不是压缩包').buffer;
  assert.equal(await prepareDocx(junk), junk);
});

/* ---------- 粘贴带图的内容：从 RTF、data: 地址里取出图片（images.ts 的 rtfImages、dataImage） ---------- */
const { rtfImages, dataImage, imageSize } = await import(ED + 'images.ts');
const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
// 一张 3×2 的 PNG 的开头（文件头 + IHDR），够认类型和宽高
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xc0, 0, 11, 8, 0, 5, 0, 7, 3, 1, 2, 3]);
/** Word 复制时一张图的写法：真的图在 \shppict 里，后面跟一份给老软件看的 WMF */
const wordPict = (bytes, blip, tag) => `{\\*\\shppict{\\pict{\\*\\picprop\\shplid1025{\\sp{\\sn shapeType}{\\sv 75}}{\\sp{\\sn wzDescription}{\\sv a \\{b\\} c}}}\\picscalex100\\picscaley100\\picw2646\\pich1764\\picwgoal1500\\pichgoal1000\\${blip}\\bliptag${tag}{\\*\\blipuid ${'0f'.repeat(16)}}${hexOf(bytes).replace(/(.{16})/g, '$1\r\n')}}}{\\nonshppict{\\pict\\picscalex100\\picw2646\\pich1764\\wmetafile8\\bliptag${tag} 010009000003de00000000}}`;

await t('RTF 里的图片按顺序取出来：PNG、JPEG 各一张，后面那份 WMF 不要', () => {
  const rtf = `{\\rtf1\\ansi{\\fonttbl{\\f0 Calibri;}}\\pard 第一段\\par ${wordPict(PNG, 'pngblip', -1234)}\\par 第二段\\par ${wordPict(JPG, 'jpegblip', 77)}\\par}`;
  const got = rtfImages(rtf);
  assert.deepEqual(got.map((g) => g.type), ['image/png', 'image/jpeg']);
  assert.deepEqual([...got[0].bytes], [...PNG]);
  assert.deepEqual([...got[1].bytes], [...JPG]);
  assert.deepEqual(imageSize(got[0].bytes), { w: 3, h: 2 });
  assert.deepEqual(imageSize(got[1].bytes), { w: 7, h: 5 });
});
await t('RTF 里没有图片、只有 WMF、内容不完整时不出错', () => {
  assert.deepEqual(rtfImages(''), []);
  assert.deepEqual(rtfImages('{\\rtf1 只有文字\\par}'), []);
  assert.deepEqual(rtfImages('{\\rtf1{\\pict\\wmetafile8\\bliptag1 0100090000}}'), []);
  // 半截的（括号没合上）：不死循环，能取多少取多少
  assert.equal(rtfImages(`{\\rtf1{\\pict\\pngblip\\bliptag1 ${hexOf(PNG)}`).length <= 1, true);
  // 大写的十六进制、数据紧跟在属性后面
  assert.deepEqual([...rtfImages(`{\\pict\\pngblip ${hexOf(PNG).toUpperCase()}}`)[0].bytes], [...PNG]);
});
await t('data: 地址里的图片：base64 和直接写的都认，不是图片的不要', () => {
  const b64 = Buffer.from(PNG).toString('base64');
  assert.deepEqual([...dataImage(`data:image/png;base64,${b64}`).bytes], [...PNG]);
  assert.equal(dataImage(`data:image/png;base64,${b64}`).type, 'image/png');
  assert.equal(new TextDecoder().decode(dataImage('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22a%22%2F%3E').bytes), '<svg xmlns="a"/>');
  assert.equal(dataImage('data:text/html;base64,PGI+eDwvYj4='), null);
  assert.equal(dataImage('data:image/png;base64,***'), null);
  assert.equal(dataImage('https://example.com/a.png'), null);
});

/* ---------- 标题里的软换行、行距 ---------- */

const { Schema } = await import(require.resolve('@tiptap/pm/model'));
const { EditorState, TextSelection } = await import(require.resolve('@tiptap/pm/state'));
const { tocOf, setHeadingLines } = await import(ED + 'toc.ts');
const { lineHeightOf, lineCss } = await import(ED + 'lineheight.ts');
// 和编辑器里一样的几种块（属性只放用得到的）
const sch = new Schema({
  nodes: {
    doc: { content: 'block+' }, text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*', attrs: { textAlign: { default: null }, anchor: { default: null }, lineHeight: { default: null } } },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 }, textAlign: { default: null }, anchor: { default: null }, lineHeight: { default: null } } },
    hardBreak: { group: 'inline', inline: true, selectable: false },
    bulletList: { group: 'block', content: 'listItem+' }, listItem: { content: 'paragraph block*' },
  },
});
/** 一段：字符串之间放软换行 */
const lines = (type, attrs, ...ts) => sch.node(type, attrs, ts.flatMap((x, i) => [...(i ? [sch.node('hardBreak')] : []), ...(x ? [sch.text(x)] : [])]));
const shape = (doc) => { const out = []; doc.forEach((b) => out.push([b.type.name === 'heading' ? `h${b.attrs.level}` : b.type.name, b.textContent, b.attrs.anchor ?? null, b.attrs.lineHeight ?? null])); return out; };

await t('目录：标题里有软换行时每行一项，第二行跳到第二行开头；链接弹窗里还是一个标题一项', () => {
  const doc = sch.node('doc', null, [lines('heading', { level: 1 }, '1、收银台优惠', '2、门店要货'), lines('heading', { level: 1 }, '3、员工交通补贴'), lines('paragraph', null, '正文')]);
  const toc = tocOf(doc);
  assert.deepEqual(toc.map((i) => [i.level, i.text]), [[1, '1、收银台优惠'], [1, '2、门店要货'], [1, '3、员工交通补贴']]);
  // 第一行是标题本身的位置；第二行是那一行第一个字的位置
  assert.equal(toc[0].pos, 0); assert.equal(toc[0].at, 0); assert.equal(toc[1].pos, 0);
  assert.equal(doc.textBetween(toc[1].at, toc[1].at + 2), '2、');
  assert.equal(toc[2].pos, doc.child(0).nodeSize);
  assert.deepEqual(tocOf(doc, false).map((i) => i.text), ['1、收银台优惠 2、门店要货', '3、员工交通补贴']);
});
await t('目录：空行、只有空格的行不单独列；没有字的标题还是一项', () => {
  const doc = sch.node('doc', null, [lines('heading', { level: 2 }, '', '甲', ' ', '', '乙', ''), lines('heading', { level: 3 })]);
  assert.deepEqual(tocOf(doc).map((i) => [i.text, i.at === i.pos]), [['甲', true], ['乙', false], ['', true]]);
});

/** 在 doc 上选中 from..to，设成 level 级标题，返回改完的文档和光标所在的那一块的文字 */
const setH = (doc, from, to, level) => {
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, from, to) }), tr = state.tr;
  const ok = setHeadingLines(tr, sch.nodes.heading, level);
  return { ok, doc: tr.doc, at: tr.selection.$from.parent.textContent };
};
await t('设成标题：段里的软换行拆成几个标题，对齐和行距留着、书签只在第一行，光标跟着原来那行', () => {
  const doc = sch.node('doc', null, [lines('paragraph', { textAlign: 'center', anchor: 'h_a', lineHeight: 1.5 }, '1、收银台优惠', '2、门店要货'), lines('paragraph', null, '3、员工交通补贴')]);
  // 光标在「门店」那一行，选到第三段
  const r = setH(doc, 12, doc.content.size - 2, 1);
  assert.ok(r.ok);
  assert.deepEqual(shape(r.doc), [['h1', '1、收银台优惠', 'h_a', 1.5], ['h1', '2、门店要货', null, 1.5], ['h1', '3、员工交通补贴', null, null]]);
  assert.equal(r.doc.child(1).attrs.textAlign, 'center');
  assert.equal(r.at, '2、门店要货');
  assert.equal(tocOf(r.doc).length, 3);
});
await t('设成标题：只有光标、没选范围时整段都拆；空行、开头结尾的软换行直接去掉，不留空标题', () => {
  const doc = sch.node('doc', null, [lines('paragraph', null, '', '甲', '', '', '乙', '')]);
  const r = setH(doc, 3, 3, 2);
  assert.deepEqual(shape(r.doc), [['h2', '甲', null, null], ['h2', '乙', null, null]]);
});
await t('设成标题：已经是标题的改级别也拆开；列表项的第一段交给 setHeading（返回 false、什么都不动）', () => {
  const doc = sch.node('doc', null, [lines('heading', { level: 1 }, '一', '二')]);
  assert.deepEqual(shape(setH(doc, 1, 1, 3).doc), [['h3', '一', null, null], ['h3', '二', null, null]]);
  const list = sch.node('doc', null, [sch.node('bulletList', null, [sch.node('listItem', null, [lines('paragraph', null, '条目', '第二行')])])]);
  const r = setH(list, 4, 4, 1);
  assert.equal(r.ok, false);
  assert.ok(r.doc.eq(list));
});
await t('行距：只认工具栏上那几种（数字或字符串），页面上按单倍 1.3 换算', () => {
  assert.deepEqual([1, '1.15', 1.5, '2', 2.5, 3].map(lineHeightOf), [1, 1.15, 1.5, 2, 2.5, 3]);
  assert.deepEqual([1.6, '24px', '', null, '150%', 0].map(lineHeightOf), [null, null, null, null, null, null]);
  assert.deepEqual([1, 1.15, 1.5, 3].map(lineCss), ['1.3', '1.495', '1.95', '3.9']);
});

console.log(process.exitCode ? '有没通过的' : `全部通过（${n} 组）`);

/**
 * 文档导入时认标题（apps/editors/src/doc/headings.ts 的 outlineHeadings、prepareDocx）的自测：
 * Word 的标题不一定用叫 heading 1～6 的样式——段落自己写大纲级别、样式起了别的名字、样式是「基于」标题样式建的，都要认成标题。
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

console.log(process.exitCode ? '有没通过的' : `全部通过（${n} 组）`);

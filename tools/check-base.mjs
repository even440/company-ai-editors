/**
 * 多维表格不碰界面的那部分（model.ts、book.ts、formula.ts、lark.ts）的自测：字段类型的值和显示、筛选、公式、关联和查找引用的重算、导入 Lark 的 .base。
 * 这个仓库没有测试框架，直接用 Node 跑 TypeScript 源码（要 Node 22.15 以上：去类型、module.registerHooks）：
 *   node --experimental-strip-types tools/check-base.mjs
 * 全部通过时最后一行是「全部通过（N 组）」，有不过的会列出来、退出码是 1。改了这几个文件以后跑一遍；加了功能在这里补一组。
 * 导入用的 tools/samples/sample.base 是照真实导出文件的结构造的，内容是编的。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';

// 源码里的相对引用不写扩展名（给 Vite 用的），这里补上 .ts；shell/i18n.ts 一加载就读地址栏和 <html>，垫两个假的
registerHooks({ resolve(spec, ctx, next) { try { return next(spec, ctx); } catch (e) { if (spec.startsWith('.')) return next(spec + '.ts', ctx); throw e; } } });
globalThis.location = { search: '?ui=zh-CN' };
globalThis.document = { documentElement: {} };

const ED = new URL('../apps/editors/src/base/', import.meta.url).href;
const { readLark, convertLark, LarkError } = await import(ED + 'lark.ts');
const M = await import(ED + 'model.ts');
const buf = fs.readFileSync(new URL('./samples/sample.base', import.meta.url));
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const users = new Map([['u1', { id: 'u1', name: '李娜', dept: '销售', tint: 'blue' }]]);
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗', name, '\n ', e.message); process.exitCode = 1; } };

/* ---- 导入 ---- */
const B = await import(ED + 'book.ts');
const FX = await import(ED + 'formula.ts');
const lark = await readLark(ab(buf));
t('两张表、分页的记录合起来', () => { assert.deepEqual(lark.tables.map((x) => [x.name, x.fields, x.records]), [['货柜', 30, 3], ['费用', 4, 1]]); assert.equal(lark.timezone, 'America/Sao_Paulo'); });
const got = convertLark(lark), notes = got.notes;
const book = B.recompute(got.book, users);
const c = book.tables[0], c2 = book.tables[1];
const byName = (name, tb = c) => tb.fields.find((f) => f.name === name);
const r = (id) => c.records.find((x) => x.id === id);
t('字段类型对应', () => {
  assert.deepEqual(book.tables.map((x) => [x.id, x.name]), [['tblShip0001', '货柜'], ['tblCost0002', '费用']]);
  const types = Object.fromEntries(c.fields.map((f) => [f.name, f.type]));
  assert.deepEqual(types, { 清单编号: 'text', 进度: 'stage', 目的港: 'select', 认证: 'multi', 预计到港: 'date', 装货时间: 'date', 箱数: 'number', 立方: 'number', 清关费: 'currency', 进度百分比: 'progress', 评分: 'rating',
    已登记: 'check', 提单号: 'barcode', 联系邮箱: 'email', 电话: 'phone', 跟踪链接: 'url', 报关单: 'attach', 负责人: 'text', 父记录: 'link', 校验: 'formula', 费用: 'duplex', 费用金额: 'text', 仓库: 'location', 群: 'text', 外部表: 'text',
    标号: 'autonum', 创建时间: 'created', 修改时间: 'updated', 创建人: 'text', 按钮: 'button' });
});
t('字段的设置', () => {
  assert.equal(byName('装货时间').time, true); assert.equal(byName('预计到港').time, undefined);
  assert.equal(byName('箱数').dec, 0); assert.equal(byName('立方').dec, 2);
  assert.deepEqual([byName('清关费').cur, byName('清关费').dec], ['BRL', 2]);
  assert.equal(byName('标号').next, 13, '接着导出文件里记的最大号');
  assert.deepEqual(byName('目的港').opts.map((o) => o[0]), ['Santos', 'Itajaí'], '去掉空格后重名的选项并成一个');
  assert.deepEqual(byName('进度').opts.map((o) => o[0]), ['装柜', '海运中', '清关', '已签收', '暂停']);
  assert.deepEqual(byName('进度').flow, { strict: true, first: true, steps: {
    装柜: { show: ['fldNo', 'fldBoxes'], need: [{ fid: 'fldBoxes', op: 'nempty', val: '' }] }, 海运中: { show: ['fldEta'], need: [{ fid: 'fldEta', op: 'nempty', val: '' }, { fid: 'fldFee', op: 'nempty', val: '' }] },
    清关: { show: ['fldFee'] }, 已签收: { end: 'done' }, 暂停: { end: 'stop' } } }, '流程每个阶段的字段、流转条件、结束的阶段都带过来');
  assert.equal(byName('校验').expr, 'IF(LEFT({清单编号},2)="DF",{箱数}*2,"不匹配")', '公式里按编号的引用换成 {字段名}');
  assert.deepEqual([byName('父记录').to, byName('父记录').back], ['tblShip0001', undefined]);
  assert.deepEqual([byName('费用').to, byName('费用').back, byName('货柜', c2).to, byName('货柜', c2).back], ['tblCost0002', 'fldShip', 'tblShip0001', 'fldCosts'], '双向关联两边成对');
  assert.equal(byName('按钮').label, '按钮');
});
t('记录的顺序和值', () => {
  assert.deepEqual(c.records.map((x) => x.id), ['recC', 'recA', 'recB'], '照第一个视图的顺序');
  const a = r('recA').v;
  assert.equal(a.fldNo, 'DF-001'); assert.equal(a.fldStage, '装柜'); assert.equal(a.fldPort, 'Santos'); assert.deepEqual(a.fldCert, ['ANVISA', 'INMETRO']);
  assert.equal(a.fldEta, '2026-10-09', '按表格的时区读日期'); assert.equal(a.fldLoad, '2026-10-09 14:30');
  assert.equal(a.fldBoxes, 800); assert.equal(a.fldFee, 25600); assert.equal(a.fldDone, 60, '进度从 0–1 换成百分数'); assert.equal(a.fldRate, 4);
  assert.equal(a.fldOk, true); assert.equal(a.fldMail, 'ops@example.com'); assert.equal(a.fldTel, '+55 11 99999-0000'); assert.equal(a.fldUrl, 'https://example.com/track/DF-001');
  assert.equal(a.fldOwner, 'LI NA'); assert.equal(a.fldBy, 'LI NA'); assert.equal(a.fldSeq, 1); assert.equal(r('recB').v.fldPort, 'Santos'); assert.equal(r('recB').v.fldFee, '');
  assert.equal(r('recA').ct, 1794245578000); assert.equal(r('recA').ut, 1794245826000);
  assert.ok(!('fldDoc' in a) && !('fldCt' in a), '附件、创建时间不往 v 里写');
  assert.deepEqual(a.fldCosts, ['recX'], '关联只留文件里真有的记录'); assert.deepEqual(a.fldParent, ['recC']); assert.deepEqual(c2.records[0].v.fldShip, ['recA']);
  assert.deepEqual(a.fldWhere, { addr: 'Porto de Santos, SP', lat: -23.9608, lng: -46.3336 });
  assert.equal(a.fldCalc, 1600, '导入的公式算出来了'); assert.equal(M.textOf(byName('费用'), a.fldCosts, users), '海运费', '关联显示对方记录的标题'); assert.equal(M.textOf(byName('父记录'), a.fldParent, users), 'DF-003');
});
t('视图：隐藏、排序、筛选、看板', () => {
  const v = Object.fromEntries(c.views.map((x) => [x.name, x]));
  assert.deepEqual(c.views.map((x) => x.type), ['grid', 'grid', 'grid', 'grid', 'kanban', 'form']);
  assert.deepEqual(v['全流程'].hidden, ['fldOut']); assert.deepEqual(v['全流程'].sort, { fid: 'fldEta', dir: 'asc' });
  assert.deepEqual(v['未签收'].filters, [{ fid: 'fldStage', op: 'eq', val: '装柜', vals: ['装柜', '海运中', '清关'] }]);
  assert.deepEqual(v['Santos 在途'].filters, [{ fid: 'fldPort', op: 'eq', val: 'Santos' }, { fid: 'fldStage', op: 'ne', val: '已签收' }, { fid: 'fldFee', op: 'nempty', val: '' }]);
  assert.equal(v['任一条件'].filters, undefined); assert.equal(v['看板'].group, 'fldStage', '看板按流程字段分组');
  assert.deepEqual(M.visibleRecords(c, v['全流程'], users).map((x) => x.id), ['recC', 'recA', 'recB']);
  assert.deepEqual(M.visibleRecords(c, v['未签收'], users).map((x) => x.id), ['recA', 'recB']);
  assert.deepEqual(M.visibleRecords(c, v['Santos 在途'], users).map((x) => x.id), ['recA'], '三个条件同时满足');
});
t('导入结果的说明', () => {
  assert.deepEqual({ ...notes }, { tables: 2, fields: 34, records: 4, views: 7, asText: ['费用金额', '群', '外部表'], people: ['负责人', '创建人'], attach: ['报关单'], formulas: ['校验'], filters: ['任一条件'], groups: ['全流程'], dropped: ['按钮'] });
});
t('存回去再读出来不变（第一张表在最外层，别的在 tables 里）', () => {
  const saved = JSON.parse(JSON.stringify(B.serialize(book)));
  assert.deepEqual(Object.keys(saved), ['tid', 'name', 'fields', 'records', 'views', 'tables']); assert.equal(saved.tables.length, 1); assert.equal(saved.fields.length, 30);
  const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => (v === null || (Array.isArray(v) && !v.length && (k === 'filters' || k === 'hidden')) ? undefined : v)));
  assert.deepEqual(strip(B.recompute(B.normalizeBook(saved), users)), strip(book));
  assert.match(B.plainOfBook(book, users), /^【货柜】\n清单编号: DF-003[^\n]*\n[^\n]*\n[^\n]*\n【费用】\n费用项: 海运费 金额: ¥12,000\.00 编号: FY-2026-007 货柜: DF-001$/);
});
t('带前缀的自动编号改成文本', () => { assert.equal(byName('编号', c2).type, 'text'); assert.equal(c2.records[0].v.fldCode, 'FY-2026-007'); assert.equal(byName('金额', c2).cur, 'CNY'); });
t('以前的内容原样就是一张表', () => {
  const old = B.normalizeBook({ fields: [{ id: 'f1', name: '客户', type: 'text' }], records: [{ id: 'r1', v: { f1: '星河' } }], views: [{ id: 'v1', name: '表格', type: 'grid' }] });
  assert.equal(old.tables.length, 1); assert.deepEqual([old.tables[0].id, old.tables[0].name], ['t1', '数据表']);
  assert.deepEqual(Object.keys(B.serialize(old)), ['tid', 'name', 'fields', 'records', 'views']); assert.equal(B.normalizeBook({}).tables[0].fields.length, 4, '空内容还是四个默认字段');
});
for (const [name, bad] of [['不是 JSON', 'hello'], ['没有快照', '{"a":1}'], ['快照不是 gzip', '{"gzipSnapshot":"aGVsbG8="}']]) {
  let code = ''; try { await readLark(ab(Buffer.from(bad))); } catch (e) { code = e instanceof LarkError ? e.code : 'other'; }
  t('读不了的文件：' + name, () => assert.equal(code, 'notLark'));
}

/* ---- 公式 ---- */
const ev = (expr, vals = {}, id = 'recZ') => FX.evaluate(expr, { id, get: (n) => { if (!(n in vals)) throw new FX.FormulaError('field'); return vals[n]; } });
t('公式：运算和优先级', () => {
  assert.equal(ev('1 + 2 * 3'), 7); assert.equal(ev('(1 + 2) * 3'), 9); assert.equal(ev('2 ^ 3 ^ 2'), 512); assert.equal(ev('-2 ^ 2'), 4); assert.equal(ev('0.1 + 0.2'), 0.3); assert.equal(ev('10 / 4'), 2.5);
  assert.equal(ev('"a" & 1 + 2'), 'a3'); assert.equal(ev('1 + 2 = 3'), true); assert.equal(ev('"b" > "a"'), true); assert.equal(ev('3 <> 3'), false); assert.equal(ev('"10" > 9'), true, '数字样子的文字按数字比');
  assert.equal(ev('{金额} * 1.12', { 金额: 100 }), 112); assert.equal(ev('{金额} + 1', { 金额: null }), 1, '空的当 0'); assert.equal(ev('{a} & "-" & {b}', { a: 'X', b: 7 }), 'X-7'); assert.equal(ev('="x" + "y"'), 'xy');
  assert.equal(ev('IF（{金额} ＞ 50，“大”，‘小’）', { 金额: 100 }), '大', '中文的括号、逗号、引号也认'); assert.equal(ev('"他说""好"""'), '他说"好"');
});
t('公式：函数', () => {
  assert.equal(ev('IF(1 > 2, "a")'), ''); assert.equal(ev('if(AND(1, "x"), "y", "n")'), 'y'); assert.equal(ev('OR(0, "", FALSE)'), false); assert.equal(ev('NOT(ISBLANK({x}))', { x: '' }), false);
  assert.equal(ev('SUM(1, 2, {x})', { x: null }), 3); assert.equal(ev('AVERAGE(2, 4)'), 3); assert.equal(ev('MAX(3, 9, 4) - MIN(3, 9, 4)'), 6); assert.equal(ev('ROUND(3.14159, 2)'), 3.14); assert.equal(ev('ROUNDUP(3.1)'), 4); assert.equal(ev('ROUNDDOWN(-3.9)'), -3);
  assert.equal(ev('INT(3.9) + ABS(-2) + MOD(7, 3) + POWER(2, 3) + SQRT(16)'), 3 + 2 + 1 + 8 + 4);
  assert.equal(ev('LEN("货柜AB")'), 4); assert.equal(ev('LEFT("DF-001", 2) & RIGHT("DF-001", 3) & MID("DF-001", 3, 1)'), 'DF001-'); assert.equal(ev('UPPER("a") & LOWER("B") & TRIM("  c ")'), 'Abc');
  assert.equal(ev('CONCATENATE("a", 1, TRUE)'), 'a1TRUE'); assert.equal(ev('VALUE("1,200.5") + 1'), 1201.5); assert.equal(ev('CONTAIN("Santos", "ant")'), true); assert.equal(ev('FIND("n", "Santos")'), 3); assert.equal(ev('SUBSTITUTE("a-b-c", "-", "/")'), 'a/b/c');
  assert.equal(ev('IFERROR(1 / 0, "除不了")'), '除不了'); assert.equal(ev('IFERROR({没有这个字段}, 0)'), 0); assert.equal(ev('IFBLANK({x}, "空")', { x: '' }), '空'); assert.equal(ev('IFS(1 > 2, "a", 2 > 1, "b")'), 'b');
  assert.equal(ev('RECORD_ID()', {}, 'recA'), 'recA'); assert.equal(ev('IF(LEFT({任务},LEN(RECORD_ID())+1)=RECORD_ID()&":","记录匹配","记录不匹配")', { 任务: 'recA:清关' }, 'recA'), '记录匹配', '用户那份 Lark 表里的公式');
});
t('公式：日期', () => {
  assert.equal(ev('{到港} - {装货}', { 到港: '2026-10-09', 装货: '2026-08-13' }), 57); assert.equal(ev('{到港} + 7', { 到港: '2026-10-28' }), '2026-11-04'); assert.equal(ev('{t} - 1', { t: '2026-03-01 08:30' }), '2026-02-28 08:30');
  assert.equal(ev('YEAR({d}) & "/" & MONTH({d}) & "/" & DAY({d})', { d: '2026-10-09' }), '2026/10/9'); assert.equal(ev('HOUR({d}) * 60 + MINUTE({d})', { d: '2026-10-09 14:30' }), 870); assert.equal(ev('WEEKDAY("2026-11-10")'), 3);
  assert.equal(ev('DAYS("2026-10-09", "2026-10-01")'), 8); assert.equal(ev('DATEDIF("2026-01-31", "2026-03-01", "M")'), 1); assert.equal(ev('DATEDIF("2024-06-15", "2026-06-14", "Y")'), 1); assert.equal(ev('DATE(2026, 2, 30)'), '2026-03-02');
  assert.match(String(ev('TODAY()')), /^\d{4}-\d\d-\d\d$/); assert.match(String(ev('NOW()')), /^\d{4}-\d\d-\d\d \d\d:\d\d$/); assert.equal(typeof ev('{d} - TODAY()', { d: '2030-01-01' }), 'number');
});
t('公式：写错、算不出都是 #ERROR', () => {
  for (const bad of ['', '1 +', 'IF(1', 'NOPE(1)', '{没关上', '"没关上', '1 2', 'abc', '1 / 0', '{没有}', 'LEFT()', 'YEAR("不是日期")', '"a" * 2', '@']) assert.equal(ev(bad), FX.ERR, bad);
  assert.equal(FX.formulaOk('IF({a} > 1, 2, 3)'), true); assert.equal(FX.formulaOk('IF({a} > 1, 2'), false); assert.deepEqual(FX.refsOf('{a} + {b 1} * {a}'), ['a', 'b 1']); assert.equal(FX.renameRef('{金额} + {金额2}', '金额', '费用'), '{费用} + {金额2}');
});

/* ---- 几张表：关联、查找引用、公式的重算 ---- */
const demo = () => B.normalizeBook({ tid: 't1', name: '货柜',
  fields: [{ id: 'n', name: '编号', type: 'text' }, { id: 'fee', name: '清关费', type: 'currency', cur: 'BRL' }, { id: 'tax', name: '含税', type: 'formula', expr: 'ROUND({清关费} * 1.1, 2)' }, { id: 'big', name: '大单', type: 'formula', expr: '{含税} > 1000' },
    { id: 'firm', name: '清关行', type: 'duplex', to: 't2', back: 'ships' }, { id: 'tel', name: '清关行电话', type: 'lookup', via: 'firm', pick: 'phone' }, { id: 'lv', name: '清关行等级', type: 'formula', expr: 'IF({清关行电话} = "", "没填电话", "可联系")' }],
  records: [{ id: 'a', v: { n: 'DF-1', fee: 1000, firm: ['x'] } }, { id: 'b', v: { n: 'DF-2', fee: 500, firm: ['x', 'gone'] } }, { id: 'c', v: { n: 'DF-3' } }], views: [],
  tables: [{ id: 't2', name: '清关行', fields: [{ id: 'name', name: '名称', type: 'text' }, { id: 'phone', name: '电话', type: 'phone' }, { id: 'ships', name: '货柜', type: 'duplex', to: 't1', back: 'firm' },
    { id: 'cnt', name: '货柜数', type: 'lookup', via: 'ships', agg: 'count' }, { id: 'sum', name: '含税合计', type: 'lookup', via: 'ships', pick: 'tax', agg: 'sum' }, { id: 'list', name: '货柜清单', type: 'lookup', via: 'ships', pick: 'n' }],
    records: [{ id: 'x', v: { name: '华通报关', phone: '+55 13', ships: ['a', 'b'] } }, { id: 'y', v: { name: '顺达报关' } }], views: [] }] });
// 算出来是空的、原来又没有值的格子不往 v 里写（免得白白改记录），读的时候当空字符串
const rv = (bk, ti, rid) => new Proxy(bk.tables[ti].records.find((x) => x.id === rid).v, { get: (o, k) => (k in o ? o[k] : '') });
t('重算：公式、公式引用公式、查找引用、跨表汇总', () => {
  const bk = B.recompute(demo(), users);
  assert.deepEqual([rv(bk, 0, 'a').tax, rv(bk, 0, 'a').big, rv(bk, 0, 'b').tax, rv(bk, 0, 'b').big, rv(bk, 0, 'c').tax], [1100, true, 550, false, 0]);
  assert.deepEqual(rv(bk, 0, 'b').firm, ['x'], '指向不存在的记录的关联清掉'); assert.equal(rv(bk, 0, 'a').tel, '+55 13'); assert.equal(rv(bk, 0, 'c').tel, ''); assert.deepEqual([rv(bk, 0, 'a').lv, rv(bk, 0, 'c').lv], ['可联系', '没填电话'], '公式用到本表的查找引用');
  assert.deepEqual([rv(bk, 1, 'x').cnt, rv(bk, 1, 'x').sum, rv(bk, 1, 'x').list, rv(bk, 1, 'y').cnt, rv(bk, 1, 'y').sum], [2, 1650, 'DF-1、DF-2', 0, ''], '查找引用取的是对方的公式');
  assert.equal(B.recompute(bk, users), bk, '没变的时候还是原来的对象');
  assert.equal(M.textOf(bk.tables[0].fields[4], ['x'], users), '华通报关'); assert.equal(M.matches(bk.tables[0].fields[4], ['x'], { fid: 'firm', op: 'has', val: '华通' }, users), true, '关联字段按标题筛');
});
t('公式互相引用成环、引用的字段不在', () => {
  const bk = B.recompute(B.normalizeBook({ fields: [{ id: 'a', name: 'A', type: 'formula', expr: '{B} + 1' }, { id: 'b', name: 'B', type: 'formula', expr: '{A} + 1' }, { id: 'c', name: 'C', type: 'formula', expr: '{没有} + 1' }, { id: 'd', name: 'D', type: 'formula', expr: 'IFERROR({C}, "兜底")' }], records: [{ id: 'r', v: {} }], views: [] }), users);
  assert.deepEqual({ ...bk.tables[0].records[0].v }, { a: '#ERROR', b: '#ERROR', c: '#ERROR', d: '兜底' });
});
t('双向关联：这边改，对方那边跟着变', () => {
  let bk = B.recompute(demo(), users);
  bk = B.recompute(B.setLink(bk, 't1', 'c', 'firm', ['y', 'x'], 'u1', 9000), users);
  assert.deepEqual(rv(bk, 1, 'y').ships, ['c']); assert.deepEqual(rv(bk, 1, 'x').ships, ['a', 'b', 'c']); assert.equal(rv(bk, 1, 'x').cnt, 3);
  const c1 = bk.tables[0].records.find((x) => x.id === 'c'); assert.deepEqual([c1.ut, c1.ub], [9000, 'u1']); assert.equal(bk.tables[1].records[0].ut, undefined, '对方那一侧是跟着变的，不算别人改了它');
  bk = B.recompute(B.setLink(bk, 't2', 'x', 'ships', ['b']), users);
  assert.deepEqual([rv(bk, 0, 'a').firm, rv(bk, 0, 'b').firm, rv(bk, 0, 'c').firm], [[], ['x'], ['y']]); assert.equal(rv(bk, 1, 'x').sum, 550);
  // 删掉一条记录：对方那边的关联和汇总跟着没了
  bk = B.recompute(B.patchTable(bk, 't1', (x) => ({ ...x, records: x.records.filter((y) => y.id !== 'b') })), users);
  assert.deepEqual([rv(bk, 1, 'x').ships, rv(bk, 1, 'x').cnt, rv(bk, 1, 'x').sum], [[], 0, '']);
});
t('加双向关联、拆对、删表', () => {
  let bk = B.normalizeBook({ tid: 't1', name: '订单', fields: [{ id: 'n', name: '单号', type: 'text' }, { id: 'k', name: '客户', type: 'link', to: 't2' }], records: [{ id: 'o1', v: { n: 'A', k: ['c1'] } }], views: [],
    tables: [{ id: 't2', name: '客户', fields: [{ id: 'm', name: '名称', type: 'text' }, { id: 'old', name: '订单', type: 'text' }], records: [{ id: 'c1', v: { m: '星河' } }], views: [] }] });
  bk = B.pairExisting(bk, 't1', 'k');
  const k = bk.tables[0].fields[1], pair = bk.tables[1].fields[2];
  assert.deepEqual([k.type, pair.type, pair.to, pair.back, k.back === pair.id, pair.name], ['duplex', 'duplex', 't1', 'k', true, '订单（2）'], '成对的字段用这张表的名字，重名就加序号'); assert.deepEqual(bk.tables[1].records[0].v[pair.id], ['o1'], '已有的关联记到对方那边');
  bk = B.addDuplex(bk, 't1', { id: 'self', name: '上级', type: 'duplex', to: 't1' });
  assert.equal(bk.tables[0].fields.at(-1).name, '上级（反向）', '关联本表时成对的字段叫「（反向）」'); assert.equal(bk.tables[0].fields.length, 4);
  const un = B.unpair(bk, bk.tables[0].fields[1]); assert.deepEqual([un.tables[1].fields[2].type, un.tables[1].fields[2].back], ['link', undefined]);
  const dropped = B.dropTable(B.recompute(bk, users), 't2', users);
  assert.equal(dropped.tables.length, 1); assert.deepEqual([dropped.tables[0].fields[1].type, dropped.tables[0].records[0].v.k], ['text', '星河'], '指着被删的表的关联变成文本，留下标题');
  assert.equal(B.freshName(['a', 'a（2）'], 'a'), 'a（3）'); assert.equal(B.newTable(bk, '').name, '数据表 3');
  assert.deepEqual(B.renameInFormulas({ fields: [{ id: 'x', name: 'X', type: 'formula', expr: '{金额} * 2' }], records: [], views: [] }, '金额', '费用')[0].expr, '{费用} * 2');
});
t('流程：一步一步走，流转条件没满足不让进下一阶段；回退、中止随时可以', () => {
  const f = byName('进度'), rec = (id) => c.records.find((x) => x.id === id);
  const b = (id, to) => M.stageBlock(c, f, rec(id), to, users);
  // recA 在「装柜」，箱数填了
  assert.equal(b('recA', '海运中'), null); assert.deepEqual(b('recA', '清关'), { why: 'order', next: '海运中' }, '不能跳'); assert.equal(b('recA', '暂停'), null, '中止随时能进'); assert.equal(b('recA', ''), null);
  // recB 在「海运中」，预计到港填了、清关费没填
  assert.deepEqual(b('recB', '清关'), { why: 'need', stage: '海运中', missing: ['清关费'] }); assert.equal(b('recB', '装柜'), null, '往回退可以');
  assert.deepEqual(M.stageMissing(c, f, '海运中', rec('recB'), users), ['清关费']); assert.equal(M.stageNext(f, '清关'), '已签收'); assert.equal(M.stageNext(f, '已签收'), null, '最后一个进行的阶段后面只剩中止，不算下一步');
  // 不严格的：能跳，但路过的阶段的条件都要满足
  const loose = { ...f, flow: { ...f.flow, strict: false } };
  assert.equal(M.stageBlock(c, loose, rec('recA'), '清关', users), null, 'recA 的箱数、预计到港、清关费都填了，能一下跳两步'); assert.deepEqual(M.stageBlock(c, loose, rec('recB'), '已签收', users), { why: 'need', stage: '海运中', missing: ['清关费'] });
  assert.equal(M.stageBlock(c, loose, rec('recC'), '装柜', users), null);
  const paused = { id: 'p', v: { fldStage: '暂停' } }; assert.equal(M.stageBlock(c, f, paused, '清关', users), null, '从中止的阶段回到哪一步都行');
  const blank = { id: 'n', v: {} }; assert.deepEqual(M.stageBlock(c, f, blank, '海运中', users), { why: 'order', next: '装柜' }); assert.equal(M.stageBlock(c, f, blank, '装柜', users), null);
  // 没设过规矩的流程就是有先后的单选，随便选
  assert.equal(M.hasFlow({ id: 's', name: 's', type: 'stage', opts: [['a', 'gray'], ['b', 'gray']] }), false); assert.equal(M.hasFlow(f), true);
  // 新记录从第一个阶段开始
  assert.equal(M.newRecord(c, 'new1', {}, 'u1').rec.v.fldStage, '装柜'); assert.equal(M.newRecord(c, 'new2', { fldStage: '清关' }, 'u1').rec.v.fldStage, '清关');
});
t('查找引用：按条件到另一张表里找（照 Lark）', () => {
  const bk = B.recompute(B.normalizeBook({ tid: 'o', name: '订单',
    fields: [{ id: 'no', name: '单号', type: 'text' }, { id: 'cust', name: '客户', type: 'text' }, { id: 'amt', name: '金额', type: 'number' },
      { id: 'tel', name: '客户电话', type: 'lookup', from: 'c', pick: 'phone', where: [{ fid: 'name', op: 'eq', src: 'cust' }] },
      { id: 'same', name: '同客户的别的单', type: 'lookup', from: 'o', pick: 'no', where: [{ fid: 'cust', op: 'eq', src: 'cust' }] },
      { id: 'big', name: '比这单大的单数', type: 'lookup', from: 'o', agg: 'count', where: [{ fid: 'cust', op: 'eq', src: 'cust' }, { fid: 'amt', op: 'gt', src: 'amt' }] }],
    records: [{ id: 'a', v: { no: 'A', cust: '星河', amt: 100 } }, { id: 'b', v: { no: 'B', cust: '星河', amt: 300 } }, { id: 'c', v: { no: 'C', cust: '海川', amt: 50 } }, { id: 'd', v: { no: 'D' } }], views: [],
    tables: [{ id: 'c', name: '客户', fields: [{ id: 'name', name: '名称', type: 'text' }, { id: 'phone', name: '电话', type: 'phone' }, { id: 'lv', name: '等级', type: 'select', opts: [['A', 'blue']] },
      { id: 'total', name: '订单总额', type: 'lookup', from: 'o', pick: 'amt', agg: 'sum', where: [{ fid: 'cust', op: 'eq', src: 'name' }] }, { id: 'n', name: '订单数', type: 'lookup', from: 'o', agg: 'count', where: [{ fid: 'cust', op: 'eq', src: 'name' }] },
      { id: 'kinds', name: '下过几种金额', type: 'lookup', from: 'o', pick: 'amt', agg: 'ucount', where: [{ fid: 'cust', op: 'eq', src: 'name' }] }, { id: 'fixed', name: '大单', type: 'lookup', from: 'o', pick: 'no', agg: 'uniq', where: [{ fid: 'amt', op: 'gt', val: '80' }] }],
      records: [{ id: 'x', v: { name: '星河', phone: '111' } }, { id: 'y', v: { name: '海川', phone: '222' } }, { id: 'z', v: { name: '没单的' } }], views: [] }] }), users);
  assert.deepEqual([rv(bk, 0, 'a').tel, rv(bk, 0, 'c').tel, rv(bk, 0, 'd').tel], ['111', '222', ''], '这边拿去比的是空的就什么都找不到');
  assert.deepEqual([rv(bk, 0, 'a').same, rv(bk, 0, 'c').same], ['B', ''], '找自己这张表时不算自己'); assert.deepEqual([rv(bk, 0, 'a').big, rv(bk, 0, 'b').big], [1, 0], '两个条件同时满足');
  assert.deepEqual([rv(bk, 1, 'x').total, rv(bk, 1, 'x').n, rv(bk, 1, 'y').total, rv(bk, 1, 'z').n, rv(bk, 1, 'z').total], [400, 2, 50, 0, '']); assert.equal(rv(bk, 1, 'x').kinds, 2); assert.equal(rv(bk, 1, 'x').fixed, 'A、B', '和固定值比');
  // 删掉对方那张表：按条件找它的查找引用变成文本，留下现在的字
  const dropped = B.dropTable(bk, 'c', users); assert.deepEqual([dropped.tables[0].fields[3].type, dropped.tables[0].records[0].v.tel], ['text', '111']);
});
t('按钮：依次改这条记录、新增记录、发消息、打开地址；被流程挡住时整个不做', () => {
  const mk = () => B.recompute(B.normalizeBook({ tid: 't1', name: '货柜',
    fields: [{ id: 'no', name: '单号', type: 'text' }, { id: 'st', name: '进度', type: 'stage', opts: [['装柜', 'gray'], ['海运中', 'blue'], ['清关', 'orange']], flow: { strict: true, steps: { 装柜: { need: [{ fid: 'eta', op: 'nempty', val: '' }] } } } },
      { id: 'eta', name: '预计到港', type: 'date' }, { id: 'who', name: '经办人', type: 'user' }, { id: 'at', name: '处理时间', type: 'date', time: true }, { id: 'grp', name: '通知群', type: 'group' },
      { id: 'go', name: '发船', type: 'button', acts: [{ do: 'set', set: [{ fid: 'st', how: 'next' }, { fid: 'who', how: 'me' }, { fid: 'at', how: 'now' }] }, { do: 'add', table: 't2', set: [{ fid: 'what', how: 'val', val: '发船' }, { fid: 'ship', how: 'this' }, { fid: 'ref', how: 'copy', from: 'no' }] },
        { do: 'msg', users: ['u9'], fields: ['who', 'grp'], text: '{单号} 已发船，现在是 {进度}' }, { do: 'open', href: 'https://e.com/t/{单号}' }, { do: 'open', href: 'javascript:alert(1)' }] }],
    records: [{ id: 'r1', v: { no: 'DF 1', st: '装柜', eta: '2026-10-09', grp: ['g1'] } }, { id: 'r2', v: { no: 'DF-2', st: '装柜' } }], views: [],
    tables: [{ id: 't2', name: '日志', fields: [{ id: 'what', name: '事件', type: 'text' }, { id: 'ship', name: '货柜', type: 'link', to: 't1' }, { id: 'ref', name: '单号', type: 'text' }, { id: 'n', name: '编号', type: 'autonum', next: 5 }], records: [], views: [] }] }), users);
  const bk = mk(), btn = bk.tables[0].fields[6];
  const res = B.runButton(bk, 't1', 'r1', btn, users, 'u1', new Date(2026, 10, 10, 9, 5));
  const r1 = res.book.tables[0].records[0];
  assert.deepEqual([r1.v.st, r1.v.who, r1.v.at, r1.ub], ['海运中', 'u1', M.today() + ' 09:05', 'u1']); assert.equal(res.error, undefined); assert.equal(res.did, 5);
  const log = res.book.tables[1].records; assert.equal(log.length, 1); assert.deepEqual([log[0].v.what, log[0].v.ship, log[0].v.ref, log[0].v.n, log[0].cb], ['发船', ['r1'], 'DF 1', 5, 'u1']); assert.equal(res.book.tables[1].fields[3].next, 6);
  assert.deepEqual(res.msgs, [{ users: ['u9', 'u1'], groups: ['g1'], text: 'DF 1 已发船，现在是 海运中' }], '消息里的 {字段名} 用的是改完以后的值；收件人加上记录里的人和群');
  assert.deepEqual(res.open, ['https://e.com/t/DF%201'], '只让打开网页，脚本地址不要'); assert.equal(bk.tables[0].records[0].v.st, '装柜', '不改原来的对象');
  // r2 没填预计到港：流程不让进下一阶段，按钮整个不做
  const no = B.runButton(bk, 't1', 'r2', btn, users, 'u1');
  assert.deepEqual(no.error, { why: 'need', stage: '装柜', missing: ['预计到港'] }); assert.equal(no.book, bk); assert.deepEqual([no.msgs, no.open, no.did], [[], [], 0]);
  // 以前只有一个地址的按钮读成「打开地址」；能填的字段、填法
  assert.deepEqual(M.normalize({ fields: [{ id: 'b', name: '看', type: 'button', href: 'https://e.com/{单号}' }], records: [], views: [] }).fields[0].acts, [{ do: 'open', href: 'https://e.com/{单号}' }]);
  assert.deepEqual(B.howsFor({ id: 'x', name: 'x', type: 'stage' }, false), ['val', 'next', 'copy', 'clear']); assert.deepEqual(B.howsFor({ id: 'x', name: 'x', type: 'link' }, true), ['this', 'copy', 'clear']);
  assert.equal(B.assignable({ id: 'x', name: 'x', type: 'formula' }), false); assert.equal(B.assignable({ id: 'x', name: 'x', type: 'date' }), true);
});
t('新类型的值：地理位置、签字、按钮、流程', () => {
  assert.deepEqual(M.locOf('Santos'), { addr: 'Santos' }); assert.deepEqual(M.locOf({ addr: '', lat: -23.5, lng: -46.6 }), { addr: '-23.50000, -46.60000', lat: -23.5, lng: -46.6 }); assert.equal(M.locOf(''), null);
  assert.deepEqual(M.locSet({ addr: 'A', lat: 1, lng: 2 }, 'B'), { addr: 'B', lat: 1, lng: 2 }); assert.equal(M.locSet('A', 'B'), 'B');
  assert.equal(M.textOf({ id: 's', name: '签收', type: 'sign' }, { id: 'f1', name: 'signature.png' }, users), '已签字'); assert.equal(M.signOf('x'), null);
  const cc = { fields: [{ id: 'n', name: '单号', type: 'text' }], records: [{ id: 'r', v: { n: 'DF 1/2' } }], views: [] };
  assert.equal(M.buttonUrl(cc, 'https://e.com/t/{单号}?q={没有}', cc.records[0], users), 'https://e.com/t/DF%201%2F2?q='); assert.equal(M.buttonUrl(cc, 'javascript:alert(1)', cc.records[0], users), null); assert.equal(M.buttonUrl(cc, '', cc.records[0], users), null);
  assert.equal(M.fillTemplate(cc, cc.records[0], '{单号} 到了，{ 单号 }', users), 'DF 1/2 到了，DF 1/2');
  assert.equal(M.isChoice('stage'), true); assert.equal(M.hasOpts({ id: 's', name: 's', type: 'stage' }), true); assert.equal(M.isAuto('formula'), true); assert.equal(M.isAuto('button'), false);
  assert.deepEqual(M.coerce({ type: 'link' }, ['a'], users, { id: 'x', name: 'x', type: 'duplex' }), ['a']); assert.deepEqual(M.coerce({ type: 'link' }, 'abc', users, { id: 'x', name: 'x', type: 'text' }), []);
  assert.equal(M.coerce({ type: 'text' }, { addr: 'Santos', lat: 1, lng: 2 }, users, { id: 'x', name: 'x', type: 'location' }), 'Santos'); assert.equal(M.coerce({ type: 'number' }, 1100, users, { id: 'x', name: 'x', type: 'formula' }), 1100);
  const all = M.TYPE_GROUPS.flatMap((g) => g[1]); assert.equal(all.length, 29); assert.deepEqual([...all].sort(), Object.keys(M.FT).sort(), '下拉框里的分组正好是全部类型');
});

/* ---- 模型 ---- */
const F = (type, more = {}) => ({ id: 'x', name: '字段', type, ...more });
t('数字类的显示', () => {
  assert.equal(M.fmtNumber(F('number'), 1234.5), '1,234.5'); assert.equal(M.fmtNumber(F('number', { dec: 2 }), 1234.5), '1,234.50');
  assert.equal(M.fmtNumber(F('currency', { cur: 'BRL', dec: 2 }), 1234.5), 'R$1,234.50'); assert.equal(M.fmtNumber(F('currency', { cur: 'CNY' }), 8), '¥8.00');
  assert.equal(M.fmtNumber(F('progress'), 60), '60%'); assert.equal(M.textOf(F('number'), 1234.5, users), '1234.5', '没设小数位数的数字在纯文本里照原样');
  assert.equal(M.textOf(F('attach'), [{ id: 'a', name: '报关单.pdf' }, { id: 'b', name: 'x.png' }], users), '报关单.pdf、x.png');
  assert.equal(M.textOf(F('creator'), 'u1', users), '李娜');
});
t('系统字段的值从记录上读', () => {
  const rec = { id: 'r', v: { x: 5 }, ct: 1000, ut: 2000, cb: 'u1' };
  assert.equal(M.val(F('created'), rec), 1000); assert.equal(M.val(F('updated'), rec), 2000); assert.equal(M.val(F('creator'), rec), 'u1'); assert.equal(M.val(F('editor'), rec), 'u1'); assert.equal(M.val(F('autonum'), rec), 5);
  assert.equal(M.val(F('created'), { id: 'o', v: {} }), '', '以前的记录没有，显示为空');
});
const flt = (op, val, vals) => ({ fid: 'x', op, val, ...(vals ? { vals } : {}) });
t('筛选：日期比先后（以前同一年比不出来）', () => {
  assert.equal(M.matches(F('date'), '2026-10-31', flt('gt', '2026-10-20'), users), true); assert.equal(M.matches(F('date'), '2026-10-08', flt('gt', '2026-10-20'), users), false);
  assert.equal(M.matches(F('date', { time: true }), '2026-10-20 09:00', flt('lt', '2026-10-20 12:00'), users), true);
  assert.equal(M.matches(F('number'), 100, flt('gt', '30'), users), true); assert.equal(M.matches(F('text'), '100', flt('gt', '30'), users), true, '文本里的数字还是按大小比');
});
t('筛选：新条件和几个值', () => {
  assert.equal(M.matches(F('select'), 'A', flt('ne', 'B'), users), true); assert.equal(M.matches(F('select'), '', flt('ne', 'B'), users), true);
  assert.equal(M.matches(F('select'), 'B', flt('eq', 'A', ['A', 'B']), users), true); assert.equal(M.matches(F('select'), 'C', flt('eq', 'A', ['A', 'B']), users), false);
  assert.equal(M.matches(F('select'), 'C', flt('ne', 'A', ['A', 'B']), users), true); assert.equal(M.matches(F('select'), 'B', flt('ne', 'A', ['A', 'B']), users), false);
  assert.equal(M.matches(F('multi'), ['A', 'C'], flt('has', 'B', ['B', 'C']), users), true); assert.equal(M.matches(F('text'), 'hello', flt('nhas', 'ell'), users), false);
  for (const [v, e] of [['', true], [[], true], [false, true], [null, true], [0, false], ['a', false], [[{ id: 'f' }], false]]) { assert.equal(M.matches(F('text'), v, flt('empty', ''), users), e); assert.equal(M.matches(F('text'), v, flt('nempty', ''), users), !e); }
  assert.equal(M.matches(F('currency', { cur: 'BRL' }), 1234.56, flt('eq', '1234.56'), users), true, '货币的「等于」按数值');
  assert.equal(M.filterActive(flt('empty', '')), true); assert.equal(M.filterActive(flt('eq', '')), false); assert.equal(M.filterDesc({ fields: [F('select')] }, flt('eq', 'A', ['A', 'B'])), '字段 是 A / B');
});
t('旧内容里的单个筛选条件读成列表', () => {
  const old = M.normalize({ fields: [{ id: 'f1', name: '客户', type: 'text' }], records: [{ id: 'r1', v: { f1: '星河' } }], views: [{ id: 'v1', name: '表格', type: 'grid', filter: { fid: 'f1', op: 'has', val: '星' } }] });
  assert.deepEqual(old.views[0].filters, [{ fid: 'f1', op: 'has', val: '星' }]); assert.equal('filter' in old.views[0], false); assert.equal(old.records[0].ct, undefined);
  const bad = M.normalize({ fields: [{ id: 'f1', name: 'a', type: 'currency', cur: 'xx', dec: 99 }, { id: 'f2', name: 'b', type: 'hologram' }], records: [], views: [] });
  assert.deepEqual(bad.fields.map((f) => [f.type, f.cur, f.dec]), [['currency', undefined, undefined], ['text', undefined, undefined]]);
});
t('新记录：时间、人、自动编号', () => {
  const base = { fields: [{ id: 'f1', name: '名称', type: 'text' }, { id: 'n', name: '编号', type: 'autonum', next: 7 }], records: [], views: [] };
  const a = M.newRecord(base, 'r1', { f1: 'x' }, 'u1', 5000);
  assert.deepEqual(a.rec, { id: 'r1', v: { f1: 'x', n: 7 }, ct: 5000, ut: 5000, cb: 'u1', ub: 'u1' }); assert.equal(a.fields[1].next, 8); assert.equal(base.fields[1].next, 7, '不改原来的对象');
  const plain = { fields: [{ id: 'f1', name: '名称', type: 'text' }], records: [], views: [] };
  assert.equal(M.newRecord(plain, 'r', {}, undefined).fields, plain.fields, '没有自动编号字段时字段不动');
  const num = M.renumber([{ id: 'a', v: {} }, { id: 'b', v: { n: 'old' } }], 'n'); assert.deepEqual(num.records.map((x) => x.v.n), [1, 2]); assert.equal(num.next, 3);
});
t('换类型时的转换', () => {
  assert.equal(M.coerce({ type: 'currency' }, '1,200.5', users), 1200.5); assert.equal(M.coerce({ type: 'rating' }, 9, users), 5); assert.equal(M.coerce({ type: 'date' }, '2026-10-09 14:30', users), '2026-10-09');
  assert.equal(M.coerce({ type: 'date', time: true }, '2026-10-09 14:30', users), '2026-10-09 14:30'); assert.equal(M.coerce({ type: 'text' }, [{ id: 'a', name: 'x.pdf' }], users), 'x.pdf');
  assert.deepEqual(M.coerce({ type: 'attach' }, 'abc', users), []); assert.equal(M.coerce({ type: 'created' }, 'abc', users), ''); assert.equal(M.coerce({ type: 'email' }, 'a@b.c', users), 'a@b.c');
  assert.equal(M.dateInput({ time: true }, '2026-10-09 14:30'), '2026-10-09T14:30'); assert.equal(M.dateStore({ time: true }, '2026-10-09T14:30'), '2026-10-09 14:30'); assert.equal(M.dateInput({}, '2026-10-09 14:30'), '2026-10-09');
});
t('排序、汇总、一句话筛选认新类型', () => {
  const cc = { fields: [{ id: 't', name: '客户', type: 'text' }, { id: 'm', name: '金额', type: 'currency', cur: 'BRL' }, { id: 'c', name: '创建时间', type: 'created' }], records: [{ id: 'a', v: { t: 'A', m: 200 }, ct: 3000 }, { id: 'b', v: { t: 'B', m: 1000 }, ct: 1000 }, { id: 'c', v: { t: 'C', m: 30 } }], views: [] };
  assert.deepEqual(M.sorted(cc, cc.records, { fid: 'm', dir: 'asc' }, users).map((x) => x.id), ['c', 'a', 'b'], '货币按数值排，不按文字');
  assert.deepEqual(M.sorted(cc, cc.records, { fid: 'c', dir: 'desc' }, users).map((x) => x.id), ['a', 'b', 'c'], '没有创建时间的排最后');
  assert.deepEqual(M.nlq(cc, '金额大于 100', users), { fid: 'm', op: 'gt', val: '100' });
  assert.match(M.summarize(cc, cc.records, users, '表格'), /金额：合计 1,230/);
  assert.match(M.plainOf(cc, users), /^客户: A 金额: R\$200\.00 创建时间: \d{4}-\d\d-\d\d \d\d:\d\d\n/);
});
console.log(process.exitCode ? '有失败' : `全部通过（${n} 组）`);

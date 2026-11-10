/**
 * 导入 Lark / 飞书多维表格的导出文件（.base）。
 *
 * 这个格式没有公开说明，下面是照 2026-11 导出的真实文件读出来的：
 * - 文件是一个 JSON：gzipSnapshot / gzipExtraInfo / gzipBaseRole / gzipAutomation…，每一项是 gzip 再 base64 的 JSON 文字。
 * - gzipSnapshot 解开是数组，每一项是「一张表的一页」：schema.data.table 是这张表的字段（fieldMap）、视图（views + viewMap），
 *   schema.data.recordMap 是这一页的记录（记录多时同一张表分成几项，按表的 id 合起来），schema.tableMap 是表名。
 * - 字段的 type 是数字（1 文本、2 数字、3 单选、4 多选、5 日期、7 复选框、11 人员、13 电话、15 链接、17 附件、18/21 关联、19 查找引用、
 *   20 公式、22 位置、23 群、24 流程、1001–1005 创建时间 / 修改时间 / 创建人 / 修改人 / 自动编号），fieldUIType 是界面上的细分
 *   （同是 2 的 Number / Currency / Progress / Rating，同是 1 的 Text / Barcode / Email）。
 * - 格子是 { value, modifiedTime, modifiedUser }：文本是 [{ type: 'text', text }] 这样的片段，单选 / 多选是选项的 id，日期是毫秒，
 *   创建时间是秒，自动编号是 [{ number }]；附件的文件、公式的结果导出文件里没有（公式的式子在字段的 property.formula 里，
 *   引用字段写成 bitable::$table[表].$field[字段]）。
 * - 流程字段的每个选项带 fieldsConfigInfo（这个阶段要处理的字段）、transitionRule（流转条件，和视图的筛选条件一个写法）、
 *   type（Default / EndDone / EndCancel）；字段的 property 里 convertMode（NextStage：只能进下一个阶段）、defaultValue（FirstStage）。
 * - 没见过真实样子的（那份文件里这些格子是空的）按猜的读，读不出来就是空：关联的值里找 rec 开头的记录编号，
 *   双向关联成对的字段找 property.backFieldId，地理位置找 fullAddress / name 和 "经度,纬度"。
 * 文件里的几张表一起导入成这边的几张数据表；不认识的类型按文本读，并在导入结果里说明。这里不碰 DOM。
 */
import type { Book, Table } from './book';
import { COLORS, type Field, type FieldType, type Filter, type FilterOp, type Flow, type Opt, type Rec, type StageCfg, type View, type ViewType } from './model';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const obj = (x: unknown): Obj => (isObj(x) ? x : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown) => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '');

export interface LarkTable { id: string; name: string; fields: number; records: number }
/** 读出来的文件：表的清单给界面选，其余留着给 convertLark */
export interface LarkBook { name: string; timezone: string; tables: LarkTable[]; raw: Map<string, { table: Obj; records: Obj; meta: Obj }>; autoNum: Obj }
/** 没法原样带过来的东西，按种类列出字段名、视图名 */
export interface ImportNotes { tables: number; fields: number; records: number; views: number; asText: string[]; people: string[]; attach: string[]; formulas: string[]; filters: string[]; groups: string[]; dropped: string[] }

/** 读不了的原因，界面按 code 给出说明 */
export class LarkError extends Error {
  code: 'notLark' | 'noTables' | 'unzip';
  constructor(code: 'notLark' | 'noTables' | 'unzip') { super(code); this.code = code; }
}

/** gzip + base64 的一段解成文字 */
async function gunzip(b64: string): Promise<string> {
  if (typeof DecompressionStream === 'undefined') throw new LarkError('unzip');
  let bytes: Uint8Array<ArrayBuffer>;
  try { const bin = atob(b64); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); } catch { throw new LarkError('notLark'); }
  try { return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); } catch { throw new LarkError('notLark'); }
}

/** 读 .base 文件：列出里面的表 */
export async function readLark(buf: ArrayBuffer): Promise<LarkBook> {
  let file: unknown;
  try { file = JSON.parse(new TextDecoder().decode(buf)); } catch { throw new LarkError('notLark'); }
  if (!isObj(file) || typeof file.gzipSnapshot !== 'string') throw new LarkError('notLark');
  let snap: unknown, extra: unknown = {};
  try { snap = JSON.parse(await gunzip(file.gzipSnapshot)); } catch (e) { throw e instanceof LarkError ? e : new LarkError('notLark'); }
  // 自动编号编到几了在另一段里，读不出来不要紧（按记录里最大的号接着编）
  if (typeof file.gzipExtraInfo === 'string') { try { extra = JSON.parse(await gunzip(file.gzipExtraInfo)); } catch { /* 没有也行 */ } }
  const raw: LarkBook['raw'] = new Map(), names = new Map<string, string>(), order: string[] = [];
  let name = '', timezone = '';
  for (const item of arr(snap)) {
    const schema = obj(obj(item).schema), base = obj(schema.base), data = obj(schema.data), table = obj(data.table), id = str(obj(table.meta).id);
    if (!id || !isObj(table.fieldMap)) continue;
    name ||= str(base.name); timezone ||= str(base.timezone);
    for (const [tid, t] of Object.entries(obj(schema.tableMap))) { const n = str(obj(t).name); if (n) names.set(tid, n); }
    for (const tid of arr(base.blocks)) if (typeof tid === 'string' && !order.includes(tid)) order.push(tid);
    const got = raw.get(id);
    // 同一张表的下一页：字段和视图每页都带一份，只把记录合进来
    if (got) { Object.assign(got.records, obj(data.recordMap)); Object.assign(got.meta, obj(data.recordMeta)); }
    else raw.set(id, { table, records: { ...obj(data.recordMap) }, meta: { ...obj(data.recordMeta) } });
  }
  if (!raw.size) throw new LarkError(Array.isArray(snap) ? 'noTables' : 'notLark');
  // 按 Lark 里左边栏的顺序列；清单里没有的排在后面
  const ids = [...order.filter((id) => raw.has(id)), ...[...raw.keys()].filter((id) => !order.includes(id))];
  const tables = ids.map((id) => { const t = raw.get(id)!; return { id, name: names.get(id) ?? '', fields: Object.keys(obj(t.table.fieldMap)).length, records: Object.keys(t.records).length }; });
  return { name, timezone, tables, raw, autoNum: obj(obj(extra).maxAutoNum) };
}

/** Lark 的选项颜色是 0–54 的序号，每 11 个一轮深浅；对到这边的 8 种颜色上 */
const LARK_HUES = ['red', 'orange', 'yellow', 'green', 'green', 'teal', 'blue', 'blue', 'purple', 'purple', 'gray'];
const colorOf = (n: unknown, i: number) => (typeof n === 'number' && n >= 0 ? LARK_HUES[n % LARK_HUES.length] : COLORS[i % COLORS.length]);

/** 时间戳写成某个时区的 YYYY-MM-DD（带时间的再加 HH:mm）。Lark 的日期是那天在表格时区的零点，按浏览器的时区读会差一天 */
function dateIn(ms: number, tz: string, withTime: boolean): string {
  const fmt = (zone: string | undefined) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  let parts: Intl.DateTimeFormatPart[];
  try { parts = fmt(tz || undefined); } catch { parts = fmt(undefined); }
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  const d = `${p('year')}-${p('month')}-${p('day')}`;
  return withTime ? `${d} ${p('hour')}:${p('minute')}` : d;
}

/** 文本类的格子：片段里的字连起来（链接取它显示的字，没有就取地址） */
function textOfCell(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '✓' : '';
  if (Array.isArray(v)) return v.map((x) => (isObj(x) ? str(x.text) || str(x.name) || str(x.link) || str(x.number) || str(x.fullAddress) : textOfCell(x))).filter(Boolean).join(isObj(v[0]) && v[0].type ? '' : '、');
  if (isObj(v)) return str(v.text) || str(v.name) || str(v.fullAddress) || str(v.link);
  return '';
}

interface Plan { field: Field; lark: Obj; kind: 'plain' | 'option' | 'options' | 'date' | 'number' | 'check' | 'autonum' | 'people' | 'url' | 'recs' | 'loc' | 'none'; optName?: Map<string, string>; scale?: number }

/** Lark 公式里的字段引用换成这边的 {字段名}：本表的直接换；别的表的写成 {表名.字段名}（这边引用不了，算出来是 #ERROR，一眼看得出要改哪里） */
function exprOf(formula: string, tableId: string, fieldNames: Map<string, Map<string, string>>, tableNames: Map<string, string>): string {
  return formula.replace(/bitable::\$table\[([^\]]+)\]\.\$field\[([^\]]+)\]/g, (_, t: string, f: string) => { const n = fieldNames.get(t)?.get(f) ?? f; return t === tableId ? `{${n}}` : `{${tableNames.get(t) ?? t}.${n}}`; });
}
/** 格子的值里所有 rec 开头的记录编号（关联字段的值没见过真实的样子，在哪一层都找） */
function recIds(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') { if (/^rec[A-Za-z0-9]+$/.test(v) && !out.includes(v)) out.push(v); }
  else if (Array.isArray(v)) v.forEach((x) => recIds(x, out));
  else if (isObj(v)) Object.values(v).forEach((x) => recIds(x, out));
  return out;
}

/** formatter 像 "0.00"、"#,##0.0"、"0%"：小数点后面有几个 0 就是几位小数 */
const decOf = (formatter: unknown): number | undefined => { const m = /\.(0+)/.exec(str(formatter)); return typeof formatter === 'string' && formatter ? (m ? m[1].length : 0) : undefined; };

/** 一个 Lark 字段变成这边的哪种字段，值怎么读 */
function planField(id: string, lf: Obj, notes: ImportNotes, tableId: string, book: LarkBook, fieldNames: Map<string, Map<string, string>>, tableNames: Map<string, string>): Plan {
  const type = Number(lf.type), ui = str(lf.fieldUIType) || str(obj(lf.exInfo).fieldUIType), prop = obj(lf.property), name = str(lf.name).trim() || id;
  const mk = (t: FieldType, kind: Plan['kind'], more: Partial<Field> = {}): Plan => ({ field: { id, name, type: t, ...more }, lark: lf, kind });
  const options = (): { opts: Opt[]; optName: Map<string, string> } => {
    // 名字前后的空格去掉；去掉以后重名的并成一个（这边的选项按名字认）
    const opts: Opt[] = [], optName = new Map<string, string>();
    arr(prop.options).forEach((o, i) => { const oo = obj(o), n = str(oo.name).trim(); if (!n) return; optName.set(str(oo.id), n); if (!opts.some((x) => x[0] === n)) opts.push([n, colorOf(oo.color, i)]); });
    return { opts, optName };
  };
  switch (type) {
    case 1: return mk(ui === 'Email' ? 'email' : ui === 'Barcode' ? 'barcode' : 'text', 'plain');
    case 2: {
      const dec = decOf(prop.formatter);
      if (ui === 'Currency') return mk('currency', 'number', { cur: /^[A-Z]{3}$/.test(str(prop.currencyCode)) ? str(prop.currencyCode) : 'CNY', dec: dec ?? 2 });
      if (ui === 'Rating') return mk('rating', 'number');
      // Lark 的进度存的是 0–1 的小数，这边存百分数
      if (ui === 'Progress') return { ...mk('progress', 'number'), scale: 100 };
      return mk('number', 'number', dec == null ? {} : { dec });
    }
    case 3: case 24: { const o = options(); return { ...mk(type === 24 ? 'stage' : 'select', 'option', { opts: o.opts }), optName: o.optName }; }
    case 4: { const o = options(); return { ...mk('multi', 'options', { opts: o.opts }), optName: o.optName }; }
    case 5: return mk('date', 'date', str(prop.timeFormat) ? { time: true } : {});
    case 7: return mk('check', 'check');
    case 11: case 1003: case 1004: notes.people.push(name); return mk('text', 'people');
    case 13: return mk('phone', 'plain');
    case 15: return mk('url', 'url');
    case 17: notes.attach.push(name); return mk('attach', 'none');
    case 18: case 21: {
      // 关联：对方那张表也在这个文件里才接得上；双向的要对方成对的字段也在、也指回这张表
      const to = str(prop.tableId), other = book.raw.get(to);
      if (!other) { notes.asText.push(name); return mk('text', 'plain'); }
      const backId = str(prop.backFieldId), back = obj(obj(other.table.fieldMap)[backId]);
      const paired = type === 21 && Number(back.type) === 21 && str(obj(back.property).tableId) === tableId;
      return mk(paired ? 'duplex' : 'link', 'recs', { to, ...(paired ? { back: backId } : {}) });
    }
    case 19: case 23: notes.asText.push(name); return mk('text', 'plain');
    case 20: notes.formulas.push(name); return mk('formula', 'none', { expr: exprOf(str(prop.formula), tableId, fieldNames, tableNames) });
    case 22: return mk('location', 'loc');
    case 1001: return mk('created', 'none');
    case 1002: return mk('updated', 'none');
    case 1005: return mk('autonum', 'autonum');
    // 按钮：留着字段，点了做什么要在这边重新设置
    case 3001: notes.dropped.push(name); return mk('button', 'none', { label: name });
    default: return mk('text', 'plain');
  }
}

function cellValue(p: Plan, cell: unknown, book: LarkBook, users: Obj): unknown {
  const v = isObj(cell) ? cell.value : cell;
  if (v == null || v === '') return p.field.type === 'check' ? false : '';
  switch (p.kind) {
    case 'option': return p.optName?.get(str(Array.isArray(v) ? v[0] : v)) ?? '';
    case 'options': return arr(Array.isArray(v) ? v : [v]).map((x) => p.optName?.get(str(x)) ?? '').filter((x, i, a) => x && a.indexOf(x) === i);
    case 'date': { const n = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(n) && n > 0 ? dateIn(n, book.timezone, !!p.field.time) : ''; }
    case 'number': { const n = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(n) ? (p.scale ? Math.round(n * p.scale * 1e6) / 1e6 : n) : ''; }
    case 'check': return v === true || v === 1;
    case 'autonum': { const t = textOfCell(v); return /^\d+$/.test(t) ? Number(t) : t; }
    case 'people': return arr(Array.isArray(v) ? v : [v]).map((x) => { const id = isObj(x) ? str(x.id) || str(x.userId) : str(x); return str(obj(users[id]).name) || (isObj(x) ? str(x.name) : '') || ''; }).filter(Boolean).join('、');
    case 'url': { const first = Array.isArray(v) ? v[0] : v; return isObj(first) ? str(first.link) || str(first.text) : textOfCell(v); }
    case 'recs': return recIds(v);
    case 'loc': {
      const o = obj(Array.isArray(v) ? v[0] : v), addr = str(o.fullAddress) || str(o.name) || str(o.address) || textOfCell(v);
      const [lng, lat] = str(o.location).split(',').map(Number);
      return Number.isFinite(lat) && Number.isFinite(lng) && str(o.location) ? { addr, lat, lng } : addr;
    }
    case 'none': return '';
    default: return textOfCell(v);
  }
}

/** Lark 视图的类型编号 */
const VIEW_TYPES: Record<number, ViewType> = { 1: 'grid', 2: 'kanban', 3: 'form', 4: 'gallery' };
const OP_MAP: Record<string, FilterOp> = { is: 'eq', isNot: 'ne', contains: 'has', doesNotContain: 'nhas', isEmpty: 'empty', isNotEmpty: 'nempty', isGreater: 'gt', isLess: 'lt' };

/** 视图的筛选：条件要同时满足才带得过来（「满足任一」这边没有）；有对不上的字段、条件就整个不要，返回 undefined（调用的地方记进说明） */
function filtersOf(info: unknown, plans: Map<string, Plan>): Filter[] | undefined {
  const conds = arr(obj(info).conditions).filter(isObj);
  if (conds.length > 1 && str(obj(info).conjunction) === 'or') return undefined;
  const out: Filter[] = [];
  for (const c of conds) {
    const p = plans.get(str(c.fieldId));
    let op = OP_MAP[str(c.operator)];
    if (!p || !op) return undefined;
    if (op === 'empty' || op === 'nempty') { out.push({ fid: p.field.id, op, val: '' }); continue; }
    const raw = arr(Array.isArray(c.value) ? c.value : c.value == null ? [] : [c.value]);
    let vals: string[];
    if (p.optName) {
      vals = raw.map((x) => p.optName!.get(str(x)) ?? '').filter(Boolean);
      // 单选的「包含这几个选项」就是「是其中之一」；多选的「是」在这边是「含有其中一项」
      if (p.kind === 'option') op = op === 'has' ? 'eq' : op === 'nhas' ? 'ne' : op;
    } else if (p.kind === 'check') vals = [raw[0] === true ? '是' : '否'];
    else vals = raw.map(textOfCell).filter(Boolean).slice(0, 1);
    if (!vals.length) return undefined;
    out.push({ fid: p.field.id, op, val: vals[0], ...(vals.length > 1 ? { vals } : {}) });
  }
  return out;
}

/** 把文件里的表都转成这边的数据表 */
export function convertLark(book: LarkBook): { book: Book; notes: ImportNotes } {
  if (!book.tables.length) throw new LarkError('noTables');
  const notes: ImportNotes = { tables: 0, fields: 0, records: 0, views: 0, asText: [], people: [], attach: [], formulas: [], filters: [], groups: [], dropped: [] };
  // 公式里引用字段是按编号的，先把每张表的「字段编号 → 名字」备好
  const tableNames = new Map(book.tables.map((t) => [t.id, t.name])), fieldNames = new Map<string, Map<string, string>>();
  for (const [id, t] of book.raw) fieldNames.set(id, new Map(Object.entries(obj(t.table.fieldMap)).map(([fid, f]) => [fid, str(obj(f).name).trim() || fid])));
  const tables = book.tables.map((info, i): Table => ({ id: info.id, name: info.name || `数据表 ${i + 1}`, ...convertTable(book, info.id, notes, fieldNames, tableNames) }));
  // 关联的值只留对方表里真有的记录
  const recs = new Map(tables.map((t) => [t.id, new Set(t.records.map((r) => r.id))]));
  for (const t of tables) for (const f of t.fields) if (f.type === 'link' || f.type === 'duplex') for (const r of t.records) r.v[f.id] = (Array.isArray(r.v[f.id]) ? (r.v[f.id] as string[]) : []).filter((id) => recs.get(f.to ?? '')?.has(id));
  notes.tables = tables.length;
  for (const k of ['asText', 'people', 'attach', 'formulas', 'filters', 'groups', 'dropped'] as const) notes[k] = [...new Set(notes[k])];
  return { book: { tables }, notes };
}

function convertTable(book: LarkBook, tableId: string, notes: ImportNotes, fieldNames: Map<string, Map<string, string>>, tableNames: Map<string, string>): { fields: Field[]; records: Rec[]; views: View[] } {
  const t = book.raw.get(tableId);
  if (!t) throw new LarkError('noTables');
  const fieldMap = obj(t.table.fieldMap), viewMap = obj(t.table.viewMap), viewIds = arr(t.table.views).map(str).filter((id) => isObj(viewMap[id]));
  const firstProp = obj(obj(viewMap[viewIds[0]]).property);
  // 字段的顺序照第一个视图；主字段（记录的标题）放最前面
  const primary = str(t.table.primaryKey);
  const fieldOrder = [...new Set([primary, ...arr(firstProp.fields).map(str), ...Object.keys(fieldMap)])].filter((id) => isObj(fieldMap[id]));
  const plans = new Map<string, Plan>();
  for (const id of fieldOrder) plans.set(id, planField(id, obj(fieldMap[id]), notes, tableId, book, fieldNames, tableNames));
  const users = obj(t.table.userMap);

  // 记录的顺序：第一个视图里的顺序，别的按 rank 接在后面
  const rank = obj(obj(t.table.rankInfo).rankMap);
  const recIdsInOrder = [...new Set([...arr(firstProp.records).map(str), ...Object.keys(t.records).sort((a, b) => str(rank[a]).localeCompare(str(rank[b])))])].filter((id) => isObj(t.records[id]));
  const records: Rec[] = recIdsInOrder.map((id) => {
    const cells = obj(t.records[id]), v: Record<string, unknown> = {};
    for (const p of plans.values()) if (p.kind !== 'none') v[p.field.id] = cellValue(p, cells[p.field.id], book, users);
    const m = obj(obj(t.meta[id]).recMeta), ct = Number(m.createdTime) * 1000, ut = Number(m.modifiedTime) * 1000;
    return { id, v, ...(ct > 0 ? { ct } : {}), ...(ut > 0 ? { ut } : ct > 0 ? { ut: ct } : {}) };
  });

  // 自动编号：号里带前缀、日期的（不是纯数字）这边编不出来，改成文本；纯数字的接着往下编
  const maxNum = obj(book.autoNum[tableId]);
  for (const p of plans.values()) {
    if (p.kind !== 'autonum') continue;
    const vals = records.map((r) => r.v[p.field.id]).filter((x) => x !== '');
    if (vals.some((x) => typeof x !== 'number')) { p.field.type = 'text'; for (const r of records) r.v[p.field.id] = String(r.v[p.field.id] ?? ''); continue; }
    p.field.next = Math.max(Number(maxNum[p.field.id]) || 0, ...(vals as number[]), 0) + 1;
  }

  // 流程：每个阶段要处理的字段（fieldsConfigInfo）、流转条件（transitionRule）、结束的阶段（type 是 EndDone / EndCancel）；
  // convertMode 是 NextStage 时只能一步一步走，defaultValue 是 FirstStage 时新记录从第一个阶段开始
  for (const p of plans.values()) {
    if (p.field.type !== 'stage') continue;
    const prop = obj(p.lark.property), steps: Record<string, StageCfg> = {};
    for (const o of arr(prop.options).filter(isObj)) {
      const name = str(o.name).trim(); if (!name || steps[name]) continue;
      const show = arr(o.fieldsConfigInfo).map((x) => str(obj(x).id)).filter((id) => plans.has(id));
      const need = filtersOf(obj(obj(o.transitionRule).condition), plans) ?? [];
      const end = str(o.type) === 'EndDone' ? 'done' as const : str(o.type) === 'EndCancel' ? 'stop' as const : undefined;
      const cfg: StageCfg = { ...(show.length ? { show } : {}), ...(need.length ? { need } : {}), ...(end ? { end } : {}) };
      if (Object.keys(cfg).length) steps[name] = cfg;
    }
    const flow: Flow = { ...(str(prop.convertMode) === 'NextStage' ? { strict: true } : {}), ...(str(prop.defaultValue) === 'FirstStage' ? { first: true } : {}), ...(Object.keys(steps).length ? { steps } : {}) };
    if (Object.keys(flow).length) p.field.flow = flow;
  }

  const fields = [...plans.values()].map((p) => p.field);
  const views: View[] = [];
  for (const vid of viewIds) {
    const lv = obj(viewMap[vid]), prop = obj(lv.property), name = str(lv.name).trim() || vid;
    const type = VIEW_TYPES[Number(lv.type)] ?? 'grid';
    const view: View = { id: vid, name, type };
    const cols = obj(prop.colInfos);
    const hidden = fields.filter((f) => obj(cols[f.id]).hidden === true).map((f) => f.id);
    if (hidden.length && hidden.length < fields.length) view.hidden = hidden;
    const s0 = obj(arr(prop.sortInfo)[0]);
    if (plans.has(str(s0.fieldId))) view.sort = { fid: str(s0.fieldId), dir: s0.desc ? 'desc' : 'asc' };
    const g0 = plans.get(str(obj(arr(prop.group)[0]).fieldId));
    if (type === 'kanban') { if (g0 && (g0.field.type === 'select' || g0.field.type === 'stage')) view.group = g0.field.id; }
    else if (type === 'grid' && g0) notes.groups.push(name);
    const flts = filtersOf(prop.filterInfo, plans);
    if (!flts) notes.filters.push(name); else if (flts.length) view.filters = flts;
    views.push(view);
  }
  if (!views.length) views.push({ id: 'v1', name: '表格视图', type: 'grid' });
  if (!fields.length) fields.push({ id: 'f1', name: '名称', type: 'text' });
  notes.fields += fields.length; notes.records += records.length; notes.views += views.length;
  return { fields, records, views };
}

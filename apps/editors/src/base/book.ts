/**
 * 一份多维表格里的几张数据表，以及跨表的东西：关联（单向、双向）、查找引用、公式的重算。不碰 DOM。
 *
 * 存的格式（README.md）：第一张表还是放在最外层的 fields / records / views（另带 tid、name），第二张起放在 tables 里。
 * 这样 2026-11-10 以前的内容原样就是「只有一张表」，平台那边只认最外层三样的代码（AI 加记录、取纯文本）也照常能用。
 */
import { ERR, FormulaError, evaluate, renameRef, type FVal } from './formula';
import { BT } from './i18n';
import { coerce, emptyContent, filesOf, fillTemplate, fld, fmtStamp, groupName, idsOf, isAuto, isChoice, isEmpty, isLink, isNumeric, isUserType, linkTitle, newRecord, normalize, plainOf, setResolvers, signOf, stageBlock, stageNext, textOf, titleOf, today, uid, userName, val,
  type Act, type Assign, type Content, type Field, type FilterOp, type LookCond, type Rec, type UserMap } from './model';

export interface Table extends Content { id: string; name: string }
export interface Book { tables: Table[] }

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** 把宿主给的 content 整理成几张表 */
export function normalizeBook(raw: unknown): Book {
  const first: Table = { id: isObj(raw) && typeof raw.tid === 'string' && raw.tid ? raw.tid : 't1', name: isObj(raw) && typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : BT.tableDefault(1), ...normalize(raw) };
  const tables = [first], seen = new Set([first.id]);
  for (const t of isObj(raw) && Array.isArray(raw.tables) ? raw.tables : []) {
    if (!isObj(t) || !Array.isArray(t.fields)) continue;
    let id = typeof t.id === 'string' && t.id ? t.id : 't' + (tables.length + 1);
    while (seen.has(id)) id += 'x';
    seen.add(id);
    tables.push({ id, name: typeof t.name === 'string' && t.name.trim() ? t.name.trim() : BT.tableDefault(tables.length + 1), ...normalize(t) });
  }
  return { tables };
}
/** 存回去的样子 */
export function serialize(b: Book): Record<string, unknown> {
  const [first, ...rest] = b.tables;
  return { tid: first.id, name: first.name, fields: first.fields, records: first.records, views: first.views, ...(rest.length ? { tables: rest } : {}) };
}
/** 给搜索和 AI 用的纯文本：几张表时每张前面一行【表名】 */
export function plainOfBook(b: Book, users: UserMap): string {
  if (b.tables.length === 1) return plainOf(b.tables[0], users);
  return b.tables.map((t) => { const p = plainOf(t, users); return p ? `【${t.name}】\n${p}` : ''; }).filter(Boolean).join('\n');
}
export const tableOf = (b: Book, id: string | undefined) => b.tables.find((t) => t.id === id);
/** 改一张表，别的表原样 */
export const patchTable = (b: Book, id: string, fn: (t: Table) => Content): Book => ({ tables: b.tables.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)) });
/** 不重名的名字：已经有了就加（2）（3） */
export function freshName(taken: string[], want: string): string {
  if (!taken.includes(want)) return want;
  for (let i = 2; ; i++) { const n = `${want}（${i}）`; if (!taken.includes(n)) return n; }
}
/** 新的一张空表：只有一个名称字段和一个表格视图 */
export function newTable(b: Book, name: string): Table {
  const c = emptyContent();
  return { id: uid('t'), name: freshName(b.tables.map((t) => t.name), name.trim() || BT.tableDefault(b.tables.length + 1)), fields: [c.fields[0]], records: [], views: [c.views[0]] };
}

/* ---------- 关联 ---------- */
/** 关联字段能选的记录：对方表里标题对得上搜索词的，最多 limit 条 */
export function linkChoices(b: Book, f: Field, q: string, limit = 200): { id: string; title: string }[] {
  const t = tableOf(b, f.to); if (!t) return [];
  const out: { id: string; title: string }[] = [], kw = q.trim().toLowerCase();
  for (const r of t.records) { const title = titleOf(t, r); if (kw && !title.toLowerCase().includes(kw)) continue; out.push({ id: r.id, title }); if (out.length >= limit) break; }
  return out;
}
/**
 * 改一条记录的关联：双向关联时对方那一侧跟着改（这边加了谁，谁那边的成对字段里就加上这条；去掉也一样）。
 * who 是改的人，只记在这条记录上：对方那一侧是被动跟着变的，不算别人改了它
 */
export function setLink(b: Book, tid: string, rid: string, fid: string, ids: string[], who?: string, now = Date.now()): Book {
  const t = tableOf(b, tid), f = t?.fields.find((x) => x.id === fid), r = t?.records.find((x) => x.id === rid);
  if (!t || !f || !r) return b;
  const next = [...new Set(ids)], before = idsOf(r.v[fid]);
  let out = patchTable(b, tid, (x) => ({ ...x, records: x.records.map((y) => (y.id === rid ? { ...y, v: { ...y.v, [fid]: next }, ut: now, ...(who ? { ub: who } : {}) } : y)) }));
  if (f.type !== 'duplex' || !f.back || !f.to) return out;
  const added = new Set(next.filter((x) => !before.includes(x))), removed = new Set(before.filter((x) => !next.includes(x))), back = f.back;
  if (!added.size && !removed.size) return out;
  out = patchTable(out, f.to, (x) => ({ ...x, records: x.records.map((y) => {
    if (!added.has(y.id) && !removed.has(y.id)) return y;
    const cur = idsOf(y.v[back]);
    return { ...y, v: { ...y.v, [back]: added.has(y.id) ? (cur.includes(rid) ? cur : [...cur, rid]) : cur.filter((z) => z !== rid) } };
  }) }));
  return out;
}
/**
 * 给一张表里已经在的双向关联字段（还没有成对的那个）到对方表里补上成对的字段（名字默认是这张表的名字），
 * 这边已经关联着的记录也记到对方那边
 */
export function pairExisting(b: Book, tid: string, fid: string): Book {
  const t = tableOf(b, tid), f = t?.fields.find((x) => x.id === fid), other = tableOf(b, f?.to);
  if (!t || !f || !other) return b;
  const backId = uid('f');
  const pair: Field = { id: backId, name: freshName(other.fields.map((x) => x.name), other.id === tid ? BT.reverseOf(f.name) : t.name), type: 'duplex', to: tid, back: fid };
  // 对方每条记录被这边的谁关联着
  const from = new Map<string, string[]>();
  for (const r of t.records) for (const id of idsOf(r.v[fid])) from.set(id, [...(from.get(id) ?? []), r.id]);
  let out = patchTable(b, tid, (x) => ({ ...x, fields: x.fields.map((g) => (g.id === fid ? { ...g, type: 'duplex' as const, back: backId } : g)) }));
  out = patchTable(out, other.id, (x) => ({ ...x, fields: [...x.fields, pair], records: from.size ? x.records.map((r) => (from.has(r.id) ? { ...r, v: { ...r.v, [backId]: from.get(r.id) } } : r)) : x.records }));
  return out;
}
/** 给一张表加双向关联字段：对方表里同时加上成对的那个 */
export function addDuplex(b: Book, tid: string, f: Field, at?: number): Book {
  if (!tableOf(b, tid) || !tableOf(b, f.to)) return b;
  const out = patchTable(b, tid, (x) => { const fields = x.fields.slice(); fields.splice(at ?? fields.length, 0, { ...f, type: 'duplex', back: undefined }); return { ...x, fields }; });
  return pairExisting(out, tid, f.id);
}
/** 一个双向关联字段没了（删了、改成别的类型）：对方成对的那个变成单向关联，值留着 */
export function unpair(b: Book, f: Field): Book {
  if (f.type !== 'duplex' || !f.back || !f.to) return b;
  return patchTable(b, f.to, (x) => ({ ...x, fields: x.fields.map((g) => (g.id === f.back ? { ...g, type: 'link' as const, back: undefined } : g)) }));
}
/** 删掉一张表：别的表里指着它的关联、顺着这些关联的查找引用变成文本，留下当时的字 */
export function dropTable(b: Book, id: string, users: UserMap): Book {
  const tables = b.tables.filter((t) => t.id !== id).map((t) => {
    const links = t.fields.filter((f) => isLink(f.type) && f.to === id), gone = new Set(links.map((f) => f.id));
    const looks = t.fields.filter((f) => f.type === 'lookup' && ((f.via && gone.has(f.via)) || f.from === id));
    if (!links.length && !looks.length) return t;
    const flat = new Set([...gone, ...looks.map((f) => f.id)]);
    return {
      ...t,
      fields: t.fields.map((f) => (flat.has(f.id) ? { id: f.id, name: f.name, type: 'text' as const } : f)),
      records: t.records.map((r) => ({ ...r, v: { ...r.v, ...Object.fromEntries([...links.map((f) => [f.id, textOf(f, r.v[f.id], users)]), ...looks.map((f) => [f.id, textOf(f, r.v[f.id], users)])]) } })),
    };
  });
  return { tables };
}
/** 字段改了名：同一张表里的公式跟着改引用 */
export const renameInFormulas = (c: Content, from: string, to: string): Field[] => (from === to ? c.fields : c.fields.map((f) => (f.type === 'formula' && f.expr?.includes(`{${from}}`) ? { ...f, expr: renameRef(f.expr, from, to) } : f)));

/* ---------- 重算：清掉指向已删记录的关联，算公式和查找引用 ---------- */
/** 一个字段的值交给公式时是什么：数字类是数字，复选框是真假，别的是显示的字 */
function formulaValue(f: Field, v: unknown, users: UserMap): FVal {
  if (v == null || v === '') return f.type === 'check' ? false : null;
  if (f.type === 'formula' || f.type === 'lookup') return typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
  if (isNumeric(f.type)) { const n = Number(v); return Number.isFinite(n) ? n : String(v); }
  if (f.type === 'check') return !!v;
  if (f.type === 'created' || f.type === 'updated') return fmtStamp(v);
  if (f.type === 'sign') return !!signOf(v);
  if (f.type === 'attach') return filesOf(v).map((x) => x.name).join('、') || null;
  return textOf(f, v, users) || null;
}

/* ---------- 查找引用：按条件到另一张表里找 ---------- */
/** 一个值拿去比「等于」时的样子：数字按数值、成员按编号、别的按显示的字；值是一组的（多选、关联）每一项各算一个 */
function eqKeys(f: Field, v: unknown, users: UserMap): string[] {
  if (isEmpty(v)) return [];
  if (typeof v === 'number' || (isNumeric(f.type) && Number.isFinite(Number(v)))) return ['n:' + Number(v)];
  if (isUserType(f.type)) return ['t:' + userName(users, v)];
  if (Array.isArray(v) && f.type === 'multi') return v.map((x) => 't:' + String(x));
  if (isLink(f.type)) return idsOf(v).map((id) => 't:' + linkTitle(f, id));
  const s = textOf(f, v, users).trim();
  // 文字里整个是数字的也按数值比：「1000」对得上 1000.0
  return [/^-?\d+(\.\d+)?$/.test(s) ? 'n:' + Number(s) : 't:' + s];
}
const keyText = (k: string) => k.slice(2);
/** 一个条件对不对得上：have 是对方那条记录的值，want 是这边拿去比的（这条记录的字段值，或固定值） */
function condHit(op: FilterOp, have: string[], want: string[]): boolean {
  if (op === 'empty') return !have.length;
  if (op === 'nempty') return have.length > 0;
  // 这边拿去比的是空的：什么都对不上（不然空着的记录会把对方所有空着的都找出来）
  if (!want.length) return false;
  switch (op) {
    case 'eq': return have.some((k) => want.includes(k));
    case 'ne': return !have.some((k) => want.includes(k));
    case 'has': return have.some((k) => want.some((w) => keyText(k).includes(keyText(w))));
    case 'nhas': return !have.some((k) => want.some((w) => keyText(k).includes(keyText(w))));
    default: {
      if (!have.length) return false;
      const a = have[0], b = want[0], d = a.startsWith('n:') && b.startsWith('n:') ? Number(keyText(a)) - Number(keyText(b)) : keyText(a).localeCompare(keyText(b), 'zh');
      return op === 'gt' ? d > 0 : d < 0;
    }
  }
}
/**
 * 按条件找记录。第一个「等于」的条件用索引（对方表按那个字段的值分好组，同一张表的每条记录共用），其余条件再逐条筛；
 * 不然每条记录都要把对方整张表过一遍，几千条对几千条时每改一个格子都卡
 */
function findBy(f: Field, t: Table, r: Rec, target: Table, users: UserMap, cache: Map<string, Map<string, Rec[]>>): Rec[] {
  const conds = (f.where ?? []).map((c) => ({ c, tf: fld(target, c.fid), sf: c.src ? fld(t, c.src) : undefined })).filter((x): x is { c: LookCond; tf: Field; sf: Field | undefined } => !!x.tf && (!x.c.src || !!x.sf));
  if (!conds.length) return [];
  const want = (x: (typeof conds)[number]) => (x.sf ? eqKeys(x.sf, val(x.sf, r), users) : x.c.val?.trim() ? eqKeys({ id: '', name: '', type: 'text' }, x.c.val, users) : []);
  const first = conds.find((x) => x.c.op === 'eq');
  let pool = target.records;
  if (first) {
    const key = f.id + ':' + first.tf.id;
    let index = cache.get(key);
    if (!index) { index = new Map(); for (const x of target.records) for (const k of eqKeys(first.tf, val(first.tf, x), users)) { const list = index.get(k); if (list) list.push(x); else index.set(k, [x]); } cache.set(key, index); }
    const hits = want(first).flatMap((k) => index.get(k) ?? []);
    pool = hits.length > 1 ? [...new Set(hits)] : hits;
  }
  const rest = conds.filter((x) => x !== first).map((x) => ({ x, want: want(x) }));
  // 找自己这张表时不把这条记录自己算进去
  return pool.filter((y) => !(target.id === t.id && y.id === r.id) && rest.every(({ x, want: w }) => condHit(x.c.op, eqKeys(x.tf, val(x.tf, y), users), w)));
}

/* ---------- 按钮：点了依次做几件事 ---------- */
export interface ButtonResult { book: Book; open: string[]; msgs: { users: string[]; groups: string[]; text: string }[]; did: number; error?: { why: 'order'; next: string } | { why: 'need'; stage: string; missing: string[] } }
/** 按钮能改的字段：系统填的、算出来的、按钮本身、附件和签字（要上传）不能由按钮填 */
export const assignable = (f: Field) => !isAuto(f.type) && !['button', 'attach', 'sign'].includes(f.type);
/** 一个字段能用哪些填法 */
export function howsFor(f: Field, adding: boolean): Assign['how'][] {
  if (isLink(f.type)) return adding ? ['this', 'copy', 'clear'] : ['copy', 'clear'];
  return ['val', ...(f.type === 'date' ? ['now' as const] : []), ...(f.type === 'user' ? ['me' as const] : []), ...(isChoice(f.type) ? ['next' as const] : []), 'copy', 'clear'];
}
/** 按一条填法算出要填的值；src 是点按钮的那条记录和它所在的表 */
function assigned(a: Assign, f: Field, cur: unknown, srcTable: Table, src: Rec, me: string | undefined, users: UserMap, now: Date): unknown {
  switch (a.how) {
    case 'now': { const p = (n: number) => String(n).padStart(2, '0'); return f.time ? `${today()} ${p(now.getHours())}:${p(now.getMinutes())}` : today(); }
    case 'me': return me ?? '';
    case 'next': return stageNext(f, cur) ?? cur;
    case 'copy': { const g = fld(srcTable, a.from); return g ? (g.type === f.type || (isLink(g.type) && isLink(f.type) && g.to === f.to) ? val(g, src) : coerce(f, val(g, src), users, g)) : ''; }
    case 'this': return isLink(f.type) && f.to === srcTable.id ? [src.id] : [];
    case 'clear': return f.type === 'check' ? false : isLink(f.type) || f.type === 'multi' || f.type === 'group' ? [] : '';
    default: return a.val ?? '';
  }
}
/**
 * 点一下按钮：按顺序做完它的每件事，算出改好的内容、要打开的地址、要发的消息（消息由调用的地方交给宿主去发）。
 * 流程字段被流转条件挡住时整个不做（error），内容原样返回——不能改了一半
 */
export function runButton(book: Book, tid: string, rid: string, f: Field, users: UserMap, me?: string, at = new Date()): ButtonResult {
  const out: ButtonResult = { book, open: [], msgs: [], did: 0 };
  let b = book;
  const here = () => tableOf(b, tid), rec = () => here()?.records.find((x) => x.id === rid);
  const now = at.getTime();
  /** 把一组填法写到某张表的某条记录上；关联字段走 setLink（双向的对方那边跟着变） */
  const apply = (table: string, id: string, list: Assign[]): ButtonResult['error'] | null => {
    for (const a of list) {
      const t = tableOf(b, table), g = t && fld(t, a.fid), target = t?.records.find((x) => x.id === id), srcT = here(), src = rec();
      if (!t || !g || !target || !srcT || !src || !assignable(g)) continue;
      const v = assigned(a, g, target.v[g.id], srcT, src, me, users, at);
      if (g.type === 'stage') { const block = stageBlock(t, g, target, v, users); if (block) return block; }
      b = isLink(g.type) ? setLink(b, table, id, g.id, idsOf(v), me, now) : patchTable(b, table, (x) => ({ ...x, records: x.records.map((y) => (y.id === id ? { ...y, v: { ...y.v, [g.id]: v }, ut: now, ...(me ? { ub: me } : {}) } : y)) }));
    }
    return null;
  };
  for (const act of f.acts ?? []) {
    const t = here(), r = rec();
    if (!t || !r) break;
    if (act.do === 'open') { const url = /^(https?:\/\/|mailto:|tel:)/i.test(fillTemplate(t, r, act.href.trim(), users, encodeURIComponent)) ? fillTemplate(t, r, act.href.trim(), users, encodeURIComponent) : ''; if (url) out.open.push(url); }
    else if (act.do === 'set') { const err = apply(tid, rid, act.set); if (err) return { ...out, book, open: [], msgs: [], did: 0, error: err }; }
    else if (act.do === 'add') {
      const target = tableOf(b, act.table); if (!target) continue;
      const id = uid('r'), made = newRecord(target, id, {}, me, now);
      b = patchTable(b, act.table, (x) => ({ ...x, fields: made.fields, records: [...x.records, made.rec] }));
      const err = apply(act.table, id, act.set); if (err) return { ...out, book, open: [], msgs: [], did: 0, error: err };
    } else if (act.do === 'msg') {
      // 收件人：指定的成员和群，加上这条记录里人员、群组字段现在的值
      const us = new Set(act.users ?? []), gs = new Set(act.groups ?? []);
      for (const fid of act.fields ?? []) { const g = fld(t, fid); if (!g) continue; const v = val(g, r); if (isUserType(g.type)) { if (typeof v === 'string' && v) us.add(v); } else if (g.type === 'group') idsOf(v).forEach((x) => gs.add(x)); }
      const text = fillTemplate(t, r, act.text, users).trim();
      if (text && (us.size || gs.size)) out.msgs.push({ users: [...us], groups: [...gs], text });
    }
    out.did++;
  }
  return { ...out, book: b };
}

/** 表一张都没变就还是原来那份（界面靠对象是不是同一个来决定重不重画） */
const keep = (b: Book, tables: Table[]): Book => (tables.every((t, i) => t === b.tables[i]) ? b : { tables });

function compute(b: Book, users: UserMap): Book {
  const byId = new Map(b.tables.map((t) => [t.id, { t, recs: new Map(t.records.map((r) => [r.id, r])) }]));
  return keep(b, b.tables.map((t) => {
    const calc = t.fields.filter((f) => f.type === 'formula' || f.type === 'lookup');
    if (!calc.length) return t;
    const byName = new Map(t.fields.map((f) => [f.name, f]));
    // 按条件查找时给对方表建的索引，这张表的每条记录共用
    const finders = new Map<string, Map<string, Rec[]>>();
    let changed = false;
    const records = t.records.map((r) => {
      const memo = new Map<string, unknown>(), stack = new Set<string>();
      const lookup = (f: Field): unknown => {
        // 找哪些记录：按条件到 from 那张表里找（照 Lark），或者顺着本表的关联字段 via
        const via = f.from ? undefined : t.fields.find((x) => x.id === f.via), target = byId.get(f.from ?? (via && isLink(via.type) ? via.to ?? '' : ''));
        if (!target || (!f.from && !via)) return '';
        const linked = f.from ? findBy(f, t, r, target.t, users, finders) : idsOf(r.v[via!.id]).map((id) => target.recs.get(id)).filter((x): x is Rec => !!x);
        if (f.agg === 'count') return linked.length;
        const pick = target.t.fields.find((x) => x.id === f.pick); if (!pick) return '';
        const vals = linked.map((x) => val(pick, x));
        if (!f.agg || f.agg === 'list' || f.agg === 'uniq' || f.agg === 'ucount') {
          // 只找到一条、取的又是数字：留着数字（还能排序、再汇总）；别的列出显示的字
          if ((!f.agg || f.agg === 'list') && vals.length === 1 && typeof vals[0] === 'number') return vals[0];
          const texts = vals.map((x) => textOf(pick, x, users)).filter(Boolean), list = !f.agg || f.agg === 'list' ? texts : [...new Set(texts)];
          return f.agg === 'ucount' ? list.length : list.join('、');
        }
        const ns = vals.map((x) => (typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null)).filter((x): x is number => x != null);
        if (!ns.length) return '';
        const sum = ns.reduce((a, x) => a + x, 0);
        return parseFloat((f.agg === 'sum' ? sum : f.agg === 'avg' ? sum / ns.length : f.agg === 'min' ? Math.min(...ns) : Math.max(...ns)).toPrecision(12));
      };
      const value = (f: Field): unknown => {
        if (f.type === 'lookup') return lookup(f);
        if (f.type !== 'formula') return val(f, r);
        if (memo.has(f.id)) return memo.get(f.id);
        // 公式互相引用成了环
        if (stack.has(f.id)) throw new FormulaError('cycle');
        stack.add(f.id);
        const out = evaluate(f.expr ?? '', { id: r.id, get: (name) => { const g = byName.get(name); if (!g) throw new FormulaError('field'); const x = value(g); if (x === ERR) throw new FormulaError('ref'); return formulaValue(g, x, users); } });
        stack.delete(f.id); memo.set(f.id, out);
        return out;
      };
      let v: Record<string, unknown> | null = null;
      for (const f of calc) {
        let x: unknown;
        try { x = value(f); } catch (e) { if (e instanceof FormulaError) x = ERR; else throw e; }
        if (x === null || x === undefined) x = '';
        if (r.v[f.id] !== x && !(r.v[f.id] == null && x === '')) (v ??= { ...r.v })[f.id] = x;
      }
      if (!v) return r;
      changed = true;
      return { ...r, v };
    });
    return changed ? { ...t, records } : t;
  }));
}

/** 指向已经不在的记录、不在的表的关联清掉 */
function cleanLinks(b: Book): Book {
  const ids = new Map(b.tables.map((t) => [t.id, new Set(t.records.map((r) => r.id))]));
  return keep(b, b.tables.map((t) => {
    const links = t.fields.filter((f) => isLink(f.type));
    if (!links.length) return t;
    let changed = false;
    const records = t.records.map((r) => {
      let v: Record<string, unknown> | null = null;
      for (const f of links) {
        const cur = r.v[f.id]; if (cur == null || cur === '') continue;
        const has = ids.get(f.to ?? ''), list = idsOf(cur), kept = has ? list.filter((x) => has.has(x)) : [];
        if (!Array.isArray(cur) || kept.length !== list.length) (v ??= { ...r.v })[f.id] = kept;
      }
      if (!v) return r;
      changed = true;
      return { ...r, v };
    });
    return changed ? { ...t, records } : t;
  }));
}

/** 登记「按编号查记录标题」的办法，textOf 显示关联字段时用 */
function register(b: Book): void {
  const idx = new Map(b.tables.map((t) => [t.id, { t, recs: new Map(t.records.map((r) => [r.id, r])) }]));
  setResolvers({ title: (tid, rid) => { const x = idx.get(tid), r = x?.recs.get(rid); return x && r ? titleOf(x.t, r) : null; } });
}

/**
 * 内容每次变了都过一遍：清关联、算公式和查找引用（算两遍：查找引用可能取的是对方的公式，公式也可能用到本表的查找引用），结果写进记录的 v。
 * 没变的表、记录还是原来的对象，界面不会白白重画
 */
export function recompute(book: Book, users: UserMap): Book {
  let b = cleanLinks(book);
  register(b);
  if (!b.tables.some((t) => t.fields.some((f) => f.type === 'formula' || f.type === 'lookup'))) return b;
  for (let i = 0; i < 2; i++) { const next = compute(b, users); if (next === b) break; b = next; register(b); }
  return b;
}
export { groupName, linkTitle, userName };

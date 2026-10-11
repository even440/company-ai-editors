/**
 * 多维表格的内容模型：字段、记录、视图，以及筛选 / 排序 / 纯文本 / 一句话筛选这些不依赖界面的逻辑。
 * 内容格式见 README.md。这里不碰 DOM，方便单独测试。
 */
import type { DirectoryUser } from '@cai/bridge';

export type FieldType = 'text' | 'select' | 'multi' | 'user' | 'date' | 'number' | 'check' | 'url';
export type ViewType = 'grid' | 'kanban' | 'gallery' | 'calendar' | 'form';
export type FilterOp = 'has' | 'eq' | 'gt' | 'lt';

/** 单选 / 多选的选项：[名称, 颜色]，颜色是 base.css 里 .c-* 的名字 */
export type Opt = [string, string];
export interface Field { id: string; name: string; type: FieldType; opts?: Opt[] }
export interface Rec { id: string; v: Record<string, unknown> }
export interface Filter { fid: string; op: FilterOp; val: string }
export interface Sort { fid: string; dir: 'asc' | 'desc' }
export interface View {
  id: string; name: string; type: ViewType;
  /** 看板按哪个单选字段分组；日历按哪个日期字段排列 */
  group?: string;
  filter?: Filter | null;
  sort?: Sort | null;
  /** 这个视图里隐藏的字段 */
  hidden?: string[];
}
export interface Content { fields: Field[]; records: Rec[]; views: View[] }

/** 字段类型：[图标, 名称] */
export const FT: Record<FieldType, [string, string]> = { text: ['text', '文本'], select: ['tag', '单选'], multi: ['listul', '多选'], user: ['user', '人员'], date: ['calendar', '日期'], number: ['topic', '数字'], check: ['check', '复选框'], url: ['link', '链接'] };
/** 视图类型：[图标, 名称] */
export const VT: Record<ViewType, [string, string]> = { grid: ['sheet', '表格视图'], kanban: ['kanban', '看板'], gallery: ['grid', '画廊'], calendar: ['calendar', '日历'], form: ['form', '表单'] };
export const OPS: [FilterOp, string][] = [['has', '包含'], ['eq', '等于'], ['gt', '大于'], ['lt', '小于']];
export const OP_WORD: Record<FilterOp, string> = { has: '包含', eq: '是', gt: '大于', lt: '小于' };
export const COLORS = ['blue', 'green', 'orange', 'purple', 'teal', 'red', 'yellow', 'gray'];

let seq = 0;
/** 新编号：时间戳 + 序号，同一毫秒里连续生成也不会撞 */
export const uid = (prefix: string) => prefix + Date.now().toString(36) + (++seq).toString(36);

/** 空内容：四个常用字段、没有记录、一个表格视图和一个看板 */
export function emptyContent(): Content {
  const fields: Field[] = [
    { id: 'f1', name: '名称', type: 'text' },
    { id: 'f2', name: '状态', type: 'select', opts: [['待处理', 'gray'], ['进行中', 'blue'], ['已完成', 'green']] },
    { id: 'f3', name: '负责人', type: 'user' },
    { id: 'f4', name: '截止日期', type: 'date' },
  ];
  return { fields, records: [], views: [{ id: 'v1', name: '表格视图', type: 'grid' }, { id: 'v2', name: '看板', type: 'kanban', group: 'f2' }] };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const TYPES = Object.keys(FT) as FieldType[], VTYPES = Object.keys(VT) as ViewType[];

/** 把宿主给的 content 整理成可用的结构：缺字段的按空内容初始化，坏掉的项丢掉 */
export function normalize(raw: unknown): Content {
  if (!isObj(raw) || !Array.isArray(raw.fields)) return emptyContent();
  const fields: Field[] = raw.fields.filter(isObj).map((f, i) => ({
    id: String(f.id ?? 'f' + (i + 1)), name: String(f.name ?? '字段 ' + (i + 1)), type: TYPES.includes(f.type as FieldType) ? (f.type as FieldType) : 'text',
    opts: Array.isArray(f.opts) ? f.opts.filter((o: unknown) => Array.isArray(o) && o.length).map((o: unknown[]): Opt => [String(o[0]), COLORS.includes(String(o[1])) ? String(o[1]) : 'gray']) : undefined,
  }));
  if (!fields.length) fields.push({ id: 'f1', name: '名称', type: 'text' });
  const records: Rec[] = (Array.isArray(raw.records) ? raw.records : []).filter(isObj).map((r, i) => ({ id: String(r.id ?? 'r' + (i + 1)), v: isObj(r.v) ? r.v : {} }));
  const views: View[] = (Array.isArray(raw.views) ? raw.views : []).filter(isObj).map((v, i) => ({
    id: String(v.id ?? 'v' + (i + 1)), name: String(v.name ?? '视图 ' + (i + 1)), type: VTYPES.includes(v.type as ViewType) ? (v.type as ViewType) : 'grid',
    group: typeof v.group === 'string' ? v.group : undefined,
    filter: isObj(v.filter) && typeof v.filter.fid === 'string' ? { fid: v.filter.fid, op: (['has', 'eq', 'gt', 'lt'] as FilterOp[]).includes(v.filter.op as FilterOp) ? (v.filter.op as FilterOp) : 'has', val: String(v.filter.val ?? '') } : null,
    sort: isObj(v.sort) && typeof v.sort.fid === 'string' ? { fid: v.sort.fid, dir: v.sort.dir === 'desc' ? 'desc' : 'asc' } : null,
    hidden: Array.isArray(v.hidden) ? v.hidden.map(String) : undefined,
  }));
  if (!views.length) views.push({ id: 'v1', name: '表格视图', type: 'grid' });
  return { fields, records, views };
}

export const fld = (c: Content, id: string | undefined) => c.fields.find((f) => f.id === id);
export const firstOf = (c: Content, type: FieldType) => c.fields.find((f) => f.type === type);
export const optColor = (f: Field, v: unknown) => (f.opts ?? []).find((o) => o[0] === v)?.[1] ?? 'gray';
/** 记录的标题：第一个文本字段的值 */
export const titleOf = (c: Content, r: Rec) => { const f = firstOf(c, 'text'); const v = f ? r.v[f.id] : ''; return v == null || v === '' ? '（无标题）' : String(v); };
export const isHidden = (v: View, fid: string) => (v.hidden ?? []).includes(fid);
export const visibleFields = (c: Content, v: View) => c.fields.filter((f) => !isHidden(v, f.id));

export type UserMap = Map<string, DirectoryUser>;
export const userName = (users: UserMap, id: unknown) => (id == null || id === '' ? '' : users.get(String(id))?.name ?? String(id));

/** 一个格子的显示文字：导出、纯文本、筛选都用它 */
export function textOf(f: Field, v: unknown, users: UserMap): string {
  if (v == null || v === '') return '';
  switch (f.type) {
    case 'check': return v ? '是' : '否';
    case 'user': return userName(users, v);
    case 'multi': return (Array.isArray(v) ? v : [v]).map(String).join('、');
    case 'number': return Number.isFinite(Number(v)) ? String(Number(v)) : String(v);
    default: return String(v);
  }
}

/** 给搜索和 AI 用的纯文本：每条记录一行，「字段名: 值」用空格分开 */
export function plainOf(c: Content, users: UserMap): string {
  return c.records.map((r) => c.fields.map((f) => { const t = textOf(f, r.v[f.id], users); return t ? `${f.name}: ${t}` : ''; }).filter(Boolean).join(' ')).filter(Boolean).join('\n');
}

const num = (x: unknown) => { const n = typeof x === 'number' ? x : parseFloat(String(x ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const truthyWord = (s: string) => /^(是|true|1|已|有|yes|y)$/i.test(s.trim());

/** 一条记录是否满足筛选条件 */
export function matches(f: Field, v: unknown, flt: Filter, users: UserMap): boolean {
  const val = flt.val.trim();
  if (flt.op === 'gt' || flt.op === 'lt') {
    const a = num(v), b = num(val);
    // 数字按大小比，日期这类字符串按字典序（YYYY-MM-DD 刚好可比）
    const cmp = a != null && b != null ? a - b : String(v ?? '').localeCompare(val, 'zh');
    if (v == null || v === '') return false;
    return flt.op === 'gt' ? cmp > 0 : cmp < 0;
  }
  if (f.type === 'check') return !!v === truthyWord(val); // 复选框只有「是 / 否」，包含和等于一个意思
  if (f.type === 'multi') { const arr = (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(String); return flt.op === 'eq' ? arr.includes(val) : arr.some((x) => x.includes(val)); }
  if (f.type === 'user') { const id = String(v ?? ''), name = userName(users, v); return flt.op === 'eq' ? id === val || name === val : name.includes(val) || id.includes(val); }
  const s = textOf(f, v, users);
  return flt.op === 'eq' ? s === val : s.includes(val);
}

export function applyFilter(c: Content, recs: Rec[], flt: Filter | null | undefined, users: UserMap): Rec[] {
  if (!flt || !flt.fid || flt.val === '') return recs;
  const f = fld(c, flt.fid); if (!f) return recs;
  return recs.filter((r) => matches(f, r.v[f.id], flt, users));
}

export function sorted(c: Content, recs: Rec[], sort: Sort | null | undefined, users: UserMap): Rec[] {
  if (!sort || !sort.fid) return recs;
  const f = fld(c, sort.fid); if (!f) return recs;
  const dir = sort.dir === 'desc' ? -1 : 1;
  const key = (r: Rec) => r.v[f.id];
  return recs.slice().sort((a, b) => {
    const x = key(a), y = key(b);
    const ex = x == null || x === '', ey = y == null || y === '';
    if (ex || ey) return ex && ey ? 0 : ex ? 1 : -1; // 空值永远排在最后
    if (f.type === 'number') return ((num(x) ?? 0) - (num(y) ?? 0)) * dir;
    if (f.type === 'check') return ((x ? 1 : 0) - (y ? 1 : 0)) * dir;
    return textOf(f, x, users).localeCompare(textOf(f, y, users), 'zh') * dir;
  });
}

/** 某个视图里能看到的记录：先筛选再排序 */
export const visibleRecords = (c: Content, v: View, users: UserMap) => sorted(c, applyFilter(c, c.records, v.filter, users), v.sort, users);

export const filterDesc = (c: Content, flt: Filter | null | undefined) => { const f = flt && fld(c, flt.fid); return f && flt && flt.val !== '' ? `${f.name} ${OP_WORD[flt.op]} ${flt.val}` : ''; };

/**
 * AI 一句话筛选（沿用原型的 CAI.baseNlq 规则）：「金额大于 30」「负责人是李娜」「包含 星河」「已报价的客户」。
 * 句子里提到了字段名就用那个字段，否则用第一个同类型的字段。解析不出返回 null。
 */
export function nlq(c: Content, q: string, users: UserMap): Filter | null {
  const text = q.trim(); if (!text) return null;
  const named = (type: FieldType) => c.fields.find((f) => f.type === type && text.includes(f.name)) ?? firstOf(c, type);
  let m: RegExpExecArray | null;
  const numF = named('number'), dateF = named('date');
  if ((m = /(大于|超过|高于|多于|>)\s*(-?\d+(?:\.\d+)?)/.exec(text)) && numF) return { fid: numF.id, op: 'gt', val: m[2] };
  if ((m = /(小于|低于|不到|少于|<)\s*(-?\d+(?:\.\d+)?)/.exec(text)) && numF) return { fid: numF.id, op: 'lt', val: m[2] };
  // 日期：「10 月 20 日之后」「2026-11-01 之前」
  if (dateF && (m = /(\d{4}-\d{2}-\d{2}|(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?)\s*(之后|以后|之前|以前|后|前)/.exec(text))) {
    const d = m[2] ? `${new Date().getFullYear()}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : m[1];
    return { fid: dateF.id, op: /后/.test(m[4]) ? 'gt' : 'lt', val: d };
  }
  // 人员：「负责人是李娜」或直接出现通讯录里的名字
  const userF = named('user');
  if (userF) {
    if ((m = /(负责人|所有者|跟进人|owner|[一-龥]{2,6})[是为：:]\s*(\S{2,4})/.exec(text)) && [...users.values()].some((u) => u.name === m![2])) return { fid: userF.id, op: 'eq', val: m[2] };
    const u = [...users.values()].find((x) => text.includes(x.name)); if (u) return { fid: userF.id, op: 'eq', val: u.name };
  }
  // 单选 / 多选：句子里出现了某个选项名
  for (const f of c.fields) if ((f.type === 'select' || f.type === 'multi') && f.opts) { const o = f.opts.find((x) => text.includes(x[0])); if (o) return { fid: f.id, op: 'eq', val: o[0] }; }
  // 复选框：「已续约的」「没有续约」
  const chk = c.fields.find((f) => f.type === 'check' && text.includes(f.name.replace(/^已|^是否/, '')));
  if (chk) return { fid: chk.id, op: 'eq', val: /(没|未|不|否)/.test(text) ? '否' : '是' };
  // 兜底：第一个像样的词在第一个文本字段里找
  const t = firstOf(c, 'text');
  if (t) {
    m = /(包含|含有|叫|名字[是为]?|有)\s*(\S{1,20})/.exec(text);
    const kw = m ? m[2] : text.replace(/[的，。？?,、！!]/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !/^(找|查|查找|筛选|显示|哪些|记录|客户|列出|看看|找出|所有)$/.test(w))[0];
    if (kw) return { fid: t.id, op: 'has', val: kw.replace(/(的|记录|客户)$/, '') || kw };
  }
  return null;
}

/** 统计汇总：给 AI 的「summary」命令用，返回一段中文 */
export function summarize(c: Content, recs: Rec[], users: UserMap, viewName: string): string {
  const lines: string[] = [`「${viewName}」共 ${recs.length} 条记录${recs.length !== c.records.length ? `（全部 ${c.records.length} 条）` : ''}。`];
  for (const f of c.fields) {
    const vals = recs.map((r) => r.v[f.id]);
    if (f.type === 'number') {
      const ns = vals.map(num).filter((x): x is number => x != null); if (!ns.length) continue;
      const sum = ns.reduce((a, b) => a + b, 0);
      lines.push(`${f.name}：合计 ${fmtNum(sum)}，平均 ${fmtNum(sum / ns.length)}，最大 ${fmtNum(Math.max(...ns))}，最小 ${fmtNum(Math.min(...ns))}。`);
    } else if (f.type === 'select' || f.type === 'user' || f.type === 'multi') {
      const cnt = new Map<string, number>();
      for (const v of vals) for (const x of f.type === 'multi' ? (Array.isArray(v) ? v : []) : [v]) { const k = f.type === 'user' ? userName(users, x) : String(x ?? ''); if (k) cnt.set(k, (cnt.get(k) ?? 0) + 1); }
      if (cnt.size) lines.push(`${f.name}：${[...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('，')}。`);
    } else if (f.type === 'check') {
      const yes = vals.filter(Boolean).length; lines.push(`${f.name}：${yes} 条已勾选，${recs.length - yes} 条未勾选。`);
    } else if (f.type === 'date') {
      const ds = vals.filter((x) => typeof x === 'string' && x).map(String).sort(); if (ds.length) lines.push(`${f.name}：从 ${ds[0]} 到 ${ds[ds.length - 1]}。`);
    }
  }
  return lines.join('\n');
}
export const fmtNum = (n: number) => Number(n.toFixed(2)).toLocaleString('zh-CN');

/** 新字段的默认选项：从已有的值里收集（改类型时用），没有就给两个占位 */
export function optsFrom(records: Rec[], fid: string): Opt[] {
  const seen = new Set<string>();
  for (const r of records) { const v = r.v[fid]; for (const x of Array.isArray(v) ? v : [v]) { const s = String(x ?? '').trim(); if (s) seen.add(s); if (seen.size >= 20) break; } }
  const list = [...seen];
  return (list.length ? list : ['选项 1', '选项 2']).map((o, i) => [o, COLORS[i % COLORS.length]] as Opt);
}
export const parseOpts = (s: string): Opt[] => s.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean).map((o, i) => [o, COLORS[i % COLORS.length]] as Opt);

/** 换类型以后把值转成新类型能用的样子，转不了的清掉 */
export function coerce(type: FieldType, v: unknown, users: UserMap): unknown {
  if (v == null || v === '') return type === 'check' ? false : '';
  switch (type) {
    case 'number': return num(Array.isArray(v) ? v[0] : v) ?? '';
    case 'check': return typeof v === 'boolean' ? v : truthyWord(String(v));
    case 'multi': return Array.isArray(v) ? v.map(String) : String(v).split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
    case 'user': { const s = Array.isArray(v) ? String(v[0] ?? '') : String(v); return users.has(s) ? s : [...users.values()].find((u) => u.name === s)?.id ?? ''; }
    case 'date': { const s = Array.isArray(v) ? String(v[0] ?? '') : String(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
    default: return Array.isArray(v) ? v.join('、') : typeof v === 'boolean' ? (v ? '是' : '') : String(v);
  }
}

/** 今天：YYYY-MM-DD（本地时区） */
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

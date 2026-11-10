/**
 * 多维表格的内容模型：字段、记录、视图，以及筛选 / 排序 / 纯文本 / 一句话筛选这些不依赖界面的逻辑。
 * 内容格式见 README.md。这里不碰 DOM，方便单独测试。
 */
import type { DirectoryUser } from '@cai/bridge';
import { lang } from '../shell/i18n';
import { BT } from './i18n';

/**
 * 字段类型（2026-11-10 用户拿 Lark 导出的货柜表对照，又发了 Lark 的字段类型清单：「这些都需要支持」）。分三组，和 Lark 的清单一样：
 * 常规（文本…查找引用）、业务（流程…评分）、高级（双向关联…最后更新时间）。
 * - 系统自己填的（isAuto）：自动编号的值在 v 里；创建 / 修改的时间和人在记录自己身上（Rec.ct / ut / cb / ub）；
 *   公式、查找引用由 book.ts 的 recompute 算好写进 v。
 * - 关联（link 单向、duplex 双向）的值是对方表里的记录编号数组；群组是会话编号数组；签字是一个文件；地理位置是文字或 { addr, lat, lng }；按钮没有值。
 */
export type FieldType = 'text' | 'select' | 'multi' | 'user' | 'group' | 'date' | 'attach' | 'number' | 'check' | 'url' | 'formula' | 'lookup'
  | 'stage' | 'button' | 'autonum' | 'phone' | 'email' | 'location' | 'barcode' | 'sign' | 'progress' | 'currency' | 'rating'
  | 'duplex' | 'link' | 'creator' | 'editor' | 'created' | 'updated';
/** 查找引用怎么汇总找到的值：原样列出、去掉重复的列出、求和、平均、最小、最大、数有几条、数有几种 */
export type Agg = 'list' | 'uniq' | 'sum' | 'avg' | 'min' | 'max' | 'count' | 'ucount';
export const AGGS: Agg[] = ['list', 'uniq', 'sum', 'avg', 'min', 'max', 'count', 'ucount'];
/**
 * 查找引用的一个查找条件（照 Lark：到另一张表里找「某个字段 和 这条记录的某个字段 / 一个固定值 对得上」的记录）：
 * fid 是对方表的字段；src 是本表的字段（拿这条记录在它上面的值去比），没有 src 时和固定值 val 比
 */
export interface LookCond { fid: string; op: FilterOp; src?: string; val?: string }
/**
 * 流程里一个阶段的设置（照 Lark）：show 是这个阶段要处理的字段（记录弹窗里标出来），need 是流转条件——都满足了才能进入下一个阶段，
 * end 标出结束的阶段：done 是正常走完，stop 是中止（暂停、取消，随时能进）
 */
export interface StageCfg { show?: string[]; need?: Filter[]; end?: 'done' | 'stop' }
/** 流程字段的设置：strict 是只能一步一步往下走（不能跳），first 是新记录从第一个阶段开始；steps 按选项名记每个阶段的设置 */
export interface Flow { strict?: boolean; first?: boolean; steps?: Record<string, StageCfg> }
/**
 * 按钮点了给一个字段填什么：val 固定值、now 当时的日期时间、me 点按钮的人、next 单选 / 流程的下一个选项、
 * copy 这条记录另一个字段（from）的值、this 这条记录本身（给关联字段）、clear 清空
 */
export interface Assign { fid: string; how: 'val' | 'now' | 'me' | 'next' | 'copy' | 'this' | 'clear'; val?: unknown; from?: string }
/**
 * 按钮点了做的一件事（照 Lark 的「点击按钮时」自动化）：open 打开地址、set 修改这条记录、add 在某张表里新增一条记录、
 * msg 发消息（users 成员、groups 群、fields 这条记录里的人员 / 群组字段；text 里的 {字段名} 换成这条记录的值）
 */
export type Act = { do: 'open'; href: string } | { do: 'set'; set: Assign[] } | { do: 'add'; table: string; set: Assign[] } | { do: 'msg'; users?: string[]; groups?: string[]; fields?: string[]; text: string };
export type ViewType = 'grid' | 'kanban' | 'gallery' | 'calendar' | 'form';
export type FilterOp = 'has' | 'nhas' | 'eq' | 'ne' | 'gt' | 'lt' | 'empty' | 'nempty';

/** 单选 / 多选的选项：[名称, 颜色]，颜色是 base.css 里 .c-* 的名字 */
export type Opt = [string, string];
export interface Field {
  id: string; name: string; type: FieldType; opts?: Opt[];
  /** 日期：带不带时间。带的值是 YYYY-MM-DD HH:mm，不带的是 YYYY-MM-DD */
  time?: boolean;
  /** 数字、货币、进度：显示几位小数；不设就照填的显示（货币默认两位） */
  dec?: number;
  /** 货币：币种代码（CNY、USD、BRL…） */
  cur?: string;
  /** 自动编号：下一条记录用的号 */
  next?: number;
  /** 关联：对方是哪张数据表（Table.id，可以就是自己这张） */
  to?: string;
  /** 双向关联：对方表里和它成对的那个字段 */
  back?: string;
  /**
   * 查找引用：取对方表的哪个字段（pick），怎么汇总（agg，不写是列出来）。找哪些记录有两种办法：
   * 按条件（照 Lark）——from 是对方的数据表，where 是查找条件，要同时满足；或者顺着本表的一个关联字段（via）
   */
  via?: string; pick?: string; agg?: Agg; from?: string; where?: LookCond[];
  /** 公式：式子原文，写法见 formula.ts */
  expr?: string;
  /** 按钮：按钮上的字、点了依次做的事。href 是 2026-11-10 当天早先的写法（只能打开地址），读的时候挪进 acts */
  label?: string; href?: string; acts?: Act[];
  /** 流程：每个阶段要处理的字段、流转条件 */
  flow?: Flow;
  /** 条码：只能扫码录入，不能手输（照 Lark 的「仅限移动端扫码录入」） */
  scan?: boolean;
}
/** 记录。ct / ut 是创建、最后修改的时间（毫秒），cb / ub 是谁；2026-11-10 以前建的记录没有，对应的字段显示为空 */
export interface Rec { id: string; v: Record<string, unknown>; ct?: number; ut?: number; cb?: string; ub?: string }
/** 附件字段里的一个文件：就是宿主上传接口给的 EditorFile。签字字段的值也是它，另带谁签的、什么时候签的 */
export interface FileVal { id: string; name: string; size: number; mime: string; url: string; by?: string; at?: number }
/** 地理位置的值：只有文字时就是一个字符串；定过位的带经纬度 */
export interface LocVal { addr: string; lat: number; lng: number }
/** 一个筛选条件。单选、多选字段可以一次选几个值（vals）：「是」「包含」算其中任意一个，「不是」「不包含」要都不是；val 总是第一个值 */
export interface Filter { fid: string; op: FilterOp; val: string; vals?: string[] }
export interface Sort { fid: string; dir: 'asc' | 'desc' }
export interface View {
  id: string; name: string; type: ViewType;
  /** 看板按哪个单选字段分组；日历按哪个日期字段排列 */
  group?: string;
  /** 筛选条件，要同时满足（2026-11-10 以前只有一个条件，存在 filter 里，读的时候挪过来） */
  filters?: Filter[];
  sort?: Sort | null;
  /** 这个视图里隐藏的字段 */
  hidden?: string[];
}
export interface Content { fields: Field[]; records: Rec[]; views: View[] }

/** 字段类型：[图标, 名称] */
export const FT: Record<FieldType, [string, string]> = {
  text: ['text', BT.ft.text], select: ['tag', BT.ft.select], multi: ['listul', BT.ft.multi], user: ['user', BT.ft.user], group: ['users', BT.ft.group], date: ['calendar', BT.ft.date],
  attach: ['clip', BT.ft.attach], number: ['topic', BT.ft.number], check: ['todo', BT.ft.check], url: ['link', BT.ft.url], formula: ['code', BT.ft.formula], lookup: ['search', BT.ft.lookup],
  stage: ['flow', BT.ft.stage], button: ['cursor', BT.ft.button], autonum: ['ol', BT.ft.autonum], phone: ['phone', BT.ft.phone], email: ['mail', BT.ft.email], location: ['pin', BT.ft.location],
  barcode: ['table', BT.ft.barcode], sign: ['pen', BT.ft.sign], progress: ['trend', BT.ft.progress], currency: ['coin', BT.ft.currency], rating: ['star', BT.ft.rating],
  duplex: ['share', BT.ft.duplex], link: ['arrow', BT.ft.link], creator: ['user', BT.ft.creator], editor: ['user', BT.ft.editor], created: ['clock', BT.ft.created], updated: ['clock', BT.ft.updated],
};
/** 「类型」下拉框里的分组和顺序，照 Lark 的清单 */
export const TYPE_GROUPS: [string, FieldType[]][] = [
  [BT.grp.common, ['text', 'select', 'multi', 'user', 'group', 'date', 'attach', 'number', 'check', 'url', 'formula', 'lookup']],
  [BT.grp.biz, ['stage', 'button', 'autonum', 'phone', 'email', 'location', 'barcode', 'sign', 'progress', 'currency', 'rating']],
  [BT.grp.adv, ['duplex', 'link', 'creator', 'editor', 'created', 'updated']],
];
/** 值是数字的类型：按大小排序、比较，右对齐 */
const NUMERIC: FieldType[] = ['number', 'currency', 'progress', 'rating', 'autonum'];
/** 系统自己填、自己算的类型：不能改，表单里不出现 */
const AUTO: FieldType[] = ['autonum', 'created', 'updated', 'creator', 'editor', 'formula', 'lookup'];
export const isNumeric = (t: FieldType) => NUMERIC.includes(t);
export const isAuto = (t: FieldType) => AUTO.includes(t);
/** 值是成员编号的类型 */
export const isUserType = (t: FieldType) => t === 'user' || t === 'creator' || t === 'editor';
/** 从选项里选一个的类型：单选和流程（流程的选项有先后） */
export const isChoice = (t: FieldType | undefined) => t === 'select' || t === 'stage';
/** 有选项的类型 */
export const isOptType = (t: FieldType | undefined) => isChoice(t) || t === 'multi';
/** 关联别的记录的类型 */
export const isLink = (t: FieldType | undefined) => t === 'link' || t === 'duplex';
/** 值是一组编号、点开面板勾选的类型 */
export const isListType = (t: FieldType) => t === 'multi' || isLink(t) || t === 'group';
/** 值是时间戳的类型 */
export const isStampType = (t: FieldType) => t === 'created' || t === 'updated';
/** 常用币种，排在下拉框最前面；别的代码（导入来的）照样能显示 */
export const CURRENCIES = ['CNY', 'USD', 'BRL', 'EUR', 'HKD', 'JPY', 'KRW', 'GBP', 'TWD', 'SGD', 'AUD', 'CAD', 'MXN', 'ARS', 'CLP', 'COP', 'PEN'];
/** 视图类型：[图标, 名称] */
export const VT: Record<ViewType, [string, string]> = { grid: ['sheet', '表格视图'], kanban: ['kanban', '看板'], gallery: ['grid', '画廊'], calendar: ['calendar', '日历'], form: ['form', '表单'] };
const OP_KEYS: FilterOp[] = ['has', 'nhas', 'eq', 'ne', 'gt', 'lt', 'empty', 'nempty'];
export const OPS: [FilterOp, string][] = OP_KEYS.map((k) => [k, BT.ops[k]]);
export const OP_WORD: Record<FilterOp, string> = BT.opWord;
/** 「为空」「不为空」不用填值 */
export const opNoVal = (op: FilterOp) => op === 'empty' || op === 'nempty';
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
const strs = (x: unknown, max = 200): string[] => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string' && !!y).slice(0, max) : []);
/** 查找引用的查找条件 */
function whereIn(x: unknown): { where?: LookCond[] } {
  const list = (Array.isArray(x) ? x : []).filter(isObj).filter((c) => typeof c.fid === 'string' && c.fid).slice(0, 10)
    .map((c): LookCond => ({ fid: String(c.fid), op: OP_KEYS.includes(c.op as FilterOp) ? (c.op as FilterOp) : 'eq', ...(typeof c.src === 'string' && c.src ? { src: c.src } : { val: String(c.val ?? '') }) }));
  return list.length ? { where: list } : {};
}
/** 流程的设置 */
function flowIn(x: unknown): { flow?: Flow } {
  if (!isObj(x)) return {};
  const steps: Record<string, StageCfg> = {};
  for (const [name, raw] of Object.entries(isObj(x.steps) ? x.steps : {})) {
    if (!isObj(raw)) continue;
    const show = strs(raw.show), need = (Array.isArray(raw.need) ? raw.need : []).map(filterIn).filter((y): y is Filter => !!y).slice(0, 30);
    const cfg: StageCfg = { ...(show.length ? { show } : {}), ...(need.length ? { need } : {}), ...(raw.end === 'done' || raw.end === 'stop' ? { end: raw.end } : {}) };
    if (Object.keys(cfg).length) steps[name] = cfg;
  }
  const flow: Flow = { ...(x.strict === true ? { strict: true } : {}), ...(x.first === true ? { first: true } : {}), ...(Object.keys(steps).length ? { steps } : {}) };
  return Object.keys(flow).length ? { flow } : {};
}
const HOWS: Assign['how'][] = ['val', 'now', 'me', 'next', 'copy', 'this', 'clear'];
const assignsIn = (x: unknown): Assign[] => (Array.isArray(x) ? x : []).filter(isObj).filter((a) => typeof a.fid === 'string' && a.fid).slice(0, 30)
  .map((a): Assign => ({ fid: String(a.fid), how: HOWS.includes(a.how as Assign['how']) ? (a.how as Assign['how']) : 'val', ...(a.val !== undefined ? { val: a.val } : {}), ...(typeof a.from === 'string' && a.from ? { from: a.from } : {}) }));
/** 按钮的动作；以前只有一个 href 的读成「打开地址」 */
function actsIn(x: unknown, href: unknown): { acts?: Act[] } {
  const acts: Act[] = [];
  for (const a of (Array.isArray(x) ? x : []).filter(isObj).slice(0, 10)) {
    if (a.do === 'open' && typeof a.href === 'string' && a.href.trim()) acts.push({ do: 'open', href: a.href.slice(0, 2000) });
    else if (a.do === 'set') acts.push({ do: 'set', set: assignsIn(a.set) });
    else if (a.do === 'add' && typeof a.table === 'string' && a.table) acts.push({ do: 'add', table: a.table, set: assignsIn(a.set) });
    else if (a.do === 'msg') acts.push({ do: 'msg', users: strs(a.users, 50), groups: strs(a.groups, 10), fields: strs(a.fields, 20), text: String(a.text ?? '').slice(0, 1000) });
  }
  if (!acts.length && typeof href === 'string' && href.trim()) acts.push({ do: 'open', href: href.slice(0, 2000) });
  return acts.length ? { acts } : {};
}
/** 存着的一个筛选条件整理成可用的样子，坏掉的返回 null */
function filterIn(x: unknown): Filter | null {
  if (!isObj(x) || typeof x.fid !== 'string' || !x.fid) return null;
  const vals = Array.isArray(x.vals) ? x.vals.map(String).filter(Boolean) : [];
  return { fid: x.fid, op: OP_KEYS.includes(x.op as FilterOp) ? (x.op as FilterOp) : 'has', val: String(x.val ?? vals[0] ?? ''), ...(vals.length > 1 ? { vals } : {}) };
}
const TYPES = Object.keys(FT) as FieldType[], VTYPES = Object.keys(VT) as ViewType[];
/** 小数位数最多几位 */
export const MAX_DEC = 6;

/** 把宿主给的 content 整理成可用的结构：缺字段的按空内容初始化，坏掉的项丢掉 */
export function normalize(raw: unknown): Content {
  if (!isObj(raw) || !Array.isArray(raw.fields)) return emptyContent();
  const fields: Field[] = raw.fields.filter(isObj).map((f, i) => ({
    id: String(f.id ?? 'f' + (i + 1)), name: String(f.name ?? '字段 ' + (i + 1)), type: TYPES.includes(f.type as FieldType) ? (f.type as FieldType) : 'text',
    opts: Array.isArray(f.opts) ? f.opts.filter((o: unknown) => Array.isArray(o) && o.length).map((o: unknown[]): Opt => [String(o[0]), COLORS.includes(String(o[1])) ? String(o[1]) : 'gray']) : undefined,
    ...(f.time === true ? { time: true } : {}),
    ...(typeof f.dec === 'number' && Number.isInteger(f.dec) && f.dec >= 0 && f.dec <= MAX_DEC ? { dec: f.dec } : {}),
    ...(typeof f.cur === 'string' && /^[A-Z]{3}$/.test(f.cur) ? { cur: f.cur } : {}),
    ...(typeof f.next === 'number' && Number.isInteger(f.next) && f.next >= 1 ? { next: f.next } : {}),
    ...Object.fromEntries((['to', 'back', 'via', 'pick', 'expr', 'label', 'from'] as const).filter((k) => typeof f[k] === 'string' && f[k]).map((k) => [k, String(f[k]).slice(0, k === 'expr' ? 2000 : 200)])),
    ...(AGGS.includes(f.agg as Agg) ? { agg: f.agg as Agg } : {}),
    ...(f.scan === true ? { scan: true } : {}),
    ...whereIn(f.where), ...flowIn(f.flow), ...actsIn(f.acts, f.href),
  }));
  if (!fields.length) fields.push({ id: 'f1', name: '名称', type: 'text' });
  const stampOf = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined), whoOf = (x: unknown) => (typeof x === 'string' && x ? x : undefined);
  const records: Rec[] = (Array.isArray(raw.records) ? raw.records : []).filter(isObj).map((r, i) => {
    const rec: Rec = { id: String(r.id ?? 'r' + (i + 1)), v: isObj(r.v) ? r.v : {} };
    const ct = stampOf(r.ct), ut = stampOf(r.ut), cb = whoOf(r.cb), ub = whoOf(r.ub);
    if (ct) rec.ct = ct; if (ut) rec.ut = ut; if (cb) rec.cb = cb; if (ub) rec.ub = ub;
    return rec;
  });
  const views: View[] = (Array.isArray(raw.views) ? raw.views : []).filter(isObj).map((v, i) => ({
    id: String(v.id ?? 'v' + (i + 1)), name: String(v.name ?? '视图 ' + (i + 1)), type: VTYPES.includes(v.type as ViewType) ? (v.type as ViewType) : 'grid',
    group: typeof v.group === 'string' ? v.group : undefined,
    filters: (Array.isArray(v.filters) ? v.filters : [v.filter]).map(filterIn).filter((x): x is Filter => !!x),
    sort: isObj(v.sort) && typeof v.sort.fid === 'string' ? { fid: v.sort.fid, dir: v.sort.dir === 'desc' ? 'desc' : 'asc' } : null,
    hidden: Array.isArray(v.hidden) ? v.hidden.map(String) : undefined,
  }));
  if (!views.length) views.push({ id: 'v1', name: '表格视图', type: 'grid' });
  return { fields, records, views };
}

export const fld = (c: Content, id: string | undefined) => c.fields.find((f) => f.id === id);
export const firstOf = (c: Content, type: FieldType) => c.fields.find((f) => f.type === type);
/** 第一个能拿来分组的字段（单选或流程）：看板用 */
export const firstChoice = (c: Content) => c.fields.find((f) => isChoice(f.type));
export const optColor = (f: Field, v: unknown) => (f.opts ?? []).find((o) => o[0] === v)?.[1] ?? 'gray';
/** 记录的标题：第一个文本字段的值 */
export const titleOf = (c: Content, r: Rec) => { const f = firstOf(c, 'text'); const v = f ? r.v[f.id] : ''; return v == null || v === '' ? '（无标题）' : String(v); };
export const isHidden = (v: View, fid: string) => (v.hidden ?? []).includes(fid);
export const visibleFields = (c: Content, v: View) => c.fields.filter((f) => !isHidden(v, f.id));

export type UserMap = Map<string, DirectoryUser>;
export const userName = (users: UserMap, id: unknown) => (id == null || id === '' ? '' : users.get(String(id))?.name ?? String(id));

/** 一条记录在某个字段上的值：系统字段的值在记录自己身上，别的在 v 里。读值一律走这里 */
export function val(f: Field, r: Rec): unknown {
  switch (f.type) {
    case 'created': return r.ct ?? '';
    case 'updated': return r.ut ?? r.ct ?? '';
    case 'creator': return r.cb ?? '';
    case 'editor': return r.ub ?? r.cb ?? '';
    default: return r.v[f.id];
  }
}
/**
 * 关联字段要显示对方记录的标题、群组字段要显示群名，这两样不在这张表里：编辑器把查的办法登记在这里（book.ts 的 recompute、BaseEditor 取到群名单时），
 * textOf、筛选、导出就都认得。没登记（单独测试、还没取到）时显示编号
 */
const resolvers: { title: (tableId: string, recId: string) => string | null; group: (id: string) => string | null } = { title: () => null, group: () => null };
export const setResolvers = (r: Partial<typeof resolvers>) => { Object.assign(resolvers, r); };
/** 关联的值：对方记录的编号 */
export const idsOf = (v: unknown): string[] => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).filter((x): x is string => typeof x === 'string' && !!x);
export const linkTitle = (f: Field, id: string) => resolvers.title(f.to ?? '', id) ?? id;
export const groupName = (id: string) => resolvers.group(id) ?? id;
/** 地理位置的值读成 { addr, lat?, lng? } */
export function locOf(v: unknown): { addr: string; lat?: number; lng?: number } | null {
  if (typeof v === 'string') return v.trim() ? { addr: v } : null;
  if (!isObj(v)) return null;
  const lat = Number(v.lat), lng = Number(v.lng), ok = Number.isFinite(lat) && Number.isFinite(lng) && v.lat != null && v.lng != null;
  const addr = String(v.addr ?? '').trim();
  return addr || ok ? { addr: addr || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, ...(ok ? { lat, lng } : {}) } : null;
}
/** 改地理位置的文字：定过位的留着经纬度 */
export const locSet = (old: unknown, addr: string): string | LocVal => { const o = locOf(old); return o?.lat != null && o.lng != null && addr.trim() ? { addr, lat: o.lat, lng: o.lng } : addr; };
/** 签字字段的值：一个文件，没签是 null */
export const signOf = (v: unknown): FileVal | null => (isObj(v) && typeof v.id === 'string' && v.id ? { ...filesOf([v])[0], ...(typeof v.by === 'string' ? { by: v.by } : {}), ...(typeof v.at === 'number' ? { at: v.at } : {}) } : null);
/** 把一段文字里的 {字段名} 换成这条记录的值（按钮打开的地址、发的消息）；enc 是值怎么转义 */
export const fillTemplate = (c: Content, r: Rec, text: string, users: UserMap, enc: (s: string) => string = (x) => x) =>
  text.replace(/\{([^{}]+)\}/g, (_, name: string) => { const g = c.fields.find((x) => x.name === name.trim()); return g ? enc(textOf(g, val(g, r), users)) : ''; });
/** 按钮打开的地址：{字段名} 换成这条记录的值；只让打开网页、邮件、电话 */
export function buttonUrl(c: Content, href: string, r: Rec, users: UserMap): string | null {
  const url = fillTemplate(c, r, href.trim(), users, encodeURIComponent);
  return /^(https?:\/\/|mailto:|tel:)/i.test(url) ? url : null;
}

/* ---------- 流程：一步一步走，流转条件 ---------- */
/** 这个流程字段有没有设过规矩（没设过的就是一个选项有先后的单选，随便选） */
export const hasFlow = (f: Field) => f.type === 'stage' && !!f.flow && (!!f.flow.strict || Object.values(f.flow.steps ?? {}).some((x) => x.need?.length || x.end));
/** 一个阶段的流转条件里这条记录还没满足的，写成「字段名 条件」给人看 */
export function stageMissing(c: Content, f: Field, stage: string, r: Rec, users: UserMap): string[] {
  const out: string[] = [];
  for (const flt of f.flow?.steps?.[stage]?.need ?? []) { const g = fld(c, flt.fid); if (g && !matches(g, val(g, r), flt, users)) out.push(flt.op === 'nempty' ? g.name : filterDesc(c, flt)); }
  return out;
}
/**
 * 一条记录的流程能不能改成 to。返回 null 是可以；不行时说明原因：
 * - 往回退、清空、进入中止的阶段（暂停、取消）随时可以；
 * - 往前走：strict 时只能进下一个阶段（中间隔着的中止阶段不算）；离开的每个阶段的流转条件都要满足
 */
export function stageBlock(c: Content, f: Field, r: Rec, to: unknown, users: UserMap): { why: 'order'; next: string } | { why: 'need'; stage: string; missing: string[] } | null {
  if (!hasFlow(f) || to == null || to === '') return null;
  const opts = (f.opts ?? []).map((o) => o[0]), steps = f.flow?.steps ?? {};
  const cur = opts.indexOf(String(r.v[f.id] ?? '')), j = opts.indexOf(String(to));
  if (j < 0 || j <= cur || steps[opts[j]]?.end === 'stop') return null;
  // 现在停在中止的阶段（暂停）：回到哪一步都行，不算往前走
  if (cur >= 0 && steps[opts[cur]]?.end === 'stop') return null;
  const live = (i: number) => steps[opts[i]]?.end !== 'stop';
  if (f.flow?.strict) { const next = opts.findIndex((_, i) => i > cur && live(i)); if (next >= 0 && j !== next) return { why: 'order', next: opts[next] }; }
  // 从现在这个阶段起、到目标之前，路过的每个阶段的流转条件都要满足
  for (let i = Math.max(cur, 0); i < j; i++) { if (!live(i)) continue; const missing = stageMissing(c, f, opts[i], r, users); if (missing.length) return { why: 'need', stage: opts[i], missing }; }
  return null;
}
/** 流程的下一个阶段（跳过中止的）；已经在最后了返回 null */
export function stageNext(f: Field, cur: unknown): string | null {
  const opts = (f.opts ?? []).map((o) => o[0]), i = opts.indexOf(String(cur ?? ''));
  return opts.find((o, k) => k > i && f.flow?.steps?.[o]?.end !== 'stop') ?? null;
}
/** 没填：空字符串、没勾的复选框、空的多选和附件 */
export const isEmpty = (v: unknown) => v == null || v === '' || v === false || (Array.isArray(v) && !v.length);
/** 附件字段的值整理成文件列表，坏掉的项丢掉 */
export const filesOf = (v: unknown): FileVal[] => (Array.isArray(v) ? v : []).filter((x): x is FileVal => isObj(x) && typeof x.id === 'string' && !!x.id)
  .map((x) => ({ id: x.id, name: String(x.name ?? x.id), size: Number(x.size) || 0, mime: String(x.mime ?? ''), url: String(x.url ?? '') }));
const p2 = (n: number) => String(n).padStart(2, '0');
/** 时间戳（毫秒）写成本地时间的 YYYY-MM-DD HH:mm */
export const fmtStamp = (ms: unknown) => { const n = Number(ms); if (!Number.isFinite(n) || n <= 0) return ''; const d = new Date(n); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
/** 币种的符号（R$、¥、US$…），不认识的代码原样返回 */
export function curSymbol(code: string | undefined): string {
  const c = code || 'CNY';
  try { return new Intl.NumberFormat(lang, { style: 'currency', currency: c }).formatToParts(0).find((x) => x.type === 'currency')?.value ?? c; } catch { return c; }
}
/** 币种在下拉框里的名字：「BRL · 巴西雷亚尔」 */
export function curLabel(code: string): string {
  try { const n = new Intl.DisplayNames([lang], { type: 'currency' }).of(code); return n && n !== code ? `${code} · ${n}` : code; } catch { return code; }
}
/** 数字类的值按字段的设置写成给人看的样子：千分位、小数位数、货币符号、百分号 */
export function fmtNumber(f: Field, v: unknown): string {
  const n = Number(v); if (v === '' || v == null || !Number.isFinite(n)) return v == null ? '' : String(v);
  const fixed = typeof f.dec === 'number' ? { minimumFractionDigits: f.dec, maximumFractionDigits: f.dec } : null;
  if (f.type === 'currency') { try { return new Intl.NumberFormat(lang, { style: 'currency', currency: f.cur || 'CNY', ...(fixed ?? {}) }).format(n); } catch { /* 不认识的币种代码：按普通数字显示 */ } }
  const s = n.toLocaleString(lang, fixed ?? { maximumFractionDigits: MAX_DEC });
  return f.type === 'progress' ? s + '%' : s;
}

/** 一个格子的显示文字：导出、纯文本、筛选都用它 */
export function textOf(f: Field, v: unknown, users: UserMap): string {
  if (v == null || v === '') return '';
  switch (f.type) {
    case 'check': return v ? '是' : '否';
    case 'user': case 'creator': case 'editor': return userName(users, v);
    case 'multi': return (Array.isArray(v) ? v : [v]).map(String).join('、');
    // 没设小数位数的数字照原样写（不加千分位），和以前一样：搜索、AI 读到的是填的那个数
    case 'number': case 'rating': case 'autonum': return !Number.isFinite(Number(v)) ? String(v) : f.type === 'number' && typeof f.dec === 'number' ? fmtNumber(f, v) : String(Number(v));
    case 'currency': case 'progress': return fmtNumber(f, v);
    case 'attach': return filesOf(v).map((x) => x.name).join('、');
    case 'created': case 'updated': return fmtStamp(v);
    case 'link': case 'duplex': return idsOf(v).map((id) => linkTitle(f, id)).join('、');
    case 'group': return idsOf(v).map(groupName).join('、');
    case 'location': return locOf(v)?.addr ?? '';
    case 'sign': return signOf(v) ? BT.signed : '';
    case 'button': return '';
    // 公式、查找引用算出来的可能是数字、文字、真假
    case 'formula': case 'lookup': return typeof v === 'boolean' ? (v ? '是' : '否') : typeof v === 'number' ? fmtNumber(f, v) : String(v);
    default: return Array.isArray(v) ? v.map(String).join('、') : isObj(v) ? '' : String(v);
  }
}

/** 给搜索和 AI 用的纯文本：每条记录一行，「字段名: 值」用空格分开 */
export function plainOf(c: Content, users: UserMap): string {
  return c.records.map((r) => c.fields.map((f) => { const t = textOf(f, val(f, r), users); return t ? `${f.name}: ${t}` : ''; }).filter(Boolean).join(' ')).filter(Boolean).join('\n');
}

const num = (x: unknown) => { const n = typeof x === 'number' ? x : parseFloat(String(x ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
/** 整个都是数字才算数：「2026-10-31」不算（parseFloat 会读成 2026） */
const strictNum = (x: unknown) => (typeof x === 'number' ? (Number.isFinite(x) ? x : null) : /^-?\d+(\.\d+)?$/.test(String(x ?? '').replace(/,/g, '').trim()) ? Number(String(x).replace(/,/g, '')) : null);
const truthyWord = (s: string) => /^(是|true|1|已|有|yes|y)$/i.test(s.trim());

/** 一条记录是否满足筛选条件 */
export function matches(f: Field, v: unknown, flt: Filter, users: UserMap): boolean {
  if (flt.op === 'empty') return isEmpty(v);
  if (flt.op === 'nempty') return !isEmpty(v);
  const qs = filterVals(flt), q = qs[0] ?? '';
  if (flt.op === 'gt' || flt.op === 'lt') {
    if (isEmpty(v)) return false;
    // 两边都是数字按大小比；别的按显示的文字比（日期 YYYY-MM-DD、时间 YYYY-MM-DD HH:mm 刚好可比）。
    // 以前两边都先用 parseFloat 读，「2026-10-31」读成 2026，同一年的日期永远比不出先后
    const a = strictNum(v), b = strictNum(q);
    const cmp = a != null && b != null ? a - b : textOf(f, v, users).localeCompare(q, 'zh');
    return flt.op === 'gt' ? cmp > 0 : cmp < 0;
  }
  const exact = flt.op === 'eq' || flt.op === 'ne';
  const hitOne = (q: string): boolean => {
    if (f.type === 'check') return !!v === truthyWord(q); // 复选框只有「是 / 否」，包含和等于一个意思
    if (f.type === 'multi') { const arr = (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(String); return exact ? arr.includes(q) : arr.some((x) => x.includes(q)); }
    if (isUserType(f.type)) { const id = String(v ?? ''), name = userName(users, v); return exact ? id === q || name === q : name.includes(q) || id.includes(q); }
    // 数字类的「等于」按数值比：货币显示成「R$ 1.234,56」，填 1234.56 也要对得上
    if (exact && isNumeric(f.type)) { const a = strictNum(v), b = strictNum(q); if (a != null && b != null) return a === b; }
    const s = textOf(f, v, users);
    return exact ? s === q : s.includes(q) || (isNumeric(f.type) && String(v).includes(q));
  };
  // 选了几个值：对上其中任意一个就算；「不是」「不包含」反过来，要一个都对不上
  const hit = qs.some(hitOne);
  return flt.op === 'ne' || flt.op === 'nhas' ? !hit : hit;
}

/** 条件里的值：选了几个就是那几个，否则是填的那一个 */
export const filterVals = (flt: Filter) => (flt.vals?.length ? flt.vals : [flt.val.trim()]);
/** 筛选条件起不起作用：选了字段，而且填了值（「为空」「不为空」不用填） */
export const filterActive = (flt: Filter | null | undefined): flt is Filter => !!flt && !!flt.fid && (opNoVal(flt.op) || flt.val !== '' || !!flt.vals?.length);
/** 视图里起作用的筛选条件 */
export const activeFilters = (v: View) => (v.filters ?? []).filter(filterActive);

/** 留下满足全部条件的记录 */
export function applyFilters(c: Content, recs: Rec[], filters: Filter[] | undefined, users: UserMap): Rec[] {
  const on = (filters ?? []).filter(filterActive).map((flt) => ({ flt, f: fld(c, flt.fid) })).filter((x): x is { flt: Filter; f: Field } => !!x.f);
  return on.length ? recs.filter((r) => on.every(({ flt, f }) => matches(f, val(f, r), flt, users))) : recs;
}

export function sorted(c: Content, recs: Rec[], sort: Sort | null | undefined, users: UserMap): Rec[] {
  if (!sort || !sort.fid) return recs;
  const f = fld(c, sort.fid); if (!f) return recs;
  const dir = sort.dir === 'desc' ? -1 : 1;
  const key = (r: Rec) => val(f, r);
  return recs.slice().sort((a, b) => {
    const x = key(a), y = key(b);
    const ex = x == null || x === '', ey = y == null || y === '';
    if (ex || ey) return ex && ey ? 0 : ex ? 1 : -1; // 空值永远排在最后
    // 公式、查找引用算出数字的也按大小排
    if (isNumeric(f.type) || isStampType(f.type) || (typeof x === 'number' && typeof y === 'number')) return ((num(x) ?? 0) - (num(y) ?? 0)) * dir;
    if (f.type === 'attach') return (filesOf(x).length - filesOf(y).length) * dir;
    if (f.type === 'check') return ((x ? 1 : 0) - (y ? 1 : 0)) * dir;
    return textOf(f, x, users).localeCompare(textOf(f, y, users), 'zh') * dir;
  });
}

/** 某个视图里能看到的记录：先筛选再排序 */
export const visibleRecords = (c: Content, v: View, users: UserMap) => sorted(c, applyFilters(c, c.records, v.filters, users), v.sort, users);

export const filterDesc = (c: Content, flt: Filter | null | undefined) => { const f = flt && fld(c, flt.fid); return f && filterActive(flt) ? `${f.name} ${OP_WORD[flt.op]}${opNoVal(flt.op) ? '' : ' ' + filterVals(flt).join(' / ')}` : ''; };
/** 能在筛选条里直接勾选项的字段：单选、多选 */
export const hasOpts = (f: Field | undefined): f is Field => !!f && isOptType(f.type);

/**
 * AI 一句话筛选（沿用原型的 CAI.baseNlq 规则）：「金额大于 30」「负责人是李娜」「包含 星河」「已报价的客户」。
 * 句子里提到了字段名就用那个字段，否则用第一个同类型的字段。解析不出返回 null。
 */
export function nlq(c: Content, q: string, users: UserMap): Filter | null {
  const text = q.trim(); if (!text) return null;
  const named = (...types: FieldType[]) => c.fields.find((f) => types.includes(f.type) && text.includes(f.name)) ?? c.fields.find((f) => types.includes(f.type));
  let m: RegExpExecArray | null;
  const numF = named('number', 'currency', 'progress', 'rating'), dateF = named('date');
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
  for (const f of c.fields) if (isOptType(f.type) && f.opts) { const o = f.opts.find((x) => text.includes(x[0])); if (o) return { fid: f.id, op: 'eq', val: o[0] }; }
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
    const vals = recs.map((r) => val(f, r));
    if ((isNumeric(f.type) && f.type !== 'autonum') || ((f.type === 'formula' || f.type === 'lookup') && vals.some((x) => typeof x === 'number'))) {
      const ns = vals.map(num).filter((x): x is number => x != null); if (!ns.length) continue;
      const sum = ns.reduce((a, b) => a + b, 0);
      lines.push(`${f.name}：合计 ${fmtNum(sum)}，平均 ${fmtNum(sum / ns.length)}，最大 ${fmtNum(Math.max(...ns))}，最小 ${fmtNum(Math.min(...ns))}。`);
    } else if (isChoice(f.type) || isUserType(f.type) || f.type === 'multi') {
      const cnt = new Map<string, number>();
      for (const v of vals) for (const x of f.type === 'multi' ? (Array.isArray(v) ? v : []) : [v]) { const k = isUserType(f.type) ? userName(users, x) : String(x ?? ''); if (k) cnt.set(k, (cnt.get(k) ?? 0) + 1); }
      if (cnt.size) lines.push(`${f.name}：${[...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('，')}。`);
    } else if (f.type === 'check') {
      const yes = vals.filter(Boolean).length; lines.push(`${f.name}：${yes} 条已勾选，${recs.length - yes} 条未勾选。`);
    } else if (f.type === 'date' || isStampType(f.type)) {
      const ds = vals.map((x) => textOf(f, x, users)).filter(Boolean).sort(); if (ds.length) lines.push(`${f.name}：从 ${ds[0]} 到 ${ds[ds.length - 1]}。`);
    } else if (f.type === 'attach') {
      const n = vals.reduce((s: number, x) => s + filesOf(x).length, 0); if (n) lines.push(`${f.name}：共 ${n} 个文件。`);
    }
  }
  return lines.join('\n');
}
export const fmtNum = (n: number) => Number(n.toFixed(2)).toLocaleString('zh-CN');

/** 新字段的默认选项：从已有的值里收集（改类型时用），没有就给两个占位 */
export function optsFrom(records: Rec[], fid: string): Opt[] {
  const seen = new Set<string>();
  for (const r of records) { const v = r.v[fid]; for (const x of Array.isArray(v) ? v : [v]) { if (isObj(x)) continue; const s = String(x ?? '').trim(); if (s) seen.add(s); if (seen.size >= 20) break; } }
  const list = [...seen];
  return (list.length ? list : ['选项 1', '选项 2']).map((o, i) => [o, COLORS[i % COLORS.length]] as Opt);
}

/** 换类型以后把值转成新类型能用的样子，转不了的清掉。系统字段的值不在 v 里，一律清掉（自动编号由 renumber 重新编） */
export function coerce(to: Pick<Field, 'type' | 'time'>, v: unknown, users: UserMap, old?: Field): unknown {
  const type = to.type, from = old?.type;
  if (isAuto(type) || type === 'button') return '';
  if (type === 'attach') return from === 'sign' && signOf(v) ? [signOf(v)!] : filesOf(v);
  // 编号数组只在同一类之间带得过去（单向 ↔ 双向关联）；别的类型换过来、换过去都从空的开始
  if (isLink(type)) return isLink(from) ? idsOf(v) : [];
  if (type === 'group') return from === 'group' ? idsOf(v) : [];
  if (type === 'sign') return from === 'sign' ? signOf(v) ?? '' : '';
  if (type === 'location') return from === 'location' ? (locOf(v) ? v : '') : typeof v === 'string' ? v : '';
  // 换成别的类型：关联、群组留下标题和群名，地理位置留下地址，公式的结果留下算出来的字（它们的值不是能直接用的文字）
  if (old && (isLink(from) || from === 'group' || from === 'location' || from === 'sign' || from === 'formula' || from === 'lookup')) v = from === 'sign' ? '' : (from === 'formula' || from === 'lookup') && typeof v !== 'boolean' ? v : textOf(old, v, users);
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return type === 'check' ? false : '';
  // 附件换成别的类型：留下文件名
  const flat = (x: unknown): unknown => (isObj(x) ? String(x.name ?? '') : x);
  const one = flat(Array.isArray(v) ? v[0] : v);
  switch (type) {
    case 'number': case 'currency': case 'progress': return num(one) ?? '';
    case 'rating': { const n = num(one); return n == null ? '' : Math.max(1, Math.min(5, Math.round(n))); }
    case 'check': return typeof v === 'boolean' ? v : truthyWord(String(one));
    case 'multi': return Array.isArray(v) ? v.map(flat).map(String).filter(Boolean) : String(v).split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
    case 'user': { const s = String(one ?? ''); return users.has(s) ? s : [...users.values()].find((u) => u.name === s)?.id ?? ''; }
    case 'date': { const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(one ?? '')); return !m ? '' : to.time && m[2] ? `${m[1]} ${m[2]}` : m[1]; }
    default: return Array.isArray(v) ? v.map(flat).map(String).filter(Boolean).join('、') : typeof v === 'boolean' ? (v ? '是' : '') : String(v);
  }
}

/** 新记录：记下创建的时间和人，每个自动编号字段取下一个号。返回这条记录和推进过编号的字段 */
export function newRecord(c: Content, id: string, preset: Record<string, unknown>, by: string | undefined, now = Date.now()): { rec: Rec; fields: Field[] } {
  const v: Record<string, unknown> = { ...preset };
  let moved = false;
  const fields = c.fields.map((f) => {
    // 流程设了「新记录从第一个阶段开始」：没指定阶段的填上第一个
    if (f.type === 'stage' && f.flow?.first && (v[f.id] == null || v[f.id] === '') && f.opts?.length) v[f.id] = f.opts[0][0];
    if (f.type !== 'autonum') return f;
    const n = Math.max(f.next ?? 1, 1); v[f.id] = n; moved = true;
    return { ...f, next: n + 1 };
  });
  return { rec: { id, v, ct: now, ut: now, ...(by ? { cb: by, ub: by } : {}) }, fields: moved ? fields : c.fields };
}
/** 一个字段刚变成自动编号：已有的记录按现在的顺序从 1 编起。返回编好的记录和下一个号 */
export function renumber(records: Rec[], fid: string): { records: Rec[]; next: number } {
  return { records: records.map((r, i) => ({ ...r, v: { ...r.v, [fid]: i + 1 } })), next: records.length + 1 };
}
/** 日期字段的值写成 input 认的样子：带时间的用 datetime-local（中间是 T） */
export const dateInput = (f: Field, v: unknown) => { const s = v == null ? '' : String(v); return f.time ? (s.length === 10 ? s + 'T00:00' : s.replace(' ', 'T')) : s.slice(0, 10); };
/** input 给的值存回去：YYYY-MM-DD 或 YYYY-MM-DD HH:mm */
export const dateStore = (f: Field, raw: string) => (f.time ? raw.replace('T', ' ').slice(0, 16) : raw.slice(0, 10));

/** 今天：YYYY-MM-DD（本地时区） */
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

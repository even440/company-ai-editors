/**
 * 公式字段的计算：把「IF({金额} > 1000, "大单", "小单")」这样的式子编译成一个函数，按记录算出值。不碰 DOM。
 *
 * 写法照 Excel / Lark 的习惯：
 * - 引用本表的字段写 {字段名}；数字、"文字"（单引号、中文引号也行）、TRUE / FALSE；
 * - 运算：+ - * / ^，& 连接文字，= != <> > >= < <= 比较；中文的括号、逗号也认；
 * - 日期（YYYY-MM-DD，可带 HH:mm）能直接加减：日期 - 日期是相差的天数，日期 ± 数字是往后 / 往前几天；
 * - 函数见 FUNCS（IF、AND、OR、SUM、ROUND、LEFT、LEN、TODAY、DATEDIF、RECORD_ID…），名字不分大小写。
 * 算不出来（字段名不对、函数不认识、除以 0、互相引用成了环）一律得到 ERR。
 */

/** 公式的值：数字、文字、真假，或者空 */
export type FVal = number | string | boolean | null;
export const ERR = '#ERROR';
export interface FormulaCtx {
  /** 取某个字段在这条记录上的值；没有这个字段时抛错 */
  get: (name: string) => FVal;
  /** 这条记录的编号（RECORD_ID()） */
  id: string;
}
type Node = (c: FormulaCtx) => FVal;
class FormulaError extends Error {}
const fail = (m: string): never => { throw new FormulaError(m); };

/* ---------- 值的换算 ---------- */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/;
const isDateText = (x: FVal): x is string => typeof x === 'string' && DATE_RE.test(x);
const p2 = (n: number) => String(n).padStart(2, '0');
function toDate(x: FVal): Date {
  if (typeof x === 'number') return new Date(x);
  const m = typeof x === 'string' ? DATE_RE.exec(x) : null;
  if (!m) return fail('date');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
}
const dateText = (d: Date, time: boolean) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}${time ? ` ${p2(d.getHours())}:${p2(d.getMinutes())}` : ''}`;
const hasTime = (x: FVal) => typeof x === 'string' && x.length > 10;
const blank = (x: FVal) => x === null || x === '';
function num(x: FVal): number {
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (blank(x)) return 0;
  const n = Number(String(x).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : fail('number');
}
/** 能当数字用：数字本身，或者整个都是数字的文字 */
const numeric = (x: FVal) => typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x.replace(/,/g, ''))));
/** 去掉 0.1 + 0.2 这种浮点尾巴 */
const tidy = (n: number) => (Number.isFinite(n) ? parseFloat(n.toPrecision(12)) : fail('range'));
const str = (x: FVal): string => (x === null ? '' : typeof x === 'boolean' ? (x ? 'TRUE' : 'FALSE') : typeof x === 'number' ? String(tidy(x)) : x);
const truthy = (x: FVal) => (typeof x === 'boolean' ? x : typeof x === 'number' ? x !== 0 : !blank(x) && x !== 'FALSE');
const DAY = 86_400_000;

function compare(a: FVal, b: FVal): number {
  if (blank(a) && blank(b)) return 0;
  if (numeric(a) && numeric(b)) return num(a) - num(b);
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(truthy(a)) - Number(truthy(b));
  return str(a).localeCompare(str(b), 'zh');
}
function add(a: FVal, b: FVal, sign: 1 | -1): FVal {
  if (isDateText(a)) {
    // 日期 - 日期：相差几天（都不带时间时是整数）；日期 ± 数字：挪几天
    if (isDateText(b)) { if (sign > 0) return fail('date+date'); const d = (toDate(a).getTime() - toDate(b).getTime()) / DAY; return hasTime(a) || hasTime(b) ? tidy(Math.round(d * 100) / 100) : Math.round(d); }
    const d = toDate(a); d.setTime(d.getTime() + sign * num(b) * DAY); return dateText(d, hasTime(a));
  }
  // 「+」两边有不是数字的文字时当连接用（& 才是正经的连接，这里只是不让人白写）
  if (sign > 0 && ((typeof a === 'string' && !blank(a) && !numeric(a)) || (typeof b === 'string' && !blank(b) && !numeric(b)))) return str(a) + str(b);
  return tidy(num(a) + sign * num(b));
}

/* ---------- 函数 ---------- */
type Fn = (args: Node[], c: FormulaCtx) => FVal;
const all = (args: Node[], c: FormulaCtx) => args.map((a) => a(c));
const nums = (args: Node[], c: FormulaCtx) => all(args, c).filter((x) => !blank(x)).map(num);
const need = (args: Node[], min: number, max = min) => { if (args.length < min || args.length > max) fail('args'); };
const roundTo = (x: number, d: number, how: (n: number) => number) => { const k = 10 ** d; return tidy(how(x * k) / k); };
const FUNCS: Record<string, Fn> = {
  IF: (a, c) => { need(a, 2, 3); return truthy(a[0](c)) ? a[1](c) : a[2] ? a[2](c) : ''; },
  IFS: (a, c) => { for (let i = 0; i + 1 < a.length; i += 2) if (truthy(a[i](c))) return a[i + 1](c); return ''; },
  IFERROR: (a, c) => { need(a, 2); try { const v = a[0](c); return v === ERR ? a[1](c) : v; } catch (e) { if (e instanceof FormulaError) return a[1](c); throw e; } },
  IFBLANK: (a, c) => { need(a, 2); const v = a[0](c); return blank(v) ? a[1](c) : v; },
  AND: (a, c) => a.every((x) => truthy(x(c))), OR: (a, c) => a.some((x) => truthy(x(c))), NOT: (a, c) => { need(a, 1); return !truthy(a[0](c)); },
  ISBLANK: (a, c) => { need(a, 1); return blank(a[0](c)); },
  SUM: (a, c) => tidy(nums(a, c).reduce((s, x) => s + x, 0)),
  AVERAGE: (a, c) => { const n = nums(a, c); return n.length ? tidy(n.reduce((s, x) => s + x, 0) / n.length) : fail('empty'); },
  MIN: (a, c) => { const n = nums(a, c); return n.length ? Math.min(...n) : 0; }, MAX: (a, c) => { const n = nums(a, c); return n.length ? Math.max(...n) : 0; },
  COUNTA: (a, c) => all(a, c).filter((x) => !blank(x)).length,
  ROUND: (a, c) => { need(a, 1, 2); return roundTo(num(a[0](c)), a[1] ? num(a[1](c)) : 0, Math.round); },
  ROUNDUP: (a, c) => { need(a, 1, 2); const x = num(a[0](c)); return roundTo(x, a[1] ? num(a[1](c)) : 0, x < 0 ? Math.floor : Math.ceil); },
  ROUNDDOWN: (a, c) => { need(a, 1, 2); return roundTo(num(a[0](c)), a[1] ? num(a[1](c)) : 0, Math.trunc); },
  INT: (a, c) => { need(a, 1); return Math.floor(num(a[0](c))); }, ABS: (a, c) => { need(a, 1); return Math.abs(num(a[0](c))); },
  MOD: (a, c) => { need(a, 2); const d = num(a[1](c)); return d === 0 ? fail('div0') : tidy(((num(a[0](c)) % d) + d) % d); },
  POWER: (a, c) => { need(a, 2); return tidy(num(a[0](c)) ** num(a[1](c))); }, SQRT: (a, c) => { need(a, 1); const x = num(a[0](c)); return x < 0 ? fail('range') : tidy(Math.sqrt(x)); },
  LEN: (a, c) => { need(a, 1); return [...str(a[0](c))].length; },
  LEFT: (a, c) => { need(a, 1, 2); return [...str(a[0](c))].slice(0, a[1] ? Math.max(0, num(a[1](c))) : 1).join(''); },
  RIGHT: (a, c) => { need(a, 1, 2); const n = a[1] ? Math.max(0, num(a[1](c))) : 1; return n ? [...str(a[0](c))].slice(-n).join('') : ''; },
  MID: (a, c) => { need(a, 3); const s = Math.max(1, num(a[1](c))); return [...str(a[0](c))].slice(s - 1, s - 1 + Math.max(0, num(a[2](c)))).join(''); },
  UPPER: (a, c) => { need(a, 1); return str(a[0](c)).toUpperCase(); }, LOWER: (a, c) => { need(a, 1); return str(a[0](c)).toLowerCase(); }, TRIM: (a, c) => { need(a, 1); return str(a[0](c)).trim(); },
  CONCATENATE: (a, c) => all(a, c).map(str).join(''), TEXT: (a, c) => { need(a, 1, 2); return str(a[0](c)); }, VALUE: (a, c) => { need(a, 1); return num(a[0](c)); },
  CONTAIN: (a, c) => { need(a, 2); return str(a[0](c)).includes(str(a[1](c))); },
  // 找不到是 0，和 Lark 一样（Excel 是报错）
  FIND: (a, c) => { need(a, 2, 3); return str(a[1](c)).indexOf(str(a[0](c)), a[2] ? Math.max(0, num(a[2](c)) - 1) : 0) + 1; },
  SUBSTITUTE: (a, c) => { need(a, 3); const from = str(a[1](c)); return from ? str(a[0](c)).split(from).join(str(a[2](c))) : str(a[0](c)); },
  TODAY: (a) => { need(a, 0); return dateText(new Date(), false); }, NOW: (a) => { need(a, 0); return dateText(new Date(), true); },
  DATE: (a, c) => { need(a, 3); return dateText(new Date(num(a[0](c)), num(a[1](c)) - 1, num(a[2](c))), false); },
  YEAR: (a, c) => { need(a, 1); return toDate(a[0](c)).getFullYear(); }, MONTH: (a, c) => { need(a, 1); return toDate(a[0](c)).getMonth() + 1; }, DAY: (a, c) => { need(a, 1); return toDate(a[0](c)).getDate(); },
  HOUR: (a, c) => { need(a, 1); return toDate(a[0](c)).getHours(); }, MINUTE: (a, c) => { need(a, 1); return toDate(a[0](c)).getMinutes(); },
  // 周日是 1，周六是 7
  WEEKDAY: (a, c) => { need(a, 1); return toDate(a[0](c)).getDay() + 1; },
  DAYS: (a, c) => { need(a, 2); return Math.round((toDate(a[0](c)).getTime() - toDate(a[1](c)).getTime()) / DAY); },
  DATEDIF: (a, c) => {
    need(a, 2, 3);
    const s = toDate(a[0](c)), e = toDate(a[1](c)), unit = a[2] ? str(a[2](c)).toUpperCase() : 'D';
    if (unit === 'D') return Math.floor((e.getTime() - s.getTime()) / DAY);
    const months = (e.getFullYear() - s.getFullYear()) * 12 + e.getMonth() - s.getMonth() - (e.getDate() < s.getDate() ? 1 : 0);
    return unit === 'M' ? months : unit === 'Y' ? Math.trunc(months / 12) : fail('unit');
  },
  RECORD_ID: (a, c) => { need(a, 0); return c.id; },
};
/** 认识的函数名，给界面列出来 */
export const FUNC_NAMES = Object.keys(FUNCS);

/* ---------- 词法 ---------- */
type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'ref'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string };
const WIDE: Record<string, string> = { '（': '(', '）': ')', '，': ',', '；': ',', ';': ',', '＋': '+', '－': '-', '＊': '*', '／': '/', '＝': '=', '＞': '>', '＜': '<', '＆': '&', '×': '*', '÷': '/' };
const CLOSE: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’' };
function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = WIDE[src[i]] ?? src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(src[i + 1] ?? ''))) { const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?|^\d+\.?/.exec(src.slice(i))!; out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
    if (CLOSE[ch]) {
      // 引号里连写两个引号是一个引号本身（Excel 的写法）
      const end = CLOSE[ch]; let s = ''; i++;
      for (;;) { if (i >= src.length) fail('string'); if (src[i] === end) { if (src[i + 1] === end && end === ch) { s += end; i += 2; continue; } i++; break; } s += src[i++]; }
      out.push({ t: 'str', v: s }); continue;
    }
    if (ch === '{') { const j = src.indexOf('}', i); if (j < 0) fail('ref'); out.push({ t: 'ref', v: src.slice(i + 1, j).trim() }); i = j + 1; continue; }
    if (/[A-Za-z_]/.test(ch)) { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!; out.push({ t: 'id', v: m[0].toUpperCase() }); i += m[0].length; continue; }
    const two = ch + (src[i + 1] ?? '');
    if (['>=', '<=', '<>', '!=', '=='].includes(two)) { out.push({ t: 'op', v: two === '==' ? '=' : two === '<>' ? '!=' : two }); i += 2; continue; }
    if ('+-*/^&=<>(),'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    fail('char');
  }
  return out;
}

/* ---------- 语法：比较 < 连接 & < 加减 < 乘除 < 乘方 < 负号 < 括号、函数、值 ---------- */
function parse(toks: Tok[]): Node {
  let p = 0;
  const peek = (v?: string) => { const t = toks[p]; return !!t && t.t === 'op' && (v === undefined || t.v === v); };
  const eat = (v: string) => { if (!peek(v)) fail('expect ' + v); p++; };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) return fail('end');
    if (t.t === 'num' || t.t === 'str') { const v = t.v; return () => v; }
    if (t.t === 'ref') { const name = t.v; return (c) => c.get(name); }
    if (t.t === 'id') {
      if (!peek('(')) { if (t.v === 'TRUE') return () => true; if (t.v === 'FALSE') return () => false; return fail('name'); }
      const fn = FUNCS[t.v] ?? fail('func');
      p++;
      const args: Node[] = [];
      if (!peek(')')) for (;;) { args.push(cmp()); if (peek(',')) { p++; continue; } break; }
      eat(')');
      return (c) => fn(args, c);
    }
    if (t.v === '(') { const e = cmp(); eat(')'); return e; }
    return fail('token');
  };
  const unary = (): Node => { if (peek('-')) { p++; const e = unary(); return (c) => tidy(-num(e(c))); } if (peek('+')) { p++; return unary(); } return primary(); };
  const pow = (): Node => { const l = unary(); if (peek('^')) { p++; const r = pow(); return (c) => tidy(num(l(c)) ** num(r(c))); } return l; };
  const mul = (): Node => { let l = pow(); while (peek('*') || peek('/')) { const op = (toks[p++] as { v: string }).v, a = l, b = pow(); l = op === '*' ? (c) => tidy(num(a(c)) * num(b(c))) : (c) => { const d = num(b(c)); return d === 0 ? fail('div0') : tidy(num(a(c)) / d); }; } return l; };
  const sum = (): Node => { let l = mul(); while (peek('+') || peek('-')) { const sign = (toks[p++] as { v: string }).v === '+' ? 1 : -1, a = l, b = mul(); l = (c) => add(a(c), b(c), sign); } return l; };
  const cat = (): Node => { let l = sum(); while (peek('&')) { p++; const a = l, b = sum(); l = (c) => str(a(c)) + str(b(c)); } return l; };
  function cmp(): Node {
    let l = cat();
    while (peek('=') || peek('!=') || peek('>') || peek('<') || peek('>=') || peek('<=')) {
      const op = (toks[p++] as { v: string }).v, a = l, b = cat();
      l = (c) => { const d = compare(a(c), b(c)); return op === '=' ? d === 0 : op === '!=' ? d !== 0 : op === '>' ? d > 0 : op === '<' ? d < 0 : op === '>=' ? d >= 0 : d <= 0; };
    }
    return l;
  }
  const root = cmp();
  if (p < toks.length) fail('extra');
  return root;
}

const cache = new Map<string, Node | null>();
/** 编译一条公式（编译结果按原文缓存）；写错了返回 null */
export function compile(expr: string): Node | null {
  const src = expr.trim().replace(/^[=＝]/, '');
  if (cache.has(src)) return cache.get(src)!;
  let node: Node | null = null;
  try { if (src) node = parse(lex(src)); } catch (e) { if (!(e instanceof FormulaError)) throw e; }
  if (cache.size > 500) cache.clear();
  cache.set(src, node);
  return node;
}
/** 算一条公式在一条记录上的值；写错、算不出都是 ERR */
export function evaluate(expr: string, ctx: FormulaCtx): FVal {
  const node = compile(expr);
  if (!node) return ERR;
  try { const v = node(ctx); return typeof v === 'number' ? tidy(v) : v; } catch (e) { if (e instanceof FormulaError) return ERR; throw e; }
}
/** 公式写得对不对（只看写法，不看字段在不在） */
export const formulaOk = (expr: string) => !!compile(expr);
/** 公式里引用了哪些字段名 */
export function refsOf(expr: string): string[] {
  try { return [...new Set(lex(expr.trim().replace(/^[=＝]/, '')).filter((t) => t.t === 'ref').map((t) => String(t.v)))]; } catch { return []; }
}
/** 字段改名：公式里引用它的地方跟着改 */
export const renameRef = (expr: string, from: string, to: string) => expr.split(`{${from}}`).join(`{${to}}`);
export { FormulaError };

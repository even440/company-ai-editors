/**
 * 三方合并：几个人同时开着同一份内容（表格、多维表格、幻灯片、思维笔记、画板、流程图、问卷），别人保存以后几秒内合并进自己这边
 * （用户 2026-11-27：「两人同时在编辑的时候看不到对方编辑的结果」，弹窗选了「几秒内看到对方的改动」、所有格式一起做）。
 *
 * base：上次和服务器一致时自己这边的内容；mine：自己现在的（可能有还没保存的改动）；theirs：服务器上别人刚存的。
 * - 只有一边改了的取那一边。
 * - 两边都改了：对象逐个键合并；数组里每一项都有编号（id、uid 或 data.uid）时按编号对齐、逐项合并，顺序以挪动过的一边为准，
 *   新加的项插在它在自己那边的前一项后面；别的（文字、数字、没有编号的数组）以自己的为准——自己的改动之后会保存，以后保存的为准。
 * - 一边删了、另一边改了：留下改过的，不丢内容。
 * 只处理 JSON（会话按 JSON 存取内容）。
 */

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const has = (o: Obj, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

/** JSON 意义上相等（值为 undefined 的键当作没有） */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  const x = a as Obj, y = b as Obj;
  let n = 0;
  for (const k in x) { if (x[k] === undefined) continue; n++; if (!has(y, k) || !same(x[k], y[k])) return false; }
  for (const k in y) if (y[k] !== undefined) n--;
  return n === 0;
}

/** 按 JSON 复制一份（Vue 的响应式对象、带 undefined 的键都变成存下来的样子） */
export const jsonClone = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)) as T);

/** 数组项的编号：id、uid，或思维笔记节点的 data.uid；没有就是 null */
export function keyOf(x: unknown): string | null {
  if (!isObj(x)) return null;
  if (typeof x.id === 'string' || typeof x.id === 'number') return `i:${x.id}`;
  if (typeof x.uid === 'string') return `u:${x.uid}`;
  if (isObj(x.data) && typeof x.data.uid === 'string') return `d:${x.data.uid}`;
  return null;
}

const MISSING = Symbol('missing');
type V = unknown | typeof MISSING;

export function merge3(base: unknown, mine: unknown, theirs: unknown): unknown {
  if (same(mine, theirs)) return mine;
  if (same(base, mine)) return theirs;
  if (same(base, theirs)) return mine;
  if (isObj(mine) && isObj(theirs)) return mergeObj(isObj(base) ? base : {}, mine, theirs);
  if (Array.isArray(mine) && Array.isArray(theirs)) return mergeArr(Array.isArray(base) ? base : [], mine, theirs) ?? mine;
  return mine;
}

/** 一个位置上三方的值（MISSING 表示那一边没有这个键 / 这一项） */
function mergeVal(b: V, m: V, t: V): V {
  if (m === MISSING && t === MISSING) return MISSING;
  if (m === MISSING) return b === MISSING ? t : same(b, t) ? MISSING : t; // 自己删了：对方没改就删，改了留下对方的
  if (t === MISSING) return b === MISSING ? m : same(b, m) ? MISSING : m;
  return merge3(b === MISSING ? undefined : b, m, t);
}

function mergeObj(base: Obj, mine: Obj, theirs: Obj): Obj {
  const out: Obj = {};
  const keys = new Set([...Object.keys(theirs), ...Object.keys(mine)]);
  for (const k of keys) {
    const v = mergeVal(has(base, k) ? base[k] : MISSING, has(mine, k) ? mine[k] : MISSING, has(theirs, k) ? theirs[k] : MISSING);
    if (v !== MISSING) out[k] = v;
  }
  return out;
}

/** 按编号建索引；有一项没编号或编号重复就返回 null（这个数组整个按值处理） */
function index(arr: unknown[]): Map<string, unknown> | null {
  const m = new Map<string, unknown>();
  for (const x of arr) { const k = keyOf(x); if (k === null || m.has(k)) return null; m.set(k, x); }
  return m;
}

/** 两边都有的项，相对顺序变了没有 */
function reordered(base: unknown[], x: unknown[], bi: Map<string, unknown>, xi: Map<string, unknown>): boolean {
  const a = base.map(keyOf).filter((k) => xi.has(k!)), b = x.map(keyOf).filter((k) => bi.has(k!));
  return a.some((k, i) => k !== b[i]);
}

function mergeArr(base: unknown[], mine: unknown[], theirs: unknown[]): unknown[] | null {
  if (!mine.length && !theirs.length) return mine;
  const B = index(base), Mi = index(mine), T = index(theirs);
  if (!B || !Mi || !T || (!Mi.size && !T.size)) return null;
  // 顺序以挪动过的一边为准：自己挪过就用自己的，不然用对方的（对方挪没挪都一样）
  const primary = reordered(base, mine, B, Mi) ? mine : theirs;
  const secondary = primary === mine ? theirs : mine;
  const order = primary.map((x) => keyOf(x)!);
  const placed = new Set(order);
  let prev: string | null = null;
  for (const x of secondary) {
    const k = keyOf(x)!;
    if (placed.has(k)) { prev = k; continue; }
    order.splice(prev === null ? 0 : order.indexOf(prev) + 1, 0, k);
    placed.add(k); prev = k;
  }
  const out: unknown[] = [];
  for (const k of order) {
    const v = mergeVal(B.has(k) ? B.get(k) : MISSING, Mi.has(k) ? Mi.get(k) : MISSING, T.has(k) ? T.get(k) : MISSING);
    if (v !== MISSING) out.push(v);
  }
  return out;
}

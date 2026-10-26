/**
 * 文档的评论：选中文字生成锚点、把宿主给的评论画成高亮、点高亮告诉宿主、报告找不到原文的评论。
 * 评论不写进正文（不加样式标记、不调保存接口），高亮全是 ProseMirror 的 decoration，所以只有阅读权限的人也能评论。
 *
 * 锚点怎么找回来（按顺序）：
 * 1. 协同模式：起止位置的 Yjs 相对位置，别人同时改正文也跟得住。原文被删了，两个相对位置会落到一起，算「找不到」，
 *    不再按文字找（免得挂到别处一样的字上）；撤销删除以后相对位置又能找到，高亮会回来。
 * 2. 相对位置不认识（普通模式没有；或者协同服务按保存的内容重建了 Y.Doc，旧编号全没了）：按 quote 在全文里找，
 *    用前后文挑对的那处。协同模式下找到以后在当前 Y.Doc 上重新算一份相对位置（只在内存里），之后靠它跟。
 *
 * 什么时候重算：
 * - 本地改动：用事务的 mapping 挪位置，很便宜；
 * - 远端改动、协同的撤销重做（y-prosemirror 每次都把整篇替换掉，mapping 没用）：按相对位置重算；
 * - 改动停下来 1 秒后整体再算一遍（包括按文字找），然后把找不到的评论报给宿主。
 */
import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
// y-tiptap 是 @tiptap/extension-collaboration 的 peer 依赖（已经装着、已经打进包里），协同扩展用的就是同一份，位置换算只能用它
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { COMMENT_ANCHOR_MAX, COMMENT_CONTEXT, COMMENT_QUOTE_MAX, type CommentAnchor, type CommentItem, type DocCommentAnchor, type EditorToHost } from '@cai/bridge';

/** 改动停下来多久以后整体重算一遍、报告找不到的评论 */
const SETTLE = 1000;

/* ---------- 全文的纯文字和位置对照 ---------- */

/** 一段文字：在纯文字里从 i 开始、在文档里从 pos 开始、长 len（文字节点里一个 UTF-16 字符占一个位置） */
interface Seg { i: number; pos: number; len: number }
interface Flat { text: string; segs: Seg[] }
const flats = new WeakMap<PMNode, Flat>();

/** 整篇的纯文字：段落（标题、列表项、单元格……）之间一个换行，硬换行也算一个换行。文档对象不可变，按对象缓存 */
function flatten(doc: PMNode): Flat {
  const hit = flats.get(doc);
  if (hit) return hit;
  const parts: string[] = [], segs: Seg[] = [];
  let n = 0;
  doc.descendants((node, pos) => {
    if (node.isText) { const t = node.text ?? ''; segs.push({ i: n, pos, len: t.length }); parts.push(t); n += t.length; }
    else if (node.type.name === 'hardBreak') { segs.push({ i: n, pos, len: 1 }); parts.push('\n'); n += 1; }
    else if (node.isTextblock && n > 0) { parts.push('\n'); n += 1; }
  });
  const f = { text: parts.join(''), segs };
  flats.set(doc, f);
  return f;
}

/** 最后一个满足 ok 的下标（segs 的 i 和 pos 都是递增的） */
function lastSeg(segs: Seg[], ok: (s: Seg) => boolean): number {
  let lo = 0, hi = segs.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ok(segs[m])) { k = m; lo = m + 1; } else hi = m - 1; }
  return k;
}
/** 文档位置 → 纯文字下标。落在段落边界上时，起点取后一段文字的开头，终点取前一段的末尾 */
function idxAt(f: Flat, pos: number, end: boolean): number {
  const k = lastSeg(f.segs, (s) => s.pos <= pos), s = f.segs[k];
  if (s && pos <= s.pos + s.len) return s.i + pos - s.pos;
  if (end) return s ? s.i + s.len : 0;
  return k + 1 < f.segs.length ? f.segs[k + 1].i : f.text.length;
}
/** 纯文字下标 → 文档位置：起点是第 i 个字前面，终点是第 i-1 个字后面；落在段落之间的换行上时往有字的一边靠 */
function posAt(f: Flat, i: number, end: boolean): number {
  const c = end ? i - 1 : i;
  const k = lastSeg(f.segs, (s) => s.i <= c), s = f.segs[k];
  if (s && c < s.i + s.len) return s.pos + c - s.i + (end ? 1 : 0);
  if (end) return s ? s.pos + s.len : 0;
  const next = f.segs[k + 1], last = f.segs[f.segs.length - 1];
  return next ? next.pos : last ? last.pos + last.len : 0;
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff, isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
/** 截一段文字，不把一个 emoji（代理对）劈成两半 */
function cut(t: string, a: number, b: number): string {
  if (a > 0 && a < t.length && isLow(t.charCodeAt(a))) a++;
  if (b > 0 && b < t.length && isHigh(t.charCodeAt(b - 1))) b--;
  return a < b ? t.slice(a, b) : '';
}

/* ---------- Yjs 相对位置 ---------- */

type Mapping = Parameters<typeof relativePositionToAbsolutePosition>[3];
/** y-prosemirror 同步插件的状态里我们要用的部分 */
interface YState { doc: Y.Doc; type: Y.XmlFragment; binding: { mapping: Mapping } | null }

function yOf(state: EditorState): YState | null {
  const y = ySyncPluginKey.getState(state) as YState | undefined;
  return y?.binding && y.type && y.doc ? y : null;
}
/** Y.Doc 的内容已经渲染进编辑器、位置对照表建好了。刚建好编辑器的一瞬间对照表是空的，这时算出来的位置不可信 */
const yReady = (y: YState) => y.binding!.mapping.size > 0 || y.type.length === 0;

interface Rel { rf: Y.RelativePosition; rt: Y.RelativePosition }
function toRel(y: YState, from: number, to: number): Rel | null {
  try {
    let rf = absolutePositionToRelativePosition(from, y.type, y.binding!.mapping) as Y.RelativePosition;
    const rt = absolutePositionToRelativePosition(to, y.type, y.binding!.mapping) as Y.RelativePosition;
    // y-prosemirror 生成的位置粘在前一个字上；起点改成粘在后一个字上，这样在评论开头前面打字不会被算进评论
    const abs = Y.createAbsolutePositionFromRelativePosition(rf, y.doc);
    if (abs && abs.type instanceof Y.XmlText) rf = Y.createRelativePositionFromTypeIndex(abs.type, abs.index, 0);
    return { rf, rt };
  } catch { return null; }
}
function fromRel(y: YState, rp: Y.RelativePosition): number | null {
  try { return relativePositionToAbsolutePosition(y.doc, y.type, rp, y.binding!.mapping); } catch { return null; }
}
function relOf(a: DocCommentAnchor): Rel | null {
  if (!a.rel || typeof a.rel !== 'object') return null;
  try { return { rf: Y.createRelativePositionFromJSON(a.rel.from), rt: Y.createRelativePositionFromJSON(a.rel.to) }; } catch { return null; }
}

/* ---------- 锚点 ---------- */

const isDocAnchor = (a: unknown): a is DocCommentAnchor => !!a && typeof a === 'object' && (a as DocCommentAnchor).kind === 'doc' && typeof (a as DocCommentAnchor).quote === 'string';

/** 给 [from, to) 生成锚点：前后的空白去掉；没有文字（只选了图片、空段落）返回 null */
export function docAnchor(state: EditorState, from: number, to: number): DocCommentAnchor | null {
  const f = flatten(state.doc), t = f.text;
  let a = idxAt(f, from, false), b = idxAt(f, to, true);
  while (a < b && /\s/.test(t[a])) a++;
  while (b > a && /\s/.test(t[b - 1])) b--;
  if (a >= b) return null;
  const pf = posAt(f, a, false), pt = posAt(f, b, true);
  const y = yOf(state), rel = y && yReady(y) ? toRel(y, pf, pt) : null;
  const anchor: DocCommentAnchor = {
    kind: 'doc', v: 1,
    rel: rel ? { from: Y.relativePositionToJSON(rel.rf), to: Y.relativePositionToJSON(rel.rt) } : null,
    quote: cut(t, a, Math.min(b, a + COMMENT_QUOTE_MAX)), len: b - a,
    prefix: cut(t, Math.max(0, a - COMMENT_CONTEXT), a), suffix: cut(t, b, b + COMMENT_CONTEXT), at: pf,
  };
  // 一般远小于上限（500 个汉字约 1.5 KB）；万一超了，把引用的原文再截短
  while (anchor.quote.length > 20 && new TextEncoder().encode(JSON.stringify(anchor)).length > COMMENT_ANCHOR_MAX) anchor.quote = cut(anchor.quote, 0, Math.floor(anchor.quote.length * 0.8));
  return anchor;
}

/** 上下文离多远还算「附近」：边上插了几个字也认 */
const NEAR = 48;
/**
 * 上下文对上了多少分：先数紧挨着的有几个字一样；不到 4 个（比如边上插了字）时，看附近 NEAR 字里能不能找到原来紧挨着的那几个字，
 * 找到按长度减一算，所以紧挨着对上的总是更高。before 为真时 ctx 是前文（从末尾往前比）
 */
function contextScore(t: string, at: number, ctx: string, before: boolean): number {
  let k = 0;
  if (before) while (k < ctx.length && at - 1 - k >= 0 && t[at - 1 - k] === ctx[ctx.length - 1 - k]) k++;
  else while (k < ctx.length && at + k < t.length && t[at + k] === ctx[k]) k++;
  if (k >= 4 || k === ctx.length) return k;
  const near = before ? t.slice(Math.max(0, at - NEAR), at) : t.slice(at, at + NEAR);
  for (let n = Math.min(8, ctx.length); n >= 3 && n - 1 > k; n--) if (near.includes(before ? ctx.slice(-n) : ctx.slice(0, n))) return n - 1;
  return k;
}

/**
 * 按文字找：quote 在全文里的每一处，按前后文和 prefix / suffix 对上了多少打分，分一样挑离创建位置近的。
 * 只有一处时直接用；有好几处、或者 strict（这条评论在这次会话里放上过，后来原文没了），前后文至少要对上几个字，免得挂错地方
 */
function findText(doc: PMNode, a: DocCommentAnchor, strict: boolean): { from: number; to: number } | null {
  if (!a.quote) return null;
  const f = flatten(doc), t = f.text, span = Math.max(a.quote.length, a.len);
  const need = Math.min(4, a.prefix.length + a.suffix.length);
  let best = -1, bestScore = -1, bestDist = Infinity, count = 0;
  for (let i = t.indexOf(a.quote); i >= 0 && count < 200; i = t.indexOf(a.quote, i + 1)) {
    count++;
    const score = contextScore(t, i, a.prefix, true) + contextScore(t, Math.min(t.length, i + span), a.suffix, false);
    const dist = Math.abs(posAt(f, i, false) - a.at);
    if (score > bestScore || (score === bestScore && dist < bestDist)) { best = i; bestScore = score; bestDist = dist; }
  }
  if (best >= 0 && (bestScore >= need || (!strict && count === 1))) return { from: posAt(f, best, false), to: posAt(f, Math.min(t.length, best + span), true) };
  return strict || best >= 0 ? null : between(f, a);
}

/**
 * 原文本身被改过、一处也找不到时：找前文的末尾和后文的开头（各至少 8 个字），两者都只出现一次、离得和原来差不多远，就把中间那段当成锚点。
 * 只在第一次放这条评论时用（比如协同服务重建了 Y.Doc，而评论里的字之前被人改过）
 */
function between(f: Flat, a: DocCommentAnchor): { from: number; to: number } | null {
  const t = f.text, pre = a.prefix.slice(-12), suf = a.suffix.slice(0, 12);
  if (pre.length < 8 || suf.length < 8) return null;
  const i = t.indexOf(pre), j = i < 0 ? -1 : t.indexOf(suf, i + pre.length);
  if (i < 0 || j < 0 || t.indexOf(pre, i + 1) >= 0 || t.indexOf(suf, j + 1) >= 0) return null;
  let s = i + pre.length, e = j;
  if (e - s > a.len * 2 + 16 || e - s < Math.ceil(a.len / 2)) return null;
  while (s < e && /\s/.test(t[s])) s++;
  while (e > s && /\s/.test(t[e - 1])) e--;
  return s < e ? { from: posAt(f, s, false), to: posAt(f, e, true) } : null;
}

/* ---------- 插件状态 ---------- */

/** 一条评论在当前文档里的位置 */
interface Spot {
  cid: string;
  a: DocCommentAnchor;
  /** 锚点的 JSON：宿主重发同一个锚点时沿用已经算好的位置和补上的相对位置 */
  key: string;
  resolved: boolean;
  rf: Y.RelativePosition | null;
  rt: Y.RelativePosition | null;
  /** 没放上时都是 -1 */
  from: number;
  to: number;
  /** 相对位置说原文确实被删了：不再按文字找 */
  dead: boolean;
  /** 这次会话里放上过：之后再丢了，按文字找时要求前后文对得上 */
  seen: boolean;
}

export interface CommentsState {
  spots: Spot[];
  /** 宿主评论框开着时临时高亮的范围 */
  pending: Spot | null;
  /** 当前评论（高亮加重），空字符串是没有 */
  active: string;
  /** 位置算得准了（协同模式要等 Y.Doc 的内容渲染进来），这之前不报找不到 */
  ready: boolean;
  deco: DecorationSet;
}
type Meta = { items?: CommentItem[]; pending?: CommentAnchor | null; active?: string; refresh?: true };

export const commentsKey = new PluginKey<CommentsState>('caiComments');

function spotOf(cid: string, raw: DocCommentAnchor, resolved: boolean, old?: Spot | null): Spot {
  const key = JSON.stringify(raw);
  if (old && old.key === key) return old.resolved === resolved ? old : { ...old, resolved };
  const quote = raw.quote;
  // 宿主原样存原样发，但还是防一手缺字段
  const a: DocCommentAnchor = {
    ...raw, quote,
    len: typeof raw.len === 'number' && raw.len >= quote.length ? raw.len : quote.length,
    prefix: typeof raw.prefix === 'string' ? raw.prefix : '', suffix: typeof raw.suffix === 'string' ? raw.suffix : '',
    at: typeof raw.at === 'number' ? raw.at : 0,
  };
  const rel = relOf(a);
  return { cid, a, key, resolved, rf: rel?.rf ?? null, rt: rel?.rt ?? null, from: -1, to: -1, dead: false, seen: false };
}
function spotsOf(items: CommentItem[] | null, prev: Spot[]): Spot[] {
  const old = new Map(prev.map((s) => [s.cid, s]));
  const out: Spot[] = [];
  for (const it of items ?? []) if (it && typeof it.cid === 'string' && isDocAnchor(it.anchor)) out.push(spotOf(it.cid, it.anchor, !!it.resolved, old.get(it.cid)));
  return out;
}

const unplaced = (s: Spot, dead: boolean): Spot => (s.from < 0 && s.dead === dead ? s : { ...s, from: -1, to: -1, dead });
const placed = (s: Spot, from: number, to: number, rel?: Rel | null): Spot =>
  (s.from === from && s.to === to && !s.dead && s.seen && !rel ? s : { ...s, from, to, dead: false, seen: true, ...(rel ? { rf: rel.rf, rt: rel.rt } : {}) });

/** 只按相对位置算：远端改动以后用 */
function byRel(s: Spot, doc: PMNode, y: YState): Spot {
  if (!s.rf || !s.rt || !yReady(y)) return unplaced(s, false);
  const f = fromRel(y, s.rf), t = fromRel(y, s.rt);
  if (f === null || t === null || t > doc.content.size) return unplaced(s, false);
  return f < t ? placed(s, f, t) : unplaced(s, true); // 相对位置还认识、却落到了一起：原文被删了
}
/** 整体算一遍：相对位置 → 按文字找；协同模式下按文字找到的，顺手在当前 Y.Doc 上补一份相对位置 */
function settle(s: Spot, doc: PMNode, y: YState | null): Spot {
  if (y) {
    if (!yReady(y)) return unplaced(s, false);
    if (s.rf && s.rt) { const r = byRel(s, doc, y); if (r.from >= 0 || r.dead) return r; s = r; }
  } else if (s.from >= 0 && s.to <= doc.content.size) return s; // 普通模式：位置一直靠 mapping 跟着，还在就不动
  const hit = findText(doc, s.a, s.seen);
  if (!hit) return unplaced(s, false);
  return placed(s, hit.from, hit.to, y ? toRel(y, hit.from, hit.to) : null);
}
/** 本地改动：跟着事务挪；整段被删了就先算没放上，停下来以后再整体算 */
function mapped(s: Spot, tr: Transaction): Spot {
  if (s.from < 0) return s;
  const f = tr.mapping.map(s.from, 1), t = tr.mapping.map(s.to, -1);
  if (f >= t) return unplaced(s, false);
  return f === s.from && t === s.to ? s : { ...s, from: f, to: t };
}

const shown = (s: Spot, active: string) => s.from >= 0 && (!s.resolved || s.cid === active);

function decorations(doc: PMNode, spots: Spot[], pending: Spot | null, active: string): DecorationSet {
  const size = doc.content.size, list: Decoration[] = [];
  for (const s of spots) {
    if (!shown(s, active) || s.to > size) continue;
    list.push(Decoration.inline(s.from, s.to, { class: s.cid === active ? 'cmt-hl cmt-on' : 'cmt-hl', 'data-cid': s.cid }));
  }
  if (pending && pending.from >= 0 && pending.to <= size) list.push(Decoration.inline(pending.from, pending.to, { class: 'cmt-hl cmt-pending' }));
  return list.length ? DecorationSet.create(doc, list) : DecorationSet.empty;
}
function make(doc: PMNode, y: YState | null, spots: Spot[], pending: Spot | null, active: string): CommentsState {
  return { spots, pending, active, ready: !y || yReady(y), deco: decorations(doc, spots, pending, active) };
}

/* ---------- 控制器：编辑器组件和插件之间 ---------- */

/**
 * 一个文档编辑器一份。宿主的评论列表、当前评论、临时高亮记在这里（编辑器重建时新插件从这里取），
 * 位置的计算在插件里，找不到的评论由这里防抖后报给宿主。
 */
export class DocComments {
  items: CommentItem[] | null = null;
  pending: CommentAnchor | null = null;
  active = '';
  private editor: Editor | null = null;
  private canReport = false;
  private sent: string | null = null;
  private mustSend = false;
  private timer = 0;
  /** 宿主要看、但还没放上的评论：放上了再滚过去，过一会儿还没放上就算了 */
  private wantScroll = '';
  private wantUntil = 0;

  constructor(private send: (m: EditorToHost) => void) {}

  /** 宿主发过 comments 以后才显示评论入口（老宿主不认识评论，入口点了也没用） */
  get enabled() { return this.items !== null; }

  /** 注册到 Tiptap 的扩展：每个编辑器实例一个插件，状态从这里取 */
  extension() {
    const ctl = this;
    return Extension.create({ name: 'caiComments', addProseMirrorPlugins: () => [ctl.plugin()] });
  }

  attach(editor: Editor | null) {
    this.editor = editor;
    if (!editor) return;
    // 插件建好到这里之间宿主可能又发过消息：整体同步一次
    if (this.items) this.dispatch({ items: this.items, pending: this.pending, active: this.active });
    this.schedule();
  }

  /** 能不能报找不到的评论：协同模式要等连上（没连上时看到的是打开时的内容，不准） */
  setReportable(v: boolean) {
    if (this.canReport === v) return;
    this.canReport = v;
    if (v) this.schedule();
  }

  setItems(items: CommentItem[]) {
    this.items = Array.isArray(items) ? items : [];
    this.mustSend = true; // 每收到一次列表都回一次，哪怕和上次一样
    this.dispatch({ items: this.items });
    this.schedule();
  }

  setPending(anchor: CommentAnchor | null) {
    this.pending = anchor;
    this.dispatch({ pending: anchor });
  }

  /** 宿主要看某条评论：设成当前评论、滚过去；还没放上（刚打开、还在连协同）就等放上了再滚 */
  focus(cid: string) {
    this.active = cid || '';
    this.dispatch({ active: this.active });
    this.wantScroll = this.active; this.wantUntil = Date.now() + 5000;
    this.scrollIfReady();
  }

  /** 评论当前选中的文字：发 comment-new 给宿主。没选中文字（或宿主不支持评论）返回 false */
  create(): boolean {
    const ed = this.editor;
    if (!ed || ed.isDestroyed || !this.enabled) return false;
    const { from, to } = ed.state.selection;
    if (from === to) return false;
    const anchor = docAnchor(ed.state, from, to);
    if (!anchor) return false;
    this.send({ type: 'comment-new', anchor, quote: anchor.quote });
    return true;
  }

  private dispatch(meta: Meta) {
    const ed = this.editor;
    if (ed && !ed.isDestroyed) ed.view.dispatch(ed.state.tr.setMeta(commentsKey, meta));
  }

  /** 停下来 SETTLE 毫秒后报一次找不到的评论 */
  schedule() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.report(), SETTLE);
  }

  /** 把找不到的评论报给宿主：和上次一样就不报（刚收到列表时总要报一次） */
  report() {
    window.clearTimeout(this.timer); this.timer = 0;
    const ed = this.editor;
    if (!ed || ed.isDestroyed || !this.items || !this.canReport) return;
    const st = commentsKey.getState(ed.state);
    if (!st?.ready) return;
    const found = new Set(st.spots.filter((s) => s.from >= 0).map((s) => s.cid));
    const cids = this.items.filter((i) => !found.has(i.cid)).map((i) => i.cid);
    const key = cids.join('\n');
    if (!this.mustSend && key === this.sent) return;
    this.mustSend = false; this.sent = key;
    this.send({ type: 'comment-orphans', cids });
  }

  private scrollIfReady() {
    const ed = this.editor, cid = this.wantScroll;
    if (cid && Date.now() > this.wantUntil) { this.wantScroll = ''; return; }
    if (!cid || !ed || ed.isDestroyed) return;
    const s = commentsKey.getState(ed.state)?.spots.find((x) => x.cid === cid);
    if (!s || s.from < 0) return;
    this.wantScroll = '';
    try {
      const view = ed.view, box = view.dom.closest('.ed-body');
      const c = view.coordsAtPos(s.from);
      if (box) { const r = box.getBoundingClientRect(); box.scrollTo({ top: Math.max(0, box.scrollTop + c.top - r.top - r.height / 3), behavior: 'smooth' }); }
    } catch { /* 还没渲染出来，不滚 */ }
  }

  private open(cid: string) {
    if (this.active !== cid) { this.active = cid; this.dispatch({ active: cid }); }
    this.send({ type: 'comment-open', cid });
  }

  private plugin(): Plugin<CommentsState> {
    const ctl = this;
    return new Plugin<CommentsState>({
      key: commentsKey,
      state: {
        init: (_, state) => {
          const y = yOf(state), pending = isDocAnchor(ctl.pending) ? spotOf('', ctl.pending, false) : null;
          const spots = spotsOf(ctl.items, []).map((s) => settle(s, state.doc, y));
          return make(state.doc, y, spots, pending && settle(pending, state.doc, y), ctl.active);
        },
        apply: (tr, prev, old, state) => {
          const meta = tr.getMeta(commentsKey) as Meta | undefined;
          // 插件的先后顺序决定 newState 里有没有同步插件的状态；它的 doc / type / binding 前后是同一份，取不到就用旧的
          const y = yOf(state) ?? yOf(old);
          let { spots, pending, active } = prev, again = false;
          if (meta?.items) { spots = spotsOf(meta.items, prev.spots); again = true; }
          if (meta && 'pending' in meta) { pending = isDocAnchor(meta.pending) ? spotOf('', meta.pending, false, prev.pending) : null; again = true; }
          if (meta?.active !== undefined) active = meta.active;
          if (meta?.refresh) again = true;
          if (again) {
            spots = spots.map((s) => settle(s, state.doc, y));
            pending = pending && settle(pending, state.doc, y);
          } else if (tr.docChanged) {
            if (y && tr.getMeta(ySyncPluginKey) !== undefined) {
              // 远端改动、协同撤销重做、刚连上时把 Y.Doc 渲染进来：整篇被替换过，只能按相对位置重算
              spots = spots.map((s) => byRel(s, state.doc, y));
              pending = pending && byRel(pending, state.doc, y);
            } else {
              spots = spots.map((s) => mapped(s, tr));
              pending = pending && mapped(pending, tr);
            }
          } else if (!meta) return prev;
          return make(state.doc, y, spots, pending, active);
        },
      },
      props: {
        decorations: (state) => commentsKey.getState(state)?.deco,
        handleDOMEvents: {
          // 点高亮：位置落在哪几条评论里，取最短的那条（重叠时是最里面的）。拖选文字松手时也会有 click，那时选区不是空的，不算
          click: (view, ev) => {
            const el = (ev.target as Element | null)?.closest?.('.cmt-hl');
            if (!el) return false;
            const sel = view.dom.ownerDocument.getSelection();
            if (sel && !sel.isCollapsed) return false;
            const st = commentsKey.getState(view.state);
            if (!st) return false;
            const at = view.posAtCoords({ left: ev.clientX, top: ev.clientY })?.pos;
            let best: Spot | null = null;
            if (at !== undefined) for (const s of st.spots) {
              if (!shown(s, st.active) || at < s.from || at > s.to) continue;
              if (!best || s.to - s.from < best.to - best.from) best = s;
            }
            const cid = best?.cid ?? el.getAttribute('data-cid');
            if (cid) ctl.open(cid);
            return false;
          },
        },
      },
      view: (view) => {
        let timer = 0;
        const refresh = () => {
          timer = 0;
          if (view.isDestroyed) return;
          view.dispatch(view.state.tr.setMeta(commentsKey, { refresh: true }));
          ctl.report();
        };
        return {
          update: (v, prevState) => {
            const st = commentsKey.getState(v.state), old = commentsKey.getState(prevState);
            if (v.state.doc !== prevState.doc && (st?.spots.length || st?.pending)) { window.clearTimeout(timer); timer = window.setTimeout(refresh, SETTLE); }
            // 协同的内容刚渲染进来，位置才算得准：这时再报一次（列表为空时上面不会重算）
            if (st?.ready && !old?.ready) ctl.schedule();
            if (st !== old) ctl.scrollIfReady();
          },
          destroy: () => window.clearTimeout(timer),
        };
      },
    });
  }
}

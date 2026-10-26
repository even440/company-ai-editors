/**
 * 表格的评论：右键菜单或工具栏的「评论」、或者 Ctrl/⌘+Alt+M，评论当前选中的格子或区域；编辑和只读都能用，评论不改格子、不保存。
 * 有评论的格子（区域的左上角那格）右上角画一个小三角：用的是 Univer 自己的格子标记（它显示「强制文本」的绿三角也是这套），
 * 经格子内容拦截器加上去，只影响显示，不进保存的内容。点有三角的格子告诉宿主（comment-open）。评论串、回复都在宿主那边，
 * 这里不装 Univer 的评论插件。当前评论、评论框开着时的范围用 Univer 的区域高亮框出来。
 *
 * 锚点是工作表编号 + 行列号（从 0 起）。这次会话里插入、删除行列时锚点跟着挪，并发 comment-moved 让宿主更新保存的锚点；
 * 宿主不处理的话，下次打开回到原来的行列号上。整片行列被删、工作表被删、行列号超出表格范围时算找不到（comment-orphans）。
 * 拖动行头移动行列、剪切粘贴格子不跟。
 */
import type { ICellMarksStyle, ICommandInfo, IDisposable, Univer } from '@univerjs/presets';
import { InterceptorEffectEnum, type FUniver } from '@univerjs/presets';
import { IconManager, INTERCEPTOR_POINT, SheetInterceptorService, type FWorkbook } from '@univerjs/preset-sheets-core';
import { COMMENT_QUOTE_MAX, type CommentAnchor, type CommentItem, type EditorToHost, type SheetCommentAnchor } from '@cai/bridge';
import { ICONS } from '../shell/icons';

/** 停下来多久以后报找不到的评论和挪过的锚点 */
const SETTLE = 1000;
/** 取引用文字时最多读这么多行列：整列、整行的选区不用全读 */
const QUOTE_ROWS = 50, QUOTE_COLS = 26;
const MENU_ICON = 'CaiCommentIcon';

interface Item {
  cid: string;
  /** 宿主给的锚点 JSON：宿主重发同一个锚点时沿用这边挪过的位置 */
  src: string;
  /** 当前的锚点（挪过以后的） */
  a: SheetCommentAnchor;
  resolved: boolean;
  /** 所在的行或列整片被删掉了 */
  dead: boolean;
  /** 挪过、还没告诉宿主 */
  moved: boolean;
}

const isSheetAnchor = (a: unknown): a is SheetCommentAnchor => {
  const x = a as SheetCommentAnchor;
  return !!x && typeof x === 'object' && x.kind === 'sheet' && typeof x.sheetId === 'string' && [x.row, x.col, x.endRow, x.endCol].every((n) => Number.isInteger(n) && n >= 0) && x.endRow >= x.row && x.endCol >= x.col;
};

/** 菜单里的图标：和编辑器其余地方一样的 16×16 描边图标，颜色跟着 Univer 的菜单文字 */
function CommentIcon(props: { className?: string; style?: React.CSSProperties }) {
  return <svg className={props.className} style={props.style} width="1em" height="1em" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS.chat }} />;
}

const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
/** #rrggbb → rgba，区域高亮的填充要半透明，不然盖住格子里的字 */
function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(250, 178, 25, ${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** 插入 / 删除 count 行（列）以后，[a, b] 变成什么；整片被删返回 null */
function shiftInsert(a: number, b: number, at: number, count: number): [number, number] {
  if (at <= a) return [a + count, b + count];
  if (at <= b) return [a, b + count];
  return [a, b];
}
function shiftRemove(a: number, b: number, from: number, to: number): [number, number] | null {
  const count = to - from + 1;
  if (b < from) return [a, b];
  if (a > to) return [a - count, b - count];
  const left = (b - a + 1) - (Math.min(b, to) - Math.max(a, from) + 1);
  if (left <= 0) return null;
  const start = a < from ? a : from;
  return [start, start + left - 1];
}

export class SheetComments {
  private items: Item[] | null = null;
  private active = '';
  private pending: SheetCommentAnchor | null = null;
  private wb: FWorkbook | null = null;
  private marks = new Map<string, ICellMarksStyle>();
  private lasting: IDisposable[] = [];
  private highlights: IDisposable[] = [];
  private menus = false;
  private timer = 0;
  private frame = 0;
  private sent: string | null = null;
  private mustSend = false;
  private onKey = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey || e.code !== 'KeyM' || !this.enabled || !this.wb) return;
    // 捕获阶段先拦下来，不让 Univer 的快捷键和格子编辑器再处理
    e.preventDefault(); e.stopPropagation();
    this.create();
  };

  /** toast：没选中格子时提示 */
  constructor(private univer: Univer, private api: FUniver, private send: (m: EditorToHost) => void, private toast: (t: string) => void) {
    window.addEventListener('keydown', this.onKey, true);
  }

  /** 宿主发过 comments 以后才有评论入口（老宿主不认识评论） */
  get enabled() { return this.items !== null; }

  /** 工作簿建好以后调：表格的服务要等第一个工作簿建好才注册进来 */
  attach(wb: FWorkbook) {
    this.wb = wb;
    if (!this.lasting.length) {
      try {
        const interceptors = this.univer.__getInjector().get(SheetInterceptorService);
        this.lasting.push(interceptors.intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
          // 只影响显示：取值（保存、公式）时 Univer 会跳过 Style 类的拦截器
          effect: InterceptorEffectEnum.Style,
          priority: 100,
          handler: (cell, pos, next) => {
            const m = this.marks.get(`${pos.subUnitId}:${pos.row}:${pos.col}`);
            return next(m ? { ...cell, markers: { ...cell?.markers, tr: m } } : cell);
          },
        }));
      } catch { /* 拿不到拦截服务（不该发生）就不画三角，其余照常 */ }
      this.lasting.push(
        this.api.addEvent(this.api.Event.CellClicked, (p) => this.clicked(p.worksheet.getSheetId(), p.row, p.column)),
        this.api.addEvent(this.api.Event.ActiveSheetChanged, () => this.repaint()),
        this.api.addEvent(this.api.Event.CommandExecuted, (e) => this.onCommand(e)),
      );
    }
    if (this.items) { this.addMenus(); this.repaint(); this.schedule(); }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey, true);
    window.clearTimeout(this.timer); cancelAnimationFrame(this.frame);
    for (const d of [...this.lasting, ...this.highlights]) { try { d.dispose(); } catch { /* Univer 已经销毁 */ } }
    this.lasting = []; this.highlights = []; this.wb = null;
  }

  setItems(list: CommentItem[]) {
    const old = new Map((this.items ?? []).map((i) => [i.cid, i]));
    this.items = [];
    for (const it of Array.isArray(list) ? list : []) {
      if (!it || typeof it.cid !== 'string') continue;
      const src = JSON.stringify(it.anchor ?? null), prev = old.get(it.cid);
      if (prev && prev.src === src) { this.items.push({ ...prev, resolved: !!it.resolved }); continue; }
      // 锚点不是表格的（不该发生）也留着，报成找不到
      const a = isSheetAnchor(it.anchor) ? { ...it.anchor } : { kind: 'sheet' as const, v: 1 as const, sheetId: '', row: 0, col: 0, endRow: 0, endCol: 0, quote: '' };
      this.items.push({ cid: it.cid, src, a, resolved: !!it.resolved, dead: !isSheetAnchor(it.anchor), moved: false });
    }
    this.mustSend = true; // 每收到一次列表都回一次找不到的，哪怕和上次一样
    if (this.wb) { this.addMenus(); this.repaint(); }
    this.schedule();
  }

  setPending(anchor: CommentAnchor | null) {
    this.pending = isSheetAnchor(anchor) ? anchor : null;
    this.repaint();
  }

  /** 宿主要看某条评论：切到它的工作表、滚过去、加重标记并框出来 */
  focus(cid: string) {
    this.active = cid || '';
    const it = this.items?.find((i) => i.cid === this.active);
    const wb = this.wb;
    if (it && wb && !this.lost(it)) {
      try {
        const switched = wb.getActiveSheet().getSheetId() !== it.a.sheetId;
        if (switched) wb.setActiveSheet(it.a.sheetId);
        // 已经在眼前就不滚（scrollToCell 会把格子滚到左上角，看着像跳了一下）
        // 冻结的行列不在主视区里，但一直看得见
        const ws = wb.getActiveSheet(), vis = switched ? null : ws.getVisibleRange(), fz = ws.getSheet().getFreeze();
        const rowSeen = (fz.ySplit > 0 && it.a.row < fz.startRow) || (!!vis && it.a.row >= vis.startRow && it.a.row <= vis.endRow);
        const colSeen = (fz.xSplit > 0 && it.a.col < fz.startColumn) || (!!vis && it.a.col >= vis.startColumn && it.a.col <= vis.endColumn);
        if (!rowSeen || !colSeen) ws.scrollToCell(it.a.row, it.a.col);
      } catch { /* 切表、滚动失败不影响高亮 */ }
    }
    this.repaint();
  }

  /** 主题变了：标记和高亮的颜色从 CSS 变量里重新取 */
  themeChanged() { this.repaint(); }

  /** 评论当前选中的格子或区域：发 comment-new 给宿主 */
  create(): boolean {
    const wb = this.wb;
    if (!wb || !this.enabled) return false;
    const ws = wb.getActiveSheet(), range = ws.getSelection()?.getActiveRange();
    if (!range) { this.toast('先选中要评论的格子'); return false; }
    const row = range.getRow(), col = range.getColumn(), endRow = range.getLastRow(), endCol = range.getLastColumn();
    let quote = '';
    try {
      const rows = ws.getRange(row, col, Math.min(endRow - row + 1, QUOTE_ROWS), Math.min(endCol - col + 1, QUOTE_COLS)).getDisplayValues();
      quote = rows.map((r) => r.join('\t').replace(/\s+$/, '')).join('\n').replace(/\s+$/, '').slice(0, COMMENT_QUOTE_MAX);
    } catch { /* 取不到显示文字就留空 */ }
    const anchor: SheetCommentAnchor = { kind: 'sheet', v: 1, sheetId: ws.getSheetId(), row, col, endRow, endCol, quote, sheetName: ws.getSheetName() };
    this.send({ type: 'comment-new', anchor, quote });
    return true;
  }

  /* ---------- 内部 ---------- */

  private addMenus() {
    if (this.menus) return;
    this.menus = true;
    try {
      // Univer 1.x 的菜单图标从 IconManager 取（文档里说的 registerComponent 管不到菜单图标）
      this.univer.__getInjector().get(IconManager).register(MENU_ICON, CommentIcon);
      const item = (id: string) => ({ id, title: '评论', tooltip: '评论选中的格子（Ctrl+Alt+M，Mac 上 ⌘+⌥+M）', icon: MENU_ICON, action: () => { this.create(); } });
      // 右键菜单（格子、行头、列头都有）和「开始」工具栏的最后一组
      this.api.createMenu(item('cai.comment.context')).appendTo('contextMenu.others');
      this.api.createMenu(item('cai.comment.ribbon')).appendTo('ribbon.start.others');
    } catch { /* 菜单加不上还有快捷键 */ }
  }

  private lost(it: Item): boolean {
    if (it.dead) return true;
    const ws = this.wb?.getSheetBySheetId(it.a.sheetId);
    if (!ws) return true;
    return it.a.row >= ws.getMaxRows() || it.a.col >= ws.getMaxColumns();
  }

  /** 点了格子：合并格子按主格子算；这一格是哪几条评论的标记格，取最小的区域 */
  private clicked(sheetId: string, row: number, col: number) {
    if (!this.items?.length) return;
    try {
      const merged = this.wb?.getSheetBySheetId(sheetId)?.getSheet().getMergedCell(row, col);
      if (merged) { row = merged.startRow; col = merged.startColumn; }
    } catch { /* 取不到合并信息就按点到的格子算 */ }
    let best: Item | null = null;
    for (const it of this.items) {
      if ((it.resolved && it.cid !== this.active) || it.a.sheetId !== sheetId || it.a.row !== row || it.a.col !== col || this.lost(it)) continue;
      const area = (it.a.endRow - it.a.row + 1) * (it.a.endCol - it.a.col + 1);
      if (!best || area < (best.a.endRow - best.a.row + 1) * (best.a.endCol - best.a.col + 1)) best = it;
    }
    if (!best) return;
    this.active = best.cid;
    this.repaint();
    this.send({ type: 'comment-open', cid: best.cid });
  }

  /** 插入、删除行列以后挪锚点；删工作表、建工作表也要重新看一遍找不到的 */
  private onCommand(e: ICommandInfo) {
    if (!this.items?.length) return;
    const p = e.params as { subUnitId?: string; range?: { startRow: number; endRow: number; startColumn: number; endColumn: number } } | undefined;
    const kind = ({
      'sheet.mutation.insert-row': 'ins-row', 'sheet.mutation.remove-rows': 'del-row',
      'sheet.mutation.insert-col': 'ins-col', 'sheet.mutation.remove-col': 'del-col',
    } as Record<string, string>)[e.id];
    if (kind && p?.range && p.subUnitId) {
      const { startRow, endRow, startColumn, endColumn } = p.range;
      let changed = false;
      for (const it of this.items) {
        if (it.dead || it.a.sheetId !== p.subUnitId) continue;
        const rows = kind.endsWith('row');
        const [a, b] = rows ? [it.a.row, it.a.endRow] : [it.a.col, it.a.endCol];
        const next = kind.startsWith('ins')
          ? shiftInsert(a, b, rows ? startRow : startColumn, rows ? endRow - startRow + 1 : endColumn - startColumn + 1)
          : shiftRemove(a, b, rows ? startRow : startColumn, rows ? endRow : endColumn);
        if (!next) { it.dead = true; changed = true; continue; }
        if (next[0] === a && next[1] === b) continue;
        it.a = rows ? { ...it.a, row: next[0], endRow: next[1] } : { ...it.a, col: next[0], endCol: next[1] };
        it.moved = true; changed = true;
      }
      if (changed) { this.repaint(); this.schedule(); }
    } else if (e.id === 'sheet.mutation.remove-sheet' || e.id === 'sheet.mutation.insert-sheet') {
      this.repaint(); this.schedule();
    }
  }

  private schedule() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.report(), SETTLE);
  }

  /** 挪过的锚点发 comment-moved；找不到的和上次不一样（或刚收到列表）就发 comment-orphans */
  private report() {
    this.timer = 0;
    if (!this.items || !this.wb) return;
    for (const it of this.items) {
      if (!it.moved) continue;
      it.moved = false;
      if (!it.dead) this.send({ type: 'comment-moved', cid: it.cid, anchor: it.a });
    }
    const cids = this.items.filter((it) => this.lost(it)).map((it) => it.cid);
    const key = cids.join('\n');
    if (!this.mustSend && key === this.sent) return;
    this.mustSend = false; this.sent = key;
    this.send({ type: 'comment-orphans', cids });
  }

  /** 重画：下一帧统一做，连着来几次只画一回 */
  private repaint() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  private paint() {
    const wb = this.wb;
    if (!wb) return;
    const normal = cssVar('--warn', '#fab219'), strong = cssVar('--serious', '#ec835a'), accent = cssVar('--accent-btn', '#2f6bf2');
    this.marks.clear();
    for (const it of this.items ?? []) {
      if ((it.resolved && it.cid !== this.active) || this.lost(it)) continue;
      const key = `${it.a.sheetId}:${it.a.row}:${it.a.col}`, on = it.cid === this.active;
      if (on || !this.marks.has(key)) this.marks.set(key, on ? { color: strong, size: 9 } : { color: normal, size: 6 });
    }
    for (const d of this.highlights) { try { d.dispose(); } catch { /* 已经没了 */ } }
    this.highlights = [];
    let ws;
    try { ws = wb.getActiveSheet(); } catch { return; }
    const sheetId = ws.getSheetId();
    const box = (a: SheetCommentAnchor, style: { stroke: string; fill: string; strokeWidth: number; strokeDash?: number }) => {
      if (a.sheetId !== sheetId || a.row >= ws.getMaxRows() || a.col >= ws.getMaxColumns()) return;
      const rows = Math.min(a.endRow, ws.getMaxRows() - 1) - a.row + 1, cols = Math.min(a.endCol, ws.getMaxColumns() - 1) - a.col + 1;
      try { this.highlights.push(ws.getRange(a.row, a.col, rows, cols).highlight(style, null)); } catch { /* 框不出来就只有三角 */ }
    };
    const act = this.items?.find((i) => i.cid === this.active && !this.lost(i));
    if (act) box(act.a, { stroke: strong, fill: alpha(strong, 0.12), strokeWidth: 2 });
    if (this.pending) box(this.pending, { stroke: accent, fill: alpha(accent, 0.08), strokeWidth: 2, strokeDash: 8 });
    try { ws.refreshCanvas(); } catch { /* 还没渲染出来 */ }
  }
}

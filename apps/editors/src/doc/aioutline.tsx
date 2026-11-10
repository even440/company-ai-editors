/**
 * AI 识别目录（用户 2026-11-10：「文档支持 ai 识别目录的功能」，照 WPS 导航窗格上的「AI 识别目录」）。
 * 有的文档标题只是加粗、放大的文字，或者只靠「一、」「1.1」这样的编号，没有设成标题，目录里就是空的（导入的 Word 按大纲级别认，见 headings.ts；
 * 连大纲级别都没有的、纯文本、网页里贴进来的就认不出）。目录上的「AI 识别目录」把正文顶层的短段落（文字、加粗、字号、居中）交给宿主的模型，
 * 认出哪些是标题、各是几级；结果先列出来给人看，去掉不对的、改了级别，确认以后才把这些段落设成标题——一步能撤销。
 * 只把段落升成标题：已有的标题只当参考，不改它的级别，也不会把标题降回段落。长文档分批问（每批带上前面已经定下来的标题，级别才接得上）。
 * 模型在宿主那边（POST …/outline），编辑器不直接碰模型；宿主没有这个接口时提示用不了
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { ApiError, OUTLINE_BATCH, OUTLINE_CHARS, OUTLINE_LINE_MAX, type EditorClient } from '@cai/bridge';
import { Modal, cx, toast } from '../shell/ui';
import { ST } from '../shell/i18n';
import { T } from './i18n';

/** 交给模型看的一段：i 是它在正文顶层的第几块；level 是它现在已经是几级标题（0 是段落） */
export interface Cand { i: number; text: string; f: string; level: number }
/** 认出来的一个标题 */
export interface Found { i: number; level: number; text: string }

/** 每批带上前面多少个已经定下来的标题 */
const TRAIL = 30;
/** 认的时候到设成标题之间别人可能加减过段落：序号对不上时在前后这么多块里找文字一样的 */
const NEAR = 40;

const norm = (n: PmNode) => n.textContent.replace(/\s+/g, ' ').trim();
const clampLevel = (v: unknown) => Math.min(6, Math.max(1, Math.round(Number(v)) || 1));

/** 段落的格式特征：b 整段加粗、数字是整段统一的字号（磅）、c 居中。标题常常就是靠这些和正文区分的 */
function featuresOf(node: PmNode): string {
  // size：undefined 是还没看到字，null 是各处字号不一样（或者没设）
  const st: { bold: boolean; size: number | null | undefined } = { bold: true, size: undefined };
  node.forEach((ch) => {
    if (!ch.isText || !/\S/.test(ch.text ?? '')) return;
    if (!ch.marks.some((m) => m.type.name === 'bold')) st.bold = false;
    const fs = /^([\d.]+)(pt|px)$/.exec(String(ch.marks.find((m) => m.type.name === 'textStyle')?.attrs.fontSize ?? ''));
    const pt = fs ? Math.round(Number(fs[1]) * (fs[2] === 'px' ? 0.75 : 1)) : null;
    st.size = st.size === undefined || st.size === pt ? pt : null;
  });
  if (st.size === undefined) return '';
  return [st.bold ? 'b' : '', st.size ? String(st.size) : '', node.attrs.textAlign === 'center' ? 'c' : ''].filter(Boolean).join(',');
}

/** 正文顶层可能是标题的段落（有字、不超过 OUTLINE_LINE_MAX 个字），和已有的标题（给模型当参考）。和目录一样只看顶层，表格、引用里的不算 */
export function candidatesOf(doc: PmNode): Cand[] {
  const out: Cand[] = [];
  doc.forEach((node, _offset, index) => {
    const name = node.type.name;
    if (name !== 'paragraph' && name !== 'heading') return;
    const text = norm(node);
    if (!text) return;
    if (name === 'heading') { const level = clampLevel(node.attrs.level); out.push({ i: index, text: text.slice(0, OUTLINE_LINE_MAX), f: `h${level}`, level }); }
    else if (text.length <= OUTLINE_LINE_MAX) out.push({ i: index, text, f: featuresOf(node), level: 0 });
  });
  return out;
}

/** 分批：一批不超过 OUTLINE_BATCH 行、OUTLINE_CHARS 个字；全是已有标题、没有段落的批不用问 */
export function batchesOf(cands: Cand[]): Cand[][] {
  const out: Cand[][] = [];
  let cur: Cand[] = [], size = 0;
  for (const c of cands) {
    if (cur.length && (cur.length >= OUTLINE_BATCH || size + c.text.length > OUTLINE_CHARS)) { out.push(cur); cur = []; size = 0; }
    cur.push(c); size += c.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** 一批批交给宿主的模型认。alive 返回 false（页面关了）就停 */
export async function recognize(client: EditorClient, cands: Cand[], onProgress: (batch: number, total: number) => void, alive: () => boolean): Promise<{ found: Found[]; mock: boolean }> {
  const batches = batchesOf(cands), todo = batches.filter((b) => b.some((c) => !c.level)).length;
  const found: Found[] = [], trail: { level: number; t: string }[] = [];
  let mock = false, n = 0;
  for (const batch of batches) {
    let levels = new Map<number, number>();
    if (batch.some((c) => !c.level)) {
      if (!alive()) break;
      onProgress(++n, todo);
      const before = trail.slice(-TRAIL);
      const res = await client.outline({ lines: batch.map((c) => ({ i: c.i, t: c.text, ...(c.f ? { f: c.f } : {}) })), ...(before.length ? { before } : {}) });
      mock = mock || !!res.mock;
      levels = new Map((Array.isArray(res.items) ? res.items : []).filter((x) => x && Number.isInteger(x.i) && Number(x.level) >= 1 && Number(x.level) <= 6).map((x) => [x.i, clampLevel(x.level)]));
    }
    // 已有的标题和新认出来的按顺序记着，下一批的级别接着它们排
    for (const c of batch) {
      const level = c.level || levels.get(c.i);
      if (!level) continue;
      trail.push({ level, t: c.text });
      if (!c.level) found.push({ i: c.i, level, text: c.text });
    }
  }
  return { found, mock };
}

/** 把选中的段落设成标题：一个事务，撤销一次就全回去；对齐、书签这些属性留着。返回设了几段 */
export function applyHeadings(editor: Editor, picks: Found[]): number {
  const heading = editor.schema.nodes.heading;
  if (!heading || editor.isDestroyed || !editor.isEditable) return 0;
  const tops: { pos: number; node: PmNode }[] = [];
  editor.state.doc.forEach((node, offset) => tops.push({ pos: offset, node }));
  const used = new Set<number>(), targets: { pos: number; node: PmNode; level: number }[] = [];
  for (const p of picks) {
    let at = -1;
    for (let d = 0; d <= NEAR && at < 0; d++) {
      for (const k of d ? [p.i - d, p.i + d] : [p.i]) {
        const t = tops[k];
        if (t && !used.has(k) && t.node.type.name === 'paragraph' && norm(t.node) === p.text) { at = k; break; }
      }
    }
    if (at < 0) continue;
    used.add(at);
    targets.push({ pos: tops[at].pos, node: tops[at].node, level: p.level });
  }
  if (!targets.length) return 0;
  // 只换节点的种类，大小不变，前面换过的不影响后面的位置
  editor.chain().command(({ tr }) => { for (const t of targets) tr.setNodeMarkup(t.pos, heading, { ...t.node.attrs, level: t.level }); return true; }).run();
  return targets.length;
}

/* ---------- 确认 ---------- */

const LEVELS = [1, 2, 3, 4, 5, 6];

/** 认出来的标题先给人看：勾掉不对的、改级别，确认了才动正文 */
function Review({ found, mock, onApply, onClose }: { found: Found[]; mock: boolean; onApply: (picks: Found[]) => void; onClose: () => void }) {
  const [rows, setRows] = useState(() => found.map((f) => ({ ...f, on: true })));
  const picks = useMemo(() => rows.filter((r) => r.on), [rows]);
  const patch = (k: number, p: Partial<{ on: boolean; level: number }>) => setRows((list) => list.map((r, j) => (j === k ? { ...r, ...p } : r)));
  const allOn = picks.length === rows.length;
  return (
    <Modal title={T.reviewTitle} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>{ST.cancel}</button><button type="button" className="btn primary" disabled={!picks.length} onClick={() => onApply(picks.map(({ i, level, text }) => ({ i, level, text })))}>{T.apply(picks.length)}</button></>}>
      <p className="fine">{T.reviewLead(found.length)}</p>
      {mock ? <p className="note warn">{T.mockNote}</p> : null}
      <div className="aio-bar"><button type="button" className="btn ghost sm" onClick={() => setRows((list) => list.map((r) => ({ ...r, on: !allOn })))}>{allOn ? T.clear : T.all}</button></div>
      <div className="aio-list" role="list">
        {rows.map((r, k) => (
          <div key={r.i} role="listitem" className={cx('aio-i', !r.on && 'off')} style={{ paddingLeft: 6 + (r.level - 1) * 14 }}>
            <label className="aio-l"><input type="checkbox" className="check" checked={r.on} onChange={(e) => patch(k, { on: e.target.checked })} /><span className="aio-t" title={r.text}>{r.text}</span></label>
            <select className="select aio-lv" aria-label={T.levelOf} value={r.level} disabled={!r.on} onChange={(e) => patch(k, { level: Number(e.target.value) })}>{LEVELS.map((n) => <option key={n} value={n}>{T.level(n)}</option>)}</select>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * 目录上的「AI 识别目录」：busy 是进行到哪了（没在跑是 null），run 开始，modal 是确认的弹窗（放在页面里）。
 * 状态放在文档页这一层：目录收起来、编辑器因为协同重连重建了，识别照常跑完
 */
export function useAiOutline(editor: Editor | null, client: EditorClient, onApplied: () => void): { busy: string | null; run: () => void; modal: ReactNode } {
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<{ found: Found[]; mock: boolean } | null>(null);
  const ed = useRef(editor); ed.current = editor;
  const running = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const run = useCallback(() => {
    const e = ed.current;
    if (!e || e.isDestroyed || !e.isEditable || running.current) return;
    const cands = candidatesOf(e.state.doc);
    if (!cands.some((c) => !c.level)) { toast(T.nothing); return; }
    running.current = true;
    setBusy(T.busy(1, 1));
    (async () => {
      try {
        const r = await recognize(client, cands, (b, n) => { if (alive.current) setBusy(T.busy(b, n)); }, () => alive.current);
        if (!alive.current) return;
        if (r.found.length) setReview(r); else toast(T.none);
      } catch (err) {
        toast(err instanceof ApiError && (err.status === 404 || err.status === 405) ? T.unsupported : T.failed(err instanceof Error && err.message ? err.message : T.unknown));
      } finally { running.current = false; if (alive.current) setBusy(null); }
    })();
  }, [client]);

  const apply = useCallback((picks: Found[]) => {
    setReview(null);
    const e = ed.current, n = e ? applyHeadings(e, picks) : 0;
    if (!n) { toast(T.moved); return; }
    toast(T.applied(n));
    onApplied();
  }, [onApplied]);

  return { busy, run, modal: review ? <Review found={review.found} mock={review.mock} onApply={apply} onClose={() => setReview(null)} /> : null };
}

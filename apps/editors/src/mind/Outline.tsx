/**
 * 大纲模式：缩进列表，节点文字直接在 contenteditable 里改。
 * 文字改动只写进树、不重渲染（避免光标跳动）；结构改动（Enter / Tab / 删除 / 折叠）由父组件改树后用 tick 触发重渲染，并按 focusReq 把光标放到目标节点。
 */
import { useLayoutEffect, useRef, type KeyboardEvent, type MutableRefObject } from 'react';
import { Icon, cx } from '../shell/ui';
import type { MNode } from './model';

export interface OutlineOps {
  child(id: string | null): void;
  sibling(id: string | null): void;
  remove(id: string | null): void;
  indent(id: string): void;
  outdent(id: string): void;
  fold(id: string): void;
}
export interface FocusReq { uid: string; selectAll?: boolean }

interface Props { root: MNode; tick: number; readonly: boolean; sel: string | null; onSel: (uid: string) => void; onText: () => void; ops: OutlineOps; focusReq: MutableRefObject<FocusReq | null> }

/** 把光标放到元素末尾（或全选） */
function placeCaret(el: HTMLElement, selectAll = false) {
  const r = document.createRange();
  r.selectNodeContents(el);
  if (!selectAll) r.collapse(false);
  const s = window.getSelection();
  if (s) { s.removeAllRanges(); s.addRange(r); }
}

/** 粘贴只要纯文本，并且压成一行 */
function pastePlain(e: React.ClipboardEvent<HTMLElement>) {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ');
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  e.currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
}

function NodeText({ n, isRoot, readonly, onSel, onText, onKey }: { n: MNode; isRoot: boolean; readonly: boolean; onSel: (uid: string) => void; onText: () => void; onKey: (e: KeyboardEvent<HTMLSpanElement>, n: MNode, isRoot: boolean) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  // 文字由我们自己同步到 DOM：React 不渲染子节点，所以输入时不会被重置
  useLayoutEffect(() => { const el = ref.current; if (el && el.textContent !== n.data.text) el.textContent = n.data.text; });
  const uid = n.data.uid!;
  return <span ref={ref} className="mn-t" data-uid={uid} contentEditable={!readonly} suppressContentEditableWarning spellCheck={false} role="textbox" aria-label={isRoot ? '中心主题' : '节点'}
    onInput={(e) => { n.data.text = e.currentTarget.textContent ?? ''; onText(); }}
    onFocus={() => onSel(uid)} onClick={() => onSel(uid)} onKeyDown={(e) => onKey(e, n, isRoot)} onPaste={pastePlain} />;
}

export function Outline({ root, tick, readonly, sel, onSel, onText, ops, focusReq }: Props) {
  const box = useRef<HTMLDivElement>(null);

  // 结构变了以后把光标放到目标节点
  useLayoutEffect(() => {
    const r = focusReq.current;
    if (!r || !box.current) return;
    focusReq.current = null;
    const el = box.current.querySelector<HTMLElement>(`.mn-t[data-uid="${r.uid}"]`);
    if (el) { el.focus(); placeCaret(el, r.selectAll); }
  }, [tick, focusReq]);

  const moveFocus = (from: HTMLElement, dir: 1 | -1) => {
    const all = Array.from(box.current?.querySelectorAll<HTMLElement>('.mn-t') ?? []);
    const next = all[all.indexOf(from) + dir];
    if (next) { next.focus(); placeCaret(next); }
  };

  const onKey = (e: KeyboardEvent<HTMLSpanElement>, n: MNode, isRoot: boolean) => {
    const uid = n.data.uid!;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); moveFocus(e.currentTarget, e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.key === 'Escape') { e.currentTarget.blur(); return; }
    if (readonly) return;
    // 中文输入法选词时的 Enter 不算（nativeEvent.isComposing）
    if (e.key === 'Enter') { e.preventDefault(); if (e.nativeEvent.isComposing) return; if (isRoot) ops.child(uid); else ops.sibling(uid); }
    else if (e.key === 'Tab') { e.preventDefault(); if (isRoot) return; if (e.shiftKey) ops.outdent(uid); else ops.indent(uid); }
    else if (e.key === 'Backspace' && !isRoot && !(e.currentTarget.textContent ?? '')) { e.preventDefault(); ops.remove(uid); }
  };

  const list = (nodes: MNode[]) => <ul className="mn-ol">{nodes.map((n) => {
    const uid = n.data.uid!, folded = n.children.length > 0 && n.data.expand === false;
    return <li key={uid}>
      <div className={cx('mn-row', sel === uid && 'on')}>
        {n.children.length
          ? <button type="button" className="mn-fold" tabIndex={-1} aria-label={folded ? '展开' : '折叠'} aria-expanded={!folded} onClick={() => ops.fold(uid)}><Icon name={folded ? 'chevron' : 'down'} /></button>
          : <span className="mn-fold leaf" aria-hidden="true"><i /></span>}
        <NodeText n={n} isRoot={false} readonly={readonly} onSel={onSel} onText={onText} onKey={onKey} />
        {folded ? <i className="mn-cnt" title={`${n.children.length} 个子节点已折叠`}>{n.children.length}</i> : null}
      </div>
      {!folded && n.children.length ? list(n.children) : null}
    </li>;
  })}</ul>;

  return <div ref={box} className="mn-outline" data-tick={tick}>
    <div className={cx('mn-root', sel === root.data.uid && 'on')}><NodeText n={root} isRoot readonly={readonly} onSel={onSel} onText={onText} onKey={onKey} /></div>
    {list(root.children)}
  </div>;
}

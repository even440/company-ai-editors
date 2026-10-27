/**
 * 文档的目录（用户 2026-10-27：深圳同事的操作手册很长，要能读出目录、点了跳过去，照 Word / WPS 左边的导航窗格）。
 * 按正文里的一到三级标题列出来（只看顶层的块，表格、引用里的标题不算），有下级的能收起、展开；滚动时当前读到的那一节亮着。
 * 宽的时候固定在正文左边，窄的时候（手机、AI 助手右边那块）是左下角一个按钮，点了从左边滑出来、选了就收起。
 * 开着还是关着按人记在本机（localStorage），没设过时宽屏、有三个以上标题才默认打开。
 * 点了跳过去以后几秒内有图片加载出来（懒加载的图没写宽高时会把正文往下挤），重新对准那个标题；自己动了滚动就不再管
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { Icon, cx } from '../shell/ui';

export interface TocItem { pos: number; level: number; text: string; key: string }

/** 正文的目录：顶层的标题。key 由级别、文字和同名的第几个组成，编辑时收起状态不乱 */
export function tocOf(doc: PmNode): TocItem[] {
  const out: TocItem[] = [], seen = new Map<string, number>();
  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return;
    const level = Math.min(3, Math.max(1, Number(node.attrs.level) || 1)), text = node.textContent.replace(/\s+/g, ' ').trim();
    const base = `${level}:${text}`, n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ pos: offset, level, text, key: `${base}#${n}` });
  });
  return out;
}

/** 目录跟着正文变：改动停下来一会儿再算，几百个标题的长文档打字时不卡 */
export function useToc(editor: Editor | null): TocItem[] {
  const [items, setItems] = useState<TocItem[]>([]);
  useEffect(() => {
    if (!editor) { setItems([]); return; }
    let t = 0;
    const calc = () => { t = 0; if (!editor.isDestroyed) setItems(tocOf(editor.state.doc)); };
    const later = () => { if (!t) t = window.setTimeout(calc, 400); };
    calc();
    editor.on('update', later);
    return () => { editor.off('update', later); window.clearTimeout(t); };
  }, [editor]);
  return items;
}

const STORE = 'cai-doc-toc';
/** 宽到这个程度目录固定在左边，窄了改成滑出来 */
export const TOC_WIDE = 880;
const readPref = (): boolean | null => { try { const v = localStorage.getItem(STORE); return v === '1' ? true : v === '0' ? false : null; } catch { return null; } };
const savePref = (on: boolean) => { try { localStorage.setItem(STORE, on ? '1' : '0'); } catch { /* 存不了就只管这一次 */ } };

/** 编辑器外壳有多宽（iframe 的宽度），跟着变 */
export function useWide(min: number): boolean {
  const q = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q), on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return wide;
}

/** 目录开着没有：宽屏按本人的设置（没设过时三个以上标题就开），窄屏每次打开都是关着的 */
export function useTocOpen(count: number, wide: boolean): [boolean, (on: boolean) => void] {
  const [mine, setMine] = useState<boolean | null>(readPref);
  const [slide, setSlide] = useState(false);
  const open = wide ? (mine ?? count >= 3) : slide;
  const set = useCallback((on: boolean) => { if (wide) { setMine(on); savePref(on); } else setSlide(on); }, [wide]);
  useEffect(() => { if (wide) setSlide(false); }, [wide]);
  return [open && count > 0, set];
}

/** 正文滚动容器里某个位置的标题现在离容器顶上多远 */
function topOf(editor: Editor, box: HTMLElement, pos: number): number | null {
  const dom = editor.view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom.getBoundingClientRect().top - box.getBoundingClientRect().top : null;
}

/** 跳到标题：离得远时直接到（一路滑过去会把途中懒加载的图都拉下来），近的平滑滚 */
function scrollToHeading(editor: Editor, box: HTMLElement, pos: number, smooth: boolean) {
  const top = topOf(editor, box, pos);
  if (top === null) return;
  const far = Math.abs(top) > box.clientHeight * 3;
  box.scrollTo({ top: box.scrollTop + top - 12, behavior: smooth && !far ? 'smooth' : 'auto' });
}

export function Outline({ editor, items, box, wide, onClose }: { editor: Editor; items: TocItem[]; box: RefObject<HTMLDivElement | null>; wide: boolean; onClose: () => void }) {
  const [cur, setCur] = useState(-1), [folded, setFolded] = useState<Set<string>>(() => new Set());
  const list = useRef<HTMLDivElement>(null);
  /** 刚点过的标题：几秒内有图片加载出来就重新对准；本人滚了、点了别处就不管了 */
  const pin = useRef<{ pos: number; until: number } | null>(null);

  // 当前读到哪一节：最后一个顶到容器上边（往下 72 像素以内）的标题；标题按顺序排，二分查找
  useEffect(() => {
    const el = box.current;
    if (!el || !items.length) { setCur(-1); return; }
    let raf = 0;
    const calc = () => {
      raf = 0;
      let lo = 0, hi = items.length - 1, at = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1, t = topOf(editor, el, items[mid].pos);
        if (t !== null && t <= 72) { at = mid; lo = mid + 1; } else hi = mid - 1;
      }
      setCur(at);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(calc); };
    calc();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [editor, box, items]);

  // 跳过去以后图片陆续加载、正文被挤动时重新对准
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onLoad = (e: Event) => {
      const p = pin.current;
      if (!p || !(e.target instanceof HTMLImageElement)) return;
      if (Date.now() > p.until) { pin.current = null; return; }
      scrollToHeading(editor, el, p.pos, false);
    };
    const drop = () => { pin.current = null; };
    el.addEventListener('load', onLoad, true);
    for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) el.addEventListener(t, drop, { passive: true });
    return () => {
      el.removeEventListener('load', onLoad, true);
      for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) el.removeEventListener(t, drop);
    };
  }, [editor, box]);

  // 看得见的项：收起的标题下面的不显示
  const shown = useMemo(() => {
    const out: { it: TocItem; i: number; kids: boolean }[] = [];
    let hideBelow = 0;
    items.forEach((it, i) => {
      if (hideBelow && it.level > hideBelow) return;
      hideBelow = 0;
      const kids = i + 1 < items.length && items[i + 1].level > it.level;
      out.push({ it, i, kids });
      if (kids && folded.has(it.key)) hideBelow = it.level;
    });
    return out;
  }, [items, folded]);
  // 当前那一节被收起来时，亮它看得见的上级
  const curShown = useMemo(() => { let at = -1; for (const s of shown) { if (s.i <= cur) at = s.i; else break; } return at; }, [shown, cur]);

  // 当前项在目录外面时把目录滚过去（只滚目录自己，不动外面的页面）
  useEffect(() => {
    const l = list.current, b = l?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!l || !b) return;
    const top = b.offsetTop - l.offsetTop;
    if (top < l.scrollTop || top + b.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = Math.max(0, top - l.clientHeight / 3);
  }, [curShown]);

  const go = (it: TocItem) => {
    const el = box.current;
    if (!el) return;
    pin.current = { pos: it.pos, until: Date.now() + 4000 };
    scrollToHeading(editor, el, it.pos, true);
    if (!wide) onClose();
  };
  const toggle = (key: string) => setFolded((f) => { const n = new Set(f); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const parents = items.filter((it, i) => i + 1 < items.length && items[i + 1].level > it.level);

  return (
    <>
      {wide ? null : <div className="toc-veil" onClick={onClose} aria-hidden="true" />}
      <nav className={cx('doc-toc', !wide && 'slide')} aria-label="目录">
        <div className="toc-head">
          <b>目录</b>
          {parents.length ? <>
            <button type="button" className="tt" onClick={() => setFolded(new Set(parents.map((p) => p.key)))} title="只看各章的标题">全部收起</button>
            <button type="button" className="tt" onClick={() => setFolded(new Set())}>全部展开</button>
          </> : null}
          <button type="button" className="tt toc-x" onClick={onClose} aria-label="关闭目录" title="关闭目录"><Icon name="x" /></button>
        </div>
        <div className="toc-list" ref={list}>
          {shown.map(({ it, i, kids }) => (
            <div key={it.key} className={cx('toc-i', `l${it.level}`, i === curShown && 'on')}>
              {kids ? <button type="button" className={cx('toc-fold', folded.has(it.key) && 'shut')} onClick={() => toggle(it.key)} aria-expanded={!folded.has(it.key)} aria-label={folded.has(it.key) ? '展开' : '收起'}><Icon name="down" /></button> : <span className="toc-fold" />}
              <button type="button" className="toc-t" onClick={() => go(it)} aria-current={i === curShown ? 'location' : undefined} title={it.text}>{it.text || '（没有文字的标题）'}</button>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}

/** 目录关着时的按钮：宽屏在正文左上角，窄屏在左下角 */
export function TocButton({ wide, onOpen }: { wide: boolean; onOpen: () => void }) {
  return <button type="button" className={cx('btn sm toc-btn', !wide && 'fab')} onClick={onOpen} aria-label="打开目录" title="目录"><Icon name="outline" />{wide ? '目录' : null}</button>;
}

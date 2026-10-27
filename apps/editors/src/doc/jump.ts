/**
 * 跳到正文里的某一块（目录、书签和文档内链接共用）。
 * 2026-10-27 深圳同事反馈：Word 转成在线版以后点「第十四章，14.2 基础设置」这种链接，落点不对——书签是对的，
 * 是一路上几百张懒加载、没写宽高的图片：跳的时候它们按 0 高度算，到了以后附近的图陆续加载，把目标往下挤走了。
 * 所以跳过去以后几秒内盯着：有图片加载出来、正文高度变了就重新对准；本人滚动、点击、按键以后不再管。
 * 离得远时直接到（一路滑过去会把途中懒加载的图都拉下来），近的平滑滚
 */
import type { EditorView } from '@tiptap/pm/view';

/** 跳过去以后盯多久 */
const PIN_MS = 4000;
/** 目标停在滚动容器顶上往下这么多像素 */
const MARGIN = 12;

/** 现在盯着的那一次跳转：新的跳转、本人动了、到时间都会停 */
let stopPin: (() => void) | null = null;

/** 正文的滚动容器：编辑器外壳的 .ed-body，没有时是整页 */
const scrollerOf = (view: EditorView): HTMLElement => (view.dom.closest('.ed-body') as HTMLElement | null) ?? (document.scrollingElement as HTMLElement);

/** 位置 pos 那一块离滚动容器顶上多远；找不到返回 null */
function topOf(view: EditorView, box: HTMLElement, pos: number): number | null {
  if (view.isDestroyed) return null;
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  const boxTop = box === document.scrollingElement ? 0 : box.getBoundingClientRect().top;
  return dom.getBoundingClientRect().top - boxTop;
}

function align(view: EditorView, box: HTMLElement, pos: number, smooth: boolean): void {
  const top = topOf(view, box, pos);
  if (top === null) return;
  const far = Math.abs(top) > box.clientHeight * 3;
  box.scrollTo({ top: box.scrollTop + top - MARGIN, behavior: smooth && !far ? 'smooth' : 'auto' });
}

/** 滚到位置 pos 那一块，并在几秒内跟着对准 */
export function jumpToPos(view: EditorView, pos: number, smooth = true): void {
  stopPin?.();
  const box = scrollerOf(view);
  align(view, box, pos, smooth);
  const until = Date.now() + PIN_MS;
  let raf = 0;
  const again = () => {
    if (Date.now() > until) { stop(); return; }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; align(view, box, pos, false); });
  };
  const onLoad = (e: Event) => { if (e.target instanceof HTMLImageElement) again(); };
  // 正文高度变了（图片出来、别人在协同里改了上面的内容）也重新对准
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(again);
  ro?.observe(view.dom);
  const timer = window.setTimeout(() => stop(), PIN_MS);
  const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
  function stop() {
    window.clearTimeout(timer); cancelAnimationFrame(raf); ro?.disconnect();
    box.removeEventListener('load', onLoad, true);
    for (const t of events) box.removeEventListener(t, stop);
    if (stopPin === stop) stopPin = null;
  }
  box.addEventListener('load', onLoad, true);
  for (const t of events) box.addEventListener(t, stop, { passive: true });
  stopPin = stop;
}

/** 滚到最上面（#_top 这类链接） */
export function jumpToTop(view: EditorView): void {
  stopPin?.();
  scrollerOf(view).scrollTo({ top: 0, behavior: 'smooth' });
}

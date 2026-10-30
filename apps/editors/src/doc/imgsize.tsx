/**
 * 调整图片大小（用户 2026-10-30 转来同事反馈：文档里插入的图片调节不了大小）。
 * 编辑时选中一张图片（单击），图片上盖一个框，右边和右下角有手柄：拖动按原比例改宽度（最小 40 像素，最大到正文宽度），
 * 拖的时候框上显示宽 × 高；松手把新的宽高写回图片的 width / height 属性（image.ts：显示宽度就是它，最宽到正文宽度）。双击手柄恢复图片的原始像素大小。
 * 不用节点视图：框放在正文的滚动容器里绝对定位（和评论按钮一样），几百张图的长文档不多出几百个组件
 */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { NodeSelection } from '@tiptap/pm/state';
import { useEditorState, type Editor } from '@tiptap/react';

const MIN_W = 40;

/** 选中的是哪张图片（位置），没选中图片时 -1 */
const selectedImage = (e: Editor): number => {
  const sel = e.state.selection;
  return e.isEditable && sel instanceof NodeSelection && sel.node.type.name === 'image' ? sel.from : -1;
};

export function ImageResizer({ editor, box }: { editor: Editor; box: RefObject<HTMLDivElement | null> }) {
  const pos = useEditorState({ editor, selector: ({ editor: e }) => selectedImage(e) });
  const [drag, setDrag] = useState<{ w: number; h: number } | null>(null), [, relayout] = useState(0);
  const start = useRef<{ x: number; w: number; ratio: number; max: number; img: HTMLImageElement } | null>(null);
  // 窗口变了、图片加载出来了：框跟着重新量
  useEffect(() => {
    if (pos < 0) return;
    const again = () => relayout((n) => n + 1);
    const img = editor.view.nodeDOM(pos);
    window.addEventListener('resize', again);
    if (img instanceof HTMLImageElement && !img.complete) img.addEventListener('load', again, { once: true });
    return () => { window.removeEventListener('resize', again); if (img instanceof HTMLImageElement) img.removeEventListener('load', again); };
  }, [editor, pos]);
  const el = box.current, img = pos >= 0 ? editor.view.nodeDOM(pos) : null;
  if (!el || !(img instanceof HTMLImageElement)) return null;

  /** 宽高比：先按图片记着的宽高，没有时按图片本身 */
  const ratioOf = (): number => {
    const node = editor.state.doc.nodeAt(pos), w = Number(node?.attrs.width), h = Number(node?.attrs.height);
    if (w > 0 && h > 0) return h / w;
    return img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : img.getBoundingClientRect().height / Math.max(1, img.getBoundingClientRect().width);
  };
  /** 写回宽高，图片保持选中 */
  const commit = (w: number, h: number) => {
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'image') return;
    editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: Math.round(w), height: Math.round(h) }); tr.setSelection(NodeSelection.create(tr.doc, pos)); return true; }).run();
  };
  const down = (e: RPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    // 最宽到正文的内容宽度（图片在表格里时到格子的宽度）
    const parent = img.parentElement, cs = parent ? getComputedStyle(parent) : null;
    const max = parent ? parent.clientWidth - parseFloat(cs!.paddingLeft) - parseFloat(cs!.paddingRight) : img.getBoundingClientRect().width;
    start.current = { x: e.clientX, w: img.getBoundingClientRect().width, ratio: ratioOf(), max: Math.max(MIN_W, max), img };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent<HTMLSpanElement>) => {
    const s = start.current;
    if (!s) return;
    const w = Math.round(Math.min(s.max, Math.max(MIN_W, s.w + e.clientX - s.x)));
    // 拖的时候直接改图片的样式看效果，松手再写进文档（中间不产生改动、不发给协同）
    s.img.style.width = `${w}px`;
    setDrag({ w, h: Math.round(w * s.ratio) });
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    s.img.style.width = '';
    if (drag && Math.abs(drag.w - s.w) >= 1) commit(drag.w, drag.h);
    setDrag(null);
  };
  /** 双击手柄：恢复原始像素大小 */
  const reset = () => { if (img.naturalWidth > 0) commit(img.naturalWidth, img.naturalHeight); };

  const r = img.getBoundingClientRect(), br = el.getBoundingClientRect();
  const top = r.top - br.top + el.scrollTop, left = r.left - br.left + el.scrollLeft;
  const w = drag?.w ?? r.width, h = drag ? drag.h : r.height;
  const handle = (cls: string) => (
    <span className={`img-h ${cls}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={reset}
      title="拖动调整大小，双击恢复原始大小" aria-hidden="true" />
  );
  return (
    <div className="img-size" style={{ top, left, width: w, height: h }}>
      {handle('e')}
      {handle('se')}
      {drag ? <span className="img-size-n">{drag.w} × {drag.h}</span> : null}
    </div>
  );
}

/**
 * PDF 预览：pdfjs 把每一页连续画到 canvas 上，支持缩放和跳页。
 * worker 用 Vite 的 ?url 引进来（模块 worker），和主包一起构建到 assets 里。
 */
import { useEffect, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Icon } from '../shell/ui';

GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
/** 页面默认按这个宽度铺（CSS 像素），再乘缩放 */
const BASE_WIDTH = 820;

export function PdfView({ data, name }: { data: ArrayBuffer; name: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null), [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1), [page, setPage] = useState(1), [done, setDone] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const pages = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    let on = true;
    // 数据复制一份：pdfjs 会把它转给 worker（转移所有权），原来的 ArrayBuffer 别的预览还要用
    const task = getDocument({ data: data.slice(0) });
    task.promise.then((d) => { if (on) setPdf(d); }).catch((e: Error) => { if (on) setErr(e.message || '打不开这个 PDF'); });
    // 卸载时销毁加载任务，文档和 worker 的那份也一起释放
    return () => { on = false; void task.destroy(); };
  }, [data]);

  // 按当前缩放一页一页画；缩放变了就从头画（上一轮用 cancelled 停掉）
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    setDone(0);
    (async () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let i = 1; i <= pdf.numPages && !cancelled; i++) {
        const canvas = pages.current[i - 1];
        if (!canvas) continue;
        const pg = await pdf.getPage(i);
        if (cancelled) return;
        const base = pg.getViewport({ scale: 1 });
        const scale = (Math.min(BASE_WIDTH, (wrap.current?.clientWidth ?? BASE_WIDTH) - 32) / base.width) * zoom;
        const vp = pg.getViewport({ scale });
        canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = `${Math.floor(vp.width)}px`; canvas.style.height = `${Math.floor(vp.height)}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        await pg.render({ canvas, canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise.catch(() => { /* 取消渲染会抛，忽略 */ });
        if (!cancelled) setDone(i);
      }
    })();
    return () => { cancelled = true; };
  }, [pdf, zoom]);

  // 滚动时算出当前页：第一个底边在视口中线以下的页
  const onScroll = () => {
    const el = wrap.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    const i = pages.current.findIndex((c) => c && c.offsetTop + c.offsetHeight >= mid);
    setPage(i < 0 ? pages.current.length : i + 1);
  };
  const goto = (n: number) => {
    if (!pdf) return;
    const i = Math.min(pdf.numPages, Math.max(1, n)), c = pages.current[i - 1];
    if (c && wrap.current) wrap.current.scrollTo({ top: c.offsetTop - 12, behavior: 'smooth' });
    setPage(i);
  };
  const zi = ZOOMS.indexOf(zoom);

  if (err) return <div className="ed-state"><div className="ed-err"><b>打不开这个 PDF</b><p>{err}</p></div></div>;
  if (!pdf) return <div className="ed-state"><span className="spin" role="status" aria-label="加载中" /></div>;
  return (
    <div className="fv-pdf">
      <div className="fv-pdfbar" role="toolbar" aria-label="PDF 工具">
        <button type="button" className="tt ico" onClick={() => setZoom(ZOOMS[Math.max(0, zi - 1)])} disabled={zi <= 0} title="缩小" aria-label="缩小"><Icon name="zoomout" /></button>
        <span className="fv-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" className="tt ico" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)])} disabled={zi >= ZOOMS.length - 1} title="放大" aria-label="放大"><Icon name="zoomin" /></button>
        <span className="sep" />
        <button type="button" className="tt ico" onClick={() => goto(page - 1)} disabled={page <= 1} aria-label="上一页"><Icon name="up" /></button>
        <label className="fv-pageno">第 <input className="input" type="number" min={1} max={pdf.numPages} value={page} aria-label="页码" onChange={(e) => goto(Number(e.target.value) || 1)} /> / {pdf.numPages} 页</label>
        <button type="button" className="tt ico" onClick={() => goto(page + 1)} disabled={page >= pdf.numPages} aria-label="下一页"><Icon name="down" /></button>
        {done < pdf.numPages ? <span className="muted fv-rendering"><span className="spin" /> 正在渲染第 {done + 1} 页</span> : null}
      </div>
      <div className="fv-pages" ref={wrap} onScroll={onScroll} aria-label={name}>
        {Array.from({ length: pdf.numPages }, (_, i) => <canvas key={i} className="fv-canvas" ref={(el) => { pages.current[i] = el; }} aria-label={`第 ${i + 1} 页`} />)}
      </div>
    </div>
  );
}

/**
 * 文件预览：s.doc.file 是上传的文件，按类型预览。顶部一行是文件名、大小、类型和「下载」；下面是预览区。
 * PDF 用 pdfjs 画到 canvas；图片、视频、音频用原生标签；txt / md / csv 读文本；xlsx 用 xlsx 解析；docx 用 mammoth 转成 HTML；
 * 其他格式只给下载。文件本身不改，content 一直是 {}。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { marked } from 'marked';
import * as XLSX from 'xlsx';
import type { EditorFile, Session } from '@cai/bridge';
import { docxToHtml, sanitizeHtml } from '../doc/import';
import { useHost, useTheme } from '../shell/session';
import { ITile, Icon, Toaster, Toolbar, cx, toast } from '../shell/ui';
import { PdfView } from './PdfView';
import '../doc/doc.css';
import './file.css';

type Kind = 'pdf' | 'image' | 'video' | 'audio' | 'text' | 'md' | 'csv' | 'xlsx' | 'docx' | 'none';
const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();
/** 按扩展名（其次 MIME）判断怎么预览 */
function kindOf(f: EditorFile): Kind {
  const ext = extOf(f.name), mime = (f.mime || '').toLowerCase();
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext) || mime.startsWith('image/')) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext) || mime.startsWith('video/')) return 'video';
  if (['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'].includes(ext) || mime.startsWith('audio/')) return 'audio';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'csv') return 'csv';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'docx') return 'docx';
  if (['txt', 'log', 'json', 'xml', 'yml', 'yaml', 'ini', 'js', 'ts', 'py', 'sh', 'sql', 'html', 'htm', 'css'].includes(ext) || mime.startsWith('text/')) return 'text';
  return 'none';
}
/** 图标、色系和类型名，和原型 fileMeta 一致 */
const META: Record<Kind, [string, string, string]> = { pdf: ['doc', 'red', 'PDF'], image: ['image', 'blue', '图片'], video: ['video', 'purple', '视频'], audio: ['mic', 'teal', '音频'], text: ['text', 'gray', '文本'], md: ['doc', 'blue', 'Markdown'], csv: ['sheet', 'green', 'CSV'], xlsx: ['sheet', 'green', '表格'], docx: ['doc', 'blue', 'Word'], none: ['file', 'gray', '文件'] };
const metaOf = (f: EditorFile, k: Kind): [string, string, string] => (k === 'none' ? (/\.pptx?$/i.test(f.name) ? ['slides', 'orange', '演示文稿'] : /\.(zip|rar|7z)$/i.test(f.name) ? ['folder', 'yellow', '压缩包'] : META.none) : META[k]);
export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);
/** 下载地址：原地址加 download=1，宿主就会按附件返回 */
const downloadUrl = (f: EditorFile) => f.url + (f.url.includes('?') ? '&' : '?') + 'download=1';

/** 读文件内容；用 ArrayBuffer 装着，各预览自己解码 */
function useFileData(f: EditorFile, want: boolean) {
  const [data, setData] = useState<ArrayBuffer | null>(null), [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!want) return;
    let on = true;
    fetch(f.url).then(async (r) => { if (!r.ok) throw new Error(`读取文件失败（${r.status}）`); return r.arrayBuffer(); }).then((b) => { if (on) setData(b); }).catch((e: Error) => { if (on) setErr(e.message); });
    return () => { on = false; };
  }, [f, want]);
  return { data, err };
}

/* ---------- 各类型的预览 ---------- */

function ImageView({ f }: { f: EditorFile }) {
  const [big, setBig] = useState(false);
  return <div className={cx('fv-imgwrap', big && 'big')}><img src={f.url} alt={f.name} className="fv-image" onClick={() => setBig((b) => !b)} title={big ? '点击缩小' : '点击放大到原始大小'} /></div>;
}

const decode = (b: ArrayBuffer) => new TextDecoder('utf-8').decode(b);

/** 解析 CSV：支持引号里的逗号和换行 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

const MAX_ROWS = 500;
const col = (i: number) => { let s = ''; for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s; return s; };
/** 只读的格子表：第一行加粗当表头，数字右对齐；行列号和在线表格一样 */
function Grid({ rows }: { rows: unknown[][] }) {
  const shown = rows.slice(0, MAX_ROWS), cols = Math.max(1, ...shown.map((r) => r.length));
  return (
    <div className="fv-sheet">
      <div className="sh-wrap fv-gridwrap">
        <table className="sh-grid">
          <thead><tr><th className="sh-corner" />{Array.from({ length: cols }, (_, i) => <th key={i}>{col(i)}</th>)}</tr></thead>
          <tbody>{shown.map((r, ri) => <tr key={ri}><th>{ri + 1}</th>{Array.from({ length: cols }, (_, ci) => { const v = r[ci]; const t = v === null || v === undefined ? '' : String(v); return <td key={ci} className={cx(ri === 0 && 'hdr', ri > 0 && /^-?[\d,]+(\.\d+)?%?$/.test(t.trim()) && 'num')}>{t}</td>; })}</tr>)}</tbody>
        </table>
      </div>
      {rows.length > MAX_ROWS ? <p className="muted">只显示前 {MAX_ROWS} 行（共 {rows.length} 行）；要看全部请下载。</p> : null}
      {!rows.length ? <p className="muted">这张表是空的。</p> : null}
    </div>
  );
}

function XlsxView({ data }: { data: ArrayBuffer }) {
  const [wb] = useState(() => XLSX.read(data, { type: 'array', cellDates: true }));
  const [cur, setCur] = useState(0);
  const name = wb.SheetNames[cur] ?? wb.SheetNames[0];
  const rows = name ? (XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' }) as unknown[][]) : [];
  return (
    <div className="fv-sheet">
      {wb.SheetNames.length > 1 ? <div className="tabs fv-tabs" role="tablist">{wb.SheetNames.map((n, i) => <button key={n} type="button" role="tab" className={cx('tab', i === cur && 'on')} aria-selected={i === cur} onClick={() => setCur(i)}>{n}</button>)}</div> : null}
      <Grid rows={rows} />
    </div>
  );
}

function DocxView({ data }: { data: ArrayBuffer }) {
  const [html, setHtml] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  useEffect(() => { let on = true; docxToHtml(data).then((h) => { if (on) setHtml(h); }).catch((e: Error) => { if (on) setErr(e.message); }); return () => { on = false; }; }, [data]);
  if (err) return <div className="note warn"><Icon name="warn" /> 转换失败：{err}</div>;
  if (html === null) return <div className="ed-state"><span className="spin" role="status" aria-label="转换中" /></div>;
  return <article className="doc fv-doc"><div className="doc-body" dangerouslySetInnerHTML={{ __html: html }} /></article>;
}

function Unsupported({ f, meta, onDownload }: { f: EditorFile; meta: [string, string, string]; onDownload: () => void }) {
  return (
    <div className={cx('fv-img', 'c-' + meta[1])}>
      <Icon name={meta[0]} /><span>{f.name}</span><i>这种格式不支持在线预览，可以下载后用本地软件打开</i>
      <button type="button" className="btn primary" onClick={onDownload}><Icon name="download" />下载（{bytes(f.size)}）</button>
    </div>
  );
}

/* ---------- 页面 ---------- */

export function FileViewer({ session: s }: { session: Session }) {
  const theme = useTheme();
  const f = s.doc.file ?? null;
  const kind: Kind = f ? kindOf(f) : 'none';
  const meta = f ? metaOf(f, kind) : META.none;
  // 这些类型要先把内容读进来；图片、视频、音频让浏览器自己按地址加载
  const needData = kind === 'pdf' || kind === 'text' || kind === 'md' || kind === 'csv' || kind === 'xlsx' || kind === 'docx';
  const { data, err } = useFileData(f ?? { id: '', name: '', size: 0, mime: '', url: '' }, !!f && needData);

  const download = () => {
    if (!f) return;
    const a = document.createElement('a');
    a.href = downloadUrl(f); a.download = f.name; a.rel = 'noopener'; document.body.appendChild(a); a.click();
    setTimeout(() => a.remove(), 1000);
    s.send({ type: 'exported', name: f.name });
  };
  useHost((m) => {
    if (m.type === 'export') { if (m.format === 'download') download(); else toast(`不支持导出为 ${m.format}`); }
    else if (m.type === 'command' && m.name === 'download') download();
  });

  let body: ReactNode;
  if (!f) body = <div className="ed-state"><div className="ed-err"><b>还没有文件</b><p>这份内容没有附带文件，可能上传还没完成。</p></div></div>;
  else if (kind === 'image') body = <ImageView f={f} />;
  else if (kind === 'video') body = <video className="fv-media" src={f.url} controls preload="metadata" aria-label={f.name} />;
  else if (kind === 'audio') body = <div className="fv-audio"><div className={cx('fv-img', 'c-' + meta[1])}><Icon name="mic" /><span>{f.name}</span></div><audio className="fv-media" src={f.url} controls preload="metadata" aria-label={f.name} /></div>;
  else if (kind === 'none') body = <Unsupported f={f} meta={meta} onDownload={download} />;
  else if (err) body = <div className="ed-state"><div className="ed-err"><b>读不到文件</b><p>{err}</p><button type="button" className="btn" onClick={download}><Icon name="download" />下载</button></div></div>;
  else if (!data) body = <div className="ed-state"><span className="spin" role="status" aria-label="加载中" /></div>;
  else if (kind === 'pdf') body = <PdfView data={data} name={f.name} />;
  else if (kind === 'text') body = <pre className="fv-text">{decode(data)}</pre>;
  else if (kind === 'md') body = <article className="doc fv-doc"><div className="doc-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parse(decode(data), { async: false, gfm: true })) }} /></article>;
  else if (kind === 'csv') body = <Grid rows={parseCsv(decode(data))} />;
  else if (kind === 'xlsx') body = <XlsxView data={data} />;
  else if (kind === 'docx') body = <DocxView data={data} />;

  return (
    <div className="ed fv" style={{ colorScheme: theme }}>
      <Toolbar right={f ? <button type="button" className="btn primary sm" onClick={download}><Icon name="download" /><span className="lbl">下载</span></button> : null}>
        <ITile icon={meta[0]} tint={meta[1]} />
        <div className="pane-t fv-title"><b title={f?.name}>{f?.name ?? s.doc.title}</b><span>{f ? `${meta[2]} · ${bytes(f.size)}${f.mime ? ' · ' + f.mime : ''}` : '文件'}</span></div>
      </Toolbar>
      <div className={cx('ed-body', kind === 'pdf' && 'fill')}><div className={cx('fv-main', `fv-${kind}`)}>{body}</div></div>
      <Toaster />
    </div>
  );
}

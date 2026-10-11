/**
 * 画板：基于 Excalidraw。内容是 { elements, appState, files }，格式说明见 README.md。
 * Excalidraw 自带工具栏、撤销重做、主题和手机布局，这里只负责：读写内容、防抖保存、只读、导出、宿主插入文字。
 */
import './fonts'; // 必须在 @excalidraw/excalidraw 之前：把字体地址换成本地打包的
import '@excalidraw/excalidraw/index.css';
import './board.css';
import { useMemo, useRef, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, MainMenu, convertToExcalidrawElements, exportToBlob, exportToSvg, getCommonBounds, getSceneVersion, getTextFromElements } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { Session } from '@cai/bridge';
import { useHost, useTheme } from '../shell/session';
import { Toaster, toast } from '../shell/ui';

/** appState 里只保存和内容有关的字段；视口、选中状态、当前工具这些不保存 */
const KEEP = ['viewBackgroundColor', 'gridSize', 'gridStep', 'gridModeEnabled'] as const;

export interface BoardContent { elements: ExcalidrawElement[]; appState: Partial<AppState>; files: BinaryFiles }

/** content 没有 elements 就按空白画板处理 */
function parse(content: unknown): BoardContent | null {
  const c = content as Partial<BoardContent> | null;
  if (!c || !Array.isArray(c.elements)) return null;
  return { elements: c.elements, appState: c.appState ?? {}, files: c.files ?? {} };
}

/** 内容的签名：元素版本号之和会随每次编辑（含删除）变化；再加上保存的 appState 字段和附件数 */
const signature = (els: readonly ExcalidrawElement[], st: AppState, files: BinaryFiles) => `${getSceneVersion(els)}|${KEEP.map((k) => String(st[k])).join('|')}|${Object.keys(files).length}`;

const htmlToText = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d.innerText; };

export function BoardEditor({ session: s }: { session: Session }) {
  const theme = useTheme();
  const [ro, setRo] = useState(s.readonly);
  const roRef = useRef(ro); roRef.current = ro;
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const lastSig = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initial = useMemo<ExcalidrawInitialDataState>(() => {
    const c = parse(s.doc.content);
    return c ? { elements: c.elements, appState: c.appState, files: c.files, scrollToContent: true } : { appState: {} };
  }, [s]);

  /** 当前内容：去掉已删除的元素，附件只留还被图片元素引用的 */
  const snapshot = () => {
    const a = api.current!;
    const elements = a.getSceneElements();
    const used = new Set(elements.map((e) => (e.type === 'image' ? e.fileId : null)));
    const all = a.getFiles(), files: BinaryFiles = {};
    for (const id of Object.keys(all)) if (used.has(id as never)) files[id] = all[id];
    const st = a.getAppState(), appState: Record<string, unknown> = {};
    for (const k of KEEP) appState[k] = st[k];
    return { content: { elements, appState, files } as BoardContent, plain: getTextFromElements(elements, '\n') };
  };

  const commit = () => { timer.current = null; if (api.current && !roRef.current) s.markDirty(snapshot); };

  /** Excalidraw 每次指针移动、选中都会回调；只有内容签名变了才算改动。第一次回调是初始化，记下签名就行 */
  const onChange = (els: readonly ExcalidrawElement[], st: AppState, files: BinaryFiles) => {
    const sig = signature(els, st, files);
    if (lastSig.current === null) { lastSig.current = sig; return; }
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    if (roRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(commit, 300);
  };

  async function exportAs(format: string) {
    const a = api.current; if (!a) return;
    const elements = a.getSceneElements();
    if (!elements.length) { toast('画板是空的，没有可导出的内容'); return; }
    const appState = { ...a.getAppState(), exportBackground: true, exportWithDarkMode: theme === 'dark', exportEmbedScene: false };
    const files = a.getFiles(), name = `${s.doc.title}.${format === 'svg' ? 'svg' : 'png'}`;
    try {
      if (format === 'svg') {
        // 不把字体内嵌进 SVG：内嵌要下载整套字体并做子集化，内网里不一定取得到
        const svg = await exportToSvg({ elements, appState, files, exportPadding: 24, skipInliningFonts: true });
        s.download(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }), name);
      } else {
        const blob = await exportToBlob({ elements, appState, files, mimeType: 'image/png', exportPadding: 24, getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }) });
        s.download(blob, name);
      }
    } catch (e) { toast('导出失败：' + (e instanceof Error ? e.message : String(e))); }
  }

  /** 宿主插入一段文字：放在现有内容的下方（那里一定是空白），画板为空就放在原点附近 */
  function insert(text: string) {
    const a = api.current; if (!a || roRef.current) return;
    const t = text.trim(); if (!t) return;
    const els = a.getSceneElements();
    let x = 100, y = 100;
    if (els.length) { const [minX, , , maxY] = getCommonBounds(els); x = minX; y = maxY + 48; }
    const added = convertToExcalidrawElements([{ type: 'text', x, y, text: t, fontSize: 20 }]);
    a.updateScene({ elements: [...a.getSceneElementsIncludingDeleted(), ...added], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    a.scrollToContent(added, { fitToContent: false, animate: true });
  }

  useHost((m) => {
    if (m.type === 'readonly') setRo(m.value);
    else if (m.type === 'export') void exportAs(m.format);
    else if (m.type === 'insert') insert(m.text ?? (m.html ? htmlToText(m.html) : ''));
    else if (m.type === 'flush') { if (timer.current) { clearTimeout(timer.current); commit(); void s.flush(); } }
  });

  return (
    <div className="ed">
      <div className="ed-body fill wb-x">
        <Excalidraw
          initialData={initial}
          excalidrawAPI={(a) => { api.current = a; }}
          onChange={onChange}
          langCode="zh-CN"
          theme={theme}
          viewModeEnabled={ro}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } }}
        >
          {/* 主菜单只留和这份内容有关的项：不要打开文件、保存到本地、excalidraw.com 的链接 */}
          <MainMenu>
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.Help />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
        </Excalidraw>
        {ro ? <span className="chip wb-ro">只读</span> : null}
      </div>
      <Toaster />
    </div>
  );
}

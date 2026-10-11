/**
 * 思维笔记编辑器：大纲 / 导图两种模式共用一份节点树。
 * 导图模式下树的权威副本在 simple-mind-map 里（它的 data_change 回写到 rootRef）；大纲模式下直接改 rootRef。
 * 任何变化都 markDirty，会话停下来后自动保存 { root, layout, theme, mode }。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type MindMap from 'simple-mind-map';
import xmind from 'simple-mind-map/src/parse/xmind.js';
import { safeName, type Session } from '@cai/bridge';
import { useHost, useTheme } from '../shell/session';
import { Icon, Select, TT, Toaster, Toolbar, cx, toast } from '../shell/ui';
import { MapView, createMap } from './MapView';
import { Outline, type FocusReq, type OutlineOps } from './Outline';
import { EXPAND_CHILDREN, LAYOUTS, addChild, addSibling, clean, ensure, find, fromOpml, fromParsed, indent, normalize, outdent, plainOf, remove, setExpandAll, toMarkdown, type Layout, type MNode, type Mode } from './model';
import { THEMES, THEME_KEYS, themeId } from './themes';
import './mind.css';

const htmlToText = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d.innerText; };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function MindEditor({ session: s }: { session: Session }) {
  const dark = useTheme() === 'dark';
  const init = useMemo(() => normalize(s.doc.content, THEME_KEYS), [s]);
  const rootRef = useRef<MNode>(init.root);
  const cfg = useRef<{ layout: Layout; theme: string; mode: Mode }>({ layout: init.layout, theme: init.theme, mode: init.mode });
  const [layout, setLayoutS] = useState(init.layout);
  const [theme, setThemeS] = useState(init.theme);
  const [mode, setModeS] = useState(init.mode);
  const [ro, setRo] = useState(s.readonly);
  const [sel, setSel] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const mapRef = useRef<MindMap | null>(null);
  const focusReq = useRef<FocusReq | null>(null);

  /** 当前的树：导图模式下以 simple-mind-map 里的为准 */
  const currentRoot = (): MNode => {
    const m = mapRef.current;
    if (m && cfg.current.mode === 'map') { const d = m.getData(); if (d) rootRef.current = ensure(d); }
    return rootRef.current;
  };
  const save = () => s.markDirty(() => { const root = clean(currentRoot()); return { content: { root, layout: cfg.current.layout, theme: cfg.current.theme, mode: cfg.current.mode }, plain: plainOf(root) }; });
  const refresh = () => setTick((t) => t + 1);
  const changed = () => { refresh(); save(); };
  /** 大纲模式改完树，或导图模式下由我们直接改了树（AI 展开、宿主插入）：把树同步给导图并保存 */
  const applyModel = () => { if (cfg.current.mode === 'map') mapRef.current?.updateData(structuredClone(clean(rootRef.current))); changed(); };
  const rootUid = rootRef.current.data.uid!;
  const mapNode = (id: string | null) => { const m = mapRef.current!; return (id && m.renderer.findNodeByUid(id)) || m.renderer.root; };

  const ops: OutlineOps & { expandAll(): void } = {
    child(id) {
      if (ro) return;
      if (cfg.current.mode === 'map') { const m = mapRef.current; if (!m) return; m.execCommand('INSERT_CHILD_NODE', true, [mapNode(id)]); return; }
      const n = addChild(rootRef.current, id);
      focusReq.current = { uid: n.data.uid! }; setSel(n.data.uid!); changed();
    },
    sibling(id) {
      if (ro || !id || id === rootUid) return;
      if (cfg.current.mode === 'map') { const m = mapRef.current; if (!m) return; m.execCommand('INSERT_NODE', true, [mapNode(id)]); return; }
      const n = addSibling(rootRef.current, id);
      focusReq.current = { uid: n.data.uid! }; setSel(n.data.uid!); changed();
    },
    remove(id) {
      if (ro || !id || id === rootUid) return;
      if (cfg.current.mode === 'map') { const m = mapRef.current; if (!m) return; const n = m.renderer.findNodeByUid(id); if (n) m.execCommand('REMOVE_NODE', [n]); return; }
      const next = remove(rootRef.current, id);
      const uid = next?.data.uid ?? rootUid;
      focusReq.current = { uid }; setSel(uid); changed();
    },
    indent(id) { if (ro) return; if (indent(rootRef.current, id)) { focusReq.current = { uid: id }; changed(); } },
    outdent(id) { if (ro) return; if (outdent(rootRef.current, id)) { focusReq.current = { uid: id }; changed(); } },
    fold(id) { const n = find(rootRef.current, id); if (!n) return; n.data.expand = n.data.expand === false; changed(); },
    expandAll() { if (cfg.current.mode === 'map') { mapRef.current?.execCommand('EXPAND_ALL'); return; } setExpandAll(rootRef.current, true); changed(); },
  };

  const setMode = (m: Mode) => {
    if (m === cfg.current.mode) return;
    currentRoot(); // 离开导图前把它的数据拿回来
    cfg.current.mode = m; setModeS(m); setSel(null); save();
  };
  const setLayout = (l: string) => { cfg.current.layout = l as Layout; setLayoutS(l as Layout); save(); };
  const setTheme = (t: string) => { cfg.current.theme = t; setThemeS(t); save(); };

  /** 给选中节点（没有就是根）加几个子节点 */
  const addChildren = (texts: string[]) => {
    if (ro || !texts.length) return;
    const root = currentRoot(), target = find(root, sel) ?? root;
    for (const t of texts) addChild(root, target.data.uid!, t);
    applyModel();
  };

  /** 导出 png 需要一个画好的导图：导图模式用当前实例，大纲模式在屏幕外临时画一个 */
  const withMap = async <T,>(fn: (m: MindMap) => Promise<T>): Promise<T> => {
    if (mapRef.current && cfg.current.mode === 'map') return fn(mapRef.current);
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:-20000px;top:0;width:1600px;height:1000px;';
    document.body.appendChild(el);
    const m = createMap(el, rootRef.current, cfg.current.layout, themeId(cfg.current.theme, dark), true);
    try { return await fn(m); } finally { m.destroy(); el.remove(); }
  };
  const doExport = async (format: string) => {
    const title = safeName(s.doc.title), root = clean(currentRoot());
    setBusy('正在导出…');
    try {
      if (format === 'md') s.download(new Blob([toMarkdown(root)], { type: 'text/markdown;charset=utf-8' }), title + '.md');
      else if (format === 'xmind') s.download(await xmind.transformToXmind(root, title), title + '.xmind');
      else if (format === 'png') {
        const url = await withMap((m) => m.export('png', false, title) as Promise<string | null>);
        if (!url) throw new Error('生成图片失败');
        s.download(await (await fetch(url)).blob(), title + '.png');
      } else throw new Error('不支持导出为 ' + format);
    } catch (e) { toast('导出失败：' + errMsg(e)); }
    finally { setBusy(null); }
  };

  useHost((m) => {
    if (m.type === 'export') void doExport(m.format);
    else if (m.type === 'insert') { const text = m.text ?? (m.html ? htmlToText(m.html) : ''); addChildren(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)); }
    else if (m.type === 'command') {
      if (m.name === 'mode') setMode(m.args === 'outline' ? 'outline' : 'map');
      else if (m.name === 'expand') { addChildren(EXPAND_CHILDREN); toast('已展开：' + EXPAND_CHILDREN.join('、')); }
    } else if (m.type === 'readonly') { s.doc.readonly = m.value; setRo(s.readonly); }
  });

  // 刚从 .xmind / .opml 导入、还没转换：下载、解析、保存，然后告诉宿主
  useEffect(() => {
    const f = s.doc.importFile;
    if (!f || s.readonly) return;
    let cancelled = false;
    (async () => {
      setBusy(`正在导入 ${f.name}…`);
      try {
        const res = await fetch(s.client.assetUrl(f.id));
        if (!res.ok) throw new Error(`下载源文件失败（${res.status}）`);
        const ext = (f.name.split('.').pop() ?? '').toLowerCase();
        let tree: MNode;
        if (ext === 'xmind') tree = fromParsed(await xmind.parseXmindFile(await res.blob()));
        else if (ext === 'opml') tree = fromOpml(await res.text(), s.doc.title);
        else throw new Error('不支持导入 .' + ext);
        if (cancelled) return;
        rootRef.current = tree; setSel(null);
        mapRef.current?.setData(structuredClone(tree));
        changed();
        await s.flush();
        await s.client.imported();
        s.send({ type: 'imported', title: s.doc.title });
        toast('已导入 ' + f.name);
      } catch (e) { if (!cancelled) toast('导入失败：' + errMsg(e)); }
      finally { if (!cancelled) setBusy(null); }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hint = ro ? '只读' : mode === 'outline' ? 'Enter 新建同级，Tab 变成子节点，Shift+Tab 升一级' : '双击节点改文字，Tab 加子节点，Enter 加同级，Delete 删除';
  const selIsRoot = !sel || sel === rootUid;
  return <div className="ed">
    <Toolbar right={<span className="muted mn-hint">{hint}</span>}>
      <span className="seg two" role="group" aria-label="模式">
        <button type="button" className={cx(mode === 'outline' && 'on')} aria-pressed={mode === 'outline'} onClick={() => setMode('outline')}><Icon name="outline" />大纲</button>
        <button type="button" className={cx(mode === 'map' && 'on')} aria-pressed={mode === 'map'} onClick={() => setMode('map')}><Icon name="mind" />导图</button>
      </span>
      {ro ? null : <>
        <TT icon="plus" label="子节点" title="给选中的节点加一个子节点（Tab）" onClick={() => ops.child(sel)} />
        <TT icon="plus" label="同级" title="在选中的节点后面加一个同级节点（Enter）" disabled={selIsRoot} onClick={() => ops.sibling(sel)} />
        <TT icon="trash" label="删除" title="删除选中的节点" disabled={selIsRoot} onClick={() => ops.remove(sel)} />
      </>}
      <TT icon="down" label="全部展开" onClick={ops.expandAll} />
      <Select aria-label="布局" title="布局" value={layout} onChange={setLayout} options={LAYOUTS} disabled={ro} />
      <Select aria-label="主题" title="主题" value={theme} onChange={setTheme} options={THEMES} disabled={ro} />
      {mode === 'map' ? <>
        <TT icon="zoomout" title="缩小" onClick={() => mapRef.current?.view.narrow()} />
        <TT icon="zoomin" title="放大" onClick={() => mapRef.current?.view.enlarge()} />
        <TT icon="screen" label="适应" title="适应窗口" onClick={() => mapRef.current?.view.fit()} />
      </> : null}
    </Toolbar>
    <div className={cx('ed-body', mode === 'map' && 'fill')}>
      {mode === 'map'
        ? <MapView root={rootRef.current} layout={layout} theme={theme} dark={dark} readonly={ro} apiRef={mapRef} onData={(d) => { rootRef.current = ensure(d); save(); }} onSel={setSel} />
        : <div className="mn"><div className="mn-body"><Outline root={rootRef.current} tick={tick} readonly={ro} sel={sel} onSel={setSel} onText={save} ops={ops} focusReq={focusReq} /></div></div>}
      {busy ? <div className="note mn-busy" role="status"><span className="spin" />{busy}</div> : null}
    </div>
    <Toaster />
  </div>;
}

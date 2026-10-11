/**
 * 流程图：基于 AntV X6。内容是 graph.toJSON() 的结果 { cells }，格式说明见 README.md。
 * 左侧形状面板拖到画布，节点双击改文字、从四边的圆点拖出连线；右侧属性面板改文字、类型、颜色和连线标签。
 */
import '@antv/x6/dist/index.css';
import '@antv/x6-plugin-stencil/dist/index.css';
import '@antv/x6-plugin-selection/dist/index.css';
import '@antv/x6-plugin-snapline/dist/index.css';
import './flow.css';
import { useEffect, useRef, useState } from 'react';
import { Graph, type Cell, type Edge, type Node } from '@antv/x6';
import { Export } from '@antv/x6-plugin-export';
import { History } from '@antv/x6-plugin-history';
import { Keyboard } from '@antv/x6-plugin-keyboard';
import { Selection } from '@antv/x6-plugin-selection';
import { Snapline } from '@antv/x6-plugin-snapline';
import { Stencil } from '@antv/x6-plugin-stencil';
import type { Session } from '@cai/bridge';
import { useHost, useTheme } from '../shell/session';
import { Icon, Select, TT, Toaster, Toolbar, cx, toast } from '../shell/ui';
import { arrange } from './layout';
import { COLORS, DEFAULT_COLOR, DEFAULT_TEXT, EDGE_SHAPE, KINDS, SIZE, colorAttrs, colorOf, kindOf, nodeMeta, registerShapes, type Color, type Kind } from './shapes';

export interface FlowContent { cells: Cell.Properties[] }

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const htmlToText = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d.innerText; };
const labelOf = (e: Edge) => String(e.getLabels()[0]?.attrs?.label?.text ?? '');
/**
 * 双击改文字用 X6 自带的 node-editor / edge-editor 工具。X6 2.x 里这个工具要事先挂在格子上，由它自己监听双击再弹出编辑框
 * （双击时才 addTools 会错过当前这次双击），所以打开内容和新增格子时都挂上，只读时摘掉。工具不进撤销栈，保存时也去掉。
 * 编辑框的颜色写 CSS 变量（行内样式里可以用），跟着主题变。
 */
const EDITOR_ATTRS = { fontSize: 13, fontFamily: 'var(--font)', color: 'var(--ink)', backgroundColor: 'var(--surface)' };
function attachEditor(cell: Cell) {
  const name = cell.isNode() ? 'node-editor' : 'edge-editor';
  if (cell.hasTool(name)) return;
  cell.addTools(cell.isNode() ? { name, args: { getText: 'label/text', setText: 'label/text', attrs: EDITOR_ATTRS } } : { name, args: { attrs: EDITOR_ATTRS } });
}
function setEditable(graph: Graph, on: boolean) { for (const c of graph.getCells()) { if (on) attachEditor(c); else c.removeTools(); } }

export function FlowEditor({ session: s }: { session: Session }) {
  const theme = useTheme();
  const [ro, setRo] = useState(s.readonly);
  const roRef = useRef(ro); roRef.current = ro;
  const wrap = useRef<HTMLDivElement>(null), stencilBox = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sel, setSel] = useState<Cell | null>(null);
  const [, bump] = useState(0); // 选中的格子属性变了就重画属性面板
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [zoom, setZoom] = useState(1);
  const [stencilOpen, setStencilOpen] = useState(() => window.innerWidth > 700);

  const snapshot = () => {
    const g = graphRef.current!;
    const cells = g.toJSON().cells.map(({ tools: _tools, ...c }) => c); // 行内编辑框这类运行时状态不保存
    const plain = [...g.getNodes().map((n) => String(n.attr('label/text') ?? '')), ...g.getEdges().map(labelOf)].filter(Boolean).join('\n');
    return { content: { cells } as FlowContent, plain };
  };
  const commit = () => { timer.current = null; if (graphRef.current && !roRef.current) s.markDirty(snapshot); };
  const schedule = () => { if (roRef.current) return; if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(commit, 300); };

  useEffect(() => {
    registerShapes();
    const graph: Graph = new Graph({
      container: wrap.current!,
      autoResize: true,
      background: false,
      grid: { visible: true, type: 'dot', size: 20, args: { color: cssVar('--line-2'), thickness: 1 } },
      panning: { enabled: true, eventTypes: ['leftMouseDown'] },
      mousewheel: { enabled: true, zoomAtMousePosition: true, minScale: 0.2, maxScale: 3, factor: 1.1 },
      scaling: { min: 0.2, max: 3 },
      interacting: () => !roRef.current, // 只读时不能拖动、连线、改大小；平移缩放仍然可以
      connecting: {
        snap: { radius: 24 }, allowBlank: false, allowLoop: false, allowNode: false, allowEdge: false, allowMulti: true, highlight: true,
        createEdge: () => graph.createEdge({ shape: EDGE_SHAPE }),
        validateConnection: ({ targetMagnet }) => !!targetMagnet,
      },
      highlighting: { magnetAdsorbed: { name: 'stroke', args: { padding: 3, attrs: { stroke: 'var(--accent-btn)', 'stroke-width': 2 } } } },
    });
    graphRef.current = graph;
    graph.use(new Selection({ enabled: true, multiple: true, rubberband: true, modifiers: 'shift', movable: true, showNodeSelectionBox: true, showEdgeSelectionBox: false, pointerEvents: 'none' }));
    graph.use(new Keyboard({ enabled: true, global: false, guard: (e) => { const t = e.target as HTMLElement | null; return !t || !(t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'); } }));
    graph.use(new History({ enabled: true, beforeAddCommand: (_event, args) => (args as { key?: string }).key !== 'tools' })); // 编辑框的出现和消失不进撤销栈
    graph.use(new Snapline({ enabled: true, sharp: true }));
    graph.use(new Export());

    const content = s.doc.content as Partial<FlowContent> | null;
    if (content && Array.isArray(content.cells)) graph.fromJSON({ cells: content.cells.map(({ tools: _tools, ...c }) => c) });
    if (!s.readonly) setEditable(graph, true);
    graph.cleanHistory();
    if (graph.getCellCount()) graph.zoomToFit({ padding: 32, maxScale: 1 });

    // 形状面板：预览用小一号的节点，放到画布时按真实尺寸新建
    const stencil = new Stencil({
      title: '形状（拖到画布上）', target: graph, stencilGraphWidth: 198, stencilGraphHeight: 0, collapsable: false,
      groups: [{ name: 'basic' }], layoutOptions: { columns: 1, columnWidth: 178, rowHeight: 68, dx: 10, dy: 10 },
      getDropNode: (node) => { const kind = kindOf(node); return graph.createNode(nodeMeta(kind, DEFAULT_TEXT[kind], 0, 0)); },
    });
    stencilBox.current!.appendChild(stencil.container);
    stencil.load(KINDS.map(([kind, name]) => { const m = nodeMeta(kind, name, 0, 0); const k = kind === 'cond' ? 0.75 : 0.85; m.width = Math.round(SIZE[kind][0] * k); m.height = Math.round(SIZE[kind][1] * k); return m; }), 'basic');

    // 保存：内容有任何变化就防抖提交
    graph.on('cell:change:*', ({ key }) => { if (key === 'tools') return; bump((v) => v + 1); schedule(); });
    graph.on('cell:added', ({ cell }) => { if (!roRef.current) attachEditor(cell); schedule(); });
    graph.on('cell:removed', schedule);
    graph.on('history:change', () => setHistory({ undo: graph.canUndo(), redo: graph.canRedo() }));
    graph.on('scale', ({ sx }) => setZoom(sx));
    graph.on('selection:changed', ({ selected }) => setSel(selected.length === 1 ? selected[0] : null));
    graph.on('edge:connected', ({ edge, isNew }) => { if (isNew) graph.resetSelection(edge); });
    graph.bindKey(['delete', 'backspace'], () => { if (roRef.current) return false; const cells = graph.getSelectedCells(); if (cells.length) graph.removeCells(cells); return false; });
    graph.bindKey(['ctrl+z', 'meta+z'], () => { if (!roRef.current) graph.undo(); return false; });
    graph.bindKey(['ctrl+y', 'ctrl+shift+z', 'meta+shift+z'], () => { if (!roRef.current) graph.redo(); return false; });

    return () => { if (timer.current) clearTimeout(timer.current); stencil.dispose(); graph.dispose(); graphRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 网格是画在 canvas 上的，不认 CSS 变量，主题变了要重画
  useEffect(() => { graphRef.current?.drawGrid({ type: 'dot', args: { color: cssVar('--line-2'), thickness: 1 } }); }, [theme]);

  function exportAs(format: string) {
    const g = graphRef.current; if (!g) return;
    if (!g.getCellCount()) { toast('流程图是空的，没有可导出的内容'); return; }
    const name = `${s.doc.title}.${format === 'svg' ? 'svg' : 'png'}`;
    g.cleanSelection();
    if (format === 'svg') g.toSVG((svg) => s.download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), name), { viewBox: g.getContentArea().inflate(24), preserveDimensions: true, copyStyles: true, serializeImages: true });
    else g.toPNG((uri) => { fetch(uri).then((r) => r.blob()).then((b) => s.download(b, name)).catch(() => toast('导出失败')); }, { padding: 24, ratio: '2', backgroundColor: cssVar('--surface'), copyStyles: true, serializeImages: true });
  }

  /** 宿主插入一段文字：加一个步骤节点，放在现有内容下方 */
  function insert(text: string) {
    const g = graphRef.current; if (!g || roRef.current) return;
    const t = text.trim(); if (!t) return;
    const has = g.getNodes().length > 0, area = g.getContentArea();
    const node = g.addNode(nodeMeta('step', t, has ? area.center.x : 240, has ? area.bottom + 40 + SIZE.step[1] / 2 : 120));
    g.resetSelection(node);
  }

  useHost((m) => {
    if (m.type === 'readonly') { setRo(m.value); const g = graphRef.current; if (g) { g.cleanSelection(); setEditable(g, !m.value); } }
    else if (m.type === 'export') exportAs(m.format);
    else if (m.type === 'insert') insert(m.text ?? (m.html ? htmlToText(m.html) : ''));
    else if (m.type === 'flush') { if (timer.current) { clearTimeout(timer.current); commit(); void s.flush(); } }
  });

  // 图在首次渲染之后才建好，所以按钮里都现取 graphRef，不能在渲染时拿
  const g = graphRef.current;
  const fit = () => { const g = graphRef.current; if (!g) return; if (g.getCellCount()) g.zoomToFit({ padding: 32, maxScale: 1.5 }); else { g.zoomTo(1); g.centerPoint(0, 0); } };
  const doArrange = () => { const g = graphRef.current; if (!g || roRef.current) return; arrange(g); fit(); };
  const remove = () => { if (graphRef.current && sel) graphRef.current.removeCell(sel); };

  return (
    <div className="ed">
      <Toolbar right={<span className="muted fl-hint">{ro ? '只读' : '拖形状到画布 · 双击改文字 · 拖节点边上的圆点连线 · Shift+拖动框选'}</span>}>
        {!ro ? <TT icon="layers" label="形状" on={stencilOpen} onClick={() => setStencilOpen((v) => !v)} title="显示或收起形状面板" /> : null}
        {!ro ? <TT icon="undo" label="撤销" disabled={!history.undo} onClick={() => graphRef.current?.undo()} title="撤销（Ctrl+Z）" /> : null}
        {!ro ? <TT icon="redo" label="重做" disabled={!history.redo} onClick={() => graphRef.current?.redo()} title="重做（Ctrl+Y）" /> : null}
        <span className="wb-zoom">
          <button type="button" className="btn ghost sm icon-only" aria-label="缩小" onClick={() => graphRef.current?.zoom(-0.2)}><Icon name="zoomout" /></button>
          <span className="tnum">{Math.round(zoom * 100)}%</span>
          <button type="button" className="btn ghost sm icon-only" aria-label="放大" onClick={() => graphRef.current?.zoom(0.2)}><Icon name="zoomin" /></button>
        </span>
        <TT icon="screen" label="适应画布" onClick={fit} />
        {!ro ? <TT icon="sort" label="自动排列" onClick={doArrange} title="按连线从开始节点往下分层排列" /> : null}
      </Toolbar>
      <div className="fl-x">
        <div className="fl-stencil" ref={stencilBox} hidden={ro || !stencilOpen} />
        <div className="fl-graph" ref={wrap} />
        {!ro && sel ? <aside className="fl-props">{sel.isNode() ? <NodeProps node={sel} graph={g!} onRemove={remove} /> : <EdgeProps edge={sel as Edge} graph={g!} onRemove={remove} />}</aside> : null}
      </div>
      <Toaster />
    </div>
  );
}

/** 文字输入时把改动合成一步撤销：聚焦时开批次，失焦或卸载时收批 */
function useBatch(graph: Graph, name: string) {
  const open = useRef(false);
  useEffect(() => () => { if (open.current) { graph.stopBatch(name); open.current = false; } }, [graph, name]);
  return { onFocus: () => { if (!open.current) { graph.startBatch(name); open.current = true; } }, onBlur: () => { if (open.current) { graph.stopBatch(name); open.current = false; } } };
}

function NodeProps({ node, graph, onRemove }: { node: Node; graph: Graph; onRemove: () => void }) {
  const kind = kindOf(node), color = colorOf(node), batch = useBatch(graph, 'label');
  /** 换类型：X6 不能原地换形状，所以记下连线、删掉再按新形状建一个同编号的节点，连线按编号接回去；整个过程是一步撤销 */
  const changeKind = (k: Kind) => {
    if (k === kind) return;
    graph.batchUpdate(() => {
      const { x, y } = node.getBBox().center, text = String(node.attr('label/text') ?? ''), c = color === DEFAULT_COLOR[kind] ? DEFAULT_COLOR[k] : color;
      const edges = graph.getConnectedEdges(node).map((e) => e.toJSON());
      graph.removeNode(node);
      const meta = nodeMeta(k, text, x, y, c); meta.id = node.id;
      const n = graph.addNode(meta);
      for (const e of edges) graph.addEdge(e);
      graph.resetSelection(n);
    });
  };
  const setColor = (c: Color) => { node.setData({ color: c }); node.attr(colorAttrs(kind, c)); };
  return <>
    <b>节点</b>
    <div className="field"><label className="field-l" htmlFor="fl-t">文字</label><input className="input" id="fl-t" value={String(node.attr('label/text') ?? '')} onChange={(e) => node.attr('label/text', e.target.value)} {...batch} /></div>
    <div className="field"><label className="field-l" htmlFor="fl-k">类型</label><Select id="fl-k" value={kind} onChange={(v) => changeKind(v as Kind)} options={KINDS} /></div>
    <div className="field"><span className="field-l">颜色</span><div className="row">{COLORS.map(([c, name]) => <button key={c} type="button" className={cx('fl-swatch', 'c-' + c, c === color && 'on')} title={name} aria-label={name} aria-pressed={c === color} onClick={() => setColor(c)} />)}</div></div>
    <button type="button" className="btn sm" onClick={onRemove}><Icon name="trash" />删除节点</button>
    <span className="fl-hint">双击节点也可以改文字；按 Delete 删除选中的节点和连线。</span>
  </>;
}

function EdgeProps({ edge, graph, onRemove }: { edge: Edge; graph: Graph; onRemove: () => void }) {
  const batch = useBatch(graph, 'edge-label');
  const setLabel = (v: string) => edge.setLabels(v ? [{ attrs: { label: { text: v } } }] : []);
  return <>
    <b>连线</b>
    <div className="field"><label className="field-l" htmlFor="fl-el">标签</label><input className="input" id="fl-el" value={labelOf(edge)} placeholder="例如：是 / 否" onChange={(e) => setLabel(e.target.value)} {...batch} /></div>
    <button type="button" className="btn sm" onClick={onRemove}><Icon name="trash" />删除连线</button>
    <span className="fl-hint">拖动连线中段可以加拐点；双击连线也可以改标签。</span>
  </>;
}

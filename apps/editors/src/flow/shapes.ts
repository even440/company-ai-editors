/**
 * 流程图的节点形状、预设色和连线样式。
 * 颜色一律用 base.css 里的 CSS 变量（--t-blue、--surface、--ink…），深色主题切换时 SVG 属性里的 var() 自动跟着变，
 * 不用改内容；导出时 X6 的 export 插件会把计算后的颜色写进 SVG 的 style，所以导出的图片也是对的。
 * 节点上存 data: { kind, color }，属性面板靠它显示当前类型和颜色。
 */
import { Graph, type Node } from '@antv/x6';

export type Kind = 'start' | 'step' | 'cond' | 'sub' | 'text';
export type Color = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray';

export const KINDS: [Kind, string][] = [['start', '开始/结束'], ['step', '步骤'], ['cond', '判断'], ['sub', '子流程'], ['text', '文本']];
export const COLORS: [Color, string][] = [['blue', '蓝'], ['green', '绿'], ['orange', '橙'], ['red', '红'], ['purple', '紫'], ['gray', '灰']];
/** 各类型的尺寸（宽, 高），和原型一致 */
export const SIZE: Record<Kind, [number, number]> = { start: [120, 44], step: [150, 50], cond: [176, 76], sub: [160, 54], text: [140, 36] };
export const DEFAULT_COLOR: Record<Kind, Color> = { start: 'blue', step: 'blue', cond: 'orange', sub: 'purple', text: 'gray' };
export const DEFAULT_TEXT: Record<Kind, string> = { start: '开始', step: '步骤', cond: '判断？', sub: '子流程', text: '文本' };
export const EDGE_SHAPE = 'cai-edge';
export const shapeOf = (kind: Kind) => 'cai-' + kind;

/** 四个方向的连接桩：平时隐藏，鼠标移到节点上才显示（见 flow.css） */
const port = (position: string) => ({ position, attrs: { circle: { r: 4, magnet: true, stroke: 'var(--accent-btn)', fill: 'var(--surface)', strokeWidth: 1.5, style: { visibility: 'hidden' } } } });
const PORTS = { groups: { top: port('top'), right: port('right'), bottom: port('bottom'), left: port('left') }, items: [{ id: 'top', group: 'top' }, { id: 'right', group: 'right' }, { id: 'bottom', group: 'bottom' }, { id: 'left', group: 'left' }] };

const TEXT = { fontSize: 13, fontFamily: 'var(--font)', fill: 'var(--ink)', textAnchor: 'middle', textVerticalAnchor: 'middle', refX: '50%', refY: '50%', textWrap: { width: -16, height: -8, ellipsis: true } };

/** 某个颜色在某类节点上的具体属性：开始/判断是浅色底，步骤/子流程是白底彩色边，文本没有边框 */
export function colorAttrs(kind: Kind, color: Color): Record<string, Record<string, string>> {
  const stroke = `var(--t-${color})`, soft = `var(--t-${color}-bg)`;
  if (kind === 'text') return { body: { stroke: 'transparent', fill: 'transparent' } };
  if (kind === 'sub') return { body: { stroke, fill: 'var(--surface)' }, inner: { stroke } };
  if (kind === 'step') return { body: { stroke, fill: 'var(--surface)' } };
  return { body: { stroke, fill: soft } };
}

let registered = false;
/** 注册形状；重复调用没有副作用 */
export function registerShapes() {
  if (registered) return;
  registered = true;
  const common = (kind: Kind, extra: Record<string, unknown>) => ({ width: SIZE[kind][0], height: SIZE[kind][1], ports: PORTS, data: { kind, color: DEFAULT_COLOR[kind] }, ...extra });
  Graph.registerNode(shapeOf('start'), common('start', { inherit: 'rect', attrs: { ...colorAttrs('start', 'blue'), body: { ...colorAttrs('start', 'blue').body, rx: 22, ry: 22, strokeWidth: 1.5 }, label: TEXT } }), true);
  Graph.registerNode(shapeOf('step'), common('step', { inherit: 'rect', attrs: { body: { ...colorAttrs('step', 'blue').body, rx: 8, ry: 8, strokeWidth: 1.5 }, label: TEXT } }), true);
  Graph.registerNode(shapeOf('cond'), common('cond', { inherit: 'polygon', attrs: { body: { ...colorAttrs('cond', 'orange').body, refPoints: '0,10 10,0 20,10 10,20', strokeWidth: 1.5 }, label: { ...TEXT, textWrap: { width: -64, height: -20, ellipsis: true } } } }), true);
  // 子流程：双边框，里面一个左右各缩进 6px 的矩形（refWidth 为负数表示在节点宽度上减去）
  Graph.registerNode(shapeOf('sub'), common('sub', { inherit: 'rect', markup: [{ tagName: 'rect', selector: 'body' }, { tagName: 'rect', selector: 'inner' }, { tagName: 'text', selector: 'label' }], attrs: { body: { ...colorAttrs('sub', 'purple').body, rx: 6, ry: 6, strokeWidth: 1.5 }, inner: { ...colorAttrs('sub', 'purple').inner, refX: 6, refY: 0, refWidth: -12, refHeight: '100%', fill: 'none', strokeWidth: 1.5, pointerEvents: 'none' }, label: TEXT } }), true);
  Graph.registerNode(shapeOf('text'), common('text', { inherit: 'rect', attrs: { body: { ...colorAttrs('text', 'gray').body, strokeWidth: 1 }, label: { ...TEXT, fontSize: 14 } } }), true);
  // 连线：正交路由 + 圆角，带箭头；标签白底小字
  Graph.registerEdge(EDGE_SHAPE, {
    inherit: 'edge',
    router: { name: 'orth', args: { padding: 16 } },
    connector: { name: 'rounded', args: { radius: 8 } },
    attrs: { line: { stroke: 'var(--ink-2)', strokeWidth: 1.5, targetMarker: { name: 'block', width: 10, height: 7 } } },
    defaultLabel: {
      markup: [{ tagName: 'rect', selector: 'body' }, { tagName: 'text', selector: 'label' }],
      attrs: {
        label: { fill: 'var(--ink-2)', fontSize: 12, fontFamily: 'var(--font)', textAnchor: 'middle', textVerticalAnchor: 'middle', pointerEvents: 'none' },
        body: { ref: 'label', fill: 'var(--surface)', stroke: 'var(--line-2)', strokeWidth: 1, rx: 4, ry: 4, refWidth: 12, refHeight: 6, refX: -6, refY: -3 },
      },
      position: { distance: 0.5 },
    },
    zIndex: 0,
  }, true);
}

/** 以 (x, y) 为中心新建一个节点的元数据 */
export function nodeMeta(kind: Kind, text: string, x: number, y: number, color: Color = DEFAULT_COLOR[kind]): Node.Metadata {
  const [w, h] = SIZE[kind];
  return { shape: shapeOf(kind), x: Math.round(x - w / 2), y: Math.round(y - h / 2), width: w, height: h, data: { kind, color }, attrs: { ...colorAttrs(kind, color), label: { text } } };
}

export const kindOf = (node: Node): Kind => ((node.getData() as { kind?: Kind } | undefined)?.kind) ?? 'step';
export const colorOf = (node: Node): Color => ((node.getData() as { color?: Color } | undefined)?.color) ?? DEFAULT_COLOR[kindOf(node)];

/**
 * 思维笔记的数据：节点树和内容格式，大纲和导图共用。
 * content = { root, layout, theme, mode }，root 是 simple-mind-map 的节点 { data: { text, uid, expand }, children }。
 * simple-mind-map 把 expand 不为 true 的节点当作收起，所以每个节点都显式写 expand。
 */
export interface MNodeData { text: string; uid?: string; expand?: boolean; isActive?: boolean; [k: string]: unknown }
export interface MNode { data: MNodeData; children: MNode[]; [k: string]: unknown }

export type Layout = 'logicalStructure' | 'mindMap' | 'organizationStructure' | 'catalogOrganization';
export type Mode = 'map' | 'outline';
export interface MindContent { root: MNode; layout: Layout; theme: string; mode: Mode }

export const LAYOUTS: [Layout, string][] = [['logicalStructure', '逻辑结构图'], ['mindMap', '思维导图'], ['organizationStructure', '组织结构图'], ['catalogOrganization', '目录组织图']];
const LAYOUT_KEYS = LAYOUTS.map((l) => l[0]);

/** AI「展开」命令给节点加的三个子节点 */
export const EXPAND_CHILDREN = ['目标', '关键步骤', '风险与对策'];

let seq = 0;
export const uid = () => 'n' + Date.now().toString(36) + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
export const node = (text: string, children: MNode[] = []): MNode => ({ data: { text, uid: uid(), expand: true }, children });

export function emptyContent(): MindContent {
  return { root: node('中心主题', [node('分支主题 1'), node('分支主题 2')]), layout: 'logicalStructure', theme: 'default', mode: 'map' };
}

/** 补齐 uid 和 expand，去掉不是我们的字段里的空值 */
export function ensure(n: MNode): MNode {
  if (!n.data || typeof n.data !== 'object') n.data = { text: '' };
  if (typeof n.data.text !== 'string') n.data.text = n.data.text == null ? '' : String(n.data.text);
  if (!n.data.uid) n.data.uid = uid();
  n.data.expand = n.data.expand !== false;
  if (!Array.isArray(n.children)) n.children = [];
  n.children.forEach(ensure);
  return n;
}

/** 宿主给的 content 可能是 {}（新建）或别的版本写的，按空内容兜底 */
export function normalize(raw: unknown, themes: string[]): MindContent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<MindContent>;
  if (!r.root || typeof r.root !== 'object') return emptyContent();
  const root = ensure(structuredClone(r.root));
  root.data.expand = true; // 根节点不能收起
  return {
    root,
    layout: LAYOUT_KEYS.includes(r.layout as Layout) ? (r.layout as Layout) : 'logicalStructure',
    theme: themes.includes(r.theme ?? '') ? (r.theme as string) : 'default',
    mode: r.mode === 'outline' ? 'outline' : 'map',
  };
}

/** 保存前去掉 simple-mind-map 塞进来的运行时字段 */
export function clean(root: MNode): MNode {
  const c = structuredClone(root) as MNode & { smmVersion?: unknown };
  delete c.smmVersion;
  walk(c, (n) => { delete n.data.isActive; });
  return c;
}

export function walk(n: MNode, fn: (n: MNode, parent: MNode | null, depth: number) => void, parent: MNode | null = null, depth = 0) {
  fn(n, parent, depth);
  n.children.forEach((c) => walk(c, fn, n, depth + 1));
}
export function find(root: MNode, id: string | null | undefined): MNode | null {
  if (!id) return null;
  let out: MNode | null = null;
  walk(root, (n) => { if (n.data.uid === id) out = n; });
  return out;
}
export function parentOf(root: MNode, id: string): MNode | null {
  let out: MNode | null = null;
  walk(root, (n, p) => { if (n.data.uid === id) out = p; });
  return out;
}

/** 给搜索和 AI 用的纯文本：所有节点文字，按深度缩进 */
export function plainOf(root: MNode): string {
  const lines: string[] = [];
  walk(root, (n, _p, d) => { const t = n.data.text.trim(); if (t) lines.push('  '.repeat(d) + t); });
  return lines.join('\n');
}

/** Markdown 大纲：根是一级标题，其余是嵌套列表 */
export function toMarkdown(root: MNode): string {
  const lines = ['# ' + (root.data.text.trim() || '未命名'), ''];
  const rec = (n: MNode, d: number) => { for (const c of n.children) { lines.push('  '.repeat(d) + '- ' + (c.data.text.trim() || ' ')); rec(c, d + 1); } };
  rec(root, 0);
  return lines.join('\n') + '\n';
}

/** OPML（大纲交换格式）：body 下只有一个 outline 时它就是根，否则用标题当根 */
export function fromOpml(xml: string, fallbackTitle: string): MNode {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('不是有效的 OPML 文件');
  const outlines = (el: Element) => Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'outline');
  const parse = (el: Element): MNode => node(el.getAttribute('text') ?? el.getAttribute('title') ?? '', outlines(el).map(parse));
  const body = doc.querySelector('body') ?? doc.documentElement;
  const tops = outlines(body);
  if (tops.length === 0) throw new Error('OPML 里没有内容');
  if (tops.length === 1) return parse(tops[0]);
  return node(doc.querySelector('head > title')?.textContent?.trim() || fallbackTitle, tops.map(parse));
}

/** 把 .xmind 解析器给的树（可能带备注、图片等字段）整理成我们的节点 */
export function fromParsed(tree: unknown): MNode {
  const t = tree as MNode;
  if (!t || !t.data) throw new Error('解析失败');
  return ensure(t);
}

/* ---------- 大纲模式的结构操作：都直接改树，调用方负责刷新和保存 ---------- */

/** 加子节点（放末尾），返回新节点 */
export function addChild(root: MNode, id: string | null, text = ''): MNode {
  const target = find(root, id) ?? root;
  const n = node(text);
  target.data.expand = true;
  target.children.push(n);
  return n;
}
/** 加同级（放在后面）；根节点没有同级，退回加子节点 */
export function addSibling(root: MNode, id: string | null, text = ''): MNode {
  const p = id ? parentOf(root, id) : null;
  if (!p) return addChild(root, id, text);
  const n = node(text);
  p.children.splice(p.children.findIndex((c) => c.data.uid === id) + 1, 0, n);
  return n;
}
/** 删除节点，返回删除后该选中的节点（前一个兄弟或父节点） */
export function remove(root: MNode, id: string): MNode | null {
  const p = parentOf(root, id);
  if (!p) return null;
  const i = p.children.findIndex((c) => c.data.uid === id);
  p.children.splice(i, 1);
  return p.children[i - 1] ?? p.children[i] ?? p;
}
/** Tab：变成前一个兄弟的子节点 */
export function indent(root: MNode, id: string): boolean {
  const p = parentOf(root, id);
  if (!p) return false;
  const i = p.children.findIndex((c) => c.data.uid === id);
  if (i <= 0) return false;
  const [n] = p.children.splice(i, 1);
  const prev = p.children[i - 1];
  prev.data.expand = true;
  prev.children.push(n);
  return true;
}
/** Shift+Tab：升到父节点后面 */
export function outdent(root: MNode, id: string): boolean {
  const p = parentOf(root, id);
  if (!p || !p.data.uid) return false;
  const gp = parentOf(root, p.data.uid);
  if (!gp) return false;
  const i = p.children.findIndex((c) => c.data.uid === id);
  const [n] = p.children.splice(i, 1);
  gp.children.splice(gp.children.findIndex((c) => c === p) + 1, 0, n);
  return true;
}
export function setExpandAll(root: MNode, expand: boolean) { walk(root, (n) => { n.data.expand = expand; }); root.data.expand = true; }

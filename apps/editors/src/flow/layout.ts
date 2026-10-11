/**
 * 自动排列：简单分层，不用 dagre。
 * 1. 从没有入边的节点（开始节点）出发深搜，指向还在搜索栈上的节点的边是回边，分层时忽略，这样有环也不会死循环；
 * 2. 按拓扑顺序取最长路径作为层号，同一层的节点横向排开，顺序按上一层父节点的位置（减少交叉）；
 * 3. 连线上手动拖出的拐点清掉，让路由重新算。
 */
import type { Graph } from '@antv/x6';

export function arrange(graph: Graph, gapX = 220, gapY = 110, top = 60) {
  const nodes = graph.getNodes();
  if (!nodes.length) return;
  const out = new Map<string, string[]>(), indeg = new Map<string, number>();
  for (const n of nodes) { out.set(n.id, []); indeg.set(n.id, 0); }
  for (const e of graph.getEdges()) {
    const a = e.getSourceCellId(), b = e.getTargetCellId();
    if (a && b && a !== b && out.has(a) && out.has(b)) { out.get(a)!.push(b); indeg.set(b, indeg.get(b)! + 1); }
  }
  // 找回边
  const state = new Map<string, 1 | 2>(), back = new Set<string>();
  const dfs = (id: string) => { state.set(id, 1); for (const to of out.get(id)!) { const st = state.get(to); if (st === 1) back.add(id + '>' + to); else if (!st) dfs(to); } state.set(id, 2); };
  for (const n of nodes) if (!indeg.get(n.id)) dfs(n.id);
  for (const n of nodes) if (!state.has(n.id)) dfs(n.id); // 只有环、没有起点的部分
  const isBack = (a: string, b: string) => back.has(a + '>' + b);
  // 最长路径分层
  const deg = new Map(indeg);
  for (const k of back) deg.set(k.split('>')[1], deg.get(k.split('>')[1])! - 1);
  const level = new Map<string, number>(), queue = nodes.filter((n) => deg.get(n.id) === 0).map((n) => n.id);
  for (const id of queue) level.set(id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const to of out.get(id)!) {
      if (isBack(id, to)) continue;
      level.set(to, Math.max(level.get(to) ?? 0, level.get(id)! + 1));
      deg.set(to, deg.get(to)! - 1);
      if (deg.get(to) === 0) queue.push(to);
    }
  }
  const parents = new Map<string, string[]>();
  for (const [a, list] of out) for (const b of list) if (!isBack(a, b)) parents.set(b, [...(parents.get(b) ?? []), a]);
  const rows: string[][] = [];
  for (const n of nodes) { const l = level.get(n.id) ?? 0; (rows[l] ||= []).push(n.id); }
  const byId = new Map(nodes.map((n) => [n.id, n])), order = new Map<string, number>();
  const curX = (id: string) => byId.get(id)!.getBBox().center.x;
  const cx = Math.max(300, graph.getContentArea().center.x || 0);
  graph.batchUpdate(() => {
    rows.forEach((row, l) => {
      if (!row) return;
      // 第一层按现在的横向位置，后面各层按父节点在上一层里的平均位置
      const key = (id: string) => { const ps = parents.get(id)?.filter((p) => order.has(p)) ?? []; return ps.length ? ps.reduce((s, p) => s + order.get(p)!, 0) / ps.length : Number.MAX_SAFE_INTEGER; };
      row.sort((p, q) => (l ? key(p) - key(q) : 0) || curX(p) - curX(q));
      row.forEach((id, i) => {
        order.set(id, i);
        const n = byId.get(id)!, { width, height } = n.size();
        n.position(Math.round(cx + (i - (row.length - 1) / 2) * gapX - width / 2), Math.round(top + l * gapY - height / 2));
      });
    });
    // 连线按新的相对位置重新选连接桩：往下走的从底到顶，同一层的左右相接，回边从顶绕到底；拐点清掉让路由重算
    for (const e of graph.getEdges()) {
      const a = e.getSourceCellId(), b = e.getTargetCellId();
      if (a && b && byId.has(a) && byId.has(b)) {
        const la = level.get(a) ?? 0, lb = level.get(b) ?? 0, right = curX(b) > curX(a);
        const [sp, tp] = la < lb ? ['bottom', 'top'] : la > lb ? ['top', 'bottom'] : right ? ['right', 'left'] : ['left', 'right'];
        e.setSource({ cell: a, port: sp }); e.setTarget({ cell: b, port: tp });
      }
      if (e.getVertices().length) e.setVertices([]);
    }
  });
}

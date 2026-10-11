/** 假宿主的示例内容：每种格式至少一份。各编辑器可以把自己格式的示例补得更像样 */
export const USERS = [
  { id: 'zs', name: '张三', dept: '销售部', tint: 'blue', color: '#2f6bf2' },
  { id: 'ln', name: '李娜', dept: '销售部', tint: 'purple', color: '#7c4ddb' },
  { id: 'wl', name: '王磊', dept: '销售部', tint: 'green', color: '#17a35a' },
  { id: 'zm', name: '周敏', dept: '销售部', tint: 'teal', color: '#0f9488' },
  { id: 'hj', name: '何静', dept: '人力资源部', tint: 'orange', color: '#e8770a' },
];

const text = (t) => ({ type: 'text', text: t });
const p = (t) => ({ type: 'paragraph', content: t ? [text(t)] : [] });
const h = (t, level = 2) => ({ type: 'heading', attrs: { level }, content: [text(t)] });
const ul = (items) => ({ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [p(t)] })) });

/** 表格示例：Univer 的 IWorkbookData。格子 { v, t, s, f }，t：1 文字、2 数字、3 布尔；样式按 styles 里的编号引用；行列号从 0 起 */
const sheetSample = () => {
  const rows = [
    ['客户', '负责人', '阶段', '金额（万元）', '预计签约', '赢率', '备注'],
    ['星河科技', '李娜', '已报价', 36, '2026-10-20', 0.6, '等法务审合同'],
    ['海川物流', '王磊', '方案确认', 48.6, '2026-11-05', 0.5, '赵总希望压缩到 5 周以内'],
    ['远大制造', '张三', '需求沟通', 12, '2026-11-18', 0.3, ''],
    ['恒信地产', '王磊', '已签约', 27.5, '2026-10-12', 1, '10 月回款'],
    ['北辰教育', '张三', '已联系', 24, '2026-10-28', 0.4, '需要教育行业案例'],
    ['云栖医疗', '李娜', '已报价', 36, '2026-10-25', 0.6, ''],
    ['蓝海零售', '李娜', '流失', 12, '', 0, '转向竞品'],
  ];
  const cellData = { 0: { 0: { v: '华东区 Q4 商机跟进表', t: 1, s: 'title' } } };
  rows.forEach((row, i) => {
    const r = i + 1;
    cellData[r] = {};
    row.forEach((v, c) => {
      if (v === '') return;
      const cell = typeof v === 'number' ? { v, t: 2 } : { v, t: 1 };
      if (r === 1) cell.s = 'hd'; else if (c === 3) cell.s = 'money'; else if (c === 5) cell.s = 'pct';
      cellData[r][c] = cell;
    });
  });
  const last = rows.length + 1; // 合计行的行号；数据占 Excel 的第 3 行到第 last 行
  cellData[last] = { 0: { v: '合计', t: 1, s: 'hd' }, 3: { f: `=SUM(D3:D${last})`, s: 'money' }, 5: { v: '加权', t: 1, s: 'hd' }, 6: { f: `=SUMPRODUCT(D3:D${last},F3:F${last})`, s: 'money' } };
  const stages = [['阶段', '含义', '赢率参考'], ['需求沟通', '了解需求，还没出方案', 0.3], ['已联系', '建立联系，确认有预算', 0.4], ['方案确认', '方案通过技术评审', 0.5], ['已报价', '报价已发出，等商务谈判', 0.6], ['已签约', '合同签回', 1], ['流失', '客户放弃或转向竞品', 0]];
  const stageCells = {};
  stages.forEach((row, r) => { stageCells[r] = {}; row.forEach((v, c) => { stageCells[r][c] = typeof v === 'number' ? { v, t: 2, s: 'pct' } : { v, t: 1, ...(r === 0 ? { s: 'hd' } : {}) }; }); });
  return {
    id: 'demo-sheet', name: '华东区 Q4 商机跟进表', appVersion: '1.0.3', locale: 'zhCN',
    styles: {
      title: { bl: 1, fs: 16, ht: 1, vt: 2 },
      hd: { bl: 1, bg: { rgb: '#eaf1fe' }, cl: { rgb: '#1a2233' }, ht: 2, vt: 2 },
      money: { n: { pattern: '#,##0.0' }, ht: 3 },
      pct: { n: { pattern: '0%' }, ht: 2 },
    },
    sheetOrder: ['s1', 's2'],
    sheets: {
      s1: { id: 's1', name: '商机', rowCount: 60, columnCount: 14, cellData, mergeData: [{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 6 }], rowData: { 0: { h: 36 } }, columnData: { 0: { w: 120 }, 1: { w: 80 }, 2: { w: 90 }, 3: { w: 110 }, 4: { w: 110 }, 5: { w: 70 }, 6: { w: 220 } }, freeze: { xSplit: 0, ySplit: 2, startRow: 2, startColumn: -1 } },
      s2: { id: 's2', name: '阶段说明', rowCount: 40, columnCount: 10, cellData: stageCells, columnData: { 0: { w: 100 }, 1: { w: 220 }, 2: { w: 90 } } },
    },
  };
};

// 幻灯片（PPTist）：文本元素的 content 是 ProseMirror 的 HTML；box 是 [left, top, width, height]，画布宽 1000
const sText = (id, html, box) => ({ type: 'text', id, left: box[0], top: box[1], width: box[2], height: box[3], rotate: 0, content: html, defaultFontName: '', defaultColor: '#333', lineHeight: 1.3 });
const sBar = (id, left, top, width, color) => ({ type: 'shape', id, left, top, width, height: 6, rotate: 0, viewBox: [200, 200], path: 'M 0 0 L 200 0 L 200 200 L 0 200 Z', fill: color, fixedRatio: false });
const sList = (items, size = 20) => '<ul>' + items.map((t) => '<li><p><span style="font-size: ' + size + 'px;">' + t + '</span></p></li>').join('') + '</ul>';
const SLIDES_THEME = { themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4', '#70ad47'], fontColor: '#333', fontName: '', backgroundColor: '#fff', shadow: { h: 3, v: 3, blur: 2, color: '#808080' }, outline: { width: 2, color: '#525252', style: 'solid' } };

/* 画板示例：Excalidraw 的元素。形状里的文字是绑定在容器上的文本元素（containerId / boundElements） */
let seed = 1000;
const el = (type, x, y, w, h, extra = {}) => ({ id: `b${++seed}`, type, x, y, width: w, height: h, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, index: null, roundness: null, seed: ++seed, version: 1, versionNonce: seed, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...extra });
const textEl = (x, y, text, fs, extra = {}) => { const lines = text.split('\n'), w = Math.max(...lines.map((l) => l.length)) * fs, h = lines.length * fs * 1.25; return el('text', x, y, w, h, { text, originalText: text, fontSize: fs, fontFamily: 5, textAlign: 'left', verticalAlign: 'top', containerId: null, lineHeight: 1.25, autoResize: true, ...extra }); };
const boxed = (type, x, y, w, h, text, stroke, bg, fs = 16) => {
  const box = el(type, x, y, w, h, { strokeColor: stroke, backgroundColor: bg, roundness: type === 'rectangle' ? { type: 3 } : null });
  const t = textEl(0, 0, text, fs, { textAlign: 'center', verticalAlign: 'middle', containerId: box.id, strokeColor: '#1e1e1e' });
  t.x = x + (w - t.width) / 2; t.y = y + (h - t.height) / 2; box.boundElements = [{ id: t.id, type: 'text' }];
  return [box, t];
};
const arrow = (x1, y1, x2, y2) => el('arrow', x1, y1, Math.abs(x2 - x1), Math.abs(y2 - y1), { points: [[0, 0], [x2 - x1, y2 - y1]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: 'arrow', elbowed: false, roundness: { type: 2 } });
const BLUE = ['#1971c2', '#a5d8ff'], GREEN = ['#2f9e44', '#b2f2bb'], RED = ['#e03131', '#ffc9c9'], YELLOW = ['#f08c00', '#ffec99'], PURPLE = ['#6741d9', '#d0bfff'];
const boardSample = () => ({ elements: [
  textEl(60, 30, '销售流程梳理 · 10 月例会', 24),
  ...boxed('rectangle', 80, 110, 160, 70, '线索', ...BLUE), ...boxed('rectangle', 360, 110, 160, 70, '商机', ...BLUE), ...boxed('rectangle', 640, 110, 160, 70, '成交', ...GREEN),
  arrow(240, 145, 360, 145), arrow(520, 145, 640, 145), arrow(800, 145, 900, 175),
  ...boxed('ellipse', 900, 100, 150, 150, '客户成功', ...PURPLE),
  ...boxed('rectangle', 60, 240, 180, 120, '线索 24 小时内\n首次联系', ...YELLOW, 14), ...boxed('rectangle', 260, 240, 180, 120, '官网线索转化率下降，\n要缩短首次联系时间', ...RED, 14),
  ...boxed('rectangle', 460, 240, 180, 120, '报价超过权限\n要主管审批', ...GREEN, 14), ...boxed('rectangle', 660, 240, 180, 120, '续约提前 45 天启动', ...BLUE, 14),
], appState: { viewBackgroundColor: '#ffffff', gridSize: 20, gridStep: 5, gridModeEnabled: false }, files: {} });

/* 流程图示例：X6 的 cells。形状定义在 apps/editors/src/flow/shapes.ts，颜色写 CSS 变量，深色主题自动换色 */
const FSIZE = { start: [120, 44], step: [150, 50], cond: [176, 76], sub: [160, 54], text: [140, 36] }, FCOLOR = { start: 'blue', step: 'blue', cond: 'orange', sub: 'purple', text: 'gray' };
const fnode = (id, kind, text, cx, cy, color = FCOLOR[kind]) => {
  const [w, h] = FSIZE[kind], tint = `var(--t-${color})`;
  const body = kind === 'text' ? { stroke: 'transparent', fill: 'transparent' } : kind === 'step' || kind === 'sub' ? { stroke: tint, fill: 'var(--surface)' } : { stroke: tint, fill: `var(--t-${color}-bg)` };
  return { id, shape: 'cai-' + kind, position: { x: cx - w / 2, y: cy - h / 2 }, size: { width: w, height: h }, data: { kind, color }, attrs: { body, ...(kind === 'sub' ? { inner: { stroke: tint } } : {}), label: { text } } };
};
const fedge = (id, from, to, label) => { const [a, ap] = from.split('.'), [b, bp] = to.split('.'); return { id, shape: 'cai-edge', source: { cell: a, port: ap }, target: { cell: b, port: bp }, ...(label ? { labels: [{ attrs: { label: { text: label } } }] } : {}) }; };
const flowSample = () => ({ cells: [
  fnode('a1', 'start', '线索进入', 550, 50), fnode('a2', 'step', '24 小时内首次联系', 550, 140), fnode('a3', 'cond', '有需求？', 550, 240), fnode('a4', 'step', '放入培育池', 280, 240, 'gray'),
  fnode('a5', 'step', '方案报价', 550, 340), fnode('a6', 'cond', '超出折扣权限？', 550, 440), fnode('a7', 'sub', '销售主管审批', 820, 440), fnode('a8', 'start', '签约回款', 550, 560, 'green'),
  fedge('e1', 'a1.bottom', 'a2.top'), fedge('e2', 'a2.bottom', 'a3.top'), fedge('e3', 'a3.bottom', 'a5.top', '是'), fedge('e4', 'a3.left', 'a4.right', '否'),
  fedge('e5', 'a5.bottom', 'a6.top'), fedge('e6', 'a6.right', 'a7.left', '是'), fedge('e7', 'a6.bottom', 'a8.top', '否'), fedge('e8', 'a7.bottom', 'a8.right'),
] });

export const SAMPLES = {
  'demo-doc': { kind: 'doc', title: '9 月销售例会纪要', content: { type: 'doc', content: [h('结论'), ul(['华东区 3 个大单延期到 10 月，9 月目标完成率 86%。', '官网表单线索的转化率下降，需要缩短首次联系时间。']), h('待办'), ul(['李娜：10 月 9 日前确认 3 个延期大单的签约日期。', '周敏：10 月 12 日前上线线索 24 小时首次联系的抽查。']), p('会后把纪要发到销售部群。')] } },
  'demo-doc-empty': { kind: 'doc', title: '未命名文档', content: {} },
  'demo-doc-import': { kind: 'doc', title: '产品需求说明', content: {}, sampleImport: 'sample.docx' },
  'demo-sheet': { kind: 'sheet', title: '华东区 Q4 商机跟进表', content: sheetSample() },
  'demo-sheet-empty': { kind: 'sheet', title: '未命名表格', content: {} },
  'demo-sheet-import': { kind: 'sheet', title: '2026H2 渠道价格表', content: {}, sampleImport: 'sample.xlsx' },
  'demo-slides': { kind: 'slides', title: 'Q4 销售策略汇报', content: { title: 'Q4 销售策略汇报', theme: SLIDES_THEME, viewportSize: 1000, viewportRatio: 0.5625, slides: [
    { id: 'sl-cover', type: 'cover', background: { type: 'solid', color: '#1f3b73' }, elements: [
      sText('t-cover-1', '<p style="text-align: center;"><span style="font-size: 48px; color: #ffffff;"><strong>Q4 销售策略汇报</strong></span></p>', [100, 190, 800, 80]),
      sText('t-cover-2', '<p style="text-align: center;"><span style="font-size: 22px; color: #c9d6ef;">销售部 · 2026 年 10 月</span></p>', [100, 300, 800, 50]),
    ] },
    { id: 'sl-review', type: 'content', elements: [
      sText('t-review-h', '<p><span style="font-size: 32px; color: #1f3b73;"><strong>Q3 回顾</strong></span></p>', [60, 40, 880, 60]),
      sBar('b-review', 60, 105, 120, '#5b9bd5'),
      sText('t-review-list', sList(['目标完成率 86%，华东区 3 个大单延期到 10 月', '官网表单线索转化率下降 4 个百分点，首次联系平均 31 小时', '新签 27 家，续约率 91%']), [60, 140, 880, 260]),
    ] },
    { id: 'sl-plan', type: 'content', elements: [
      sText('t-plan-h', '<p><span style="font-size: 32px; color: #1f3b73;"><strong>Q4 重点</strong></span></p>', [60, 40, 880, 60]),
      sBar('b-plan', 60, 105, 120, '#ed7d31'),
      sText('t-plan-list', sList(['10 月 9 日前锁定 3 个延期大单的签约日期（李娜）', '线索 24 小时内首次联系，每周抽查（周敏）', '华南区新开 2 家渠道，11 月前完成培训（王磊）']), [60, 140, 880, 260]),
    ] },
  ] } },
  'demo-slides-import': { kind: 'slides', title: 'Q3 复盘', content: {}, sampleImport: 'sample.pptx' },
  'demo-base': { kind: 'base', title: '客户续约台账', content: {
    fields: [{ id: 'f1', name: '客户', type: 'text' }, { id: 'f2', name: '阶段', type: 'select', opts: [['待跟进', 'gray'], ['已联系', 'blue'], ['已报价', 'orange'], ['已签约', 'green'], ['流失', 'red']] }, { id: 'f3', name: '负责人', type: 'user' }, { id: 'f4', name: '到期日', type: 'date' }, { id: 'f5', name: '年费（万元）', type: 'number' }, { id: 'f6', name: '已续约', type: 'check' }, { id: 'f7', name: '合同', type: 'url' }],
    records: [
      { id: 'r1', v: { f1: '星河科技', f2: '已报价', f3: 'ln', f4: '2026-10-31', f5: 36, f6: false, f7: 'https://example.com/contract/xinghe-2024' } },
      { id: 'r2', v: { f1: '海川物流', f2: '已联系', f3: 'wl', f4: '2026-11-15', f5: 48.6, f6: false } },
      { id: 'r3', v: { f1: '远大制造', f2: '待跟进', f3: 'zs', f4: '2026-12-01', f5: 12, f6: false } },
      { id: 'r4', v: { f1: '恒信地产', f2: '已签约', f3: 'wl', f4: '2026-10-12', f5: 27.5, f6: true } },
      { id: 'r5', v: { f1: '蓝海零售', f2: '流失', f3: 'ln', f4: '2026-10-08', f5: 12, f6: false } },
      { id: 'r6', v: { f1: '北辰教育', f2: '已联系', f3: 'zs', f4: '2026-10-22', f5: 24, f6: false } },
      { id: 'r7', v: { f1: '云栖医疗', f2: '已报价', f3: 'ln', f4: '2026-10-18', f5: 36, f6: false } },
    ],
    views: [{ id: 'v1', name: '表格视图', type: 'grid' }, { id: 'v2', name: '按阶段', type: 'kanban', group: 'f2' }, { id: 'v3', name: '画廊', type: 'gallery' }, { id: 'v4', name: '到期日历', type: 'calendar' }, { id: 'v5', name: '录入表单', type: 'form' }],
  } },
  'demo-base-empty': { kind: 'base', title: '未命名多维表格', content: {} },
  'demo-survey': { kind: 'survey', title: '国庆后办公安排调研', content: {
    desc: '用 1 分钟告诉人事你对假期后办公安排的想法，10 月 15 日截止。',
    qs: [
      { id: 'q1', type: 'single', t: '你所在的部门', opts: ['销售部', '研发部', '财务部', '人力资源部', '其他'], req: true },
      { id: 'q2', type: 'multi', t: '你希望的办公方式（可多选）', opts: ['全员到岗', '每周 1 天远程', '每周 2 天远程', '自由安排'], req: true },
      { id: 'q3', type: 'rate', t: '对新考勤规则的满意度', req: true },
      { id: 'q4', type: 'date', t: '你希望新安排从哪天生效', req: false },
      { id: 'q5', type: 'text', t: '其他建议', req: false },
    ],
    set: { anon: false, once: true, due: '2026-10-15' },
  } },
  'demo-survey-empty': { kind: 'survey', title: '未命名问卷', content: {} },
  'demo-mind': { kind: 'mind', title: '海川物流项目拆解', content: { mode: 'map', layout: 'logicalStructure', theme: 'default', root: { data: { text: '海川物流项目' }, children: [
    { data: { text: '范围' }, children: [{ data: { text: '3 个区域仓的调度系统' }, children: [] }, { data: { text: '年度框架协议' }, children: [] }] },
    { data: { text: '交付' }, children: [{ data: { text: '一期：10 月上线华东仓' }, children: [] }, { data: { text: '二期：11 月上线华南、华北仓' }, children: [] }, { data: { text: '总周期 5 周' }, children: [] }] },
    { data: { text: '报价' }, children: [{ data: { text: '¥486,000，按 8.5 折' }, children: [] }, { data: { text: '低于 9 折需销售主管确认' }, children: [] }] },
    { data: { text: '风险' }, children: [{ data: { text: '赵总希望压缩到 5 周以内' }, children: [] }, { data: { text: '历史数据迁移' }, children: [] }] },
  ] } } },
  'demo-mind-empty': { kind: 'mind', title: '未命名思维笔记', content: {} },
  'demo-mind-import': { kind: 'mind', title: '产品规划', content: {}, sampleImport: 'sample.xmind' },
  'demo-board': { kind: 'board', title: '销售流程梳理', content: boardSample() },
  'demo-board-empty': { kind: 'board', title: '未命名画板', content: {} },
  'demo-flow': { kind: 'flow', title: '线索到回款流程图', content: flowSample() },
  'demo-flow-empty': { kind: 'flow', title: '未命名流程图', content: {} },
  'demo-file-pdf': { kind: 'file', title: '星河科技续约合同（签字版）.pdf', content: {}, sampleFile: 'sample.pdf' },
  'demo-file-image': { kind: 'file', title: '华东区客户拜访照片.png', content: {}, sampleFile: 'sample.png' },
  'demo-file-xlsx': { kind: 'file', title: '2026H2 渠道价格表.xlsx', content: {}, sampleFile: 'sample.xlsx' },
  'demo-file-docx': { kind: 'file', title: '产品需求说明.docx', content: {}, sampleFile: 'sample.docx' },
};

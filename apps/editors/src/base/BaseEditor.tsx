/**
 * 多维表格编辑器：数据表页签 → 视图页签 → 工具栏 → 筛选条 → 当前视图。
 * 整份内容（几张数据表）放在一个 state 里，每次改动产生新对象、过一遍 recompute（清关联、算公式和查找引用）再 markDirty；
 * 视图里的筛选 / 排序 / 隐藏也在内容里，所以切回来还在。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatGroup, Session } from '@cai/bridge';
import { useHost, useTheme } from '../shell/session';
import { Confirm, Icon, TT, Toaster, Toolbar, cx, toast } from '../shell/ui';
import * as B from './book';
import { BaseCtx, MenuItem, Picker, Popover } from './cells';
import { exportXlsx } from './export';
import { GridView } from './GridView';
import { BT } from './i18n';
import { LarkError, convertLark, readLark, type ImportNotes } from './lark';
import { FieldModal, FieldsModal, ImportResultModal, RecordModal, TableModal, ViewModal, type FieldSpec } from './modals';
import * as M from './model';
import { CalendarView, FormView, GalleryView, KanbanView } from './views';
import './style.css';

type ModalState = null | { kind: 'rec'; rid: string } | { kind: 'field'; field?: M.Field; at?: number } | { kind: 'fields' } | { kind: 'view'; view?: M.View } | { kind: 'delView'; view: M.View } | { kind: 'delField'; field: M.Field }
  | { kind: 'table'; table?: B.Table } | { kind: 'delTable'; table: B.Table };
type Pt = { x: number; y: number };
type MenuState = null | { kind: 'field'; f: M.Field; at: Pt } | { kind: 'view'; v: M.View; at: Pt } | { kind: 'table'; t: B.Table; at: Pt };
const stripHtml = (h: string) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent ?? ''; };

export function BaseEditor({ session: s }: { session: Session }) {
  const theme = useTheme();
  const [book, setBook] = useState(() => B.recompute(B.normalizeBook(s.doc.content), new Map()));
  const ref = useRef(book);
  const [users, setUsers] = useState<M.UserMap>(() => new Map());
  const usersRef = useRef(users);
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  /** 内容里有没有群组字段、发到群的按钮变了，群名单要重新取（别人填的、自己不在的群也要有名字） */
  const groupIds = useRef('');
  const [hostRo, setHostRo] = useState(false);
  const ro = s.readonly || hostRo, roRef = useRef(ro); roRef.current = ro;
  /** 当前的数据表、当前的视图 */
  const [tid, setTid] = useState(book.tables[0].id);
  const content = B.tableOf(book, tid) ?? book.tables[0];
  const tidRef = useRef(content.id); tidRef.current = content.id;
  const [curId, setCurId] = useState(content.views[0].id);
  const view = content.views.find((v) => v.id === curId) ?? content.views[0];
  const [title, setTitle] = useState(s.doc.title);
  const [filterOn, setFilterOn] = useState(() => M.activeFilters(view).length > 0);
  const [modal, setModal] = useState<ModalState>(null);
  /** 导入：正在读文件时的提示、导入完的说明 */
  const [busy, setBusy] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportNotes | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  /** 当前这张表的最新样子（回调里用，不等重画） */
  const cur = () => B.tableOf(ref.current, tidRef.current) ?? ref.current.tables[0];

  // 通讯录、群名单到了以后重算一遍（公式里可能用到人名），只是显示，不算改动
  useEffect(() => {
    s.client.directory().then((r) => { const m = new Map(r.users.map((u) => [u.id, u])); usersRef.current = m; setUsers(m); const next = B.recompute(ref.current, m); ref.current = next; setBook(next); }).catch(() => { /* 没有通讯录就只显示编号 */ });
  }, [s]);
  const loadGroups = useCallback(() => { s.client.groups().then((r) => { const m = new Map(r.groups.map((g) => [g.id, g.name])); M.setResolvers({ group: (id) => m.get(id) ?? null }); setGroups(r.groups); }).catch(() => { /* 没有群名单就只显示编号 */ }); }, [s]);
  useEffect(loadGroups, [loadGroups]);

  /** 所有改动都走这里：只读时只改界面不保存 */
  const commitBook = useCallback((fn: (b: B.Book) => B.Book) => {
    const next = B.recompute(fn(ref.current), usersRef.current); ref.current = next; setBook(next);
    if (!roRef.current) s.markDirty(() => ({ content: B.serialize(ref.current), plain: B.plainOfBook(ref.current, usersRef.current) }));
  }, [s]);
  /** 只改当前这张表 */
  const commit = useCallback((fn: (c: B.Table) => M.Content) => commitBook((b) => B.patchTable(b, tidRef.current, fn)), [commitBook]);
  const patchView = useCallback((id: string, patch: Partial<M.View>) => commit((c) => ({ ...c, views: c.views.map((v) => (v.id === id ? { ...v, ...patch } : v)) })), [commit]);

  /* ---------- 导入 Lark 导出的 .base（平台按扩展名建好这份内容、带着源文件，打开时在这里转换） ---------- */
  useEffect(() => {
    const f = s.doc.importFile; if (!f) return;
    let off = false;
    void (async () => {
      setBusy(BT.importing(f.name));
      try {
        const res = await fetch(s.client.assetUrl(f.id));
        if (!res.ok) throw new Error(BT.downloadFail(res.status));
        const got = convertLark(await readLark(await res.arrayBuffer()));
        if (off) return;
        const next = B.recompute(got.book, usersRef.current), first = next.tables[0];
        ref.current = next; setBook(next); setTid(first.id); setCurId(first.views[0].id); setFilterOn(M.activeFilters(first.views[0]).length > 0);
        if (!s.readonly) {
          s.markDirty(() => ({ content: B.serialize(ref.current), plain: B.plainOfBook(ref.current, usersRef.current) }));
          await s.flush();
          await s.client.imported();
          s.send({ type: 'imported', title: s.doc.title });
        }
        toast(BT.imported(f.name)); setImported(got.notes);
      } catch (e) {
        if (off) return;
        const message = e instanceof LarkError ? (e.code === 'unzip' ? BT.unzipFail : e.code === 'noTables' ? BT.noTables : BT.notLark) : e instanceof Error ? e.message : String(e);
        toast(BT.importFail + message); s.send({ type: 'error', message: BT.importFail + message });
      } finally { if (!off) setBusy(null); }
    })();
    return () => { off = true; };
  }, [s]);

  /* ---------- 数据表 ---------- */
  const switchTable = (id: string) => { const t = B.tableOf(ref.current, id); if (!t) return; setTid(id); setCurId(t.views[0].id); setFilterOn(M.activeFilters(t.views[0]).length > 0); };
  const addTable = (name: string) => { const t = B.newTable(ref.current, name); commitBook((b) => ({ tables: [...b.tables, t] })); switchTable(t.id); };
  const renameTable = (id: string, name: string) => { if (!name) return; commitBook((b) => ({ tables: b.tables.map((t) => (t.id === id ? { ...t, name: B.freshName(b.tables.filter((x) => x.id !== id).map((x) => x.name), name) } : t)) })); };
  const delTable = (id: string) => {
    if (ref.current.tables.length <= 1) { toast(BT.keepOneTable); return; }
    commitBook((b) => B.dropTable(b, id, usersRef.current));
    if (id === tidRef.current) switchTable(ref.current.tables[0].id);
  };

  /* ---------- 记录 ---------- */
  const me = s.doc.user?.id;
  // 改一个格子：顺带记下修改的时间和人（「修改时间」「修改人」字段读它们）。关联要连对方那一侧一起改
  const setVal = useCallback((rid: string, fid: string, v: unknown) => {
    if (roRef.current) return;
    const f = cur().fields.find((x) => x.id === fid), r = cur().records.find((x) => x.id === rid);
    if (M.isLink(f?.type)) { commitBook((b) => B.setLink(b, tidRef.current, rid, fid, M.idsOf(v), me)); return; }
    // 流程：要一步一步走、流转条件没满足的不让改，说清楚还差什么
    if (f?.type === 'stage' && r) { const block = M.stageBlock(cur(), f, r, v, usersRef.current); if (block) { toast(blockText(block)); return; } }
    commit((c) => ({ ...c, records: c.records.map((r) => (r.id === rid ? { ...r, v: { ...r.v, [fid]: v }, ut: Date.now(), ...(me ? { ub: me } : {}) } : r)) }));
  }, [commit, commitBook, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const addRec = useCallback((preset: Record<string, unknown> = {}) => { const id = M.uid('r'); commit((c) => { const { rec, fields } = M.newRecord(c, id, preset, me); return { ...c, fields, records: [...c.records, rec] }; }); return id; }, [commit, me]);
  const delRec = useCallback((rid: string) => commit((c) => ({ ...c, records: c.records.filter((r) => r.id !== rid) })), [commit]);
  const openRec = useCallback((rid: string) => setModal({ kind: 'rec', rid }), []);
  const addAndOpen = (preset?: Record<string, unknown>) => { if (ro) return; openRec(addRec(preset)); };

  /* ---------- 字段 ---------- */
  /** 弹窗里填的变成字段：只留这种类型用得上的设置 */
  const fieldOf = (id: string, spec: FieldSpec): M.Field => ({
    id, name: spec.name, type: spec.type, opts: M.isOptType(spec.type) ? spec.opts : undefined,
    ...(spec.type === 'date' && spec.time ? { time: true } : {}),
    ...((spec.type === 'number' || spec.type === 'currency' || spec.type === 'progress' || spec.type === 'formula') && spec.dec != null ? { dec: spec.dec } : {}),
    ...(spec.type === 'currency' ? { cur: spec.cur || 'CNY' } : {}),
    ...(M.isLink(spec.type) && spec.to ? { to: spec.to } : {}),
    ...(spec.type === 'lookup' ? { pick: spec.pick, ...(spec.from ? { from: spec.from, where: spec.where } : { via: spec.via }), ...(spec.agg && spec.agg !== 'list' ? { agg: spec.agg } : {}) } : {}),
    ...(spec.type === 'formula' ? { expr: spec.expr ?? '' } : {}),
    ...(spec.type === 'button' ? { label: spec.label || undefined, ...(spec.acts?.length ? { acts: spec.acts } : {}) } : {}),
    ...(spec.type === 'stage' && spec.flow && Object.keys(spec.flow).length ? { flow: spec.flow } : {}),
    ...(spec.type === 'barcode' && spec.scan ? { scan: true } : {}),
  });
  const addField = (spec: FieldSpec, at?: number) => {
    const f = fieldOf(M.uid('f'), spec);
    // 双向关联：对方表里同时加上成对的字段
    if (f.type === 'duplex') { commitBook((b) => B.addDuplex(b, tidRef.current, f, at)); return f; }
    commit((c) => {
      const fields = c.fields.slice();
      // 新加的自动编号：已有的记录先编上号
      const num = f.type === 'autonum' ? M.renumber(c.records, f.id) : null;
      fields.splice(at ?? fields.length, 0, num ? { ...f, next: num.next } : f);
      return { ...c, fields, records: num ? num.records : c.records };
    });
    return f;
  };
  const editField = (f: M.Field, spec: FieldSpec) => commitBook((b0) => {
    let b = b0, nf = fieldOf(f.id, spec);
    // 关联的字段不换表；双向的留着成对的字段，不再是双向的就把对方那个改成单向
    if (M.isLink(nf.type) && M.isLink(f.type)) nf = { ...nf, to: f.to, ...(nf.type === 'duplex' && f.type === 'duplex' ? { back: f.back } : {}) };
    if (f.type === 'duplex' && nf.type !== 'duplex') b = B.unpair(b, f);
    b = B.patchTable(b, tidRef.current, (c) => {
      let records = c.records;
      if (nf.type === 'autonum') {
        // 本来就是自动编号的接着原来的号；刚改成自动编号的把已有的记录从 1 编起
        if (f.type === 'autonum') nf = { ...nf, next: f.next };
        else { const num = M.renumber(records, f.id); records = num.records; nf = { ...nf, next: num.next }; }
      } else if (f.type !== nf.type || (nf.type === 'date' && !!f.time !== !!nf.time)) {
        records = records.map((r) => ({ ...r, v: { ...r.v, [f.id]: M.coerce(nf, r.v[f.id], usersRef.current, f) } }));
      }
      // 改了名：本表的公式里引用它的地方跟着改；它不再是关联了：顺着它的查找引用没东西可查，变成文本留下现在的字
      const fields = B.renameInFormulas(c, f.name, nf.name).map((x) => (x.id === f.id ? nf : M.isLink(f.type) && !M.isLink(nf.type) && x.type === 'lookup' && x.via === f.id ? { id: x.id, name: x.name, type: 'text' as const } : x));
      return { ...c, fields, records };
    });
    // 别的类型改成双向关联：到对方表里补上成对的字段，已有的关联也记到对方那边
    if (nf.type === 'duplex' && f.type !== 'duplex') b = B.pairExisting(b, tidRef.current, f.id);
    return b;
  });
  const delField = (f: M.Field) => {
    if (cur().fields.length <= 1) { toast('至少保留一个字段'); return; }
    commitBook((b) => B.patchTable(B.unpair(b, f), tidRef.current, (c) => ({
      // 顺着这个关联字段的查找引用变成文本，留下现在的字
      fields: c.fields.filter((x) => x.id !== f.id).map((x) => (x.type === 'lookup' && x.via === f.id ? { id: x.id, name: x.name, type: 'text' as const } : x)),
      records: c.records.map((r) => { const v = { ...r.v }; delete v[f.id]; return { ...r, v }; }),
      views: c.views.map((v) => ({ ...v, hidden: v.hidden?.filter((x) => x !== f.id), filters: v.filters?.filter((x) => x.fid !== f.id), sort: v.sort?.fid === f.id ? null : v.sort, group: v.group === f.id ? undefined : v.group })),
    })));
  };
  const hideField = (fid: string, hidden: boolean) => patchView(view.id, { hidden: hidden ? [...(view.hidden ?? []), fid] : (view.hidden ?? []).filter((x) => x !== fid) });

  /* ---------- 视图 ---------- */
  const addView = (name: string, type: M.ViewType) => {
    const id = M.uid('v'), c = cur();
    const group = type === 'kanban' ? M.firstChoice(c)?.id : type === 'calendar' ? M.firstOf(c, 'date')?.id : undefined;
    commit((x) => ({ ...x, views: [...x.views, { id, name, type, group }] })); setCurId(id);
  };
  const delView = (v: M.View) => { if (cur().views.length <= 1) { toast('至少保留一个视图'); return; } commit((c) => ({ ...c, views: c.views.filter((x) => x.id !== v.id) })); if (v.id === view.id) setCurId(cur().views[0].id); };

  /* ---------- 按钮：依次做设好的几件事（照 Lark 的「点击按钮时」） ---------- */
  const runBtn = useCallback((f: M.Field, rid: string) => {
    if (!f.acts?.length) { toast(BT.btnNone); return; }
    // 只读：改不了记录、发不了消息，只让「打开地址」的按钮用
    if (roRef.current && f.acts.some((a) => a.do !== 'open')) { toast(BT.btnRo); return; }
    const res = B.runButton(ref.current, tidRef.current, rid, f, usersRef.current, me);
    if (res.error) { toast(blockText(res.error)); return; }
    if (res.book !== ref.current) commitBook(() => res.book);
    for (const url of res.open) window.open(url, '_blank', 'noopener');
    if (!res.msgs.length) { if (res.did && !res.open.length) toast(BT.btnDone); return; }
    // 消息交给宿主去发：先把改动存下去，对方点开看到的才是改完的
    void s.flush().then(() => Promise.all(res.msgs.map((m) => s.client.notify(m))))
      .then((list) => toast(BT.btnMsgSent(list.reduce((n, x) => n + x.users + x.groups, 0))))
      .catch((e: unknown) => toast(BT.btnMsgFail + (e instanceof Error ? e.message : String(e))));
  }, [commitBook, me, s]);
  const openChat = useCallback((id: string) => s.send({ type: 'open-chat', convId: id }), [s]);

  /* ---------- 当前视图里的数据 ---------- */
  const recs = useMemo(() => M.visibleRecords(content, view, users), [content, view, users]);
  const fields = useMemo(() => M.visibleFields(content, view), [content, view]);

  /* ---------- 宿主消息 ---------- */
  const doExport = async () => {
    try { const blob = await exportXlsx(fields, recs, users, view.name); s.download(blob, `${title || '多维表格'}.xlsx`); toast('已导出 Excel'); }
    catch (e) { toast('导出失败：' + (e instanceof Error ? e.message : String(e))); s.exportFailed(); }
  };
  const applyNlq = (q: string) => {
    const flt = M.nlq(cur(), q, usersRef.current);
    if (!flt) { toast('没看懂这句话。试试「金额大于 30」「负责人是李娜」「已报价的客户」'); return; }
    // 表单视图没有列表，换到第一个能看记录的视图再筛
    let target = view; if (view.type === 'form') { target = cur().views.find((v) => v.type !== 'form') ?? view; setCurId(target.id); }
    patchView(target.id, { filters: [flt] }); setFilterOn(true);
    toast('已筛选：' + M.filterDesc(cur(), flt));
  };
  /** AI 一次加几个字段：只加自己就能用的类型（关联、查找引用、公式要选表、写式子，让人在界面上加） */
  const addFieldsCmd = (args: unknown) => {
    const list = (Array.isArray(args) ? args : [args]).filter((x): x is { name: string; type?: string; opts?: unknown } => !!x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string');
    if (!list.length) { toast('addFields 需要 [{ name, type }] 这样的参数'); return; }
    const simple: M.FieldType[] = (Object.keys(M.FT) as M.FieldType[]).filter((t) => !M.isLink(t) && t !== 'lookup' && t !== 'formula');
    let n = 0;
    for (const it of list) {
      const type = simple.includes(it.type as M.FieldType) ? (it.type as M.FieldType) : 'text';
      const opts = Array.isArray(it.opts) ? it.opts.map((o, i) => (Array.isArray(o) ? [String(o[0]), M.COLORS.includes(String(o[1])) ? String(o[1]) : M.COLORS[i % M.COLORS.length]] : [String(o), M.COLORS[i % M.COLORS.length]]) as M.Opt) : undefined;
      addField({ name: it.name.trim() || '新字段', type, opts: M.isOptType(type) ? (opts?.length ? opts : [['选项 1', 'blue'], ['选项 2', 'green']]) : undefined }); n++;
    }
    toast(`已添加 ${n} 个字段`);
  };
  useHost((m) => {
    if (m.type === 'readonly') setHostRo(m.value);
    else if (m.type === 'title') setTitle(m.title);
    else if (m.type === 'flush') void s.flush();
    else if (m.type === 'export') { if (m.format === 'xlsx') void doExport(); else { toast('多维表格只能导出 Excel'); s.exportFailed(); } }
    else if (m.type === 'insert') {
      if (ro) { toast('只读，不能插入'); return; }
      const text = (m.text ?? (m.html ? stripHtml(m.html) : '')).trim(), t = M.firstOf(cur(), 'text');
      if (!text) return; if (!t) { toast('没有文本字段，插不进去'); return; }
      addRec({ [t.id]: text }); toast('已新增一条记录');
    } else if (m.type === 'command') {
      const a = m.args as { q?: unknown; text?: unknown } | string | undefined;
      if (m.name === 'filter') applyNlq(typeof a === 'string' ? a : String(a?.q ?? a?.text ?? ''));
      else if (m.name === 'summary') s.send({ type: 'selection', text: M.summarize(cur(), recs, usersRef.current, view.name) });
      else if (m.name === 'addFields') { if (ro) toast('只读，不能添加字段'); else addFieldsCmd(typeof a === 'string' ? safeJson(a) : a); }
      else toast('不认识的命令：' + m.name);
    }
  });

  /* ---------- 界面 ---------- */
  const openFieldMenu = useCallback((f: M.Field, at: Pt) => setMenu({ kind: 'field', f, at }), []);
  const openViewMenu = (v: M.View, at: Pt) => { if (!ro) setMenu({ kind: 'view', v, at }); };
  const addFieldBtn = useCallback(() => setModal({ kind: 'field' }), []);
  const sortSelect = <label className="row nowrap tt" title="排序"><Icon name="sort" /><select className="select" aria-label="排序字段" value={view.sort?.fid ?? ''} onChange={(e) => patchView(view.id, { sort: e.target.value ? { fid: e.target.value, dir: view.sort?.dir ?? 'asc' } : null })}><option value="">排序</option>{content.fields.filter((f) => f.type !== 'button').map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
    {view.sort ? <button type="button" className="bs-sortdir tt" title={view.sort.dir === 'asc' ? '升序，点击改为降序' : '降序，点击改为升序'} onClick={() => patchView(view.id, { sort: { fid: view.sort!.fid, dir: view.sort!.dir === 'asc' ? 'desc' : 'asc' } })}><Icon name={view.sort.dir === 'asc' ? 'up' : 'down'} /></button> : null}</label>;
  const selectFields = content.fields.filter((f) => M.isChoice(f.type));

  const body = view.type === 'kanban' ? <KanbanView c={content} view={view} recs={recs} users={users} ro={ro} onOpen={openRec} onAdd={addAndOpen} onSet={setVal} />
    : view.type === 'gallery' ? <GalleryView c={content} view={view} recs={recs} users={users} ro={ro} onOpen={openRec} onAdd={addAndOpen} onSet={setVal} />
    : view.type === 'calendar' ? <CalendarView c={content} view={view} recs={recs} users={users} ro={ro} onOpen={openRec} onAdd={addAndOpen} onSet={setVal} onGroup={(fid) => patchView(view.id, { group: fid })} />
    : view.type === 'form' ? <FormView c={content} view={view} users={users} ro={ro} title={title} onSubmit={(v) => { addRec(v); toast('已提交，成为一条新记录'); const g = content.views.find((x) => x.type === 'grid'); if (g) setCurId(g.id); }} />
    : <GridView key={content.id + view.id} c={content} view={view} recs={recs} fields={fields} users={users} ro={ro} onSet={setVal} onOpen={openRec} onAdd={addRec} onFieldMenu={openFieldMenu} onAddField={addFieldBtn} />;

  const rec = modal?.kind === 'rec' ? content.records.find((r) => r.id === modal.rid) : undefined;
  const ctx = useMemo(() => ({ book, users, groups, run: runBtn, openChat }), [book, users, groups, runBtn, openChat]);
  // 记录里填的群变了（别人填了我不在的群）：重新取一次群名单，把名字补上
  useEffect(() => {
    const ids = [...new Set(book.tables.flatMap((t) => t.fields.filter((f) => f.type === 'group').flatMap((f) => t.records.flatMap((r) => M.idsOf(r.v[f.id])))))].sort().join(',');
    if (ids === groupIds.current) return;
    const known = new Set(groups.map((g) => g.id)), first = groupIds.current === '';
    groupIds.current = ids;
    if (!first && ids.split(',').some((id) => id && !known.has(id))) loadGroups();
  }, [book, groups, loadGroups]);
  return <BaseCtx.Provider value={ctx}><div className={cx('ed bs', 'theme-' + theme, ro && 'ro')}>
    {/* 数据表页签：只有一张表又是只读时不占地方 */}
    {book.tables.length > 1 || !ro ? <div className="bs-tbar" role="tablist">
      {book.tables.map((t) => <button type="button" key={t.id} role="tab" aria-selected={t.id === content.id} className={cx('bs-tab', t.id === content.id && 'on')} onClick={(e) => { if (t.id !== content.id) switchTable(t.id); else if (!ro) { const r = e.currentTarget.getBoundingClientRect(); setMenu({ kind: 'table', t, at: { x: r.left, y: r.bottom } }); } }} onContextMenu={(e) => { e.preventDefault(); if (!ro) setMenu({ kind: 'table', t, at: { x: e.clientX, y: e.clientY } }); }}>
        <Icon name="base" />{t.name}{t.id === content.id && !ro ? <span className="bs-more" aria-hidden="true"><Icon name="down" /></span> : null}</button>)}
      {ro ? null : <button type="button" className="bs-tab add" onClick={() => setModal({ kind: 'table' })}><Icon name="plus" />{BT.addTable}</button>}
    </div> : null}
    <div className="bs-views" role="tablist">
      {content.views.map((v) => <button type="button" key={v.id} role="tab" aria-selected={v.id === view.id} className={cx('bs-view', v.id === view.id && 'on')} onClick={(e) => { if (v.id === view.id) { const r = e.currentTarget.getBoundingClientRect(); openViewMenu(v, { x: r.left, y: r.bottom }); } else { setCurId(v.id); setFilterOn(M.activeFilters(v).length > 0); } }} onContextMenu={(e) => { e.preventDefault(); openViewMenu(v, { x: e.clientX, y: e.clientY }); }}>
        <Icon name={M.VT[v.type][0]} />{v.name}{v.id === view.id && !ro ? <span className="bs-more" aria-hidden="true"><Icon name="down" /></span> : null}</button>)}
      {ro ? null : <button type="button" className="bs-view add" onClick={() => setModal({ kind: 'view' })}><Icon name="plus" />视图</button>}
    </div>
    <Toolbar right={<><span className="muted bs-count">{recs.length} 条记录</span>{!ro && view.type !== 'form' ? <button type="button" className="btn primary sm" onClick={() => addAndOpen()}><Icon name="plus" />新增记录</button> : null}</>}>
      <TT icon="filter" label="筛选" on={M.activeFilters(view).length > 0} pressed={filterOn} onClick={() => setFilterOn((x) => !x)} />
      {sortSelect}
      {view.type === 'kanban' ? <label className="row nowrap tt" title="分组"><Icon name="group" /><select className="select" aria-label="分组字段" value={M.isChoice(M.fld(content, view.group)?.type) ? view.group : selectFields[0]?.id ?? ''} onChange={(e) => patchView(view.id, { group: e.target.value })}>{selectFields.length ? selectFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>) : <option value="">没有单选字段</option>}</select></label> : null}
      <TT icon="list" label="字段" onClick={() => setModal({ kind: 'fields' })} />
    </Toolbar>
    {filterOn ? <FilterBar key={content.id + view.id} c={content} users={users} filters={view.filters ?? []} onChange={(filters) => patchView(view.id, { filters })} /> : null}
    <div className={cx('ed-body', view.type === 'grid' && 'fill')}>{body}{busy ? <div className="bs-busy"><span className="spin" role="status" /><span>{busy}</span></div> : null}</div>

    {menu?.kind === 'field' ? <Popover at={menu.at} onClose={closeMenu}>
      <div className="dmenu-l">{menu.f.name} · {M.FT[menu.f.type][1]}</div>
      {ro ? null : <><MenuItem icon="pen" label="编辑字段（改名 / 改类型）" onClick={() => { setModal({ kind: 'field', field: menu.f }); closeMenu(); }} />
        <MenuItem icon="plus" label="向左插入字段" onClick={() => { setModal({ kind: 'field', at: content.fields.indexOf(menu.f) }); closeMenu(); }} />
        <MenuItem icon="plus" label="向右插入字段" onClick={() => { setModal({ kind: 'field', at: content.fields.indexOf(menu.f) + 1 }); closeMenu(); }} />
        <div className="dmenu-d" /></>}
      {menu.f.type === 'button' ? null : <><MenuItem icon="up" label="升序" on={view.sort?.fid === menu.f.id && view.sort.dir === 'asc'} onClick={() => { patchView(view.id, { sort: { fid: menu.f.id, dir: 'asc' } }); closeMenu(); }} />
        <MenuItem icon="down" label="降序" on={view.sort?.fid === menu.f.id && view.sort.dir === 'desc'} onClick={() => { patchView(view.id, { sort: { fid: menu.f.id, dir: 'desc' } }); closeMenu(); }} />
        {view.sort?.fid === menu.f.id ? <MenuItem icon="x" label="取消排序" onClick={() => { patchView(view.id, { sort: null }); closeMenu(); }} /> : null}
        <MenuItem icon="filter" label="按这个字段筛选" onClick={() => { const cur = (view.filters ?? []).filter((x) => x.fid); if (!cur.some((x) => x.fid === menu.f.id)) patchView(view.id, { filters: [...cur.filter(M.filterActive), { fid: menu.f.id, op: M.hasOpts(menu.f) ? 'eq' : 'has', val: '' }] }); setFilterOn(true); closeMenu(); }} /></>}
      <MenuItem icon="square" label="隐藏字段" onClick={() => { if (fields.length <= 1) toast('至少显示一个字段'); else hideField(menu.f.id, true); closeMenu(); }} />
      {ro ? null : <><div className="dmenu-d" /><MenuItem icon="trash" label="删除字段" crit onClick={() => { setModal({ kind: 'delField', field: menu.f }); closeMenu(); }} /></>}
    </Popover> : null}
    {menu?.kind === 'view' ? <Popover at={menu.at} onClose={closeMenu}>
      <div className="dmenu-l">{menu.v.name} · {M.VT[menu.v.type][1]}</div>
      <MenuItem icon="pen" label="重命名" onClick={() => { setModal({ kind: 'view', view: menu.v }); closeMenu(); }} />
      <MenuItem icon="trash" label="删除视图" crit onClick={() => { if (content.views.length <= 1) toast('至少保留一个视图'); else setModal({ kind: 'delView', view: menu.v }); closeMenu(); }} />
    </Popover> : null}
    {menu?.kind === 'table' ? <Popover at={menu.at} onClose={closeMenu}>
      <div className="dmenu-l">{menu.t.name}</div>
      <MenuItem icon="pen" label={BT.rename} onClick={() => { setModal({ kind: 'table', table: menu.t }); closeMenu(); }} />
      <MenuItem icon="trash" label={BT.delTable} crit onClick={() => { if (book.tables.length <= 1) toast(BT.keepOneTable); else setModal({ kind: 'delTable', table: menu.t }); closeMenu(); }} />
    </Popover> : null}

    {rec ? <RecordModal c={content} rec={rec} users={users} ro={ro} onSet={setVal} onDelete={delRec} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'field' ? <FieldModal field={modal.field} records={content.records} book={book} tid={content.id} onOk={(spec) => { if (modal.field) editField(modal.field, spec); else addField(spec, modal.at); setModal(null); }} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'fields' ? <FieldsModal c={content} view={view} ro={ro} onHide={hideField} onEdit={(f) => setModal({ kind: 'field', field: f })} onDelete={(f) => { delField(f); }} onAdd={() => setModal({ kind: 'field' })} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'view' ? <ViewModal view={modal.view} onOk={(name, type) => { if (modal.view) patchView(modal.view.id, { name }); else addView(name, type); setModal(null); }} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'delView' ? <Confirm title="删除视图" text={`删除视图「${modal.view.name}」？记录不会受影响。`} ok="删除" danger onOk={() => delView(modal.view)} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'delField' ? <Confirm title="删除字段" text={`删除「${modal.field.name}」会连同所有记录里这一列的值一起删掉，确定？`} ok="删除" danger onOk={() => delField(modal.field)} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'table' ? <TableModal name={modal.table?.name} onOk={(name) => { if (modal.table) renameTable(modal.table.id, name); else addTable(name); setModal(null); }} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'delTable' ? <Confirm title={BT.delTable} text={BT.delTableAsk(modal.table.name)} ok="删除" danger onOk={() => delTable(modal.table.id)} onClose={() => setModal(null)} /> : null}
    {imported ? <ImportResultModal notes={imported} onClose={() => setImported(null)} /> : null}
    <Toaster />
  </div></BaseCtx.Provider>;
}

const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return s; } };
/** 流程被挡住时的说明 */
const blockText = (b: NonNullable<ReturnType<typeof M.stageBlock>>) => (b.why === 'order' ? BT.blockOrder(b.next) : BT.blockNeed(b.stage, b.missing.join('、')));

/**
 * 筛选条：一行一个条件（字段 / 条件 / 值），要同时满足；「添加条件」加一行。
 * 单选、多选字段的值是勾选项（可以勾几个）；别的字段是输入框，停下来 300 毫秒后才应用，避免每敲一个字就重算
 */
function FilterBar({ c, users, filters, onChange }: { c: M.Content; users: M.UserMap; filters: M.Filter[]; onChange: (f: M.Filter[]) => void }) {
  const blank: M.Filter = { fid: '', op: 'has', val: '' };
  const rows = filters.length ? filters : [blank];
  const set = (i: number, next: M.Filter) => onChange(rows.map((r, j) => (j === i ? next : r)));
  return <div className="bs-filter" role="search">
    {rows.map((flt, i) => <FilterRow key={i} c={c} users={users} flt={flt} first={i === 0} onChange={(next) => set(i, next)} onRemove={rows.length > 1 ? () => onChange(rows.filter((_, j) => j !== i)) : undefined} />)}
    <div className="row bs-frow">
      <button type="button" className="btn ghost sm" onClick={() => onChange([...rows, blank])}><Icon name="plus" />{BT.addCond}</button>
      <button type="button" className="btn ghost sm" onClick={() => onChange([])}>{BT.clearFilter}</button>
    </div>
  </div>;
}

function FilterRow({ c, users, flt, first, onChange, onRemove }: { c: M.Content; users: M.UserMap; flt: M.Filter; first: boolean; onChange: (f: M.Filter) => void; onRemove?: () => void }) {
  const [text, setText] = useState(flt.val);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pick, setPick] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { setText(flt.val); }, [flt.fid, flt.val]);
  const f = M.fld(c, flt.fid), opts = M.hasOpts(f), noVal = M.opNoVal(flt.op);
  const chosen = opts ? M.filterVals(flt).filter(Boolean) : [];
  const desc = M.filterDesc(c, flt);
  return <div className="row bs-frow">
    {first ? <Icon name="filter" /> : <span className="bs-and">{BT.and}</span>}
    {/* 换字段时值清掉：上一个字段的选项、文字放到这个字段上没有意义 */}
    <select className="select" aria-label="筛选字段" value={flt.fid} onChange={(e) => { const nf = M.fld(c, e.target.value); onChange({ fid: e.target.value, op: M.hasOpts(nf) && flt.op === 'has' ? 'eq' : flt.op, val: '' }); }}><option value="">选择字段</option>{c.fields.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
    <select className="select" aria-label="筛选条件" value={flt.op} onChange={(e) => onChange({ ...flt, op: e.target.value as M.FilterOp })}>{M.OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    {noVal ? null : opts && f ? <>
      <button type="button" className="input bs-fvals" aria-label={BT.pickOpts} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPick({ x: r.left, y: r.bottom + 2 }); }}>
        {chosen.length ? chosen.map((x) => <span key={x} className={cx('chip', 'c-' + M.optColor(f, x))}>{x}</span>) : <span className="muted">{BT.pickOpts}</span>}</button>
      {pick ? <Picker f={{ ...f, type: 'multi' }} v={chosen} users={users} at={pick} onChange={(v) => { const vals = (Array.isArray(v) ? v : []).map(String); onChange({ fid: flt.fid, op: flt.op, val: vals[0] ?? '', ...(vals.length > 1 ? { vals } : {}) }); }} onClose={() => setPick(null)} /> : null}
    </> : <input className="input" aria-label="筛选值" placeholder="值" value={text} onChange={(e) => { const v = e.target.value; setText(v); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => onChange({ fid: flt.fid, op: flt.op, val: v }), 300); }} onKeyDown={(e) => { if (e.key === 'Enter') { if (timer.current) clearTimeout(timer.current); onChange({ fid: flt.fid, op: flt.op, val: text }); } }} />}
    {desc && !opts ? <span className="chip info">{desc}</span> : null}
    {onRemove ? <button type="button" className="btn ghost sm icon-only" onClick={onRemove} aria-label={BT.delCond} title={BT.delCond}><Icon name="x" /></button> : null}
  </div>;
}

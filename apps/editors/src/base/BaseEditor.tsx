/**
 * 多维表格编辑器：视图页签 → 工具栏 → 筛选条 → 当前视图。
 * 内容整体放在一个 state 里，每次改动产生新对象并 markDirty；视图里的筛选 / 排序 / 隐藏也在内容里，所以切回来还在。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@cai/bridge';
import { useHost, useTheme } from '../shell/session';
import { Confirm, Icon, TT, Toaster, Toolbar, cx, toast } from '../shell/ui';
import { MenuItem, Popover } from './cells';
import { exportXlsx } from './export';
import { GridView } from './GridView';
import { FieldModal, FieldsModal, RecordModal, ViewModal, type FieldSpec } from './modals';
import * as M from './model';
import { CalendarView, FormView, GalleryView, KanbanView } from './views';
import './style.css';

type ModalState = null | { kind: 'rec'; rid: string } | { kind: 'field'; field?: M.Field; at?: number } | { kind: 'fields' } | { kind: 'view'; view?: M.View } | { kind: 'delView'; view: M.View } | { kind: 'delField'; field: M.Field };
type MenuState = null | { kind: 'field'; f: M.Field; at: { x: number; y: number } } | { kind: 'view'; v: M.View; at: { x: number; y: number } };
type Pt = { x: number; y: number };
const stripHtml = (h: string) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent ?? ''; };

export function BaseEditor({ session: s }: { session: Session }) {
  const theme = useTheme();
  const [content, setContent] = useState(() => M.normalize(s.doc.content));
  const ref = useRef(content);
  const [users, setUsers] = useState<M.UserMap>(() => new Map());
  const usersRef = useRef(users);
  const [hostRo, setHostRo] = useState(false);
  const ro = s.readonly || hostRo, roRef = useRef(ro); roRef.current = ro;
  const [curId, setCurId] = useState(content.views[0].id);
  const view = content.views.find((v) => v.id === curId) ?? content.views[0];
  const [title, setTitle] = useState(s.doc.title);
  const [filterOn, setFilterOn] = useState(!!view.filter?.fid);
  const [modal, setModal] = useState<ModalState>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => { s.client.directory().then((r) => { const m = new Map(r.users.map((u) => [u.id, u])); usersRef.current = m; setUsers(m); }).catch(() => { /* 没有通讯录就只显示编号 */ }); }, [s]);

  /** 所有改动都走这里：只读时只改界面不保存 */
  const commit = useCallback((fn: (c: M.Content) => M.Content) => {
    const next = fn(ref.current); ref.current = next; setContent(next);
    if (!roRef.current) s.markDirty(() => ({ content: next, plain: M.plainOf(next, usersRef.current) }));
  }, [s]);
  const patchView = useCallback((id: string, patch: Partial<M.View>) => commit((c) => ({ ...c, views: c.views.map((v) => (v.id === id ? { ...v, ...patch } : v)) })), [commit]);

  /* ---------- 记录 ---------- */
  const setVal = useCallback((rid: string, fid: string, v: unknown) => { if (roRef.current) return; commit((c) => ({ ...c, records: c.records.map((r) => (r.id === rid ? { ...r, v: { ...r.v, [fid]: v } } : r)) })); }, [commit]);
  const addRec = useCallback((preset: Record<string, unknown> = {}) => { const id = M.uid('r'); commit((c) => ({ ...c, records: [...c.records, { id, v: { ...preset } }] })); return id; }, [commit]);
  const delRec = useCallback((rid: string) => commit((c) => ({ ...c, records: c.records.filter((r) => r.id !== rid) })), [commit]);
  const openRec = useCallback((rid: string) => setModal({ kind: 'rec', rid }), []);
  const addAndOpen = (preset?: Record<string, unknown>) => { if (ro) return; openRec(addRec(preset)); };

  /* ---------- 字段 ---------- */
  const addField = (spec: FieldSpec, at?: number) => {
    const f: M.Field = { id: M.uid('f'), name: spec.name, type: spec.type, opts: spec.type === 'select' || spec.type === 'multi' ? spec.opts : undefined };
    commit((c) => { const fields = c.fields.slice(); fields.splice(at ?? fields.length, 0, f); return { ...c, fields }; });
    return f;
  };
  const editField = (f: M.Field, spec: FieldSpec) => commit((c) => {
    const nf: M.Field = { ...f, name: spec.name, type: spec.type, opts: spec.type === 'select' || spec.type === 'multi' ? spec.opts : undefined };
    const records = f.type === spec.type ? c.records : c.records.map((r) => ({ ...r, v: { ...r.v, [f.id]: M.coerce(spec.type, r.v[f.id], usersRef.current) } }));
    return { ...c, fields: c.fields.map((x) => (x.id === f.id ? nf : x)), records };
  });
  const delField = (f: M.Field) => {
    if (ref.current.fields.length <= 1) { toast('至少保留一个字段'); return; }
    commit((c) => ({
      fields: c.fields.filter((x) => x.id !== f.id),
      records: c.records.map((r) => { const v = { ...r.v }; delete v[f.id]; return { ...r, v }; }),
      views: c.views.map((v) => ({ ...v, hidden: v.hidden?.filter((x) => x !== f.id), filter: v.filter?.fid === f.id ? null : v.filter, sort: v.sort?.fid === f.id ? null : v.sort, group: v.group === f.id ? undefined : v.group })),
    }));
  };
  const hideField = (fid: string, hidden: boolean) => patchView(view.id, { hidden: hidden ? [...(view.hidden ?? []), fid] : (view.hidden ?? []).filter((x) => x !== fid) });

  /* ---------- 视图 ---------- */
  const addView = (name: string, type: M.ViewType) => {
    const id = M.uid('v'), c = ref.current;
    const group = type === 'kanban' ? M.firstOf(c, 'select')?.id : type === 'calendar' ? M.firstOf(c, 'date')?.id : undefined;
    commit((x) => ({ ...x, views: [...x.views, { id, name, type, group }] })); setCurId(id);
  };
  const delView = (v: M.View) => { if (ref.current.views.length <= 1) { toast('至少保留一个视图'); return; } commit((c) => ({ ...c, views: c.views.filter((x) => x.id !== v.id) })); if (v.id === view.id) setCurId(ref.current.views[0].id); };

  /* ---------- 当前视图里的数据 ---------- */
  const recs = useMemo(() => M.visibleRecords(content, view, users), [content, view, users]);
  const fields = useMemo(() => M.visibleFields(content, view), [content, view]);

  /* ---------- 宿主消息 ---------- */
  const doExport = async () => {
    try { const blob = await exportXlsx(fields, recs, users, view.name); s.download(blob, `${title || '多维表格'}.xlsx`); toast('已导出 Excel'); }
    catch (e) { toast('导出失败：' + (e instanceof Error ? e.message : String(e))); }
  };
  const applyNlq = (q: string) => {
    const flt = M.nlq(ref.current, q, usersRef.current);
    if (!flt) { toast('没看懂这句话。试试「金额大于 30」「负责人是李娜」「已报价的客户」'); return; }
    // 表单视图没有列表，换到第一个能看记录的视图再筛
    let target = view; if (view.type === 'form') { target = ref.current.views.find((v) => v.type !== 'form') ?? view; setCurId(target.id); }
    patchView(target.id, { filter: flt }); setFilterOn(true);
    toast('已筛选：' + M.filterDesc(ref.current, flt));
  };
  const addFieldsCmd = (args: unknown) => {
    const list = (Array.isArray(args) ? args : [args]).filter((x): x is { name: string; type?: string; opts?: unknown } => !!x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string');
    if (!list.length) { toast('addFields 需要 [{ name, type }] 这样的参数'); return; }
    let n = 0;
    for (const it of list) {
      const type = (Object.keys(M.FT) as M.FieldType[]).includes(it.type as M.FieldType) ? (it.type as M.FieldType) : 'text';
      const opts = Array.isArray(it.opts) ? it.opts.map((o, i) => (Array.isArray(o) ? [String(o[0]), M.COLORS.includes(String(o[1])) ? String(o[1]) : M.COLORS[i % M.COLORS.length]] : [String(o), M.COLORS[i % M.COLORS.length]]) as M.Opt) : undefined;
      addField({ name: it.name.trim() || '新字段', type, opts: type === 'select' || type === 'multi' ? (opts?.length ? opts : [['选项 1', 'blue'], ['选项 2', 'green']]) : undefined }); n++;
    }
    toast(`已添加 ${n} 个字段`);
  };
  useHost((m) => {
    if (m.type === 'readonly') setHostRo(m.value);
    else if (m.type === 'title') setTitle(m.title);
    else if (m.type === 'flush') void s.flush();
    else if (m.type === 'export') { if (m.format === 'xlsx') void doExport(); else toast('多维表格只能导出 Excel'); }
    else if (m.type === 'insert') {
      if (ro) { toast('只读，不能插入'); return; }
      const text = (m.text ?? (m.html ? stripHtml(m.html) : '')).trim(), t = M.firstOf(ref.current, 'text');
      if (!text) return; if (!t) { toast('没有文本字段，插不进去'); return; }
      addRec({ [t.id]: text }); toast('已新增一条记录');
    } else if (m.type === 'command') {
      const a = m.args as { q?: unknown; text?: unknown } | string | undefined;
      if (m.name === 'filter') applyNlq(typeof a === 'string' ? a : String(a?.q ?? a?.text ?? ''));
      else if (m.name === 'summary') s.send({ type: 'selection', text: M.summarize(ref.current, recs, usersRef.current, view.name) });
      else if (m.name === 'addFields') { if (ro) toast('只读，不能添加字段'); else addFieldsCmd(typeof a === 'string' ? safeJson(a) : a); }
      else toast('不认识的命令：' + m.name);
    }
  });

  /* ---------- 界面 ---------- */
  const openFieldMenu = useCallback((f: M.Field, at: Pt) => setMenu({ kind: 'field', f, at }), []);
  const openViewMenu = (v: M.View, at: Pt) => { if (!ro) setMenu({ kind: 'view', v, at }); };
  const addFieldBtn = useCallback(() => setModal({ kind: 'field' }), []);
  const sortSelect = <label className="row nowrap tt" title="排序"><Icon name="sort" /><select className="select" aria-label="排序字段" value={view.sort?.fid ?? ''} onChange={(e) => patchView(view.id, { sort: e.target.value ? { fid: e.target.value, dir: view.sort?.dir ?? 'asc' } : null })}><option value="">排序</option>{content.fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
    {view.sort ? <button type="button" className="bs-sortdir tt" title={view.sort.dir === 'asc' ? '升序，点击改为降序' : '降序，点击改为升序'} onClick={() => patchView(view.id, { sort: { fid: view.sort!.fid, dir: view.sort!.dir === 'asc' ? 'desc' : 'asc' } })}><Icon name={view.sort.dir === 'asc' ? 'up' : 'down'} /></button> : null}</label>;
  const selectFields = content.fields.filter((f) => f.type === 'select');

  const body = view.type === 'kanban' ? <KanbanView c={content} view={view} recs={recs} users={users} ro={ro} onOpen={openRec} onAdd={addAndOpen} onSet={setVal} />
    : view.type === 'gallery' ? <GalleryView c={content} view={view} recs={recs} users={users} ro={ro} onOpen={openRec} onAdd={addAndOpen} onSet={setVal} />
    : view.type === 'calendar' ? <CalendarView c={content} view={view} recs={recs} users={users} ro={ro} onOpen={openRec} onAdd={addAndOpen} onSet={setVal} onGroup={(fid) => patchView(view.id, { group: fid })} />
    : view.type === 'form' ? <FormView c={content} view={view} users={users} ro={ro} title={title} onSubmit={(v) => { addRec(v); toast('已提交，成为一条新记录'); const g = content.views.find((x) => x.type === 'grid'); if (g) setCurId(g.id); }} />
    : <GridView key={view.id} c={content} view={view} recs={recs} fields={fields} users={users} ro={ro} onSet={setVal} onOpen={openRec} onAdd={addRec} onFieldMenu={openFieldMenu} onAddField={addFieldBtn} />;

  const rec = modal?.kind === 'rec' ? content.records.find((r) => r.id === modal.rid) : undefined;
  return <div className={cx('ed bs', 'theme-' + theme, ro && 'ro')}>
    <div className="bs-views" role="tablist">
      {content.views.map((v) => <button type="button" key={v.id} role="tab" aria-selected={v.id === view.id} className={cx('bs-view', v.id === view.id && 'on')} onClick={(e) => { if (v.id === view.id) { const r = e.currentTarget.getBoundingClientRect(); openViewMenu(v, { x: r.left, y: r.bottom }); } else setCurId(v.id); }} onContextMenu={(e) => { e.preventDefault(); openViewMenu(v, { x: e.clientX, y: e.clientY }); }}>
        <Icon name={M.VT[v.type][0]} />{v.name}{v.id === view.id && !ro ? <span className="bs-more" aria-hidden="true"><Icon name="down" /></span> : null}</button>)}
      {ro ? null : <button type="button" className="bs-view add" onClick={() => setModal({ kind: 'view' })}><Icon name="plus" />视图</button>}
    </div>
    <Toolbar right={<><span className="muted bs-count">{recs.length} 条记录</span>{!ro && view.type !== 'form' ? <button type="button" className="btn primary sm" onClick={() => addAndOpen()}><Icon name="plus" />新增记录</button> : null}</>}>
      <TT icon="filter" label="筛选" on={!!(view.filter?.fid && view.filter.val !== '')} pressed={filterOn} onClick={() => setFilterOn((x) => !x)} />
      {sortSelect}
      {view.type === 'kanban' ? <label className="row nowrap tt" title="分组"><Icon name="group" /><select className="select" aria-label="分组字段" value={M.fld(content, view.group)?.type === 'select' ? view.group : selectFields[0]?.id ?? ''} onChange={(e) => patchView(view.id, { group: e.target.value })}>{selectFields.length ? selectFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>) : <option value="">没有单选字段</option>}</select></label> : null}
      <TT icon="list" label="字段" onClick={() => setModal({ kind: 'fields' })} />
    </Toolbar>
    {filterOn ? <FilterBar c={content} filter={view.filter ?? null} onChange={(flt) => patchView(view.id, { filter: flt })} /> : null}
    <div className={cx('ed-body', view.type === 'grid' && 'fill')}>{body}</div>

    {menu?.kind === 'field' ? <Popover at={menu.at} onClose={closeMenu}>
      <div className="dmenu-l">{menu.f.name} · {M.FT[menu.f.type][1]}</div>
      {ro ? null : <><MenuItem icon="pen" label="编辑字段（改名 / 改类型）" onClick={() => { setModal({ kind: 'field', field: menu.f }); closeMenu(); }} />
        <MenuItem icon="plus" label="向左插入字段" onClick={() => { setModal({ kind: 'field', at: content.fields.indexOf(menu.f) }); closeMenu(); }} />
        <MenuItem icon="plus" label="向右插入字段" onClick={() => { setModal({ kind: 'field', at: content.fields.indexOf(menu.f) + 1 }); closeMenu(); }} />
        <div className="dmenu-d" /></>}
      <MenuItem icon="up" label="升序" on={view.sort?.fid === menu.f.id && view.sort.dir === 'asc'} onClick={() => { patchView(view.id, { sort: { fid: menu.f.id, dir: 'asc' } }); closeMenu(); }} />
      <MenuItem icon="down" label="降序" on={view.sort?.fid === menu.f.id && view.sort.dir === 'desc'} onClick={() => { patchView(view.id, { sort: { fid: menu.f.id, dir: 'desc' } }); closeMenu(); }} />
      {view.sort?.fid === menu.f.id ? <MenuItem icon="x" label="取消排序" onClick={() => { patchView(view.id, { sort: null }); closeMenu(); }} /> : null}
      <MenuItem icon="filter" label="按这个字段筛选" onClick={() => { patchView(view.id, { filter: { fid: menu.f.id, op: view.filter?.fid === menu.f.id ? view.filter.op : 'has', val: view.filter?.fid === menu.f.id ? view.filter.val : '' } }); setFilterOn(true); closeMenu(); }} />
      <MenuItem icon="square" label="隐藏字段" onClick={() => { if (fields.length <= 1) toast('至少显示一个字段'); else hideField(menu.f.id, true); closeMenu(); }} />
      {ro ? null : <><div className="dmenu-d" /><MenuItem icon="trash" label="删除字段" crit onClick={() => { setModal({ kind: 'delField', field: menu.f }); closeMenu(); }} /></>}
    </Popover> : null}
    {menu?.kind === 'view' ? <Popover at={menu.at} onClose={closeMenu}>
      <div className="dmenu-l">{menu.v.name} · {M.VT[menu.v.type][1]}</div>
      <MenuItem icon="pen" label="重命名" onClick={() => { setModal({ kind: 'view', view: menu.v }); closeMenu(); }} />
      <MenuItem icon="trash" label="删除视图" crit onClick={() => { if (content.views.length <= 1) toast('至少保留一个视图'); else setModal({ kind: 'delView', view: menu.v }); closeMenu(); }} />
    </Popover> : null}

    {rec ? <RecordModal c={content} rec={rec} users={users} ro={ro} onSet={setVal} onDelete={delRec} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'field' ? <FieldModal field={modal.field} records={content.records} onOk={(spec) => { if (modal.field) editField(modal.field, spec); else addField(spec, modal.at); setModal(null); }} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'fields' ? <FieldsModal c={content} view={view} ro={ro} onHide={hideField} onEdit={(f) => setModal({ kind: 'field', field: f })} onDelete={(f) => { delField(f); }} onAdd={() => setModal({ kind: 'field' })} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'view' ? <ViewModal view={modal.view} onOk={(name, type) => { if (modal.view) patchView(modal.view.id, { name }); else addView(name, type); setModal(null); }} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'delView' ? <Confirm title="删除视图" text={`删除视图「${modal.view.name}」？记录不会受影响。`} ok="删除" danger onOk={() => delView(modal.view)} onClose={() => setModal(null)} /> : null}
    {modal?.kind === 'delField' ? <Confirm title="删除字段" text={`删除「${modal.field.name}」会连同所有记录里这一列的值一起删掉，确定？`} ok="删除" danger onOk={() => delField(modal.field)} onClose={() => setModal(null)} /> : null}
    <Toaster />
  </div>;
}

const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return s; } };

/** 筛选条：字段 / 条件 / 值。值输入停下来 300 毫秒后才应用，避免每敲一个字就重算 */
function FilterBar({ c, filter, onChange }: { c: M.Content; filter: M.Filter | null; onChange: (f: M.Filter | null) => void }) {
  const [val, setVal] = useState(filter?.val ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setVal(filter?.val ?? ''); }, [filter?.fid, filter?.val]);
  const fid = filter?.fid ?? '', op = filter?.op ?? 'has';
  const emit = (patch: Partial<M.Filter>) => { const next = { fid, op, val, ...patch }; onChange(next.fid ? next : null); };
  const desc = M.filterDesc(c, filter);
  return <div className="bs-filter" role="search">
    <Icon name="filter" />
    <select className="select" aria-label="筛选字段" value={fid} onChange={(e) => emit({ fid: e.target.value })}><option value="">选择字段</option>{c.fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
    <select className="select" aria-label="筛选条件" value={op} onChange={(e) => emit({ op: e.target.value as M.FilterOp })}>{M.OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    <input className="input" aria-label="筛选值" placeholder="值" value={val} onChange={(e) => { const v = e.target.value; setVal(v); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => emit({ val: v }), 300); }} onKeyDown={(e) => { if (e.key === 'Enter') { if (timer.current) clearTimeout(timer.current); emit({ val }); } }} />
    {desc ? <span className="chip info">{desc}</span> : null}
    <button type="button" className="btn ghost sm" onClick={() => { setVal(''); onChange(null); }}>清除</button>
  </div>;
}

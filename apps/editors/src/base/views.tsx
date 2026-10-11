/** 看板、画廊、日历、表单四种视图。它们都从 BaseEditor 拿到已经筛选排序好的记录 */
import { useState } from 'react';
import { Icon, cx } from '../shell/ui';
import { CellView, FieldInput } from './cells';
import { FT, fld, firstOf, optColor, titleOf, today, visibleFields, type Content, type Field, type Rec, type UserMap, type View } from './model';

interface ViewProps { c: Content; view: View; recs: Rec[]; users: UserMap; ro: boolean; onOpen: (rid: string) => void; onAdd: (preset?: Record<string, unknown>) => void; onSet: (rid: string, fid: string, v: unknown) => void }

/* ---------- 看板 ---------- */
export function KanbanView({ c, view, recs, users, ro, onOpen, onAdd, onSet }: ViewProps) {
  const g = (() => { const f = fld(c, view.group); return f?.type === 'select' ? f : firstOf(c, 'select'); })();
  const [over, setOver] = useState<string | null>(null);
  if (!g) return <div className="note bs-note">看板需要一个单选字段来分组，先在「字段」里添加。</div>;
  const cols = (g.opts ?? []).map((o) => o[0]).concat(['未分类']);
  const sub = visibleFields(c, view).filter((f) => f.id !== g.id && f.type !== 'text').slice(0, 2);
  const drop = (col: string, e: React.DragEvent) => { e.preventDefault(); setOver(null); const rid = e.dataTransfer.getData('text/cai-rec'); if (rid) onSet(rid, g.id, col === '未分类' ? '' : col); };
  return <div className="bs-kb">{cols.map((col) => {
    const rs = recs.filter((r) => { const v = r.v[g.id]; return (v == null || v === '' ? '未分类' : String(v)) === col; });
    return <div key={col} className={cx('bs-col', over === col && 'over')} onDragOver={ro ? undefined : (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== col) setOver(col); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }} onDrop={ro ? undefined : (e) => drop(col, e)}>
      <div className="bs-colh"><span className={cx('chip', 'c-' + (col === '未分类' ? 'gray' : optColor(g, col)))}>{col}</span><i>{rs.length}</i></div>
      {rs.map((r) => <button type="button" key={r.id} className="bs-card" draggable={!ro} onDragStart={(e) => { e.dataTransfer.setData('text/cai-rec', r.id); e.dataTransfer.effectAllowed = 'move'; }} onClick={() => onOpen(r.id)}>
        <b>{titleOf(c, r)}</b>{sub.map((f) => <span key={f.id}><CellView f={f} v={r.v[f.id]} users={users} /></span>)}
      </button>)}
      {!ro && col !== '未分类' ? <button type="button" className="btn ghost sm" onClick={() => onAdd({ [g.id]: col })}><Icon name="plus" />新增</button> : null}
    </div>; })}</div>;
}

/* ---------- 画廊 ---------- */
export function GalleryView({ c, view, recs, users, ro, onOpen, onAdd }: ViewProps) {
  const t = firstOf(c, 'text'), s = firstOf(c, 'select');
  const extra = visibleFields(c, view).filter((f) => f !== t).slice(0, 3);
  return <div className="bs-gal">
    {recs.map((r) => <button type="button" key={r.id} className="bs-gcard" onClick={() => onOpen(r.id)}>
      <div className={cx('bs-gcover', 'c-' + (s ? optColor(s, r.v[s.id]) : 'blue'))}><Icon name="image" /></div>
      <b>{titleOf(c, r)}</b>
      {extra.map((f) => <span key={f.id} className="row nowrap"><i className="muted">{f.name}</i><CellView f={f} v={r.v[f.id]} users={users} /></span>)}
    </button>)}
    {ro ? null : <button type="button" className="bs-gcard add" onClick={() => onAdd()}><Icon name="plus" />新增记录</button>}
    {!recs.length && ro ? <div className="bs-empty">没有记录</div> : null}
  </div>;
}

/* ---------- 日历 ---------- */
export function CalendarView({ c, view, recs, ro, onOpen, onAdd, onGroup }: ViewProps & { onGroup: (fid: string) => void }) {
  const dateFields = c.fields.filter((f) => f.type === 'date');
  const df = (() => { const f = fld(c, view.group); return f?.type === 'date' ? f : dateFields[0]; })();
  const td = today();
  const [ym, setYm] = useState(() => ({ y: Number(td.slice(0, 4)), m: Number(td.slice(5, 7)) }));
  if (!df) return <div className="note bs-note">日历视图需要一个日期字段，先在「字段」里添加。</div>;
  const key = `${ym.y}-${String(ym.m).padStart(2, '0')}`;
  const first = (new Date(ym.y, ym.m - 1, 1).getDay() + 6) % 7, days = new Date(ym.y, ym.m, 0).getDate();
  const byDay = new Map<number, Rec[]>();
  for (const r of recs) { const v = String(r.v[df.id] ?? ''); if (v.startsWith(key)) { const d = Number(v.slice(8, 10)); byDay.set(d, [...(byDay.get(d) ?? []), r]); } }
  const move = (n: number) => setYm(({ y, m }) => { const d = new Date(y, m - 1 + n, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < first; i++) cells.push(<div key={'o' + i} className="bs-day off" />);
  for (let d = 1; d <= days; d++) { const ds = `${key}-${String(d).padStart(2, '0')}`; cells.push(<div key={d} className={cx('bs-day', ds === td && 'today')} onDoubleClick={ro ? undefined : () => onAdd({ [df.id]: ds })} title={ro ? undefined : '双击新增这天的记录'}>
    <i>{d}</i>{(byDay.get(d) ?? []).map((r) => <button type="button" key={r.id} className="bs-ev" onClick={() => onOpen(r.id)}>{titleOf(c, r)}</button>)}
  </div>); }
  return <div className="bs-cal">
    <div className="bs-calh"><button type="button" className="btn ghost sm icon-only" onClick={() => move(-1)} aria-label="上个月"><Icon name="left" /></button><b>{ym.y} 年 {ym.m} 月</b><button type="button" className="btn ghost sm icon-only bs-next" onClick={() => move(1)} aria-label="下个月"><Icon name="chevron" /></button>
      <button type="button" className="btn ghost sm" onClick={() => setYm({ y: Number(td.slice(0, 4)), m: Number(td.slice(5, 7)) })}>今天</button>
      {dateFields.length > 1 ? <label className="row nowrap muted">按<select className="select" value={df.id} onChange={(e) => onGroup(e.target.value)}>{dateFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>排列</label> : <span className="muted">按「{df.name}」排列</span>}
    </div>
    <div className="bs-week">{['一', '二', '三', '四', '五', '六', '日'].map((w) => <span key={w}>{w}</span>)}</div>
    <div className="bs-month">{cells}</div>
  </div>;
}

/* ---------- 表单 ---------- */
export function FormView({ c, view, users, ro, title, onSubmit }: { c: Content; view: View; users: UserMap; ro: boolean; title: string; onSubmit: (v: Record<string, unknown>) => void }) {
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const fields = visibleFields(c, view);
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (ro) return; onSubmit(vals); setVals({}); };
  return <form className="bs-form" onSubmit={submit}>
    <h2>{title}</h2>
    <p className="muted">提交后会成为一条新记录；表单链接可以发给公司里的任何人。</p>
    {ro ? <div className="note warn">只读模式下不能提交。</div> : null}
    {fields.map((f) => <div className="field" key={f.id}><label className="field-l" htmlFor={'bf-' + f.id}><Icon name={FT[f.type][0]} /> {f.name}</label><FieldInput id={'bf-' + f.id} f={f} v={vals[f.id]} users={users} disabled={ro} onChange={(v) => setVals((o) => ({ ...o, [f.id]: v }))} /></div>)}
    <div><button type="submit" className="btn primary" disabled={ro}>提交</button></div>
  </form>;
}

/** 字段名前面的类型图标 + 名称，表单和弹窗共用 */
export const fieldLabel = (f: Field) => <><Icon name={FT[f.type][0]} /> {f.name}</>;

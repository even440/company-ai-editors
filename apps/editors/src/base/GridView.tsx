/**
 * 表格视图：@tanstack/react-table 9 负责列模型（表头、按行取格子），格子直接可编辑，行按滚动位置只画看得见的那一段（几千行也不卡）。
 * 筛选 / 排序 / 隐藏字段不交给 react-table，而是在 model.ts 里按视图算好再喂进来，这样五种视图共用同一套逻辑。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { constructTable, createColumnHelper, tableFeatures, type Table } from '@tanstack/react-table';
import { Icon, cx } from '../shell/ui';
import { CellView, Picker } from './cells';
import { FT, type Content, type Field, type Rec, type UserMap, type View } from './model';

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, Rec>();

/**
 * 给 constructTable 用的最简反应式绑定。react-table 自带的 useTable 用 @tanstack/react-store 的 atom 并依赖 React hook，
 * 而这个仓库的根目录被提升了一份 React 18（@radix-ui 的 peer），react-table 拿到的是那一份，hook 会报「Invalid hook call」。
 * 这里的表格实例随列和数据重建、从不改状态，所以只需要：可写 atom 存值，只读 atom 算一次缓存起来，任何可写 atom 一变就全部作废。
 * 等 vite 配了 resolve.dedupe（或根目录的 React 和 apps/editors 一致）以后，可以换回 useTable。
 */
type Bindings = Table<typeof features, Rec>['_reactivity'];
function staticBindings(): Bindings {
  let epoch = 0;
  const noSub = () => ({ unsubscribe() { /* 没有订阅者 */ } });
  const b = {
    createOptionsStore: false, wrapExternalAtoms: false,
    addSubscription() { /* 不接外部 atom */ }, batch: (fn: () => void) => fn(), schedule: (fn: () => void) => queueMicrotask(fn), untrack: <T,>(fn: () => T) => fn(),
    createWritableAtom: <T,>(value: T) => { let v = value; return { get: () => v, set: (u: T | ((p: T) => T)) => { v = typeof u === 'function' ? (u as (p: T) => T)(v) : u; epoch++; }, subscribe: noSub }; },
    createReadonlyAtom: <T,>(fn: () => T) => { let at = -1, v: T; return { get: () => { if (at !== epoch) { v = fn(); at = epoch; } return v; }, subscribe: noSub }; },
  };
  return b as unknown as Bindings;
}
/** 每种字段的列宽 */
const WIDTH: Record<Field['type'], number> = { text: 190, select: 130, multi: 200, user: 140, date: 130, number: 120, check: 90, url: 220 };
const RH = 36, OVERSCAN = 12;

export interface GridProps {
  c: Content; view: View; recs: Rec[]; fields: Field[]; users: UserMap; ro: boolean;
  onSet: (rid: string, fid: string, v: unknown) => void;
  onOpen: (rid: string) => void;
  /** 新增一条记录，返回编号 */
  onAdd: () => string;
  onFieldMenu: (f: Field, at: { x: number; y: number }) => void;
  onAddField: () => void;
}

export function GridView({ c, view, recs, fields, users, ro, onSet, onOpen, onAdd, onFieldMenu, onAddField }: GridProps) {
  const columns = useMemo(() => helper.columns(fields.map((f) => helper.accessor((r: Rec) => r.v[f.id], { id: f.id, header: f.name }))), [fields]);
  // 只用 react-table 的列模型（列定义、表头分组、按行取格子），实例随列和数据重建；为什么不用 useTable 见 staticBindings 的注释
  const table = useMemo(() => constructTable({ features: { ...features, coreReactivityFeature: staticBindings() }, columns, data: recs, getRowId: (r) => r.id }), [columns, recs]);
  const byId = useMemo(() => new Map(c.fields.map((f) => [f.id, f])), [c.fields]);
  const [edit, setEdit] = useState<{ rid: string; fid: string } | null>(null);
  const [pick, setPick] = useState<{ rid: string; fid: string; at: { x: number; y: number } } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0), [vh, setVh] = useState(600);
  const pendingBottom = useRef(false);

  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setVh(el.clientHeight)); ro.observe(el); setVh(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const onScroll = useCallback(() => { const el = wrap.current; if (el) setScrollTop(el.scrollTop); }, []);
  useEffect(() => { if (pendingBottom.current && wrap.current) { pendingBottom.current = false; wrap.current.scrollTop = wrap.current.scrollHeight; } });
  // 只读、或者字段被删掉 / 换了类型时收起编辑状态
  useEffect(() => { if (ro) { setEdit(null); setPick(null); } }, [ro]);

  const rows = table.getRowModel().rows;
  const start = Math.max(0, Math.floor(scrollTop / RH) - OVERSCAN), end = Math.min(rows.length, Math.ceil((scrollTop + vh) / RH) + OVERSCAN);
  // 行号列按位数加宽，几千行时 4 位数字也放得下
  const nw = Math.max(44, 18 + String(rows.length).length * 8);
  const total = fields.reduce((s, f) => s + WIDTH[f.type], 0) + nw + 44;
  const cols = fields.length + 2;

  const commitText = (rid: string, f: Field, raw: string) => { onSet(rid, f.id, f.type === 'number' ? (raw.trim() === '' ? '' : Number(raw)) : raw); setEdit(null); };
  const clickCell = (e: React.MouseEvent<HTMLTableCellElement>, rid: string, f: Field, v: unknown) => {
    if (ro) return;
    if (f.type === 'check') { onSet(rid, f.id, !v); return; }
    const r = e.currentTarget.getBoundingClientRect();
    if (f.type === 'select' || f.type === 'multi' || f.type === 'user') { setEdit(null); setPick({ rid, fid: f.id, at: { x: r.left, y: r.bottom + 2 } }); return; }
    setPick(null); setEdit({ rid, fid: f.id });
  };
  const addRow = () => { const id = onAdd(); const f = fields.find((x) => x.type === 'text') ?? fields[0]; pendingBottom.current = true; if (f && (f.type === 'text' || f.type === 'number' || f.type === 'url' || f.type === 'date')) setEdit({ rid: id, fid: f.id }); };
  const pickField = pick ? byId.get(pick.fid) : undefined, pickRec = pick ? recs.find((r) => r.id === pick.rid) : undefined;
  const closePick = useCallback(() => setPick(null), []);

  return <div ref={wrap} className="bs-wrap" onScroll={onScroll}>
    <table className={cx('bs-grid', !ro && 'editable')} style={{ width: total }}>
      <colgroup><col style={{ width: nw }} />{fields.map((f) => <col key={f.id} style={{ width: WIDTH[f.type] }} />)}<col /></colgroup>
      <thead>{table.getHeaderGroups().map((g) => <tr key={g.id}><th className="bs-n">#</th>
        {g.headers.map((h) => { const f = byId.get(h.column.id)!; const s = view.sort?.fid === f.id ? view.sort.dir : null; return <th key={h.id} title={`${f.name}（${FT[f.type][1]}）`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onFieldMenu(f, { x: r.left, y: r.bottom + 2 }); }} onContextMenu={(e) => { e.preventDefault(); onFieldMenu(f, { x: e.clientX, y: e.clientY }); }}>
          <span className="bs-th"><Icon name={FT[f.type][0]} /><b>{h.isPlaceholder ? null : String(h.column.columnDef.header ?? f.name)}</b>{s ? <Icon className="bs-sort" name={s === 'asc' ? 'up' : 'down'} /> : null}</span></th>; })}
        <th className="bs-addf">{ro ? null : <button type="button" className="btn ghost sm icon-only" onClick={onAddField} aria-label="添加字段" title="添加字段"><Icon name="plus" /></button>}</th></tr>)}</thead>
      <tbody>
        {start > 0 ? <tr aria-hidden="true"><td colSpan={cols} style={{ height: start * RH, padding: 0, border: 0 }} /></tr> : null}
        {rows.slice(start, end).map((row, i) => <tr key={row.id} className="bs-row">
          <td className="bs-n click" title="打开记录" onClick={() => onOpen(row.id)}>{start + i + 1}</td>
          {row.getAllCells().map((cell) => { const f = byId.get(cell.column.id)!, v = cell.getValue(); const editing = edit && edit.rid === row.id && edit.fid === f.id;
            return <td key={cell.id} className={cx('bs-cell', f.type === 'number' && 'num', editing && 'editing')} onClick={(e) => clickCell(e, row.id, f, v)}>
              {editing ? <input className="bs-cellin" autoFocus type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} step="any" defaultValue={v == null ? '' : String(v)}
                onBlur={(e) => commitText(row.id, f, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitText(row.id, f, e.currentTarget.value); } else if (e.key === 'Escape') { e.preventDefault(); setEdit(null); } }} /> : <CellView f={f} v={v} users={users} />}
            </td>; })}
          <td />
        </tr>)}
        {end < rows.length ? <tr aria-hidden="true"><td colSpan={cols} style={{ height: (rows.length - end) * RH, padding: 0, border: 0 }} /></tr> : null}
        {ro ? null : <tr className="bs-addrow"><td colSpan={cols}><button type="button" className="btn ghost sm" onClick={addRow}><Icon name="plus" />新增记录</button></td></tr>}
        {!rows.length && ro ? <tr><td colSpan={cols} className="bs-empty">没有记录</td></tr> : null}
      </tbody>
    </table>
    {pick && pickField && pickRec ? <Picker f={pickField} v={pickRec.v[pickField.id]} users={users} at={pick.at} onChange={(v) => onSet(pick.rid, pick.fid, v)} onClose={closePick} /> : null}
  </div>;
}

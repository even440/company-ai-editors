/** 弹窗：记录、字段（新建 / 编辑）、字段列表、视图（新建 / 重命名） */
import { useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Confirm, Field as FieldRow, Icon, Modal, Select, Toggle, cx, toast } from '../shell/ui';
import { FieldInput } from './cells';
import { COLORS, FT, VT, isHidden, optsFrom, type Content, type Field, type FieldType, type Opt, type Rec, type UserMap, type View, type ViewType } from './model';

/* ---------- 记录 ---------- */
export function RecordModal({ c, rec, users, ro, onSet, onDelete, onClose }: { c: Content; rec: Rec; users: UserMap; ro: boolean; onSet: (rid: string, fid: string, v: unknown) => void; onDelete: (rid: string) => void; onClose: () => void }) {
  const [ask, setAsk] = useState(false);
  return <>
    <Modal title="记录" onClose={onClose} footer={<>{ro ? null : <button type="button" className="btn ghost" onClick={() => setAsk(true)}><Icon name="trash" />删除</button>}<span className="spacer" /><button type="button" className="btn primary" onClick={onClose}>完成</button></>}>
      <div className="bs-rec">{c.fields.map((f) => <FieldRow key={f.id} label={<><Icon name={FT[f.type][0]} /> {f.name}</>} htmlFor={'br-' + f.id}><FieldInput id={'br-' + f.id} f={f} v={rec.v[f.id]} users={users} disabled={ro} onChange={(v) => onSet(rec.id, f.id, v)} /></FieldRow>)}</div>
    </Modal>
    {ask ? <Confirm title="删除记录" text="删除后不能恢复，确定删除这条记录？" ok="删除" danger onOk={() => { onDelete(rec.id); onClose(); }} onClose={() => setAsk(false)} /> : null}
  </>;
}

/* ---------- 字段 ---------- */
export interface FieldSpec { name: string; type: FieldType; opts?: Opt[] }
const TYPE_OPTS = (Object.keys(FT) as FieldType[]).map((k): [string, string] => [k, FT[k][1]]);

/** 选项编辑器的一行：key 只给界面认行，颜色是这个选项的（已有的照旧，新加的接着配色） */
interface OptRow { key: number; name: string; color: string }
let optSeq = 0;
const optRow = (name: string, color: string): OptRow => ({ key: ++optSeq, name, color });

/**
 * 单选、多选的选项：一行一个（用户 2026-10-29 转来同事反馈：逗号分隔不好用，要按回车添加一行、或者底下有「+」按钮）。
 * 回车在下面加一行，空行按退格删掉回到上一行；粘贴一串用逗号或换行隔开的，拆成几行
 */
function OptsEditor({ rows, onChange }: { rows: OptRow[]; onChange: (rows: OptRow[]) => void }) {
  const refs = useRef(new Map<number, HTMLInputElement>()), [focus, setFocus] = useState<number | null>(null);
  // 新加的一行（删掉一行后的上一行）画出来马上把光标放进去、放在最后：用 useLayoutEffect，接着打的字不会落到别处或被选中替掉
  useLayoutEffect(() => { if (focus === null) return; const el = refs.current.get(focus); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } setFocus(null); }, [focus, rows]);
  const nextColor = (list: OptRow[]) => COLORS[list.length % COLORS.length];
  const insert = (at: number, names: string[]) => {
    const list = [...rows], add: OptRow[] = [];
    for (const n of names) add.push(optRow(n, nextColor([...list, ...add])));
    list.splice(at, 0, ...add);
    onChange(list);
    setFocus(add[add.length - 1].key);
  };
  const set = (key: number, name: string) => onChange(rows.map((r) => (r.key === key ? { ...r, name } : r)));
  const remove = (i: number) => { const list = rows.filter((_, j) => j !== i); onChange(list.length ? list : [optRow('', COLORS[0])]); setFocus((list[Math.max(0, i - 1)] ?? null)?.key ?? null); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); if (rows[i].name.trim()) insert(i + 1, ['']); return; }
    if (e.key === 'Backspace' && !rows[i].name && rows.length > 1) { e.preventDefault(); remove(i); }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, i: number) => {
    const parts = e.clipboardData.getData('text/plain').split(/[,，、\n]/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) return;
    e.preventDefault();
    const [first, ...rest] = parts, cur = rows[i].name.trim();
    if (cur) { insert(i + 1, parts); return; }
    const list = rows.map((r, j) => (j === i ? { ...r, name: first } : r)), add: OptRow[] = [];
    for (const n of rest) add.push(optRow(n, nextColor([...list, ...add])));
    list.splice(i + 1, 0, ...add);
    onChange(list);
    setFocus(add[add.length - 1].key);
  };
  return <div className="bs-opts">
    {rows.map((r, i) => <div key={r.key} className="row nowrap bs-opt">
      <span className={cx('bs-optdot', 'c-' + r.color)} aria-hidden="true" />
      <input id={i === 0 ? 'bf-opts' : undefined} ref={(el) => { if (el) refs.current.set(r.key, el); else refs.current.delete(r.key); }} className="input" value={r.name} placeholder={i === 0 ? '例如：待跟进' : '选项名称'} aria-label={`选项 ${i + 1}`} onChange={(e) => set(r.key, e.target.value)} onKeyDown={(e) => onKey(e, i)} onPaste={(e) => onPaste(e, i)} />
      <button type="button" className="btn ghost sm icon-only" onClick={() => remove(i)} aria-label={`删除选项 ${r.name || i + 1}`} title="删除选项"><Icon name="x" /></button>
    </div>)}
    <button type="button" className="btn ghost sm bs-opt-add" onClick={() => insert(rows.length, [''])}><Icon name="plus" />添加选项</button>
  </div>;
}

export function FieldModal({ field, records, onOk, onClose }: { field?: Field; records: Rec[]; onOk: (spec: FieldSpec) => void; onClose: () => void }) {
  const [name, setName] = useState(field?.name ?? '');
  const [type, setType] = useState<FieldType>(field?.type ?? 'text');
  const [opts, setOpts] = useState<OptRow[]>(() => (field?.opts?.length ? field.opts.map((o) => optRow(o[0], o[1])) : [optRow('', COLORS[0])]));
  const hasOpts = type === 'select' || type === 'multi';
  const ok = () => {
    const n = name.trim(); if (!n) { toast('先填字段名'); return; }
    let list: Opt[] | undefined;
    if (hasOpts) {
      // 一样的名字只留第一个；什么都没填就从已有的值里收集
      const seen = new Set<string>(), filled: Opt[] = [];
      for (const r of opts) { const v = r.name.trim(); if (v && !seen.has(v)) { seen.add(v); filled.push([v, r.color]); } }
      list = filled.length ? filled : field ? optsFrom(records, field.id) : [['选项 1', 'blue'], ['选项 2', 'green']];
    }
    onOk({ name: n, type, opts: list });
  };
  return <Modal title={field ? '编辑字段' : '添加字段'} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn primary" onClick={ok}>{field ? '保存' : '添加'}</button></>}>
    <FieldRow label="字段名" htmlFor="bf-name"><input id="bf-name" className="input" value={name} autoFocus placeholder="例如：跟进状态" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }} /></FieldRow>
    <FieldRow label="类型" htmlFor="bf-type" hint={field && field.type !== type ? '改类型后，已有的值会尽量转换，转不了的会清空。' : undefined}><Select id="bf-type" value={type} onChange={(v) => setType(v as FieldType)} options={TYPE_OPTS} /></FieldRow>
    {hasOpts ? <FieldRow label="选项" htmlFor="bf-opts" hint={field?.type === type ? '按回车添加下一个' : '按回车添加下一个；都不填就从已有的值里自动收集'}><OptsEditor rows={opts} onChange={setOpts} /></FieldRow> : null}
  </Modal>;
}

export function FieldsModal({ c, view, ro, onHide, onEdit, onDelete, onAdd, onClose }: { c: Content; view: View; ro: boolean; onHide: (fid: string, hidden: boolean) => void; onEdit: (f: Field) => void; onDelete: (f: Field) => void; onAdd: () => void; onClose: () => void }) {
  const [del, setDel] = useState<Field | null>(null);
  return <>
    <Modal title="字段" onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>关闭</button>{ro ? null : <button type="button" className="btn primary" onClick={onAdd}><Icon name="plus" />添加字段</button>}</>}>
      <p className="fine">显示 / 隐藏只影响当前视图「{view.name}」。</p>
      <div className="bs-fl">{c.fields.map((f) => <div key={f.id} className="row nowrap bs-fl-row">
        <span className="row nowrap bs-fl-name"><Icon name={FT[f.type][0]} /><b>{f.name}</b><span className="muted">{FT[f.type][1]}</span></span>
        <Toggle checked={!isHidden(view, f.id)} onChange={(on) => onHide(f.id, !on)} label="显示" />
        {ro ? null : <><button type="button" className="btn ghost sm icon-only" onClick={() => onEdit(f)} aria-label="编辑字段" title="编辑字段"><Icon name="pen" /></button><button type="button" className="btn ghost sm icon-only" onClick={() => setDel(f)} aria-label="删除字段" title="删除字段"><Icon name="trash" /></button></>}
      </div>)}</div>
    </Modal>
    {del ? <Confirm title="删除字段" text={`删除「${del.name}」会连同所有记录里这一列的值一起删掉，确定？`} ok="删除" danger onOk={() => onDelete(del)} onClose={() => setDel(null)} /> : null}
  </>;
}

/* ---------- 视图 ---------- */
const VIEW_OPTS = (Object.keys(VT) as ViewType[]).map((k): [string, string] => [k, VT[k][1]]);
export function ViewModal({ view, onOk, onClose }: { view?: View; onOk: (name: string, type: ViewType) => void; onClose: () => void }) {
  const [name, setName] = useState(view?.name ?? '');
  const [type, setType] = useState<ViewType>(view?.type ?? 'grid');
  const ok = () => onOk(name.trim() || VT[type][1], type);
  return <Modal title={view ? '重命名视图' : '新建视图'} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn primary" onClick={ok}>{view ? '保存' : '创建'}</button></>}>
    <FieldRow label="名称" htmlFor="bv-name"><input id="bv-name" className="input" value={name} autoFocus placeholder="例如：按负责人" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }} /></FieldRow>
    {view ? null : <FieldRow label="类型" htmlFor="bv-type"><div className="bs-vtypes" id="bv-type">{VIEW_OPTS.map(([k, l]) => <button type="button" key={k} className={cx('tt', type === k && 'on')} onClick={() => setType(k as ViewType)}><Icon name={VT[k as ViewType][0]} /><span className="lbl">{l}</span></button>)}</div></FieldRow>}
  </Modal>;
}

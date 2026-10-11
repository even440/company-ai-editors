/** 弹窗：记录、字段（新建 / 编辑）、字段列表、视图（新建 / 重命名） */
import { useState } from 'react';
import { Confirm, Field as FieldRow, Icon, Modal, Select, Toggle, cx, toast } from '../shell/ui';
import { FieldInput } from './cells';
import { FT, VT, isHidden, optsFrom, parseOpts, type Content, type Field, type FieldType, type Opt, type Rec, type UserMap, type View, type ViewType } from './model';

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

export function FieldModal({ field, records, onOk, onClose }: { field?: Field; records: Rec[]; onOk: (spec: FieldSpec) => void; onClose: () => void }) {
  const [name, setName] = useState(field?.name ?? '');
  const [type, setType] = useState<FieldType>(field?.type ?? 'text');
  const [opts, setOpts] = useState(field?.opts?.map((o) => o[0]).join(', ') ?? '');
  const hasOpts = type === 'select' || type === 'multi';
  const ok = () => {
    const n = name.trim(); if (!n) { toast('先填字段名'); return; }
    let list: Opt[] | undefined;
    if (hasOpts) {
      // 已有的选项保留原来的颜色，新加的按顺序配色；什么都没填就从已有的值里收集
      const parsed = parseOpts(opts);
      list = parsed.length ? parsed.map((o, i) => [o[0], field?.opts?.find((x) => x[0] === o[0])?.[1] ?? o[1]] as Opt) : field ? optsFrom(records, field.id) : [['选项 1', 'blue'], ['选项 2', 'green']];
    }
    onOk({ name: n, type, opts: list });
  };
  return <Modal title={field ? '编辑字段' : '添加字段'} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn primary" onClick={ok}>{field ? '保存' : '添加'}</button></>}>
    <FieldRow label="字段名" htmlFor="bf-name"><input id="bf-name" className="input" value={name} autoFocus placeholder="例如：跟进状态" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }} /></FieldRow>
    <FieldRow label="类型" htmlFor="bf-type" hint={field && field.type !== type ? '改类型后，已有的值会尽量转换，转不了的会清空。' : undefined}><Select id="bf-type" value={type} onChange={(v) => setType(v as FieldType)} options={TYPE_OPTS} /></FieldRow>
    {hasOpts ? <FieldRow label="选项（逗号分隔）" htmlFor="bf-opts" hint={field?.type === type ? undefined : '留空则从已有的值里自动收集'}><input id="bf-opts" className="input" value={opts} placeholder="待跟进, 已联系, 已报价" onChange={(e) => setOpts(e.target.value)} /></FieldRow> : null}
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

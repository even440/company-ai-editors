/** 弹窗：记录、字段（新建 / 编辑）、字段列表、视图（新建 / 重命名） */
import { useContext, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Confirm, Field as FieldRow, Icon, Modal, Select, Toggle, cx, toast } from '../shell/ui';
import { BaseCtx, ButtonCell, FieldInput, PickMany, StagePanel } from './cells';
import { assignable, howsFor, tableOf, type Book } from './book';
import { FUNC_NAMES, formulaOk } from './formula';
import { BT } from './i18n';
import type { ImportNotes } from './lark';
import { AGGS, COLORS, CURRENCIES, FT, OPS, TYPE_GROUPS, VT, curLabel, hasFlow, isAuto, isHidden, isLink, isOptType, isUserType, opNoVal, optsFrom, val,
  type Act, type Agg, type Assign, type Content, type Field, type FieldType, type FilterOp, type Flow, type LookCond, type Opt, type Rec, type StageCfg, type UserMap, type View, type ViewType } from './model';

/* ---------- 记录 ---------- */
export function RecordModal({ c, rec, users, ro, onSet, onDelete, onClose }: { c: Content; rec: Rec; users: UserMap; ro: boolean; onSet: (rid: string, fid: string, v: unknown) => void; onDelete: (rid: string) => void; onClose: () => void }) {
  const [ask, setAsk] = useState(false);
  // 流程现在这个阶段要处理的字段：标出来，一眼看得到该填哪几项
  const todo = new Set(c.fields.filter((f) => f.type === 'stage').flatMap((f) => f.flow?.steps?.[String(rec.v[f.id] ?? '')]?.show ?? []));
  return <>
    <Modal title="记录" onClose={onClose} footer={<>{ro ? null : <button type="button" className="btn ghost" onClick={() => setAsk(true)}><Icon name="trash" />删除</button>}<span className="spacer" /><button type="button" className="btn primary" onClick={onClose}>完成</button></>}>
      <div className="bs-rec">{c.fields.map((f) => <FieldRow key={f.id} label={<><Icon name={FT[f.type][0]} /> {f.name}{todo.has(f.id) ? <span className="bs-todo" aria-hidden="true" /> : null}</>} htmlFor={'br-' + f.id}>{f.type === 'button' ? <ButtonCell f={f} r={rec} /> : hasFlow(f) ? <StagePanel c={c} f={f} r={rec} users={users} disabled={ro} onChange={(v) => onSet(rec.id, f.id, v)} /> : <FieldInput id={'br-' + f.id} f={f} v={val(f, rec)} users={users} disabled={ro} onChange={(v) => onSet(rec.id, f.id, v)} />}</FieldRow>)}</div>
    </Modal>
    {ask ? <Confirm title="删除记录" text="删除后不能恢复，确定删除这条记录？" ok="删除" danger onOk={() => { onDelete(rec.id); onClose(); }} onClose={() => setAsk(false)} /> : null}
  </>;
}

/* ---------- 字段 ---------- */
export interface FieldSpec { name: string; type: FieldType; opts?: Opt[]; time?: boolean; dec?: number; cur?: string; to?: string; via?: string; pick?: string; agg?: Agg; from?: string; where?: LookCond[]; expr?: string; label?: string; acts?: Act[]; flow?: Flow; scan?: boolean }
/** 小数位数的选项：空是「照填的显示」 */
const DEC_OPTS: [string, string][] = [['', BT.decAuto], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']];

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

export function FieldModal({ field, records, book, tid, onOk, onClose }: { field?: Field; records: Rec[]; book: Book; tid: string; onOk: (spec: FieldSpec) => void; onClose: () => void }) {
  const table = tableOf(book, tid);
  const [name, setName] = useState(field?.name ?? '');
  const [type, setType] = useState<FieldType>(field?.type ?? 'text');
  const [opts, setOpts] = useState<OptRow[]>(() => (field?.opts?.length ? field.opts.map((o) => optRow(o[0], o[1])) : [optRow('', COLORS[0])]));
  const [time, setTime] = useState(!!field?.time);
  const [dec, setDec] = useState(field?.dec == null ? '' : String(field.dec));
  const [cur, setCur] = useState(field?.cur ?? 'CNY');
  const [to, setTo] = useState(field?.to ?? '');
  const [via, setVia] = useState(field?.via ?? '');
  const [pick, setPick] = useState(field?.pick ?? '');
  const [agg, setAgg] = useState<Agg>(field?.agg ?? 'list');
  const [expr, setExpr] = useState(field?.expr ?? '');
  const [label, setLabel] = useState(field?.label ?? '');
  const [acts, setActs] = useState<Act[]>(field?.acts ?? []);
  // 查找引用：新建的默认按条件找（Lark 的做法）；已经是顺着关联字段的照旧
  const [byLink, setByLink] = useState(!!field?.via && !field?.from);
  const [from, setFrom] = useState(field?.from ?? '');
  const [where, setWhere] = useState<LookCond[]>(field?.where ?? []);
  // 流程：每个阶段的设置跟着选项那一行走（按行的 key 记），改了选项的名字设置还在
  const [flowFirst, setFlowFirst] = useState(field?.flow?.first ?? !field);
  const [flowStrict, setFlowStrict] = useState(!!field?.flow?.strict);
  const [steps, setSteps] = useState<Record<number, StageCfg>>(() => Object.fromEntries(opts.map((r) => [r.key, field?.flow?.steps?.[r.name] ?? {}])));
  const [scan, setScan] = useState(!!field?.scan);
  const exprBox = useRef<HTMLTextAreaElement>(null);
  const hasOpts = isOptType(type);
  const hasDec = type === 'number' || type === 'currency' || type === 'progress' || type === 'formula';
  // 导入来的币种不在常用名单里时也列出来
  const curs = CURRENCIES.includes(cur) ? CURRENCIES : [cur, ...CURRENCIES];
  // 已经是关联的字段不能换表（值是对方的记录编号，换了表就对不上）
  const lockTo = !!field && isLink(field.type);
  const links = (table?.fields ?? []).filter((f) => isLink(f.type) && f.id !== field?.id);
  const viaField = links.find((f) => f.id === via), target = tableOf(book, byLink ? viaField?.to : from);
  const picks = (target?.fields ?? []).filter((f) => f.type !== 'button');
  const others = (table?.fields ?? []).filter((f) => f.id !== field?.id && f.type !== 'button');
  const insert = (text: string) => {
    const el = exprBox.current, at = el ? el.selectionStart : expr.length, end = el ? el.selectionEnd : expr.length;
    setExpr(expr.slice(0, at) + text + expr.slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + text.length, at + text.length); });
  };
  const ok = () => {
    const n = name.trim(); if (!n) { toast('先填字段名'); return; }
    let list: Opt[] | undefined;
    if (hasOpts) {
      // 一样的名字只留第一个；什么都没填就从已有的值里收集
      const seen = new Set<string>(), filled: Opt[] = [];
      for (const r of opts) { const v = r.name.trim(); if (v && !seen.has(v)) { seen.add(v); filled.push([v, r.color]); } }
      list = filled.length ? filled : field ? optsFrom(records, field.id) : [['选项 1', 'blue'], ['选项 2', 'green']];
    }
    if (isLink(type) && !tableOf(book, to)) { toast(BT.needTarget); return; }
    const conds = where.filter((c) => picks.some((f) => f.id === c.fid) && (opNoVal(c.op) || c.src || c.val?.trim()));
    if (type === 'lookup' && ((byLink ? !viaField : !target || !conds.length) || (agg !== 'count' && !picks.some((f) => f.id === pick)))) { toast(BT.needLookup); return; }
    // 流程：只留填了名字的选项的设置，按名字存
    const stepMap: Record<string, StageCfg> = {};
    for (const r of opts) { const n2 = r.name.trim(), cfg = steps[r.key]; if (n2 && cfg && !stepMap[n2] && (cfg.show?.length || cfg.need?.length || cfg.end)) stepMap[n2] = cfg; }
    if (type === 'formula' && !formulaOk(expr)) { toast(BT.exprBad); return; }
    onOk({
      name: n, type, opts: list,
      ...(type === 'date' && time ? { time: true } : {}),
      // 货币没选小数位数按两位
      ...(hasDec && (dec !== '' || type === 'currency') ? { dec: dec === '' ? 2 : Number(dec) } : {}),
      ...(type === 'currency' ? { cur } : {}),
      ...(isLink(type) ? { to } : {}),
      ...(type === 'lookup' ? { pick, agg, ...(byLink ? { via } : { from, where: conds }) } : {}),
      ...(type === 'formula' ? { expr: expr.trim() } : {}),
      ...(type === 'button' ? { label: label.trim(), acts: cleanActs(acts) } : {}),
      ...(type === 'stage' ? { flow: { ...(flowFirst ? { first: true } : {}), ...(flowStrict ? { strict: true } : {}), ...(Object.keys(stepMap).length ? { steps: stepMap } : {}) } } : {}),
      ...(type === 'barcode' && scan ? { scan: true } : {}),
    });
  };
  return <Modal title={field ? '编辑字段' : '添加字段'} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn primary" onClick={ok}>{field ? '保存' : '添加'}</button></>}>
    <FieldRow label="字段名" htmlFor="bf-name"><input id="bf-name" className="input" value={name} autoFocus placeholder="例如：跟进状态" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }} /></FieldRow>
    <FieldRow label="类型" htmlFor="bf-type" hint={field && field.type !== type ? '改类型后，已有的值会尽量转换，转不了的会清空。' : undefined}>
      <select id="bf-type" className="select" value={type} onChange={(e) => setType(e.target.value as FieldType)}>{TYPE_GROUPS.map(([g, list]) => <optgroup key={g} label={g}>{list.map((k) => <option key={k} value={k}>{FT[k][1]}</option>)}</optgroup>)}</select>
    </FieldRow>
    {hasOpts ? <FieldRow label="选项" htmlFor="bf-opts" hint={field?.type === type ? '按回车添加下一个' : '按回车添加下一个；都不填就从已有的值里自动收集'}><OptsEditor rows={opts} onChange={setOpts} /></FieldRow> : null}
    {type === 'date' ? <FieldRow label={BT.withTime} hint={BT.withTimeHint}><Toggle checked={time} onChange={setTime} /></FieldRow> : null}
    {type === 'currency' ? <FieldRow label={BT.currency} htmlFor="bf-cur"><Select id="bf-cur" value={cur} onChange={setCur} options={curs.map((c): [string, string] => [c, curLabel(c)])} /></FieldRow> : null}
    {isLink(type) ? <FieldRow label={BT.linkTo} htmlFor="bf-to" hint={lockTo ? BT.linkToHint : type === 'duplex' ? BT.duplexHint : undefined}>
      <select id="bf-to" className="select" value={to} disabled={lockTo} onChange={(e) => setTo(e.target.value)}><option value="">—</option>{book.tables.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === tid ? BT.thisTable : ''}</option>)}</select></FieldRow> : null}
    {type === 'lookup' ? <>
      <FieldRow label={BT.lookMode} htmlFor="bf-lmode"><Select id="bf-lmode" value={byLink ? 'link' : 'cond'} onChange={(v) => { setByLink(v === 'link'); setPick(''); }} options={[['cond', BT.lookByCond], ['link', BT.lookByLink]]} /></FieldRow>
      {byLink ? (links.length ? <FieldRow label={BT.lookVia} htmlFor="bf-via"><select id="bf-via" className="select" value={via} onChange={(e) => { setVia(e.target.value); setPick(''); }}><option value="">—</option>{links.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></FieldRow> : <div className="note">{BT.lookNoLink}</div>) : <>
        <FieldRow label={BT.lookFrom} htmlFor="bf-from"><select id="bf-from" className="select" value={from} onChange={(e) => { setFrom(e.target.value); setPick(''); setWhere([]); }}><option value="">—</option>{book.tables.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === tid ? BT.thisTable : ''}</option>)}</select></FieldRow>
        {target ? <FieldRow label={BT.lookWhere}><CondsEditor conds={where} theirs={picks} mine={others} onChange={setWhere} /></FieldRow> : null}
      </>}
      {target ? <>
        <FieldRow label={BT.lookAgg} htmlFor="bf-agg"><Select id="bf-agg" value={agg} onChange={(v) => setAgg(v as Agg)} options={AGGS.map((a): [string, string] => [a, BT.agg[a]])} /></FieldRow>
        {agg === 'count' ? null : <FieldRow label={BT.lookPick} htmlFor="bf-pick"><select id="bf-pick" className="select" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">—</option>{picks.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></FieldRow>}
      </> : null}
    </> : null}
    {type === 'formula' ? <>
      <FieldRow label={BT.exprLabel} htmlFor="bf-expr" hint={BT.exprHint}><textarea id="bf-expr" ref={exprBox} className="input bs-expr" rows={3} value={expr} placeholder={BT.exprPh} spellCheck={false} onChange={(e) => setExpr(e.target.value)} /></FieldRow>
      {expr.trim() && !formulaOk(expr) ? <div className="note warn">{BT.exprBad}</div> : null}
      <div className="bs-refs">{others.map((f) => <button type="button" key={f.id} className="chip" onClick={() => insert(`{${f.name}}`)}><Icon name={FT[f.type][0]} />{f.name}</button>)}</div>
      <details className="bs-funcs"><summary>{BT.funcs}</summary><div className="bs-refs">{FUNC_NAMES.map((fn) => <button type="button" key={fn} className="chip dim" onClick={() => insert(fn + '()')}>{fn}</button>)}</div></details>
    </> : null}
    {type === 'button' ? <>
      <FieldRow label={BT.btnLabel} htmlFor="bf-label"><input id="bf-label" className="input" value={label} placeholder={BT.btnDefault} onChange={(e) => setLabel(e.target.value)} /></FieldRow>
      <FieldRow label={BT.actsTitle}><ActsEditor acts={acts} book={book} tid={tid} self={field?.id} onChange={setActs} /></FieldRow>
    </> : null}
    {type === 'stage' ? <>
      <FieldRow label={BT.flowFirst}><Toggle checked={flowFirst} onChange={setFlowFirst} /></FieldRow>
      <FieldRow label={BT.flowStrict}><Toggle checked={flowStrict} onChange={setFlowStrict} /></FieldRow>
      <FieldRow label={BT.flowSteps}><StagesEditor rows={opts.filter((r) => r.name.trim())} steps={steps} fields={others} onChange={setSteps} /></FieldRow>
    </> : null}
    {type === 'barcode' ? <FieldRow label={BT.scanOnly} hint={BT.scanOnlyHint}><Toggle checked={scan} onChange={setScan} /></FieldRow> : null}
    {hasDec ? <FieldRow label={BT.decimals} htmlFor="bf-dec"><Select id="bf-dec" value={type === 'currency' && dec === '' ? '2' : dec} onChange={setDec} options={type === 'currency' ? DEC_OPTS.slice(1) : DEC_OPTS} /></FieldRow> : null}
    {isAuto(type) && type !== 'formula' && type !== 'lookup' ? <p className="fine">{type === 'autonum' ? BT.autoNumHint : BT.autoHint}</p> : null}
  </Modal>;
}

/** 没填完整的动作不存：打开地址要有地址，发消息要有内容，改记录、新增记录至少填一个字段 */
const cleanActs = (acts: Act[]): Act[] => acts.filter((a) => (a.do === 'open' ? a.href.trim() : a.do === 'msg' ? a.text.trim() : a.do === 'add' ? a.table : a.set.length));

/** 查找引用的查找条件：对方的字段 / 条件 / 本表的字段或固定值 */
function CondsEditor({ conds, theirs, mine, onChange }: { conds: LookCond[]; theirs: Field[]; mine: Field[]; onChange: (c: LookCond[]) => void }) {
  const rows = conds.length ? conds : [{ fid: '', op: 'eq' as FilterOp, src: '' }];
  const set = (i: number, patch: Partial<LookCond>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return <div className="bs-conds">
    {rows.map((c, i) => <div key={i} className="row bs-cond">
      <select className="select" aria-label={BT.lookTheirs} value={c.fid} onChange={(e) => set(i, { fid: e.target.value })}><option value="">{BT.lookTheirs}</option>{theirs.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
      <select className="select" aria-label="条件" value={c.op} onChange={(e) => set(i, { op: e.target.value as FilterOp })}>{OPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {opNoVal(c.op) ? null : <>
        {/* 和本表的哪个字段比；选「固定值」就在后面填 */}
        <select className="select" aria-label={BT.lookMine} value={c.src ?? (c.val !== undefined ? '@' : '')} onChange={(e) => set(i, e.target.value === '@' ? { src: undefined, val: c.val ?? '' } : { src: e.target.value, val: undefined })}><option value="">{BT.lookMine}</option>{mine.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}<option value="@">{BT.lookConst}</option></select>
        {c.src === undefined && c.val !== undefined ? <input className="input" aria-label={BT.lookConst} value={c.val} onChange={(e) => set(i, { val: e.target.value })} /> : null}
      </>}
      {rows.length > 1 ? <button type="button" className="btn ghost sm icon-only" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={BT.delCond} title={BT.delCond}><Icon name="x" /></button> : null}
    </div>)}
    <button type="button" className="btn ghost sm bs-opt-add" onClick={() => onChange([...rows, { fid: '', op: 'eq', src: '' }])}><Icon name="plus" />{BT.addCond}</button>
  </div>;
}

/** 流程每个阶段的设置：是进行中、完成还是中止；这个阶段要处理的字段；填了哪些才能进入下一个阶段 */
function StagesEditor({ rows, steps, fields, onChange }: { rows: OptRow[]; steps: Record<number, StageCfg>; fields: Field[]; onChange: (s: Record<number, StageCfg>) => void }) {
  const items = fields.filter((f) => !isAuto(f.type)).map((f) => ({ id: f.id, label: f.name }));
  const set = (key: number, patch: Partial<StageCfg>) => onChange({ ...steps, [key]: { ...steps[key], ...patch } });
  if (!rows.length) return <span className="muted">这个字段还没有选项</span>;
  return <div className="bs-stages">{rows.map((r, i) => {
    const cfg = steps[r.key] ?? {}, must = (cfg.need ?? []).filter((x) => x.op === 'nempty'), other = (cfg.need ?? []).filter((x) => x.op !== 'nempty');
    return <div key={r.key} className="bs-stagec">
      <div className="row nowrap"><span className={cx('chip', 'c-' + r.color)}>{i + 1}. {r.name}</span><span className="spacer" />
        <select className="select" aria-label={r.name} value={cfg.end ?? ''} onChange={(e) => set(r.key, { end: e.target.value === 'done' || e.target.value === 'stop' ? e.target.value : undefined })}><option value="">{BT.kindGo}</option><option value="done">{BT.kindDone}</option><option value="stop">{BT.kindStop}</option></select></div>
      <label className="fine">{BT.stageShow}</label>
      <PickMany items={items} value={cfg.show ?? []} placeholder={BT.noneYet} onChange={(v) => set(r.key, { show: v })} />
      {cfg.end ? null : <>
        <label className="fine">{BT.stageNeed}{other.length ? `（${BT.stageOther(other.length)}）` : ''}</label>
        {/* 「必填」就是「不为空」的流转条件；导入来的别的条件（等于某个值这类）原样留着 */}
        <PickMany items={items} value={must.map((x) => x.fid)} placeholder={BT.noneYet} onChange={(v) => set(r.key, { need: [...v.map((fid) => ({ fid, op: 'nempty' as FilterOp, val: '' })), ...other] })} />
      </>}
    </div>; })}</div>;
}

/** 按钮点了做的几件事 */
function ActsEditor({ acts, book, tid, self, onChange }: { acts: Act[]; book: Book; tid: string; self?: string; onChange: (a: Act[]) => void }) {
  const { groups } = useContext(BaseCtx);
  const here = tableOf(book, tid), mine = (here?.fields ?? []).filter((f) => f.id !== self);
  const set = (i: number, a: Act) => onChange(acts.map((x, j) => (j === i ? a : x)));
  const blank = (kind: Act['do']): Act => (kind === 'open' ? { do: 'open', href: '' } : kind === 'set' ? { do: 'set', set: [] } : kind === 'add' ? { do: 'add', table: tid, set: [] } : { do: 'msg', text: '' });
  const KINDS: Act['do'][] = ['set', 'add', 'msg', 'open'];
  return <div className="bs-acts">
    {acts.map((a, i) => <div key={i} className="bs-act">
      <div className="row nowrap"><b>{i + 1}.</b><select className="select" aria-label={BT.actsTitle} value={a.do} onChange={(e) => set(i, blank(e.target.value as Act['do']))}>{KINDS.map((k) => <option key={k} value={k}>{BT.act[k]}</option>)}</select><span className="spacer" />
        <button type="button" className="btn ghost sm icon-only" onClick={() => onChange(acts.filter((_, j) => j !== i))} aria-label={BT.delAct} title={BT.delAct}><Icon name="x" /></button></div>
      {a.do === 'open' ? <><input className="input" aria-label={BT.btnHref} value={a.href} placeholder={BT.btnHrefPh} onChange={(e) => set(i, { ...a, href: e.target.value })} /><span className="field-h">{BT.btnHrefHint}</span></> : null}
      {a.do === 'set' ? <AssignsEditor list={a.set} target={mine} source={mine} adding={false} onChange={(list) => set(i, { ...a, set: list })} /> : null}
      {a.do === 'add' ? <>
        <select className="select" aria-label={BT.actTable} value={a.table} onChange={(e) => set(i, { do: 'add', table: e.target.value, set: [] })}>{book.tables.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === tid ? BT.thisTable : ''}</option>)}</select>
        <AssignsEditor list={a.set} target={tableOf(book, a.table)?.fields ?? []} source={mine} adding srcTable={tid} onChange={(list) => set(i, { ...a, set: list })} />
      </> : null}
      {a.do === 'msg' ? <>
        <label className="fine">{BT.msgFields}</label><PickMany items={mine.filter((f) => isUserType(f.type) || f.type === 'group').map((f) => ({ id: f.id, label: f.name }))} value={a.fields ?? []} placeholder={BT.pickFields} onChange={(v) => set(i, { ...a, fields: v })} />
        <label className="fine">{BT.msgUsers}</label><UsersPick value={a.users ?? []} onChange={(v) => set(i, { ...a, users: v })} />
        <label className="fine">{BT.msgGroups}</label><PickMany items={groups.filter((g) => g.mine !== false).map((g) => ({ id: g.id, label: g.name }))} value={a.groups ?? []} placeholder={BT.pickGroups} onChange={(v) => set(i, { ...a, groups: v })} />
        <textarea className="input bs-expr" rows={2} aria-label={BT.msgText} value={a.text} placeholder={BT.msgTextPh} onChange={(e) => set(i, { ...a, text: e.target.value })} /><span className="field-h">{BT.msgHint}</span>
      </> : null}
    </div>)}
    <button type="button" className="btn ghost sm bs-opt-add" onClick={() => onChange([...acts, blank('set')])}><Icon name="plus" />{BT.actAdd}</button>
  </div>;
}
/** 成员的多选：名单从编辑器主体那里拿（按钮发消息给谁） */
function UsersPick({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { users } = useContext(BaseCtx);
  return <PickMany items={[...users.values()].map((u) => ({ id: u.id, label: u.dept ? `${u.name}（${u.dept}）` : u.name }))} value={value} placeholder={BT.pickUsers} onChange={onChange} />;
}

/** 按钮往记录里填哪些字段、各填什么 */
function AssignsEditor({ list, target, source, adding, srcTable, onChange }: { list: Assign[]; target: Field[]; source: Field[]; adding: boolean; srcTable?: string; onChange: (l: Assign[]) => void }) {
  const { users } = useContext(BaseCtx);
  const fields = target.filter(assignable);
  const set = (i: number, a: Assign) => onChange(list.map((x, j) => (j === i ? a : x)));
  return <div className="bs-assigns">
    {list.map((a, i) => {
      const f = fields.find((x) => x.id === a.fid);
      // 「关联这条记录」只在那个关联字段正好指着按钮所在的表时才有意义
      const hows = f ? howsFor(f, adding).filter((h) => h !== 'this' || f.to === srcTable) : [];
      return <div key={i} className="bs-assign">
        <div className="row"><select className="select" aria-label={BT.pickFields} value={a.fid} onChange={(e) => { const g = fields.find((x) => x.id === e.target.value); set(i, { fid: e.target.value, how: g ? howsFor(g, adding).filter((h) => h !== 'this' || g.to === srcTable)[0] ?? 'clear' : 'val' }); }}><option value="">{BT.pickFields}</option>{fields.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          {f ? <select className="select" aria-label={f.name} value={a.how} onChange={(e) => set(i, { fid: a.fid, how: e.target.value as Assign['how'] })}>{hows.map((h) => <option key={h} value={h}>{BT.how[h]}</option>)}</select> : null}
          {f && a.how === 'copy' ? <select className="select" aria-label={BT.how.copy} value={a.from ?? ''} onChange={(e) => set(i, { ...a, from: e.target.value })}><option value="">—</option>{source.filter((x) => x.type !== 'button').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : null}
          <span className="spacer" /><button type="button" className="btn ghost sm icon-only" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={BT.delAssign} title={BT.delAssign}><Icon name="x" /></button></div>
        {f && a.how === 'val' ? <FieldInput f={f} v={a.val} users={users} onChange={(v) => set(i, { ...a, val: v })} /> : null}
      </div>; })}
    <button type="button" className="btn ghost sm bs-opt-add" onClick={() => onChange([...list, { fid: '', how: 'val' }])}><Icon name="plus" />{BT.assignAdd}</button>
  </div>;
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

/* ---------- 数据表：新建、重命名 ---------- */
export function TableModal({ name: init, onOk, onClose }: { name?: string; onOk: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(init ?? '');
  const ok = () => onOk(name.trim());
  return <Modal title={init === undefined ? BT.newTable : BT.renameTable} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn primary" onClick={ok}>{init === undefined ? BT.create : BT.save}</button></>}>
    <FieldRow label={BT.tableName} htmlFor="bt-name"><input id="bt-name" className="input" value={name} autoFocus placeholder={BT.tableNamePh} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }} /></FieldRow>
  </Modal>;
}

/* ---------- 导入 Lark 的 .base：导入完说明带过来了多少、哪些没法原样带过来 ---------- */
export function ImportResultModal({ notes, onClose }: { notes: ImportNotes; onClose: () => void }) {
  const names = (list: string[]) => list.map((n) => `「${n}」`).join('');
  const lines = [
    notes.formulas.length ? BT.noteFormula(names(notes.formulas)) : '', notes.asText.length ? BT.noteAsText(names(notes.asText)) : '', notes.people.length ? BT.notePeople(names(notes.people)) : '', notes.attach.length ? BT.noteAttach(names(notes.attach)) : '',
    notes.filters.length ? BT.noteFilters(names(notes.filters)) : '', notes.groups.length ? BT.noteGroups(names(notes.groups)) : '', notes.dropped.length ? BT.noteDropped(names(notes.dropped)) : '', BT.noteOther,
  ].filter(Boolean);
  return <Modal title={BT.resultTitle} onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>{BT.gotIt}</button>}>
    <p>{BT.resultDone(notes.tables, notes.fields, notes.records, notes.views)}</p>
    <p className="fine">{BT.resultNotes}</p>
    <ul className="bs-notes">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
  </Modal>;
}

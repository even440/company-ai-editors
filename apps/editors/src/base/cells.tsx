/** 格子的显示和编辑：表格、记录弹窗、表单都用这里的组件，保证同一种字段在哪里看起来都一样 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ChatGroup, DirectoryUser } from '@cai/bridge';
import { useSession } from '../shell/session';
import { Icon, Modal, cx, toast } from '../shell/ui';
import { linkChoices, type Book } from './book';
import { ERR } from './formula';
import { BT } from './i18n';
import { curSymbol, dateInput, dateStore, filesOf, fmtNumber, fmtStamp, groupName, hasFlow, idsOf, isAuto, isChoice, isLink, isListType, isNumeric, isUserType, linkTitle, locOf, locSet, optColor, signOf, stageMissing, stageNext, userName,
  type Content, type Field, type FileVal, type Rec, type UserMap } from './model';

/**
 * 格子要用到、又不在这张表里的东西：整份内容（关联要列对方表的记录）、群名单（群组字段；mine 是我在的，能选、能点开），
 * 以及两件要交给编辑器主体去办的事：点按钮（run）、打开一个群（openChat）
 */
export const BaseCtx = createContext<{ book: Book; users: UserMap; groups: ChatGroup[]; run: (f: Field, rid: string) => void; openChat: (id: string) => void }>({ book: { tables: [] }, users: new Map(), groups: [], run: () => { /* 没接上 */ }, openChat: () => { /* 没接上 */ } });

export function UserAv({ u, name }: { u?: DirectoryUser; name?: string }) {
  return <span className={cx('av sm', 'c-' + (u?.tint ?? 'gray'))} aria-hidden="true">{(u?.name ?? name ?? '?').charAt(0)}</span>;
}

/** 只读显示一个值 */
export function CellView({ f, v, users }: { f: Field; v: unknown; users: UserMap }): ReactNode {
  if (f.type === 'check') return <span className={cx('bs-check', !!v && 'on')}>{v ? <Icon name="check" /> : null}</span>;
  if (v == null || v === '') return null;
  switch (f.type) {
    case 'select': return <span className={cx('chip', 'c-' + optColor(f, v))}>{String(v)}</span>;
    // 流程：选项有先后，后面标出走到第几步
    case 'stage': { const i = (f.opts ?? []).findIndex((o) => o[0] === v), n = f.opts?.length ?? 0; return <span className="bs-stage"><span className={cx('chip', 'c-' + optColor(f, v))}>{String(v)}</span>{i >= 0 ? <i title={BT.stepOf(i + 1, n)}>{i + 1}/{n}</i> : null}</span>; }
    case 'link': case 'duplex': { const ids = idsOf(v); return ids.length ? <span className="bs-multi">{ids.slice(0, 6).map((id) => <span key={id} className="chip">{linkTitle(f, id)}</span>)}{ids.length > 6 ? <i className="muted">+{ids.length - 6}</i> : null}</span> : null; }
    case 'group': return idsOf(v).length ? <GroupChips ids={idsOf(v)} /> : null;
    case 'location': { const o = locOf(v); return o ? <a className="bs-loc" href={mapUrl(o)} target="_blank" rel="noreferrer" title={BT.openMap} onClick={(e) => e.stopPropagation()}><Icon name="pin" />{o.addr}</a> : null; }
    case 'barcode': return <span className="bs-code">{String(v)}</span>;
    case 'sign': { const x = signOf(v); return x ? <SignImg file={x} users={users} /> : null; }
    case 'button': return null;
    case 'formula': case 'lookup': return v === ERR ? <span className="bs-err" title={BT.exprBad}>{ERR}</span> : typeof v === 'boolean' ? <span className={cx('bs-check', v && 'on')}>{v ? <Icon name="check" /> : null}</span> : typeof v === 'number' ? <span className="num">{fmtNumber(f, v)}</span> : String(v);
    case 'multi': return <span className="bs-multi">{(Array.isArray(v) ? v : [v]).map((x, i) => <span key={i} className={cx('chip', 'c-' + optColor(f, x))}>{String(x)}</span>)}</span>;
    case 'user': case 'creator': case 'editor': { const u = users.get(String(v)); return <span className="row nowrap bs-user"><UserAv u={u} name={String(v)} />{u?.name ?? String(v)}</span>; }
    case 'number': case 'currency': case 'autonum': return <span className="num">{fmtNumber(f, v)}</span>;
    case 'progress': { const n = Number(v); return <span className="bs-prog" title={fmtNumber(f, v)}><span className="bs-prog-bar"><i style={{ width: `${Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0))}%` }} /></span><span className="num">{fmtNumber(f, v)}</span></span>; }
    case 'rating': return <Stars v={v} />;
    case 'url': return <a href={String(v)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{String(v)}</a>;
    case 'phone': return <a href={'tel:' + String(v).replace(/[^\d+]/g, '')} onClick={(e) => e.stopPropagation()}>{String(v)}</a>;
    case 'email': return <a href={'mailto:' + String(v)} onClick={(e) => e.stopPropagation()}>{String(v)}</a>;
    case 'attach': return <AttachChips files={filesOf(v)} />;
    case 'created': case 'updated': return fmtStamp(v);
    default: return Array.isArray(v) ? v.map(String).join('、') : String(v);
  }
}

/** 群组：谁都看得到群名；自己在的群能点开 */
function GroupChips({ ids }: { ids: string[] }) {
  const { groups, openChat } = useContext(BaseCtx);
  return <span className="bs-multi">{ids.map((id) => { const mine = groups.some((g) => g.id === id && g.mine !== false);
    return mine ? <button type="button" key={id} className="chip c-blue bs-gchip" title={BT.openChat} onClick={(e) => { e.stopPropagation(); openChat(id); }}><Icon name="users" />{groupName(id)}</button>
      : <span key={id} className="chip c-blue" title={BT.notInGroup}><Icon name="users" />{groupName(id)}</span>; })}</span>;
}

const mapUrl = (o: { addr: string; lat?: number; lng?: number }) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.lat != null && o.lng != null ? `${o.lat},${o.lng}` : o.addr);

/** 评分：五颗星。给了 onChange 就能点，点已经选中的那颗清掉 */
export function Stars({ v, onChange, disabled }: { v: unknown; onChange?: (v: number | '') => void; disabled?: boolean }) {
  const n = Math.max(0, Math.min(5, Math.round(Number(v) || 0)));
  if (!onChange) return n ? <span className="bs-stars" role="img" aria-label={BT.stars(n)}>{[1, 2, 3, 4, 5].map((k) => <Icon key={k} name="star" className={k <= n ? 'on' : undefined} />)}</span> : null;
  return <span className="bs-stars edit" role="group">{[1, 2, 3, 4, 5].map((k) => <button type="button" key={k} disabled={disabled} className={k <= n ? 'on' : undefined} aria-label={BT.stars(k)} aria-pressed={k === n} title={k === n ? BT.clearRating : BT.stars(k)}
    onClick={(e) => { e.stopPropagation(); onChange(k === n ? '' : k); }}><Icon name="star" /></button>)}</span>;
}

/* ---------- 附件 ---------- */
const isImage = (x: FileVal) => x.mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(x.name);
export const fmtSize = (n: number) => (n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
/**
 * 文件的地址：一律按编号现拼带令牌的地址（s.client.assetUrl）。存下来的 url 同源部署时不带令牌、能用，
 * 但开发时（编辑器跨域）它带的是上传那一刻的令牌，过期就打不开
 */
export function useAssetUrl() { const s = useSession(); return (id: string, download = false) => s.client.assetUrl(id) + (download ? '&download=1' : ''); }

/** 格子、卡片里的附件：图片是小缩略图，别的是文件名，放不下的只写个数 */
function AttachChips({ files }: { files: FileVal[] }) {
  const url = useAssetUrl();
  if (!files.length) return null;
  const shown = files.slice(0, 3);
  return <span className="bs-att" title={files.map((x) => x.name).join('\n')}>
    {shown.map((x) => (isImage(x) ? <img key={x.id} src={url(x.id)} alt={x.name} loading="lazy" /> : <span key={x.id} className="chip"><Icon name="file" />{x.name}</span>))}
    {files.length > shown.length ? <i>+{files.length - shown.length}</i> : null}
  </span>;
}
/** 记录的封面：附件里的第一张图片（画廊用） */
export const coverOf = (files: FileVal[]) => files.find(isImage);

/** 附件的列表和上传：记录弹窗、表单、表格里点开格子的面板都用它 */
export function AttachList({ v, onChange, disabled, id }: { v: unknown; onChange: (v: FileVal[]) => void; disabled?: boolean; id?: string }) {
  const s = useSession(), url = useAssetUrl();
  const files = filesOf(v), cur = useRef(files); cur.current = files;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const add = async (list: FileList | null) => {
    const picked = [...(list ?? [])]; if (!picked.length) return;
    setBusy(picked.length);
    const done: FileVal[] = [];
    for (const file of picked) {
      try { const r = await s.client.upload(file); done.push({ id: r.id, name: r.name || file.name, size: r.size ?? file.size, mime: r.mime || file.type, url: r.url }); }
      catch (e) { toast(BT.uploadFail + (e instanceof Error ? e.message : String(e))); }
    }
    // 传的过程中列表可能变了（删了别的文件），接在最新的后面
    if (done.length) onChange([...cur.current, ...done]);
    setBusy(0);
    if (input.current) input.current.value = '';
  };
  return <div className="bs-atl">
    {files.map((x) => <div key={x.id} className="row nowrap bs-atl-row">
      {isImage(x) ? <img src={url(x.id)} alt="" loading="lazy" /> : <span className="bs-atl-ic"><Icon name="file" /></span>}
      <a className="bs-atl-name" href={url(x.id)} target="_blank" rel="noreferrer" title={BT.open}>{x.name}</a>
      <span className="muted bs-atl-size">{x.size ? fmtSize(x.size) : ''}</span>
      <a className="btn ghost sm icon-only" href={url(x.id, true)} download={x.name} aria-label={`${BT.download} ${x.name}`} title={BT.download}><Icon name="download" /></a>
      {disabled ? null : <button type="button" className="btn ghost sm icon-only" onClick={() => onChange(files.filter((y) => y.id !== x.id))} aria-label={`${BT.remove} ${x.name}`} title={BT.remove}><Icon name="x" /></button>}
    </div>)}
    {files.length || !disabled ? null : <span className="muted">{BT.noFiles}</span>}
    {disabled ? null : <>
      <input ref={input} id={id} type="file" multiple hidden onChange={(e) => void add(e.target.files)} />
      <button type="button" className="btn sm bs-atl-add" disabled={busy > 0} onClick={() => input.current?.click()}><Icon name="upload" />{busy ? BT.uploading(busy) : BT.upload}</button>
    </>}
  </div>;
}

/** 多选的值：一组可以点选的标签 */
export function MultiChips({ f, v, onChange, disabled }: { f: Field; v: unknown; onChange: (v: string[]) => void; disabled?: boolean }) {
  const cur = (Array.isArray(v) ? v : []).map(String);
  const opts = f.opts ?? [];
  return <div className="bs-chips" role="group">{opts.map((o) => { const on = cur.includes(o[0]); return <button type="button" key={o[0]} className={cx('chip', on ? 'c-' + o[1] : 'dim', on && 'on')} disabled={disabled} aria-pressed={on} onClick={() => onChange(on ? cur.filter((x) => x !== o[0]) : [...cur, o[0]])}>{on ? <Icon name="check" /> : null}{o[0]}</button>; })}{opts.length ? null : <span className="muted">这个字段还没有选项</span>}</div>;
}

/** 弹窗和表单里的输入控件：撑满一行 */
export function FieldInput({ f, v, users, onChange, disabled, id, autoFocus }: { f: Field; v: unknown; users: UserMap; onChange: (v: unknown) => void; disabled?: boolean; id?: string; autoFocus?: boolean }) {
  // 系统自己填的字段：只显示，不能改
  if (isAuto(f.type)) return <div className="bs-auto" id={id} title={BT.autoHint}>{v == null || v === '' ? <span className="muted">—</span> : <CellView f={f} v={v} users={users} />}</div>;
  if (f.type === 'attach') return <AttachList id={id} v={v} onChange={onChange} disabled={disabled} />;
  if (f.type === 'rating') return <Stars v={v} onChange={onChange} disabled={disabled} />;
  if (f.type === 'sign') return <SignField v={v} users={users} onChange={onChange} disabled={disabled} />;
  if (f.type === 'stage') return <StageSteps f={f} v={v} onChange={onChange} disabled={disabled} />;
  if (isLink(f.type) || f.type === 'group') return <PickField f={f} v={v} users={users} onChange={onChange} disabled={disabled} />;
  if (f.type === 'location') return <LocInput id={id} v={v} onChange={onChange} disabled={disabled} />;
  if (f.type === 'barcode') return <CodeInput id={id} v={v} onChange={onChange} disabled={disabled} autoFocus={autoFocus} scanOnly={!!f.scan} />;
  if (f.type === 'select') return <select id={id} className="select" value={v == null ? '' : String(v)} disabled={disabled} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{(f.opts ?? []).map((o) => <option key={o[0]} value={o[0]}>{o[0]}</option>)}</select>;
  if (isUserType(f.type)) return <select id={id} className="select" value={v == null ? '' : String(v)} disabled={disabled} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{[...users.values()].map((u) => <option key={u.id} value={u.id}>{u.name}（{u.dept}）</option>)}</select>;
  if (f.type === 'multi') return <MultiChips f={f} v={v} onChange={onChange} disabled={disabled} />;
  if (f.type === 'check') return <label className="switch"><input id={id} type="checkbox" checked={!!v} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span className="switch-t" /><span className="switch-l">{v ? '已勾选' : '未勾选'}</span></label>;
  if (f.type === 'date') return <input id={id} className="input" type={f.time ? 'datetime-local' : 'date'} value={dateInput(f, v)} disabled={disabled} autoFocus={autoFocus} onChange={(e) => onChange(dateStore(f, e.target.value))} />;
  const numeric = isNumeric(f.type);
  const type = numeric ? 'number' : f.type === 'url' ? 'url' : f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : 'text';
  const box = <input id={id} className="input" type={type} step={numeric ? 'any' : undefined} value={v == null ? '' : String(v)} disabled={disabled} autoFocus={autoFocus} placeholder={f.type === 'url' ? 'https://' : undefined}
    onChange={(e) => onChange(numeric ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />;
  // 货币前面带符号，进度后面带百分号
  if (f.type === 'currency') return <div className="row nowrap bs-affix"><span className="muted">{curSymbol(f.cur)}</span>{box}</div>;
  if (f.type === 'progress') return <div className="row nowrap bs-affix">{box}<span className="muted">%</span></div>;
  return box;
}

/** 固定定位的小菜单：表头菜单、视图菜单、格子里的选项面板都用它。点外面或按 Esc 关闭 */
export function Popover({ at, onClose, children, className, width }: { at: { x: number; y: number }; onClose: () => void; children: ReactNode; className?: string; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  // 贴着锚点显示，超出窗口就往回挪
  useLayoutEffect(() => { const el = ref.current; if (!el) return; const r = el.getBoundingClientRect(); setPos({ x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)), y: at.y + r.height > window.innerHeight - 8 ? Math.max(8, at.y - r.height - 8) : at.y }); }, [at]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    // 用 setTimeout 跳过打开菜单的那一次点击
    const t = setTimeout(() => { document.addEventListener('mousedown', down); document.addEventListener('keydown', key, true); }, 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [onClose]);
  return createPortal(<div ref={ref} className={cx('dmenu bs-pop', className)} style={{ position: 'fixed', left: pos.x, top: pos.y, width }} role="menu">{children}</div>, document.body);
}

export function MenuItem({ icon, label, onClick, crit, on }: { icon?: string; label: ReactNode; onClick: () => void; crit?: boolean; on?: boolean }) {
  return <button type="button" className={cx('dmenu-i', crit && 'crit', on && 'on')} role="menuitem" onClick={onClick}>{icon ? <Icon name={icon} /> : null}<span>{label}</span>{on ? <Icon name="check" /> : null}</button>;
}

/** 表格格子里的选项面板：单选 / 流程 / 多选 / 人员 / 关联的记录 / 群组。值是一组的（多选、关联、群组）点了不关，可以接着勾 */
export function Picker({ f, v, users, at, onChange, onClose }: { f: Field; v: unknown; users: UserMap; at: { x: number; y: number }; onChange: (v: unknown) => void; onClose: () => void }) {
  const { book, groups } = useContext(BaseCtx);
  const [q, setQ] = useState('');
  const many = isListType(f.type);
  const cur = many ? (Array.isArray(v) ? v : []).map(String) : [];
  const toggle = (key: string) => onChange(cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]);
  const list: { key: string; node: ReactNode; on: boolean; pick: () => void }[] = [];
  let none = '没有选项，先在字段设置里添加';
  if (isUserType(f.type)) { none = '没有匹配的成员'; for (const u of users.values()) { if (q && !u.name.includes(q) && !u.dept.includes(q)) continue; list.push({ key: u.id, node: <><UserAv u={u} />{u.name}<i className="muted">{u.dept}</i></>, on: String(v) === u.id, pick: () => { onChange(u.id); onClose(); } }); } }
  else if (isLink(f.type)) { none = q ? BT.noMatch : BT.noRecords; for (const r of linkChoices(book, f, q)) list.push({ key: r.id, node: <span className="chip">{r.title}</span>, on: cur.includes(r.id), pick: () => toggle(r.id) }); }
  else if (f.type === 'group') { none = q ? BT.noMatch : BT.noGroups; for (const g of groups) { if (g.mine === false) continue; if (q && !g.name.toLowerCase().includes(q.toLowerCase())) continue; list.push({ key: g.id, node: <><span className="chip c-blue"><Icon name="users" />{g.name}</span><i className="muted">{g.members}</i></>, on: cur.includes(g.id), pick: () => toggle(g.id) }); } }
  else for (const o of f.opts ?? []) { if (q && !o[0].includes(q)) continue; const on = many ? cur.includes(o[0]) : v === o[0]; list.push({ key: o[0], node: <span className={cx('chip', 'c-' + o[1])}>{o[0]}</span>, on, pick: () => { if (many) toggle(o[0]); else { onChange(o[0]); onClose(); } } }); }
  const search = list.length > 6 || !!q || isUserType(f.type) || isLink(f.type);
  return <Popover at={at} onClose={onClose} width={260}>
    {search ? <input className="input bs-pop-q" placeholder="搜索" value={q} autoFocus onChange={(e) => setQ(e.target.value)} /> : null}
    <div className="bs-pop-list">{list.map((it) => <button type="button" key={it.key} className={cx('dmenu-i', it.on && 'on')} onClick={it.pick}><span className="row nowrap">{it.node}</span>{it.on ? <Icon name="check" /> : null}</button>)}{list.length ? null : <div className="dmenu-l">{none}</div>}</div>
    <div className="dmenu-d" /><button type="button" className="dmenu-i" onClick={() => { onChange(many ? [] : ''); onClose(); }}><Icon name="x" /><span>清空</span></button>
  </Popover>;
}

/** 弹窗、表单里的关联和群组：显示已选的，旁边的按钮点开勾选面板 */
function PickField({ f, v, users, onChange, disabled }: { f: Field; v: unknown; users: UserMap; onChange: (v: unknown) => void; disabled?: boolean }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return <div className="row bs-pickf">
    <CellView f={f} v={v} users={users} />
    {disabled ? (idsOf(v).length ? null : <span className="muted">—</span>) : <button type="button" className="btn sm" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ x: r.left, y: r.bottom + 2 }); }}><Icon name="plus" />{f.type === 'group' ? BT.pickGroups : BT.pickRecords}</button>}
    {at ? <Picker f={f} v={v} users={users} at={at} onChange={onChange} onClose={() => setAt(null)} /> : null}
  </div>;
}

/** 流程：一步一步排开，点哪一步就走到哪一步；再点当前这一步是清掉 */
function StageSteps({ f, v, onChange, disabled }: { f: Field; v: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const opts = f.opts ?? [], cur = opts.findIndex((o) => o[0] === v);
  if (!opts.length) return <span className="muted">这个字段还没有选项</span>;
  return <div className="bs-steps" role="group">{opts.map((o, i) => <button type="button" key={o[0]} disabled={disabled} aria-pressed={i === cur} title={BT.stepOf(i + 1, opts.length)}
    className={cx('bs-step', i < cur && 'done', i === cur && 'on', i === cur && 'c-' + o[1])} onClick={() => onChange(i === cur ? '' : o[0])}><i>{i < cur ? <Icon name="check" /> : i + 1}</i>{o[0]}</button>)}</div>;
}

/** 按钮字段：点了交给编辑器主体，依次做设好的几件事（改这条记录、新增记录、发消息、打开地址） */
export function ButtonCell({ f, r }: { f: Field; r: Rec }) {
  const { run } = useContext(BaseCtx);
  return <button type="button" className="btn sm bs-btnf" onClick={(e) => { e.stopPropagation(); run(f, r.id); }}>{f.label?.trim() || BT.btnDefault}</button>;
}

/** 从一张清单里勾几项：字段、成员、群这些「选几个」的地方都用它。按钮上显示已选的，点开是能搜索的勾选面板 */
export function PickMany({ items, value, onChange, placeholder, disabled }: { items: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; placeholder: string; disabled?: boolean }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null), [q, setQ] = useState('');
  const chosen = value.map((id) => items.find((x) => x.id === id)).filter((x): x is { id: string; label: string } => !!x);
  const shown = q ? items.filter((x) => x.label.toLowerCase().includes(q.toLowerCase())) : items;
  return <>
    <button type="button" className="input bs-fvals" disabled={disabled} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setQ(''); setAt({ x: r.left, y: r.bottom + 2 }); }}>
      {chosen.length ? chosen.map((x) => <span key={x.id} className="chip">{x.label}</span>) : <span className="muted">{placeholder}</span>}</button>
    {at ? <Popover at={at} onClose={() => setAt(null)} width={280}>
      {items.length > 6 ? <input className="input bs-pop-q" placeholder="搜索" value={q} autoFocus onChange={(e) => setQ(e.target.value)} /> : null}
      <div className="bs-pop-list">{shown.map((x) => { const on = value.includes(x.id); return <button type="button" key={x.id} className={cx('dmenu-i', on && 'on')} onClick={() => onChange(on ? value.filter((y) => y !== x.id) : [...value, x.id])}><span>{x.label}</span>{on ? <Icon name="check" /> : null}</button>; })}
        {shown.length ? null : <div className="dmenu-l">{BT.noMatch}</div>}</div>
    </Popover> : null}
  </>;
}

/**
 * 记录弹窗里的流程（设了流转条件的）：一排步骤，下面写这个阶段要处理哪些字段、离进入下一阶段还差什么，和「进入下一阶段」。
 * 点步骤、点按钮都只是提出要改，过不过由编辑器主体按流转条件判断（不行会提示还差什么）
 */
export function StagePanel({ c, f, r, users, disabled, onChange }: { c: Content; f: Field; r: Rec; users: UserMap; disabled?: boolean; onChange: (v: unknown) => void }) {
  const v = r.v[f.id], cur = String(v ?? ''), cfg = f.flow?.steps?.[cur];
  const next = cur ? stageNext(f, cur) : f.opts?.[0]?.[0] ?? null;
  const lack = cur ? stageMissing(c, f, cur, r, users) : [];
  const show = (cfg?.show ?? []).map((id) => c.fields.find((x) => x.id === id)?.name).filter((x): x is string => !!x);
  return <div className="bs-stagep">
    <StageSteps f={f} v={v} onChange={onChange} disabled={disabled} />
    {show.length ? <p className="fine">{BT.stageTodo}{show.join('、')}</p> : null}
    {cfg?.end ? <p className="fine">{BT.stageEnd}</p> : <>
      {lack.length ? <p className="fine bs-lack">{BT.stageLack}{lack.join('、')}</p> : null}
      {next && !disabled ? <button type="button" className="btn sm primary bs-next" disabled={lack.length > 0} onClick={() => onChange(next)}><Icon name="arrow" />{BT.nextStage(next)}</button> : null}
    </>}
  </div>;
}
export { hasFlow };

/* ---------- 地理位置 ---------- */
function LocInput({ id, v, onChange, disabled }: { id?: string; v: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const o = locOf(v), [busy, setBusy] = useState(false);
  // 定过位、地址还是坐标本身的，输入框里不重复显示坐标
  const text = typeof v === 'string' ? v : isRecord(v) ? String(v.addr ?? '') : '';
  const locate = () => {
    if (!navigator.geolocation) { toast(BT.locFail); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition((p) => { setBusy(false); onChange({ addr: text, lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }); }, () => { setBusy(false); toast(BT.locFail); }, { timeout: 10_000 });
  };
  return <div className="bs-locf">
    <div className="row nowrap bs-affix"><input id={id} className="input" value={text} disabled={disabled} placeholder={BT.locPh} onChange={(e) => onChange(locSet(v, e.target.value) || (o?.lat != null ? { addr: '', lat: o.lat, lng: o.lng } : ''))} />
      {disabled ? null : <button type="button" className="btn sm" disabled={busy} onClick={locate}><Icon name="pin" />{BT.locate}</button>}</div>
    {o?.lat != null ? <a className="fine" href={mapUrl(o)} target="_blank" rel="noreferrer">{o.lat}, {o.lng} · {BT.openMap}</a> : null}
  </div>;
}
const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/* ---------- 条码 ---------- */
/** 这里能不能用摄像头（要 https 和 iframe 的 camera 授权） */
export const canScan = () => !!navigator.mediaDevices?.getUserMedia;
function CodeInput({ id, v, onChange, disabled, autoFocus, scanOnly }: { id?: string; v: unknown; onChange: (v: unknown) => void; disabled?: boolean; autoFocus?: boolean; scanOnly?: boolean }) {
  const [scan, setScan] = useState(false);
  // 只能扫码录入的：输入框只读（照 Lark 的「仅限扫码录入」），清空还是可以的
  return <div className="row nowrap bs-affix"><input id={id} className="input bs-code" value={v == null ? '' : String(v)} disabled={disabled} readOnly={scanOnly} title={scanOnly ? BT.scanOnlyTip : undefined} placeholder={scanOnly ? BT.scanOnlyTip : undefined} autoFocus={autoFocus && !scanOnly} onChange={(e) => onChange(e.target.value)} />
    {!disabled && (canScan() || scanOnly) ? <button type="button" className="btn sm" onClick={() => setScan(true)}><Icon name="search" />{BT.scan}</button> : null}
    {!disabled && scanOnly && v ? <button type="button" className="btn ghost sm icon-only" onClick={() => onChange('')} aria-label={BT.clearSign} title={BT.clearSign}><Icon name="x" /></button> : null}
    {scan ? <ScanModal onCode={(code) => { onChange(code); setScan(false); }} onClose={() => setScan(false)} /> : null}</div>;
}
interface Detector { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
/**
 * 扫码：浏览器自己会认条码的（Chrome 在 Mac、安卓上有 BarcodeDetector）用它，又快又省；
 * 没有的（iPhone、Windows）用 @zxing/library 解码（2026-11-10 用户同意加的依赖，只在这里点了扫码才加载）
 */
export function ScanModal({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null), done = useRef(onCode); done.current = onCode;
  const [err, setErr] = useState(false);
  useEffect(() => {
    let stop = () => { /* 还没开始 */ }, off = false;
    const hit = (code: string | undefined) => { if (!off && code) { off = true; done.current(code); } };
    void (async () => {
      try {
        const el = video.current; if (!el || !canScan()) throw new Error('no camera');
        const constraints = { video: { facingMode: 'environment' } };
        if ('BarcodeDetector' in window) {
          const det = new (window as unknown as { BarcodeDetector: new () => Detector }).BarcodeDetector();
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          const timer = setInterval(() => { void det.detect(el).then((codes) => hit(codes[0]?.rawValue)).catch(() => { /* 这一帧没认出来 */ }); }, 300);
          stop = () => { clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); };
          if (off) { stop(); return; }
          el.srcObject = stream; await el.play();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/library');
          const reader = new BrowserMultiFormatReader();
          stop = () => reader.reset();
          if (off) return;
          await reader.decodeFromConstraints(constraints, el, (result) => hit(result?.getText()));
          if (off) reader.reset();
        }
      } catch { if (!off) setErr(true); }
    })();
    return () => { off = true; stop(); };
  }, []);
  return <Modal title={BT.scan} onClose={onClose}>{err ? <div className="note warn">{BT.scanFail}</div> : <><video ref={video} className="bs-scan" muted playsInline /><p className="fine">{BT.scanHint}</p></>}</Modal>;
}

/* ---------- 签字 ---------- */
function SignImg({ file, users }: { file: FileVal; users: UserMap }) {
  const url = useAssetUrl();
  return <img className="bs-sign" src={url(file.id)} alt={BT.signed} loading="lazy" title={file.by || file.at ? BT.signedAt(userName(users, file.by) || '—', fmtStamp(file.at)) : BT.signed} />;
}
function SignField({ v, users, onChange, disabled }: { v: unknown; users: UserMap; onChange: (v: unknown) => void; disabled?: boolean }) {
  const cur = signOf(v), [open, setOpen] = useState(false);
  return <div className="row bs-signf">
    {cur ? <><SignImg file={cur} users={users} />{cur.by || cur.at ? <span className="fine">{BT.signedAt(userName(users, cur.by) || '—', fmtStamp(cur.at))}</span> : null}</> : disabled ? <span className="muted">—</span> : null}
    {disabled ? null : <><button type="button" className="btn sm" onClick={() => setOpen(true)}><Icon name="pen" />{cur ? BT.resign : BT.signBtn}</button>{cur ? <button type="button" className="btn ghost sm" onClick={() => onChange('')}>{BT.clearSign}</button> : null}</>}
    {open ? <SignModal onDone={(f) => { onChange(f); setOpen(false); }} onClose={() => setOpen(false)} /> : null}
  </div>;
}
/** 签字板：在画布上写，存成白底的 PNG 传给宿主（白底：深色主题下也看得清） */
function SignModal({ onDone, onClose }: { onDone: (f: FileVal) => void; onClose: () => void }) {
  const s = useSession(), cv = useRef<HTMLCanvasElement>(null), drawn = useRef(false), last = useRef<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { const el = cv.current, g = el?.getContext('2d'); if (!el || !g) return; g.fillStyle = '#fff'; g.fillRect(0, 0, el.width, el.height); drawn.current = false; };
  useEffect(reset, []);
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => { const el = e.currentTarget, r = el.getBoundingClientRect(); return { x: (e.clientX - r.left) * (el.width / r.width), y: (e.clientY - r.top) * (el.height / r.height) }; };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = e.currentTarget.getContext('2d'), from = last.current; if (!g || !from) return;
    const to = at(e); g.strokeStyle = '#1a2233'; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(from.x, from.y); g.lineTo(to.x, to.y); g.stroke();
    last.current = to; drawn.current = true;
  };
  const save = () => {
    if (!drawn.current) { toast(BT.signEmpty); return; }
    setBusy(true);
    cv.current?.toBlob((blob) => {
      if (!blob) { setBusy(false); return; }
      s.client.upload(new File([blob], 'signature.png', { type: 'image/png' })).then((r) => onDone({ id: r.id, name: r.name || 'signature.png', size: r.size ?? blob.size, mime: 'image/png', url: r.url, ...(s.doc.user?.id ? { by: s.doc.user.id } : {}), at: Date.now() }))
        .catch((e: unknown) => { toast(BT.signFail + (e instanceof Error ? e.message : String(e))); setBusy(false); });
    }, 'image/png');
  };
  return <Modal title={BT.signBtn} onClose={onClose} footer={<><button type="button" className="btn" onClick={reset}>{BT.signClear}</button><button type="button" className="btn primary" disabled={busy} onClick={save}>{BT.signSave}</button></>}>
    <p className="fine">{BT.signHint}</p>
    <canvas ref={cv} className="bs-signpad" width={960} height={400} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = at(e); }} onPointerMove={move} onPointerUp={() => { last.current = null; }} onPointerCancel={() => { last.current = null; }} />
  </Modal>;
}

/** 表格格子里点开附件：文件列表 + 上传 */
export function AttachPop({ v, at, ro, onChange, onClose }: { v: unknown; at: { x: number; y: number }; ro: boolean; onChange: (v: FileVal[]) => void; onClose: () => void }) {
  return <Popover at={at} onClose={onClose} width={320} className="bs-attpop"><AttachList v={v} onChange={onChange} disabled={ro} /></Popover>;
}

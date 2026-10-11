/** 格子的显示和编辑：表格、记录弹窗、表单都用这里的组件，保证同一种字段在哪里看起来都一样 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { DirectoryUser } from '@cai/bridge';
import { Icon, cx } from '../shell/ui';
import { optColor, type Field, type UserMap } from './model';

export function UserAv({ u, name }: { u?: DirectoryUser; name?: string }) {
  return <span className={cx('av sm', 'c-' + (u?.tint ?? 'gray'))} aria-hidden="true">{(u?.name ?? name ?? '?').charAt(0)}</span>;
}

/** 只读显示一个值 */
export function CellView({ f, v, users }: { f: Field; v: unknown; users: UserMap }): ReactNode {
  if (f.type === 'check') return <span className={cx('bs-check', !!v && 'on')}>{v ? <Icon name="check" /> : null}</span>;
  if (v == null || v === '') return null;
  switch (f.type) {
    case 'select': return <span className={cx('chip', 'c-' + optColor(f, v))}>{String(v)}</span>;
    case 'multi': return <span className="bs-multi">{(Array.isArray(v) ? v : [v]).map((x, i) => <span key={i} className={cx('chip', 'c-' + optColor(f, x))}>{String(x)}</span>)}</span>;
    case 'user': { const u = users.get(String(v)); return <span className="row nowrap bs-user"><UserAv u={u} name={String(v)} />{u?.name ?? String(v)}</span>; }
    case 'number': return <span className="num">{Number.isFinite(Number(v)) ? Number(v).toLocaleString('zh-CN') : String(v)}</span>;
    case 'url': return <a href={String(v)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{String(v)}</a>;
    default: return String(v);
  }
}

/** 多选的值：一组可以点选的标签 */
export function MultiChips({ f, v, onChange, disabled }: { f: Field; v: unknown; onChange: (v: string[]) => void; disabled?: boolean }) {
  const cur = (Array.isArray(v) ? v : []).map(String);
  const opts = f.opts ?? [];
  return <div className="bs-chips" role="group">{opts.map((o) => { const on = cur.includes(o[0]); return <button type="button" key={o[0]} className={cx('chip', on ? 'c-' + o[1] : 'dim', on && 'on')} disabled={disabled} aria-pressed={on} onClick={() => onChange(on ? cur.filter((x) => x !== o[0]) : [...cur, o[0]])}>{on ? <Icon name="check" /> : null}{o[0]}</button>; })}{opts.length ? null : <span className="muted">这个字段还没有选项</span>}</div>;
}

/** 弹窗和表单里的输入控件：撑满一行 */
export function FieldInput({ f, v, users, onChange, disabled, id, autoFocus }: { f: Field; v: unknown; users: UserMap; onChange: (v: unknown) => void; disabled?: boolean; id?: string; autoFocus?: boolean }) {
  if (f.type === 'select') return <select id={id} className="select" value={v == null ? '' : String(v)} disabled={disabled} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{(f.opts ?? []).map((o) => <option key={o[0]} value={o[0]}>{o[0]}</option>)}</select>;
  if (f.type === 'user') return <select id={id} className="select" value={v == null ? '' : String(v)} disabled={disabled} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{[...users.values()].map((u) => <option key={u.id} value={u.id}>{u.name}（{u.dept}）</option>)}</select>;
  if (f.type === 'multi') return <MultiChips f={f} v={v} onChange={onChange} disabled={disabled} />;
  if (f.type === 'check') return <label className="switch"><input id={id} type="checkbox" checked={!!v} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span className="switch-t" /><span className="switch-l">{v ? '已勾选' : '未勾选'}</span></label>;
  const type = f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text';
  return <input id={id} className="input" type={type} step={f.type === 'number' ? 'any' : undefined} value={v == null ? '' : String(v)} disabled={disabled} autoFocus={autoFocus} placeholder={f.type === 'url' ? 'https://' : undefined}
    onChange={(e) => onChange(f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />;
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

/** 表格格子里的选项面板：单选 / 多选 / 人员 */
export function Picker({ f, v, users, at, onChange, onClose }: { f: Field; v: unknown; users: UserMap; at: { x: number; y: number }; onChange: (v: unknown) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const cur = f.type === 'multi' ? (Array.isArray(v) ? v : []).map(String) : [];
  const list: { key: string; node: ReactNode; on: boolean; pick: () => void }[] = [];
  if (f.type === 'user') for (const u of users.values()) { if (q && !u.name.includes(q) && !u.dept.includes(q)) continue; list.push({ key: u.id, node: <><UserAv u={u} />{u.name}<i className="muted">{u.dept}</i></>, on: String(v) === u.id, pick: () => { onChange(u.id); onClose(); } }); }
  else for (const o of f.opts ?? []) { if (q && !o[0].includes(q)) continue; const on = f.type === 'multi' ? cur.includes(o[0]) : v === o[0]; list.push({ key: o[0], node: <span className={cx('chip', 'c-' + o[1])}>{o[0]}</span>, on, pick: () => { if (f.type === 'multi') onChange(on ? cur.filter((x) => x !== o[0]) : [...cur, o[0]]); else { onChange(o[0]); onClose(); } } }); }
  return <Popover at={at} onClose={onClose} width={240}>
    {list.length > 6 || f.type === 'user' ? <input className="input bs-pop-q" placeholder="搜索" value={q} autoFocus onChange={(e) => setQ(e.target.value)} /> : null}
    <div className="bs-pop-list">{list.map((it) => <button type="button" key={it.key} className={cx('dmenu-i', it.on && 'on')} onClick={it.pick}><span className="row nowrap">{it.node}</span>{it.on ? <Icon name="check" /> : null}</button>)}{list.length ? null : <div className="dmenu-l">{f.type === 'user' ? '没有匹配的成员' : '没有选项，先在字段设置里添加'}</div>}</div>
    <div className="dmenu-d" /><button type="button" className="dmenu-i" onClick={() => { onChange(f.type === 'multi' ? [] : ''); onClose(); }}><Icon name="x" /><span>清空</span></button>
  </Popover>;
}

/** 编辑器共用的小组件：图标、工具栏按钮、下拉、弹窗、提示。类名和平台的 globals.css 一致，样式在 base.css 里 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ICONS } from './icons';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export function Icon({ name, className }: { name: string; className?: string }) {
  return <svg className={cx('ic', className)} viewBox="0 0 16 16" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] ?? '' }} />;
}

export function ITile({ icon, tint = 'blue', size }: { icon: string; tint?: string; size?: 'sm' | 'lg' }) {
  return <span className={cx('itile', 'c-' + tint, size)} aria-hidden="true"><Icon name={icon} /></span>;
}

/** 工具栏按钮：图标 + 文字，窄屏时只留图标 */
export function TT({ icon, label, on, title, disabled, onClick, pressed }: { icon?: string; label?: ReactNode; on?: boolean; title?: string; disabled?: boolean; onClick?: () => void; pressed?: boolean }) {
  return <button type="button" className={cx('tt', on && 'on')} title={title} disabled={disabled} onClick={onClick} aria-pressed={pressed}>{icon ? <Icon name={icon} /> : null}{label ? <span className="lbl">{label}</span> : null}</button>;
}

/** 工具栏：和平台里的 .dtool 一样 */
export function Toolbar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return <div className="dtool" role="toolbar">{children}{right !== undefined ? <><span className="spacer" />{right}</> : null}</div>;
}

type Opt = string | [string, string];
export function Select({ value, onChange, options, ...rest }: { value: string; onChange: (v: string) => void; options: Opt[] } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return <select className="select" value={value} onChange={(e) => onChange(e.target.value)} {...rest}>{options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}</select>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return <label className="switch"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span className="switch-t" />{label ? <span className="switch-l">{label}</span> : null}</label>;
}

export function Field({ label, htmlFor, hint, children }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
  return <div className="field"><label className="field-l" htmlFor={htmlFor}>{label}</label>{children}{hint ? <span className="field-h">{hint}</span> : null}</div>;
}

export function Modal({ title, onClose, footer, children, wide }: { title: string; onClose: () => void; footer?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  return createPortal(
    <div id="overlay"><div className="scrim" onClick={onClose} /><div className={cx('modal', wide && 'wide')} role="dialog" aria-modal="true" aria-label={title}><div className="modal-h"><h2>{title}</h2><button type="button" className="btn ghost sm icon-only" onClick={onClose} aria-label="关闭"><Icon name="x" /></button></div><div className="modal-b">{children}</div>{footer ? <div className="modal-f">{footer}</div> : null}</div></div>,
    document.body,
  );
}

/* ---------- 提示 ---------- */
type Listener = (msgs: { id: number; text: string }[]) => void;
let toasts: { id: number; text: string }[] = [], seq = 0;
const listeners = new Set<Listener>();
export function toast(text: string) {
  const id = ++seq; toasts = [...toasts, { id, text }]; listeners.forEach((l) => l(toasts));
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); listeners.forEach((l) => l(toasts)); }, 3400);
}
export function Toaster() {
  const [list, setList] = useState(toasts);
  useEffect(() => { listeners.add(setList); return () => { listeners.delete(setList); }; }, []);
  return <div id="toasts" aria-live="polite">{list.map((t) => <div key={t.id} className="toast" role="status">{t.text}</div>)}</div>;
}

/** 确认框：返回 Promise */
export function Confirm({ title, text, ok = '确定', danger, onOk, onClose }: { title: string; text: ReactNode; ok?: string; danger?: boolean; onOk: () => void; onClose: () => void }) {
  return <Modal title={title} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className={cx('btn primary', danger && 'danger')} onClick={() => { onOk(); onClose(); }}>{ok}</button></>}><p>{text}</p></Modal>;
}

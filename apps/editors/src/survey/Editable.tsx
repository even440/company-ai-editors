/**
 * 行内可编辑文字（题目、选项）：contenteditable，文字由我们同步到 DOM，React 不渲染子节点，所以输入时光标不会跳。
 * Enter 不换行（题目都是一行），粘贴只要纯文本。
 * 问卷说明用 EditableArea：多行（用户 2026-11-27：「问卷调查说明部分的编辑不可换行」——活动日期、时间、地点要分行写，粘贴进来的几行也被并成一行）。
 */
import { createElement, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

/** ph：空的时候显示的提示（样式里 :empty::before 取 data-ph，跟着界面语言） */
interface Props { value: string; onChange: (v: string) => void; className?: string; disabled?: boolean; tag?: 'span' | 'div' | 'b'; label?: string; ph?: string; onEnter?: () => void }

function pastePlain(e: ClipboardEvent<HTMLElement>) {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ');
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  e.currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
}

export function Editable({ value, onChange, className, disabled, tag = 'span', label, ph, onEnter }: Props) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => { const el = ref.current; if (el && el.textContent !== value) el.textContent = value; });
  return createElement(tag, {
    ref, className, contentEditable: !disabled, suppressContentEditableWarning: true, spellCheck: false, role: 'textbox', 'aria-label': label, 'data-ph': ph,
    onInput: (e: React.FormEvent<HTMLElement>) => onChange(e.currentTarget.textContent ?? ''),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => { if (e.key === 'Enter') { e.preventDefault(); if (e.nativeEvent.isComposing) return; if (onEnter) onEnter(); else e.currentTarget.blur(); } else if (e.key === 'Escape') e.currentTarget.blur(); },
    onPaste: pastePlain,
  });
}

/** 多行文字（问卷说明）：textarea 跟着内容长高，Enter 换行，粘贴保留换行；只读时也照样分行显示 */
export function EditableArea({ value, onChange, className, disabled, label, ph }: Omit<Props, 'tag' | 'onEnter'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => { const el = ref.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
  useLayoutEffect(fit, [value]);
  // 宽度变了（拉窗口、手机转屏）行数跟着变，高度重新量
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <textarea ref={ref} className={className} rows={1} value={value} readOnly={disabled} placeholder={ph} aria-label={label} spellCheck={false}
    onChange={(e) => onChange(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }} />;
}

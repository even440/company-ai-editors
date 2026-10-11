/**
 * 行内可编辑文字（题目、选项、说明）：contenteditable，文字由我们同步到 DOM，React 不渲染子节点，所以输入时光标不会跳。
 * Enter 不换行（题目都是一行），粘贴只要纯文本。
 */
import { createElement, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

interface Props { value: string; onChange: (v: string) => void; className?: string; disabled?: boolean; tag?: 'span' | 'div' | 'b'; label?: string; onEnter?: () => void }

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

export function Editable({ value, onChange, className, disabled, tag = 'span', label, onEnter }: Props) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => { const el = ref.current; if (el && el.textContent !== value) el.textContent = value; });
  return createElement(tag, {
    ref, className, contentEditable: !disabled, suppressContentEditableWarning: true, spellCheck: false, role: 'textbox', 'aria-label': label,
    onInput: (e: React.FormEvent<HTMLElement>) => onChange(e.currentTarget.textContent ?? ''),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => { if (e.key === 'Enter') { e.preventDefault(); if (e.nativeEvent.isComposing) return; if (onEnter) onEnter(); else e.currentTarget.blur(); } else if (e.key === 'Escape') e.currentTarget.blur(); },
    onPaste: pastePlain,
  });
}

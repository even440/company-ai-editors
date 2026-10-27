/**
 * 工具栏上的格式（2026-10-27，同事反馈：没有常用的对齐方式，改不了字体、字号、字的颜色，不能加底纹，列表、编号只有一种样式）。
 * 字体、字号是下拉框；文字颜色、底纹、对齐、列表和编号的样式是按钮加弹出的面板（Drop）。
 * 面板挂在按钮下面，点外面、按 Esc、切到别的窗口时收起；按下时不抢正文的焦点，选中的文字一直显示着
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { Icon, Select, cx } from '../shell/ui';
import { listStyleAt } from './liststyle';
import { ALIGNS, BG_COLORS, FONTS, SIZES, TEXT_COLORS, fontLabel, hexOf, type Align } from './textstyle';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** 按钮加弹出的面板。label 为空时只有一个小三角（列表、编号旁边那个） */
function Drop({ label, title, split, children }: { label?: ReactNode; title: string; split?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null), pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', close);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); window.removeEventListener('blur', close); };
  }, [open]);
  // 右边放不下时贴着按钮的右边展开
  useLayoutEffect(() => {
    const el = pane.current;
    if (!open || !el) return;
    el.classList.remove('end');
    if (el.getBoundingClientRect().right > window.innerWidth - 8) el.classList.add('end');
  }, [open]);
  return (
    <span className="fmt-drop" ref={box}>
      <button type="button" className={cx('tt fmt-btn', split && 'fmt-car-only', open && 'on')} title={title} aria-label={title} aria-haspopup="true" aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        {label}<Icon name="down" className="fmt-car" />
      </button>
      {open ? <div ref={pane} className="fmt-pane" role="menu" aria-label={title} onMouseDown={(e) => e.preventDefault()}>{children(() => setOpen(false))}</div> : null}
    </span>
  );
}

/* ---------- 字体、字号 ---------- */

export function FontPick({ editor }: { editor: Editor }) {
  const cur = useEditorState({ editor, selector: ({ editor: e }) => String(e.getAttributes('textStyle').fontFamily ?? '') });
  // 粘贴进来的、名单外的字体也显示出来
  const options: [string, string][] = [['', '默认字体'], ...FONTS, ...(cur && !FONTS.some(([v]) => v === cur) ? [[cur, fontLabel(cur)] as [string, string]] : [])];
  return <Select className="select fmt-font" aria-label="字体" title="字体" value={cur} options={options}
    onChange={(v) => { const c = editor.chain().focus(); (v ? c.setFontFamily(v) : c.unsetFontFamily()).run(); }} />;
}

export function SizePick({ editor }: { editor: Editor }) {
  const cur = useEditorState({ editor, selector: ({ editor: e }) => String(e.getAttributes('textStyle').fontSize ?? '') });
  const options: [string, string][] = [['', '默认字号'], ...SIZES, ...(cur && !SIZES.some(([v]) => v === cur) ? [[cur, cur] as [string, string]] : [])];
  return <Select className="select fmt-size" aria-label="字号" title="字号（磅）" value={cur} options={options}
    onChange={(v) => { const c = editor.chain().focus(); (v ? c.setFontSize(v) : c.unsetFontSize()).run(); }} />;
}

/* ---------- 文字颜色、底纹 ---------- */

/** 面板上是「默认颜色 / 无底纹」加一排色块；按钮上那条线是现在的颜色 */
export function ColorPick({ editor, kind }: { editor: Editor; kind: 'color' | 'bg' }) {
  const attr = kind === 'color' ? 'color' : 'backgroundColor';
  const cur = useEditorState({ editor, selector: ({ editor: e }) => hexOf(e.getAttributes('textStyle')[attr]) ?? '' });
  const set = (v: string | null) => {
    const c = editor.chain().focus();
    if (kind === 'color') (v ? c.setColor(v) : c.unsetColor()).run();
    else (v ? c.setBackgroundColor(v) : c.unsetBackgroundColor()).run();
  };
  const title = kind === 'color' ? '文字颜色' : '底纹', list = kind === 'color' ? TEXT_COLORS : BG_COLORS;
  return (
    <Drop title={title} label={kind === 'color'
      ? <span className="fmt-a" aria-hidden="true">A<i style={{ background: cur || 'currentColor' }} /></span>
      : <span className="fmt-hl" aria-hidden="true"><Icon name="marker" /><i style={cur ? { background: cur } : undefined} /></span>}>
      {(close) => <>
        <button type="button" role="menuitem" className="fmt-i" onClick={() => { set(null); close(); }}>
          {kind === 'color' ? <span className="fmt-a">A</span> : <span className="sw-none" />}{kind === 'color' ? '默认颜色' : '无底纹'}
        </button>
        <div className="fmt-sw">
          {list.map(([v, name]) => (
            <button key={v} type="button" role="menuitemradio" aria-checked={cur === v} className={cx('sw', cur === v && 'on')} style={{ background: v }}
              title={name} aria-label={`${title}：${name}`} onClick={() => { set(v); close(); }} />
          ))}
        </div>
      </>}
    </Drop>
  );
}

/* ---------- 对齐 ---------- */

const ALIGN_TEXT: Record<Align, [string, string]> = { left: ['左对齐', 'L'], center: ['居中', 'E'], right: ['右对齐', 'R'], justify: ['两端对齐', 'J'] };
const shortcut = (k: string) => (MAC ? `⌘⇧${k}` : `Ctrl+Shift+${k}`);

/** 按钮上是现在的对齐方式；左对齐是默认，选它就是去掉对齐 */
export function AlignPick({ editor }: { editor: Editor }) {
  const cur = useEditorState({ editor, selector: ({ editor: e }) => ALIGNS.find((a) => a !== 'left' && e.isActive({ textAlign: a })) ?? 'left' });
  const set = (a: Align) => { const c = editor.chain().focus(); (a === 'left' ? c.unsetTextAlign() : c.setTextAlign(a)).run(); };
  return (
    <Drop title={`对齐：${ALIGN_TEXT[cur][0]}`} label={<Icon name={`align${cur}`} />}>
      {(close) => ALIGNS.map((a) => (
        <button key={a} type="button" role="menuitemradio" aria-checked={cur === a} className={cx('fmt-i', cur === a && 'on')} onClick={() => { set(a); close(); }}>
          <Icon name={`align${a}`} />{ALIGN_TEXT[a][0]}<kbd>{shortcut(ALIGN_TEXT[a][1])}</kbd>
        </button>
      ))}
    </Drop>
  );
}

/* ---------- 列表、编号的样式 ---------- */

/** [样式（null 是默认）, 示意, 名字] */
const BULLETS: [string | null, string, string][] = [[null, '●', '实心圆'], ['circle', '○', '空心圆'], ['square', '■', '方块']];
const NUMBERS: [string | null, string, string][] = [
  [null, '1. 2. 3.', '数字'], ['lower-alpha', 'a. b. c.', '小写字母'], ['upper-alpha', 'A. B. C.', '大写字母'],
  ['lower-roman', 'i. ii. iii.', '小写罗马数字'], ['upper-roman', 'I. II. III.', '大写罗马数字'], ['cjk-ideographic', '一、二、三、', '中文数字'],
];

/** 列表、编号按钮旁边的小三角：选一种样式；还不是这种列表时先变成这种列表 */
export function ListPick({ editor, type }: { editor: Editor; type: 'bulletList' | 'orderedList' }) {
  const cur = useEditorState({ editor, selector: ({ editor: e }) => { const v = listStyleAt(e.state, type); return v === 'disc' || v === 'decimal' ? null : v; } });
  const pick = (style: string | null) => {
    const c = editor.chain().focus();
    if (cur === undefined) { if (type === 'bulletList') c.toggleBulletList(); else c.toggleOrderedList(); }
    c.setListStyle(type, style).run();
  };
  return (
    <Drop split title={type === 'bulletList' ? '项目符号样式' : '编号样式'}>
      {(close) => (type === 'bulletList' ? BULLETS : NUMBERS).map(([v, sample, name]) => {
        const on = cur !== undefined && cur === v;
        return (
          <button key={name} type="button" role="menuitemradio" aria-checked={on} className={cx('fmt-i', on && 'on')} onClick={() => { pick(v); close(); }}>
            <span className="fmt-sample">{sample}</span>{name}
          </button>
        );
      })}
    </Drop>
  );
}

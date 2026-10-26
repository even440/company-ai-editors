/**
 * 书签和文档内链接（2026-10-26：上传的 Word 转成在线文档以后，目录、书签、交叉引用要能跳）。
 *
 * - 书签记在块的属性 anchor 上：标题、段落、列表项，几个书签用空格隔开，页面上是 data-anchor。
 *   Word 的书签由 mammoth 转成空的 <a id>，导入时由 import.ts 的 liftAnchors 挪到所在的块上；HTML 里块元素的 id、
 *   <a name> 同样处理；Markdown 的标题有链接指向它（GitHub 的写法 #标题-文字）时补上锚点。
 * - 点 #书签 的链接：滚到那一块并闪一下，编辑时光标放到那一块的开头；找不到时提示。#_top / #top 回到开头。
 *   不再新开窗口——Tiptap 的链接编辑时用 window.open、只读时带 target="_blank"，# 链接打开的是编辑器自己的地址（带令牌）。
 *   找书签先按 anchor，再按标题：GitHub 写法的 slug 或标题原文（手写的 #标题 链接也能跳）。
 * - 导出 Word 时写回书签（Bookmark）和文档内链接（InternalHyperlink），见 export.ts。
 * - 宿主（平台）的 src/features/docs/schema.ts 有同名的属性，服务端做协同转换时才留得住；平台保存时的清理（content.ts 的 cleanDoc）放行它和 # 开头的链接。
 */
import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { toast } from '../shell/ui';
import './anchors.css';

/** 能挂书签的块 */
export const ANCHOR_TYPES = ['heading', 'paragraph', 'listItem'];
/** 一个块最多记几个书签 */
const MAX_PER_BLOCK = 16;
/** 书签名：不含空白、控制字符和引号尖括号，最长 100 个字（Word 自己最长 40） */
const NAME = /^[^\s\p{Cc}"'<>`]{1,100}$/u;

/** 属性值里的书签名（去重、去掉不合规的） */
export const anchorNames = (v: unknown): string[] => (typeof v === 'string' ? [...new Set(v.split(/\s+/).filter((x) => NAME.test(x)))].slice(0, MAX_PER_BLOCK) : []);
/** 书签名合成属性值；一个都没有时是 null（不写这个属性） */
export const anchorValue = (names: string[]): string | null => { const n = anchorNames(names.join(' ')); return n.length ? n.join(' ') : null; };
export const validAnchor = (name: string) => NAME.test(name);

/** 链接地址里的书签名：#附录A、#%E9%99%84… 都认；不是 # 开头的返回 null */
export function anchorOfHref(href: string | null | undefined): string | null {
  if (!href || !href.startsWith('#')) return null;
  const raw = href.slice(1);
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** GitHub 给标题生成锚点的写法：小写、去掉标点（保留 - 和 _）、空格换成 - */
export const slugOf = (text: string) => text.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');

const isTop = (name: string) => name === '' || /^_?top$/i.test(name);
const textOf = (n: PmNode) => n.textContent.trim();

/** 书签在文档里的位置：先按 anchor 属性，再按标题的 slug 或原文。找不到时 null */
export function findAnchor(doc: PmNode, name: string): { pos: number; node: PmNode } | null {
  let hit: { pos: number; node: PmNode } | null = null, byHeading: { pos: number; node: PmNode } | null = null;
  doc.descendants((node, pos) => {
    if (hit) return false;
    if (!ANCHOR_TYPES.includes(node.type.name)) return true;
    if (anchorNames(node.attrs.anchor).includes(name)) { hit = { pos, node }; return false; }
    if (!byHeading && node.type.name === 'heading') { const t = textOf(node); if (t && (t === name || slugOf(t) === name.toLowerCase())) byHeading = { pos, node }; }
    return node.type.name === 'listItem';
  });
  return hit ?? byHeading;
}

/* ---------- 跳转 ---------- */

const flashKey = new PluginKey<DecorationSet>('anchorFlash');
/** 闪多久（毫秒），和 anchors.css 的动画一样长 */
const FLASH_MS = 1600;
/** 第几次跳转：到点只清自己那一次的高亮，连着点两个链接时不把后一次的清掉 */
let flashSeq = 0;

/** 滚动到书签所在的块；编辑时光标放到那一块的开头。找到了返回 true */
export function jumpTo(view: EditorView, name: string): boolean {
  const scroller = view.dom.closest('.ed-body') as HTMLElement | null;
  if (isTop(name)) { (scroller ?? document.scrollingElement)?.scrollTo({ top: 0, behavior: 'smooth' }); return true; }
  const hit = findAnchor(view.state.doc, name);
  if (!hit) { toast(`文档里找不到书签「${name}」`); return false; }
  const tr = view.state.tr.setMeta(flashKey, { from: hit.pos, to: hit.pos + hit.node.nodeSize });
  if (view.editable) tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos + 1)));
  view.dispatch(tr);
  const dom = view.nodeDOM(hit.pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const seq = ++flashSeq;
  window.setTimeout(() => { if (seq === flashSeq && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(flashKey, 'clear')); }, FLASH_MS);
  return true;
}

/** 这次点击落在文档内链接上时，给出书签名 */
function internalTarget(view: EditorView, event: MouseEvent): string | null {
  const el = event.target instanceof Element ? event.target.closest('a[href]') : null;
  return el && view.dom.contains(el) ? anchorOfHref(el.getAttribute('href')) : null;
}

/** 书签属性 + 点文档内链接跳转。优先级比链接（1000）高：编辑时链接扩展在 mouseup 里 window.open，要先拦下 */
export const Anchors = Extension.create({
  name: 'anchors',
  priority: 1100,
  addGlobalAttributes() {
    return [{
      types: ANCHOR_TYPES,
      attributes: {
        anchor: {
          default: null,
          keepOnSplit: false,
          parseHTML: (el) => anchorValue(anchorNames(el.getAttribute('data-anchor'))),
          renderHTML: (attrs) => (attrs.anchor ? { 'data-anchor': attrs.anchor } : {}),
        },
      },
    }];
  },
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: flashKey,
      state: {
        init: () => DecorationSet.empty,
        apply: (tr, set) => {
          const m = tr.getMeta(flashKey) as { from: number; to: number } | 'clear' | undefined;
          if (m === 'clear') return DecorationSet.empty;
          if (m) return DecorationSet.create(tr.doc, [Decoration.node(m.from, m.to, { class: 'anchor-flash' })]);
          return set.map(tr.mapping, tr.doc);
        },
      },
      props: {
        decorations: (state) => flashKey.getState(state),
        // 编辑时：mouseup 时链接扩展会 window.open。文档内链接这里接过来（返回 true 它就不处理了），跳转在下面的 click 里做
        handleClick: (view, _pos, event) => internalTarget(view, event) !== null,
        handleDOMEvents: {
          // 只读时浏览器会按 target="_blank" 新开窗口；编辑时没有默认动作。两种都在这里跳
          click: (view, event) => {
            const name = internalTarget(view, event);
            if (name === null) return false;
            event.preventDefault();
            if (!event.shiftKey) jumpTo(view, name);
            return true;
          },
          // 中键也会新开窗口
          auxclick: (view, event) => { if (internalTarget(view, event) === null) return false; event.preventDefault(); return true; },
        },
      },
    })];
  },
});

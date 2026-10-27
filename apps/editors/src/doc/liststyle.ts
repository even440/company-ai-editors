/**
 * 列表和编号的样式（用户 2026-10-27 转来同事反馈：列表只有圆点、编号只有 1.2.3，比较单一）：
 * 存在列表节点的 listStyle 属性上，页面上是 list-style-type；不设就是默认（项目符号实心圆、编号 1. 2. 3.）。
 * 平台 src/features/docs/schema.ts 也有同样的属性（协同转换时才不丢），content.ts 的 cleanDoc 按同一份名单清洗
 */
import { Extension } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';

/** 项目符号：实心圆、空心圆、方块 */
export const BULLET_STYLES = ['disc', 'circle', 'square'] as const;
/** 编号：1. / a. / A. / i. / I. / 一、 */
export const ORDERED_STYLES = ['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman', 'cjk-ideographic'] as const;
export type BulletStyle = (typeof BULLET_STYLES)[number];
export type OrderedStyle = (typeof ORDERED_STYLES)[number];

const pick = (v: string | null | undefined, list: readonly string[]) => (v && list.includes(v) ? v : null);
const attr = (list: readonly string[]) => ({
  default: null,
  parseHTML: (el: HTMLElement) => pick(el.style.listStyleType || el.getAttribute('data-list-style'), list),
  renderHTML: (a: Record<string, unknown>) => (typeof a.listStyle === 'string' && list.includes(a.listStyle) ? { style: `list-style-type: ${a.listStyle}`, 'data-list-style': a.listStyle } : {}),
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    listStyle: {
      /** 把光标所在的（最里面那层）列表改成这个样式；null 是默认 */
      setListStyle: (type: 'bulletList' | 'orderedList', style: string | null) => ReturnType;
    };
  }
}

/** 光标所在的（最里面那层）这种列表的样式：不在这种列表里时 undefined，默认样式是 null */
export function listStyleAt(state: EditorState, type: 'bulletList' | 'orderedList'): string | null | undefined {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === type) return typeof node.attrs.listStyle === 'string' ? node.attrs.listStyle : null;
  }
  return undefined;
}

export const ListStyle = Extension.create({
  name: 'listStyle',
  addGlobalAttributes() {
    return [
      { types: ['bulletList'], attributes: { listStyle: attr(BULLET_STYLES) } },
      { types: ['orderedList'], attributes: { listStyle: attr(ORDERED_STYLES) } },
    ];
  },
  addCommands() {
    return {
      // 用 tr 上的选区：和 toggleBulletList 这些串在一起时，看到的是刚建好的列表
      setListStyle: (type, style) => ({ tr, dispatch }) => {
        const { $from } = tr.selection;
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.type.name !== type) continue;
          if (dispatch) tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, listStyle: style });
          return true;
        }
        return false;
      },
    };
  },
});

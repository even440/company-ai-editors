/**
 * 行距（用户 2026-11-25：「找不到设置行间距的功能」）。
 * 存在标题和段落的 lineHeight 属性上，值是 Word 的「多倍行距」：1 是单倍、1.5 是 1.5 倍……（列表、表格里的字也是段落，一样能设）。
 * 页面上按 LINE_UNIT 换成 CSS 的 line-height：Word 的单倍行距在中文字体上大约是字号的 1.3 倍，这样设了以后和 Word 里看着差不多；
 * 没设的照正文默认的 1.75（大约是 Word 的 1.35 倍）。导出 Word 时写成多倍行距（export.ts）。
 * 只认 LINE_HEIGHTS 里这几种：工具栏设的、本编辑器复制出来的（data-line-height），以及 Word 粘贴过来的百分比（line-height:150%）里正好是这几种的；
 * 网页上的 line-height 不留（多半是原网页的排版，和文字颜色一样，见 textstyle.ts）。
 * 平台 src/features/docs/schema.ts 有同样的属性（协同转换、只读页面才认得），content.ts 的 cleanDoc 按同一份名单清洗
 */
import { Extension } from '@tiptap/core';

/** 工具栏上能选的行距（倍）。不设就是默认 */
export const LINE_HEIGHTS = [1, 1.15, 1.5, 2, 2.5, 3] as const;
/** 单倍行距是字号的几倍（CSS line-height） */
export const LINE_UNIT = 1.3;
const TYPES = ['heading', 'paragraph'];

/** 认得的行距；别的都是 null */
export const lineHeightOf = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && (LINE_HEIGHTS as readonly number[]).includes(n) ? n : null;
};
/** 页面上的 CSS line-height：保留三位小数，1.15 倍是 1.495 */
export const lineCss = (v: number) => String(Math.round(v * LINE_UNIT * 1000) / 1000);

/** 粘贴进来的：本编辑器复制出来的带 data-line-height；Word 的多倍行距是百分比 */
function parse(el: HTMLElement): number | null {
  const own = lineHeightOf(el.getAttribute('data-line-height'));
  if (own !== null) return own;
  const m = /^(\d{2,3}(?:\.\d+)?)%$/.exec(el.style.lineHeight.trim());
  return m ? lineHeightOf(Number(m[1]) / 100) : null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lineHeight: {
      /** 选中的标题和段落设成这个行距；null 是恢复默认 */
      setLineHeight: (v: number | null) => ReturnType;
    };
  }
}

export const LineHeight = Extension.create({
  name: 'lineHeight',
  addGlobalAttributes() {
    return [{
      types: TYPES,
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: parse,
          renderHTML: (a: Record<string, unknown>) => { const v = lineHeightOf(a.lineHeight); return v === null ? {} : { style: `line-height: ${lineCss(v)}`, 'data-line-height': String(v) }; },
        },
      },
    }];
  },
  addCommands() {
    return {
      setLineHeight: (v) => ({ commands }) => {
        const value = v === null ? null : lineHeightOf(v);
        if (v !== null && value === null) return false;
        return TYPES.map((t) => commands.updateAttributes(t, { lineHeight: value })).some(Boolean);
      },
    };
  },
});

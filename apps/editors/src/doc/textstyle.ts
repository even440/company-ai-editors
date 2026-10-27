/**
 * 字体、字号、文字颜色、底纹和对齐（用户 2026-10-27 转来同事反馈：没有常用的对齐方式，改不了字体、字号、字的颜色，不能给文字加底纹）。
 * 文字上的是 Tiptap 的 TextStyle（<span style>）加颜色、底纹、字体、字号四个属性；对齐是标题和段落的 textAlign。
 * 粘贴进来的样式只留看得出是特意设的：彩色的字（黑、白、灰多半是原网页的默认颜色，深色模式下会看不见）、偏浅的彩色底纹（白底、灰底、深色底不要）、
 * 下面列着的字体、pt 或 px 的字号；颜色统一存成 #RRGGBB。工具栏设的都在名单里，复制粘贴不会丢。
 * 平台 src/features/docs/schema.ts 也有同样的属性（协同转换时才不丢），content.ts 的 cleanDoc 再按格式清洗一遍
 */
import type { Extensions } from '@tiptap/core';
import { TextAlign } from '@tiptap/extension-text-align';
import { BackgroundColor, Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';

/** 对齐：左、中、右、两端；左对齐就是默认，不存 */
export const ALIGNS = ['left', 'center', 'right', 'justify'] as const;
export type Align = (typeof ALIGNS)[number];

/** 字体：值是 CSS 的 font-family，前面是 Windows 上的字体，没有时退到 Mac 上相近的；导出 Word 用第一个名字 */
export const FONTS: [string, string][] = [
  ['"Microsoft YaHei", "PingFang SC", sans-serif', '微软雅黑'],
  ['SimSun, "Songti SC", serif', '宋体'],
  ['SimHei, "Heiti SC", sans-serif', '黑体'],
  ['KaiTi, "Kaiti SC", STKaiti, serif', '楷体'],
  ['FangSong, STFangsong, serif', '仿宋'],
  ['Arial, Helvetica, sans-serif', 'Arial'],
  ['"Times New Roman", Times, serif', 'Times New Roman'],
  ['"Courier New", Courier, monospace', 'Courier New'],
];
/** 粘贴进来的字体按第一个名字认（Word 里常写中文名），换成上面那份的写法 */
const FONT_ALIAS: Record<string, string> = {
  'microsoft yahei': '微软雅黑', 微软雅黑: '微软雅黑',
  simsun: '宋体', nsimsun: '宋体', 宋体: '宋体', 新宋体: '宋体', 'songti sc': '宋体', stsong: '宋体',
  simhei: '黑体', 黑体: '黑体', 'heiti sc': '黑体', stheiti: '黑体',
  kaiti: '楷体', 楷体: '楷体', 楷体_gb2312: '楷体', 'kaiti sc': '楷体', stkaiti: '楷体',
  fangsong: '仿宋', 仿宋: '仿宋', 仿宋_gb2312: '仿宋', stfangsong: '仿宋',
  arial: 'Arial', helvetica: 'Arial', 'times new roman': 'Times New Roman', times: 'Times New Roman', 'courier new': 'Courier New', courier: 'Courier New',
};
const firstFont = (css: string) => css.split(',')[0].trim().replace(/^["']|["']$/g, '');
/** 认得的字体换成 FONTS 里的值；不认得时 null */
export function fontOf(css: unknown): string | null {
  if (typeof css !== 'string') return null;
  const exact = FONTS.find(([v]) => v === css.trim());
  if (exact) return exact[0];
  const label = FONT_ALIAS[firstFont(css).toLowerCase()];
  return FONTS.find(([, l]) => l === label)?.[0] ?? null;
}
/** 字体在 Word 里的名字 */
export const wordFont = (css: string) => firstFont(css);
/** 下拉框里显示的名字：认得的用中文名，不认得的用第一个字体名 */
export const fontLabel = (css: string) => FONTS.find(([v]) => v === css)?.[1] ?? firstFont(css);

/** 字号：pt（和 Word 一样），括号里是中文字号 */
export const SIZES: [string, string][] = [
  ['9pt', '9（小五）'], ['10pt', '10'], ['10.5pt', '10.5（五号）'], ['11pt', '11'], ['12pt', '12（小四）'], ['14pt', '14（四号）'], ['15pt', '15（小三）'],
  ['16pt', '16（三号）'], ['18pt', '18（小二）'], ['20pt', '20'], ['22pt', '22（二号）'], ['24pt', '24（小一）'], ['26pt', '26（一号）'], ['28pt', '28'],
  ['36pt', '36（小初）'], ['42pt', '42（初号）'], ['48pt', '48'], ['72pt', '72'],
];
/** 字号换成磅；只认 pt 和 px，6～96 磅以外的不认 */
export function ptOf(v: unknown): number | null {
  const m = typeof v === 'string' ? /^(\d{1,3}(?:\.\d{1,2})?)(pt|px)$/i.exec(v.trim()) : null;
  if (!m) return null;
  const pt = Number(m[1]) * (m[2].toLowerCase() === 'px' ? 0.75 : 1);
  return pt >= 6 && pt <= 96 ? pt : null;
}
const sizeOf = (v: string) => (ptOf(v) === null ? null : v.trim().toLowerCase());

/** 文字颜色：白底和深色模式下都看得清的几种 */
export const TEXT_COLORS: [string, string][] = [
  ['#8F959E', '灰色'], ['#F54A45', '红色'], ['#DE7802', '橙色'], ['#DC9B04', '黄色'], ['#2EA121', '绿色'], ['#3370FF', '蓝色'], ['#8B5CF6', '紫色'],
];
/** 底纹：偏浅的几种，深色模式下上面的字换成深色（doc.css） */
export const BG_COLORS: [string, string][] = [
  ['#E5E6EB', '灰色'], ['#FBBFBC', '红色'], ['#FED4A4', '橙色'], ['#FFF67A', '黄色'], ['#B7EDB1', '绿色'], ['#BACEFD', '蓝色'], ['#CDB2FA', '紫色'],
];

/** 颜色换成 #RRGGBB（大写）；认不出、几乎透明时 null。页面里借 canvas 认 rgb()、颜色名这些写法 */
let canvas: CanvasRenderingContext2D | null | undefined;
export function hexOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim(), m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) return '#' + (m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]).toUpperCase();
  if (canvas === undefined) canvas = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!canvas) return null;
  // 认不出的写法 fillStyle 不变，所以先放一个不会有人用的值
  canvas.fillStyle = '#010203'; canvas.fillStyle = s;
  const out = String(canvas.fillStyle);
  if (out === '#010203') return null;
  if (out.startsWith('#')) return out.toUpperCase();
  const r = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(out);
  if (!r || (r[4] !== undefined && Number(r[4]) < 0.5)) return null;
  return '#' + [r[1], r[2], r[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
/** 相对亮度（WCAG） */
const lum = (hex: string) => { const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const chroma = (hex: string) => { const c = channels(hex); return Math.max(...c) - Math.min(...c); };
const inList = (list: [string, string][], hex: string) => list.some(([v]) => v === hex);
/** 粘贴进来的文字颜色留不留：工具栏里的都留；别的要是彩色、不太深也不太浅 */
const keepColor = (v: string) => { const h = hexOf(v); return h && (inList(TEXT_COLORS, h) || (chroma(h) >= 0.3 && lum(h) >= 0.05 && lum(h) <= 0.7)) ? h : null; };
/** 粘贴进来的底纹留不留：工具栏里的都留；别的要是彩色而且偏浅 */
const keepBg = (v: string) => { const h = hexOf(v); return h && (inList(BG_COLORS, h) || (chroma(h) >= 0.15 && lum(h) >= 0.25)) ? h : null; };

/** 只在解析粘贴内容（HTML）时过滤这个属性：原来的 parseHTML 读出来的值，留不下就当没有 */
function filtered<E extends typeof Color | typeof BackgroundColor | typeof FontFamily | typeof FontSize>(ext: E, attr: string, keep: (v: string) => string | null): E {
  return ext.extend({
    addGlobalAttributes() {
      return (this.parent?.() ?? []).map((g) => ({
        ...g,
        attributes: Object.fromEntries(Object.entries(g.attributes).map(([k, a]) => [k, k !== attr ? a : {
          ...a,
          parseHTML: (el: HTMLElement) => { const raw = a?.parseHTML?.(el); return typeof raw === 'string' && raw.trim() ? keep(raw.trim()) : null; },
        }])),
      }));
    },
  }) as E;
}

/** 有这四种样式之一的 <span> 才算文字样式（Word 的高亮写成 background 简写）；别的 span（Word 里的 mso-*、网页的排版）不建空的样式 */
const STYLED = /(^|;)\s*(color|background|background-color|font-family|font-size)\s*:/i;

/** 文字样式和对齐的扩展，放进 schema.ts */
export const textStyleExtensions = (): Extensions => [
  TextStyle.extend({
    parseHTML() {
      return (this.parent?.() ?? []).map((rule) => ({
        ...rule,
        getAttrs: (el: HTMLElement | string) => (typeof el !== 'string' && STYLED.test(el.getAttribute('style') ?? '') ? rule.getAttrs?.(el as HTMLElement & string) ?? null : false),
      }));
    },
  }),
  filtered(Color, 'color', keepColor),
  filtered(BackgroundColor, 'backgroundColor', keepBg),
  filtered(FontFamily, 'fontFamily', fontOf),
  filtered(FontSize, 'fontSize', sizeOf),
  TextAlign.configure({ types: ['heading', 'paragraph'], alignments: [...ALIGNS] }),
];

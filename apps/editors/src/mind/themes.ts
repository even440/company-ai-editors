/**
 * 导图主题。simple-mind-map 0.14 只内置 default 一个主题（其余在另一个包里，我们不加依赖），所以这里自己定义几个。
 * 每个主题有浅色和深色两套配色，深色版注册成「名字-dark」，跟着平台主题切换；content 里只存基础名字。
 */
import MindMap from 'simple-mind-map';

export const THEMES: [string, string][] = [['default', '经典绿'], ['blue', '商务蓝'], ['fresh', '清新绿'], ['warm', '暖橙'], ['mono', '素雅灰']];
export const THEME_KEYS = THEMES.map((t) => t[0]);

interface Palette { bg: string; line: string; root: string; rootInk: string; second: string; secondInk: string; node: string }
const FONT = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

const config = (p: Palette): Record<string, unknown> => ({
  backgroundColor: p.bg,
  lineColor: p.line,
  lineWidth: 1.5,
  generalizationLineColor: p.line,
  root: { fillColor: p.root, color: p.rootInk, fontFamily: FONT, borderRadius: 8, startColor: p.root },
  second: { fillColor: p.second, color: p.secondInk, borderColor: p.line, fontFamily: FONT, borderRadius: 8, startColor: p.line },
  node: { color: p.node, fontFamily: FONT, startColor: p.line },
  generalization: { fillColor: p.second, color: p.secondInk, borderColor: p.line, fontFamily: FONT },
});

const LIGHT: Record<string, Palette> = {
  default: { bg: '#fafafa', line: '#549688', root: '#549688', rootInk: '#fff', second: '#fff', secondInk: '#565656', node: '#6a6d6c' },
  blue: { bg: '#f5f7fb', line: '#2f6bf2', root: '#2f6bf2', rootInk: '#fff', second: '#fff', secondInk: '#1a2233', node: '#3b4656' },
  fresh: { bg: '#f3faf5', line: '#17a35a', root: '#17a35a', rootInk: '#fff', second: '#fff', secondInk: '#1f2d24', node: '#3f5a48' },
  warm: { bg: '#fff8f0', line: '#e8770a', root: '#e8770a', rootInk: '#fff', second: '#fff', secondInk: '#33261a', node: '#5a4636' },
  mono: { bg: '#f6f6f7', line: '#6b7280', root: '#1f2937', rootInk: '#fff', second: '#fff', secondInk: '#111827', node: '#374151' },
};
const DARK: Record<string, Palette> = {
  default: { bg: '#14181f', line: '#5fb39f', root: '#3f8f7b', rootInk: '#fff', second: '#1c2430', secondInk: '#e6edf5', node: '#c5cfdc' },
  blue: { bg: '#0f1218', line: '#6c9bff', root: '#2f6bf2', rootInk: '#fff', second: '#1a2233', secondInk: '#eef1f6', node: '#c9d2e0' },
  fresh: { bg: '#0f1713', line: '#3dcc7f', root: '#17a35a', rootInk: '#fff', second: '#162019', secondInk: '#e8f3ec', node: '#b9d3c3' },
  warm: { bg: '#1a1410', line: '#ffa04d', root: '#e8770a', rootInk: '#fff', second: '#2a1f16', secondInk: '#f6ede4', node: '#d9c6b5' },
  mono: { bg: '#111317', line: '#8b93a1', root: '#e5e7eb', rootInk: '#111827', second: '#1b1f27', secondInk: '#e5e7eb', node: '#c3c9d4' },
};

let registered = false;
/** 注册所有主题（只做一次）；default 的浅色版用库自带的，其余都自定义 */
export function registerThemes() {
  if (registered) return;
  registered = true;
  for (const k of THEME_KEYS) {
    if (k !== 'default') MindMap.defineTheme(k, config(LIGHT[k]));
    MindMap.defineTheme(k + '-dark', config(DARK[k]));
  }
}

/** 实际交给 simple-mind-map 的主题名 */
export const themeId = (theme: string, dark: boolean) => (THEME_KEYS.includes(theme) ? theme : 'default') + (dark ? '-dark' : '');
